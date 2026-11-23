package server

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

func (s *Server) debugConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.workspaceFor(w, r); !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chrome": s.cfg.Chrome, "node": s.cfg.Node, "dlv": s.cfg.DLV,
	})
}

func (s *Server) debugWS(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	kind := strings.ToLower(chi.URLParam(r, "kind"))
	if kind != "go" && kind != "node" && kind != "browser" {
		writeError(w, http.StatusBadRequest, "invalid_kind", "debug kind must be go, node or browser")
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	if !s.originAllowed(r) {
		writeError(w, http.StatusForbidden, "origin", "websocket origin is not allowed")
		return
	}

	sessionID := strings.TrimSpace(r.URL.Query().Get("session"))
	var (
		sess    *debugSession
		adapter *debugAdapter
		conn    net.Conn
	)
	if sessionID != "" {
		sess = s.findDebugSession(ws.ID.Hex(), ws.OwnerID.Hex(), kind, sessionID)
		if sess == nil {
			writeError(w, http.StatusNotFound, "session_not_found", "debug session not found")
			return
		}
		s.debugMu.Lock()
		sess.refs++
		if sess.timer != nil {
			sess.timer.Stop()
			sess.timer = nil
		}
		address := sess.address
		s.debugMu.Unlock()
		conn, err = net.DialTimeout("tcp", address, 3*time.Second)
		if err != nil {
			s.releaseDebug(sess.id)
			writeError(w, http.StatusBadGateway, "adapter_unavailable", "could not connect to debug adapter")
			return
		}
	} else {
		identity, err := s.workspaces.Identity(r.Context(), ws)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "isolation_failed", err.Error())
			return
		}
		adapter, err = s.startDebugAdapter(context.Background(), kind, root, identity)
		if err != nil {
			s.log.Warn("debug adapter failed", "kind", kind, "err", err)
			writeError(w, http.StatusServiceUnavailable, "debugger_unavailable", err.Error())
			return
		}
		sess = &debugSession{
			id: randomID(), owner: ws.OwnerID.Hex(), workspace: ws.ID.Hex(), kind: kind,
			cmd: adapter.cmd, address: adapter.address, refs: 1,
		}
		s.debugMu.Lock()
		s.debugSess[sess.id] = sess
		s.debugMu.Unlock()
		conn = adapter.conn
	}

	conn2, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		_ = conn.Close()
		s.releaseDebug(sess.id)
		return
	}
	defer conn2.Close()
	defer s.releaseDebug(sess.id)
	conn2.SetReadLimit(16 << 20)
	_ = conn2.WriteJSON(map[string]any{
		"seq": 0, "type": "event", "event": "goland/adapter",
		"body": map[string]string{"id": sess.id},
	})

	s.audit(r, "debug.start", ws.ID.Hex(), kind)
	s.log.Info("debug session connected", "kind", kind, "workspace", ws.ID.Hex(), "id", sess.id, "adapter", sess.address)
	trace := os.Getenv("GOLAND_DEBUG_DAP_TRACE") != ""
	traceFrame := func(direction string, body []byte) {
		if !trace {
			return
		}
		text := string(body)
		if len(text) > 2000 {
			text = text[:2000] + "…"
		}
		s.log.Info("dap trace", "direction", direction, "kind", kind, "body", text)
	}

	var writeMu sync.Mutex
	writeWS := func(body []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn2.WriteMessage(websocket.TextMessage, body)
	}
	writeTCP := func(body []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		frame := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(body))
		if _, err := io.WriteString(conn, frame); err != nil {
			return err
		}
		_, err := conn.Write(body)
		return err
	}

	go func() {
		reader := bufio.NewReaderSize(conn, 1<<20)
		for {
			body, err := readLSPFrame(reader)
			if err != nil {
				if !errors.Is(err, io.EOF) {
					s.log.Debug("debug adapter read ended", "err", err)
				}
				_ = conn2.Close()
				return
			}
			traceFrame("adapter->client", body)
			if err := writeWS(body); err != nil {
				return
			}
		}
	}()

	for {
		_, payload, err := conn2.ReadMessage()
		if err != nil {
			return
		}
		if len(payload) == 0 || len(payload) > 16<<20 {
			continue
		}
		traceFrame("client->adapter", payload)
		if err := writeTCP(payload); err != nil {
			return
		}
	}
}

func (s *Server) findDebugSession(workspaceID, ownerID, kind, id string) *debugSession {
	s.debugMu.Lock()
	defer s.debugMu.Unlock()
	sess := s.debugSess[id]
	if sess == nil || sess.workspace != workspaceID || sess.owner != ownerID || sess.kind != kind {
		return nil
	}
	return sess
}

func (s *Server) releaseDebug(id string) {
	s.debugMu.Lock()
	defer s.debugMu.Unlock()
	sess := s.debugSess[id]
	if sess == nil {
		return
	}
	sess.refs--
	if sess.refs > 0 {
		return
	}
	if sess.timer != nil {
		sess.timer.Stop()
	}
	sess.timer = time.AfterFunc(5*time.Second, func() {
		s.debugMu.Lock()
		current := s.debugSess[id]
		if current == nil || current.refs > 0 {
			s.debugMu.Unlock()
			return
		}
		delete(s.debugSess, id)
		s.debugMu.Unlock()
		if current.cmd != nil && current.cmd.Process != nil {
			_ = syscall.Kill(-current.cmd.Process.Pid, syscall.SIGKILL)
			_ = current.cmd.Wait()
		}
		s.log.Info("debug adapter stopped", "id", id)
	})
}

type debugAdapter struct {
	cmd     *exec.Cmd
	conn    net.Conn
	address string
}

type debugSession struct {
	id        string
	owner     string
	workspace string
	kind      string
	cmd       *exec.Cmd
	address   string
	refs      int
	timer     *time.Timer
}

func randomID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func (d *debugAdapter) Close() {
	if d.conn != nil {
		_ = d.conn.Close()
	}
	if d.cmd != nil && d.cmd.Process != nil {
		_ = syscall.Kill(-d.cmd.Process.Pid, syscall.SIGKILL)
		_ = d.cmd.Wait()
	}
}

func (s *Server) startDebugAdapter(ctx context.Context, kind, root string, identity interface {
	Apply(*exec.Cmd)
	Env(string) []string
}) (*debugAdapter, error) {
	var command string
	var args []string
	switch kind {
	case "go":
		if s.cfg.DLV == "" {
			return nil, errors.New("Delve is not configured")
		}
		command = s.cfg.DLV
		args = []string{"dap", "--listen=127.0.0.1:0", "--only-same-user=false"}
	default:
		if s.cfg.JsDebug == "" {
			return nil, errors.New("js-debug is not installed")
		}
		command = s.cfg.Node
		args = []string{s.cfg.JsDebug, "0", "127.0.0.1"}
	}
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = root
	env := identity.Env(root)
	env = append(env, "CHROME_BIN="+s.cfg.Chrome)
	cmd.Env = env
	identity.Apply(cmd)
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start debug adapter: %w", err)
	}
	addrCh := make(chan string, 1)
	scan := func(reader io.Reader, source string) {
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		sent := false
		for scanner.Scan() {
			line := scanner.Text()
			if !sent {
				if addr := extractListeningAddress(line); addr != "" {
					sent = true
					select {
					case addrCh <- addr:
					default:
					}
					continue
				}
			}
			s.log.Info("debug adapter output", "kind", kind, "source", source, "line", line)
		}
	}
	go scan(stdout, "stdout")
	go scan(stderr, "stderr")

	var address string
	select {
	case address = <-addrCh:
	case <-time.After(20 * time.Second):
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Wait()
		return nil, errors.New("debug adapter did not start listening in time")
	case <-ctx.Done():
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Wait()
		return nil, ctx.Err()
	}

	var conn net.Conn
	for i := 0; i < 30; i++ {
		conn, err = net.DialTimeout("tcp", address, time.Second)
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			break
		case <-time.After(100 * time.Millisecond):
		}
	}
	if err != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Wait()
		return nil, fmt.Errorf("connect to debug adapter: %w", err)
	}
	return &debugAdapter{cmd: cmd, conn: conn, address: address}, nil
}

func extractListeningAddress(line string) string {
	lower := strings.ToLower(line)
	idx := strings.Index(lower, "listening at")
	if idx < 0 {
		return ""
	}
	addr := strings.TrimSpace(line[idx+len("listening at"):])
	addr = strings.TrimSpace(strings.TrimPrefix(addr, ":"))
	host, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		return ""
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}

var _ = os.Getpid
