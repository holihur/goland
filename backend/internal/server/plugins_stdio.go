package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"goland/internal/plugins"
	"goland/internal/store"
)

func (s *Server) pluginLSPWS(w http.ResponseWriter, r *http.Request) {
	ws, rec, manifest, ok := s.enabledPluginForWS(w, r)
	if !ok {
		return
	}
	serverID := strings.TrimSpace(chi.URLParam(r, "serverID"))
	var language *plugins.Language
	for i := range manifest.Contributes.Languages {
		if manifest.Contributes.Languages[i].ID == serverID {
			language = &manifest.Contributes.Languages[i]
			break
		}
	}
	if language == nil {
		writeError(w, http.StatusNotFound, "language_not_found", "plugin language not found")
		return
	}
	s.proxyPluginWorker(w, r, ws, rec, "lsp", language.Server)
}

func (s *Server) pluginDAPWS(w http.ResponseWriter, r *http.Request) {
	ws, rec, manifest, ok := s.enabledPluginForWS(w, r)
	if !ok {
		return
	}
	kind := strings.TrimSpace(chi.URLParam(r, "kind"))
	var debugger *plugins.Debugger
	for i := range manifest.Contributes.Debuggers {
		if manifest.Contributes.Debuggers[i].Kind == kind {
			debugger = &manifest.Contributes.Debuggers[i]
			break
		}
	}
	if debugger == nil {
		writeError(w, http.StatusNotFound, "debugger_not_found", "plugin debugger not found")
		return
	}
	s.proxyPluginWorker(w, r, ws, rec, "dap", debugger.Server)
}

func (s *Server) enabledPluginForWS(w http.ResponseWriter, r *http.Request) (*store.Workspace, *store.PluginRecord, *plugins.Manifest, bool) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return nil, nil, nil, false
	}
	pluginID := chi.URLParam(r, "pluginID")
	rec, err := s.store.FindPlugin(r.Context(), pluginID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "plugin not found")
		return nil, nil, nil, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin")
		return nil, nil, nil, false
	}
	state, err := s.store.FindWorkspacePlugin(r.Context(), ws.OwnerID, ws.ID, pluginID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && !state.Enabled) {
		writeError(w, http.StatusConflict, "plugin_disabled", "plugin is not enabled for this workspace")
		return nil, nil, nil, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin state")
		return nil, nil, nil, false
	}
	manifest, err := s.pluginManifest(rec)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "invalid_plugin", err.Error())
		return nil, nil, nil, false
	}
	return ws, rec, manifest, true
}

func (s *Server) proxyPluginWorker(w http.ResponseWriter, r *http.Request, ws *store.Workspace, rec *store.PluginRecord, kind string, server plugins.Server) {
	if !s.originAllowed(r) {
		writeError(w, http.StatusForbidden, "origin", "websocket origin is not allowed")
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	executable := filepath.Join(rec.PackageDir, filepath.FromSlash(server.Command))
	identity, err := s.workspaces.Identity(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "isolation_failed", err.Error())
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(16 << 20)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, server.Args...)
	cmd.Dir = root
	cmd.Env = identity.Env(root)
	identity.Apply(cmd)
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = conn.WriteJSON(pluginWorkerError(kind, "could not create plugin stdin: "+err.Error()))
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = conn.WriteJSON(pluginWorkerError(kind, "could not create plugin stdout: "+err.Error()))
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = conn.WriteJSON(pluginWorkerError(kind, "could not create plugin stderr: "+err.Error()))
		return
	}
	if err := cmd.Start(); err != nil {
		_ = conn.WriteJSON(pluginWorkerError(kind, "could not start plugin "+kind+" server: "+err.Error()))
		return
	}
	stop := func() {
		cancel()
		if cmd.Process != nil {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
	}
	unregister := s.registerPluginWorker(ws.ID.Hex(), rec.PluginID, stop)
	defer unregister()
	defer func() {
		cancel()
		if cmd.Process != nil {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		_ = cmd.Wait()
		s.log.Info("plugin worker stopped", "kind", kind, "plugin", rec.PluginID, "workspace", ws.ID.Hex())
	}()
	s.log.Info("plugin worker started", "kind", kind, "plugin", rec.PluginID, "workspace", ws.ID.Hex(), "pid", cmd.Process.Pid)

	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			s.log.Debug("plugin worker stderr", "kind", kind, "plugin", rec.PluginID, "line", scanner.Text())
		}
	}()

	var writeMu sync.Mutex
	writeFrame := func(body []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(websocket.TextMessage, body)
	}
	stdoutDone := make(chan struct{})
	go func() {
		defer close(stdoutDone)
		reader := bufio.NewReaderSize(stdout, 1<<20)
		for {
			body, err := readLSPFrame(reader)
			if err != nil {
				if !errors.Is(err, io.EOF) && !errors.Is(err, context.Canceled) {
					_ = writeFrame(mustJSON(pluginWorkerError(kind, fmt.Sprintf("%s server closed: %v", kind, err))))
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
		if len(payload) == 0 || len(payload) > 16<<20 {
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

func pluginWorkerError(kind, message string) map[string]any {
	if kind == "dap" {
		return map[string]any{
			"jsonrpc": "2.0", "type": "event", "event": "output",
			"body": map[string]any{"category": "stderr", "output": message + "\n"},
		}
	}
	return lspErrorNotification(message)
}

func (s *Server) registerPluginWorker(workspaceID, pluginID string, stop func()) func() {
	key := workspaceID + "\x00" + pluginID
	workerID := randomID()
	s.pluginMu.Lock()
	if s.pluginWorkers[key] == nil {
		s.pluginWorkers[key] = make(map[string]func())
	}
	s.pluginWorkers[key][workerID] = stop
	s.pluginMu.Unlock()
	return func() {
		s.pluginMu.Lock()
		delete(s.pluginWorkers[key], workerID)
		if len(s.pluginWorkers[key]) == 0 {
			delete(s.pluginWorkers, key)
		}
		s.pluginMu.Unlock()
	}
}

func (s *Server) stopPluginWorkers(workspaceID, pluginID string) {
	key := workspaceID + "\x00" + pluginID
	s.pluginMu.Lock()
	stops := make([]func(), 0, len(s.pluginWorkers[key]))
	for _, stop := range s.pluginWorkers[key] {
		stops = append(stops, stop)
	}
	delete(s.pluginWorkers, key)
	s.pluginMu.Unlock()
	for _, stop := range stops {
		stop()
	}
}

func (s *Server) stopWorkspacePluginWorkers(workspaceID string) {
	prefix := workspaceID + "\x00"
	s.pluginMu.Lock()
	var stops []func()
	for key, workers := range s.pluginWorkers {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		for _, stop := range workers {
			stops = append(stops, stop)
		}
		delete(s.pluginWorkers, key)
	}
	s.pluginMu.Unlock()
	for _, stop := range stops {
		stop()
	}
}

func (s *Server) stopAllPluginWorkersForPlugin(pluginID string) {
	suffix := "\x00" + pluginID
	s.pluginMu.Lock()
	var stops []func()
	for key, workers := range s.pluginWorkers {
		if !strings.HasSuffix(key, suffix) {
			continue
		}
		for _, stop := range workers {
			stops = append(stops, stop)
		}
		delete(s.pluginWorkers, key)
	}
	s.pluginMu.Unlock()
	for _, stop := range stops {
		stop()
	}
}
