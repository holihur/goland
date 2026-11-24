package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	"goland/internal/plugins"
	"goland/internal/store"
)

var (
	errPluginDisabled  = errors.New("plugin is not enabled for this workspace")
	errPluginPackage   = errors.New("stored plugin package is invalid")
	errPluginNotFound  = errors.New("plugin not found")
	errCommandNotFound = errors.New("plugin command not found")
)

func (s *Server) pluginManifest(rec *store.PluginRecord) (*plugins.Manifest, error) {
	manifest, err := plugins.ParseManifest(rec.Manifest)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errPluginPackage, err)
	}
	return manifest, nil
}

func (s *Server) ensurePluginHost(ctx context.Context, ws *store.Workspace, rec *store.PluginRecord, state *store.WorkspacePluginRecord) (*plugins.Host, error) {
	if state == nil || !state.Enabled {
		return nil, errPluginDisabled
	}
	manifest, err := s.pluginManifest(rec)
	if err != nil {
		return nil, err
	}
	if err := plugins.ValidatePackage(manifest, rec.PackageDir); err != nil {
		return nil, fmt.Errorf("%w: %v", errPluginPackage, err)
	}
	identity, err := s.workspaces.Identity(ctx, ws)
	if err != nil {
		return nil, fmt.Errorf("workspace identity: %w", err)
	}
	spec := plugins.HostSpec{
		WorkspaceID: ws.ID.Hex(),
		PluginID:    rec.PluginID,
		Root:        ws.RootPath,
		Executable:  filepath.Join(rec.PackageDir, filepath.FromSlash(manifest.Executable)),
		Config:      plugins.ConfigWithDefaults(manifest, state.Config),
		Identity:    identity,
		Sink:        s.pluginEvents.publish,
		Logger:      s.log,
	}
	return s.pluginHosts.Ensure(ctx, spec)
}

func (s *Server) executePluginCommand(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	rec, ok := s.workspacePluginRecord(w, r)
	if !ok {
		return
	}
	state, err := s.store.FindWorkspacePlugin(r.Context(), ws.OwnerID, ws.ID, rec.PluginID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "plugin_disabled", "plugin is not enabled for this workspace")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin state")
		return
	}
	manifest, err := s.pluginManifest(rec)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "invalid_plugin", err.Error())
		return
	}
	commandID := chi.URLParam(r, "commandID")
	var command *plugins.Command
	for i := range manifest.Contributes.Commands {
		if manifest.Contributes.Commands[i].ID == commandID {
			command = &manifest.Contributes.Commands[i]
			break
		}
	}
	if command == nil {
		writeError(w, http.StatusNotFound, "command_not_found", "plugin command not found")
		return
	}
	var body struct {
		RequestID string             `json:"requestId"`
		Args      []string           `json:"args"`
		Inputs    map[string]any     `json:"inputs"`
		Path      string             `json:"path"`
		Selection *plugins.Selection `json:"selection"`
	}
	if !decodeJSON(w, r, &body, 1<<20) {
		return
	}
	host, err := s.ensurePluginHost(r.Context(), ws, rec, state)
	if err != nil {
		status := http.StatusServiceUnavailable
		code := "debugger_unavailable"
		if errors.Is(err, errPluginDisabled) {
			status, code = http.StatusConflict, "plugin_disabled"
		} else if errors.Is(err, errPluginPackage) {
			status, code = http.StatusInternalServerError, "invalid_plugin"
		}
		writeError(w, status, code, err.Error())
		return
	}
	started := time.Now()
	result, err := host.ExecuteCommand(r.Context(), plugins.CommandRequest{
		RequestID: body.RequestID,
		CommandID: commandID,
		Args:      append(append([]string{}, command.Args...), body.Args...),
		Inputs:    body.Inputs,
		Path:      body.Path,
		Selection: body.Selection,
	})
	elapsed := time.Since(started)
	if err != nil {
		status, code := http.StatusBadGateway, "plugin_failed"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			status, code = http.StatusGatewayTimeout, "plugin_timeout"
		}
		s.audit(r, "plugin.command.failed", ws.ID.Hex(), rec.PluginID+":"+commandID+":"+elapsed.String())
		_ = result
		writeError(w, status, code, err.Error())
		return
	}
	s.audit(r, "plugin.command", ws.ID.Hex(), rec.PluginID+":"+commandID+":"+elapsed.String())
	writeJSON(w, http.StatusOK, map[string]any{
		"requestId": body.RequestID,
		"commandId": commandID,
		"output":    result.Output,
		"result":    result.Result,
	})
}

func (s *Server) cancelPluginCommand(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	rec, ok := s.workspacePluginRecord(w, r)
	if !ok {
		return
	}
	var body struct {
		RequestID string `json:"requestId"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	if body.RequestID == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "requestId is required")
		return
	}
	host, healthy := s.pluginHosts.Get(ws.ID.Hex(), rec.PluginID)
	if !healthy {
		writeError(w, http.StatusNotFound, "plugin_not_running", "plugin is not running")
		return
	}
	if err := host.Cancel(body.RequestID); err != nil {
		writeError(w, http.StatusBadGateway, "cancel_failed", err.Error())
		return
	}
	s.audit(r, "plugin.cancel", ws.ID.Hex(), rec.PluginID+":"+body.RequestID)
	w.WriteHeader(http.StatusNoContent)
}
