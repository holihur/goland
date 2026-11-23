package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"

	"goland/internal/isolation"
)

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  32 << 10,
	WriteBufferSize: 32 << 10,
	CheckOrigin:     func(*http.Request) bool { return true },
}

func (s *Server) terminalInfo(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"root": root, "shell": shellPath()})
}

func (s *Server) terminalWS(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
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
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Warn("terminal websocket upgrade failed", "err", err)
		return
	}
	defer conn.Close()
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(24 * time.Hour))

	identity, err := s.workspaces.Identity(r.Context(), ws)
	if err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": "could not prepare workspace user: " + err.Error()})
		return
	}
	cmd := exec.Command(shellPath(), "-l")
	cmd.Dir = root
	cmd.Env = terminalEnv(identity, root)
	identity.Apply(cmd)
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 100, Rows: 30})
	if err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": "could not start terminal: " + err.Error()})
		return
	}
	defer func() {
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			killSession(cmd.Process.Pid)
		}
	}()

	var writeMu sync.Mutex
	writeBinary := func(data []byte) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.WriteMessage(websocket.BinaryMessage, data)
	}
	writeControl := func(v any) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.WriteJSON(v)
	}

	exited := make(chan struct{})
	go func() {
		buf := make([]byte, 32<<10)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				writeBinary(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		err := cmd.Wait()
		code := 0
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
		}
		writeControl(map[string]any{"type": "exit", "exitCode": code})
		close(exited)
		_ = conn.Close()
	}()

	for {
		select {
		case <-exited:
			return
		default:
		}
		_, data, err := conn.ReadMessage()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				s.log.Debug("terminal socket closed", "err", err)
			}
			return
		}
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
			Cols uint16 `json:"cols"`
			Rows uint16 `json:"rows"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "input":
			if msg.Data != "" {
				_, _ = ptmx.Write([]byte(msg.Data))
			}
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Cols: msg.Cols, Rows: msg.Rows})
			}
		}
	}
}

func (s *Server) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	normalized := strings.TrimSuffix(origin, "/")
	for _, allowed := range s.cfg.AllowedOrigins {
		if strings.EqualFold(normalized, allowed) {
			return true
		}
	}
	return strings.EqualFold(u.Host, r.Host)
}

func killSession(sessionID int) {
	entries, _ := os.ReadDir("/proc")
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		data, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if err != nil {
			continue
		}
		closeParen := strings.LastIndexByte(string(data), ')')
		if closeParen < 0 || closeParen+2 >= len(data) {
			continue
		}
		fields := strings.Fields(string(data[closeParen+2:]))
		if len(fields) < 4 {
			continue
		}
		sid, err := strconv.Atoi(fields[3])
		if err == nil && sid == sessionID && pid != os.Getpid() {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	}
}

func shellPath() string {
	for _, candidate := range []string{"/bin/bash", "/bin/zsh", "/bin/sh"} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return "/bin/sh"
}

func terminalEnv(identity *isolation.Identity, root string) []string {
	env := identity.Env(root)
	for i := range env {
		if strings.HasPrefix(env[i], "TERM=") {
			env[i] = "TERM=xterm-256color"
		}
	}
	return append(env, "COLORTERM=truecolor")
}
