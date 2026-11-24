package server

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"goland/internal/plugins"
	"goland/internal/store"
)

type workspacePluginView struct {
	pluginView
	Enabled   bool           `json:"enabled"`
	Config    map[string]any `json:"config"`
	Defaults  map[string]any `json:"defaults,omitempty"`
	Health    string         `json:"health"`
	LastError string         `json:"lastError,omitempty"`
}

func (s *Server) pluginHealth(workspaceID, pluginID string) (string, string) {
	host, healthy := s.pluginHosts.Get(workspaceID, pluginID)
	if host == nil {
		return "stopped", ""
	}
	if healthy {
		return "running", ""
	}
	return "error", host.LastError()
}

func (s *Server) listWorkspacePlugins(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	installed, err := s.store.ListPlugins(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list plugins")
		return
	}
	states, err := s.store.ListWorkspacePlugins(r.Context(), ws.OwnerID, ws.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list workspace plugins")
		return
	}
	byID := make(map[string]store.WorkspacePluginRecord, len(states))
	for _, state := range states {
		byID[state.PluginID] = state
	}
	views := make([]workspacePluginView, 0, len(installed))
	for _, rec := range installed {
		view := workspacePluginView{pluginView: pluginViewFrom(rec), Config: map[string]any{}}
		if view.Manifest != nil {
			view.Defaults = view.Manifest.ConfigDefaults()
		}
		if state, ok := byID[rec.PluginID]; ok {
			view.Enabled = state.Enabled
			if state.Config != nil {
				view.Config = state.Config
			}
		}
		view.Health, view.LastError = s.pluginHealth(ws.ID.Hex(), rec.PluginID)
		views = append(views, view)
	}
	writeJSON(w, http.StatusOK, map[string]any{"plugins": views})
}

func (s *Server) updateWorkspacePlugin(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	rec, ok := s.workspacePluginRecord(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled bool           `json:"enabled"`
		Config  map[string]any `json:"config"`
	}
	if !decodeJSON(w, r, &body, 256<<10) {
		return
	}
	manifest, err := plugins.ParseManifest(rec.Manifest)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "invalid_plugin", "stored plugin manifest is invalid")
		return
	}
	existing, err := s.store.FindWorkspacePlugin(r.Context(), ws.OwnerID, ws.ID, rec.PluginID)
	config := map[string]any{}
	if err == nil && existing.Config != nil {
		for key, value := range existing.Config {
			config[key] = value
		}
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin state")
		return
	}
	if body.Config != nil {
		config = body.Config
		if err := plugins.ValidateConfig(manifest, config); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_config", err.Error())
			return
		}
	} else if body.Enabled {
		if err := plugins.ValidateConfig(manifest, config); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_config", err.Error())
			return
		}
	}
	state := &store.WorkspacePluginRecord{
		WorkspaceID: ws.ID, OwnerID: ws.OwnerID, PluginID: rec.PluginID,
		Enabled: body.Enabled, Config: config,
	}
	if err := s.store.UpsertWorkspacePlugin(r.Context(), state); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save plugin state")
		return
	}
	if body.Enabled {
		if body.Config != nil || !s.pluginHostsHealthy(ws.ID.Hex(), rec.PluginID) {
			s.pluginHosts.Stop(ws.ID.Hex(), rec.PluginID)
			s.stopPluginWorkers(ws.ID.Hex(), rec.PluginID)
		}
		if _, err := s.ensurePluginHost(r.Context(), ws, rec, state); err != nil {
			s.log.Warn("plugin start failed", "plugin", rec.PluginID, "workspace", ws.ID.Hex(), "err", err)
			// Roll the enablement back so a broken package cannot stay enabled.
			state.Enabled = false
			_ = s.store.UpsertWorkspacePlugin(r.Context(), state)
			writeError(w, http.StatusBadGateway, "plugin_start_failed", err.Error())
			return
		}
	} else {
		s.pluginHosts.Stop(ws.ID.Hex(), rec.PluginID)
		s.stopPluginWorkers(ws.ID.Hex(), rec.PluginID)
	}
	action := "plugin.disable"
	if body.Enabled {
		action = "plugin.enable"
	}
	s.audit(r, action, ws.ID.Hex(), rec.PluginID)
	view := workspacePluginView{
		pluginView: pluginViewFrom(*rec), Enabled: state.Enabled, Config: config,
		Defaults: manifest.ConfigDefaults(),
	}
	view.Health, view.LastError = s.pluginHealth(ws.ID.Hex(), rec.PluginID)
	writeJSON(w, http.StatusOK, map[string]any{"plugin": view})
}

func (s *Server) removeWorkspacePlugin(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	pluginID := chi.URLParam(r, "pluginID")
	if _, err := s.store.FindPlugin(r.Context(), pluginID); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "plugin not found")
		return
	}
	s.pluginHosts.Stop(ws.ID.Hex(), pluginID)
	s.stopPluginWorkers(ws.ID.Hex(), pluginID)
	if err := s.store.DeleteWorkspacePlugin(r.Context(), ws.OwnerID, ws.ID, pluginID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not remove plugin state")
		return
	}
	s.audit(r, "plugin.remove", ws.ID.Hex(), pluginID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) workspacePluginRecord(w http.ResponseWriter, r *http.Request) (*store.PluginRecord, bool) {
	pluginID := chi.URLParam(r, "pluginID")
	rec, err := s.store.FindPlugin(r.Context(), pluginID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "plugin not found")
		return nil, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin")
		return nil, false
	}
	return rec, true
}

func (s *Server) pluginHostsHealthy(workspaceID, pluginID string) bool {
	_, healthy := s.pluginHosts.Get(workspaceID, pluginID)
	return healthy
}
