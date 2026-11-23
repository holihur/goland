package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/websocket"

	"goland/internal/isolation"
)

func (s *Server) lspWS(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	language := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("language")))
	if language != "go" && language != "typescript" {
		writeError(w, http.StatusBadRequest, "invalid_language", "language must be go or typescript")
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
	command, args, err := s.lspCommand(language)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "lsp_unavailable", err.Error())
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(8 << 20)

	identity, err := s.workspaces.Identity(r.Context(), ws)
	if err != nil {
		_ = conn.WriteJSON(lspErrorNotification("could not prepare workspace user: " + err.Error()))
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = root
	cmd.Env = lspEnv(identity, root)
	identity.Apply(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = conn.WriteJSON(lspErrorNotification("could not create LSP stdin: " + err.Error()))
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = conn.WriteJSON(lspErrorNotification("could not create LSP stdout: " + err.Error()))
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = conn.WriteJSON(lspErrorNotification("could not create LSP stderr: " + err.Error()))
		return
	}
	if err := cmd.Start(); err != nil {
		_ = conn.WriteJSON(lspErrorNotification("could not start language server: " + err.Error()))
		return
	}
	s.log.Info("language server started", "language", language, "workspace", ws.ID.Hex(), "pid", cmd.Process.Pid)
	defer func() {
		cancel()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
		s.log.Info("language server stopped", "language", language, "workspace", ws.ID.Hex())
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			s.log.Debug("lsp stderr", "language", language, "line", scanner.Text())
		}
	}()

	var writeMu sync.Mutex
	writeFrame := func(body []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(websocket.TextMessage, body)
	}
	writeErr := func(err error) {
		_ = writeFrame(mustJSON(lspErrorNotification(err.Error())))
	}

	stdoutDone := make(chan struct{})
	go func() {
		defer close(stdoutDone)
		reader := bufio.NewReaderSize(stdout, 1<<20)
		for {
			body, err := readLSPFrame(reader)
			if err != nil {
				if !errors.Is(err, io.EOF) && !errors.Is(err, context.Canceled) {
					writeErr(fmt.Errorf("language server connection closed: %w", err))
				}
				return
			}
			if err := writeFrame(body); err != nil {
				return
			}
		}
	}()

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if len(payload) == 0 || len(payload) > 8<<20 {
			continue
		}
		var probe any
		if json.Unmarshal(payload, &probe) != nil {
			continue
		}
		frame := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(payload))
		if _, err := io.WriteString(stdin, frame); err != nil {
			return
		}
		if _, err := stdin.Write(payload); err != nil {
			return
		}
	}
}

func (s *Server) lspCommand(language string) (string, []string, error) {
	var configured string
	var args []string
	switch language {
	case "go":
		configured = s.cfg.GoPLS
	case "typescript":
		configured = s.cfg.TSServer
		args = []string{"--stdio"}
	default:
		return "", nil, errors.New("unsupported language")
	}
	if strings.Contains(configured, "/") {
		if !filepath.IsAbs(configured) {
			if abs, err := filepath.Abs(configured); err == nil {
				configured = abs
			}
		}
		if info, err := os.Stat(configured); err != nil || info.IsDir() {
			return "", nil, fmt.Errorf("language server binary not found at %s", configured)
		}
		return configured, args, nil
	}
	path, err := exec.LookPath(configured)
	if err != nil {
		return "", nil, fmt.Errorf("language server %q not installed; run `mise run tools`", configured)
	}
	return path, args, nil
}

func readLSPFrame(reader *bufio.Reader) ([]byte, error) {
	length := -1
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(line), "content-length:") {
			value := strings.TrimSpace(line[len("content-length:"):])
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 0 || parsed > 16<<20 {
				return nil, errors.New("invalid Content-Length")
			}
			length = parsed
		}
	}
	if length < 0 {
		return nil, errors.New("missing Content-Length")
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	return body, nil
}

func lspErrorNotification(message string) map[string]any {
	return map[string]any{
		"jsonrpc": "2.0",
		"method":  "goland/error",
		"params":  map[string]string{"message": message},
	}
}

func mustJSON(v any) []byte {
	data, _ := json.Marshal(v)
	return data
}

func lspEnv(identity *isolation.Identity, root string) []string {
	return identity.Env(root)
}
