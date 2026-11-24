package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"goland/internal/plugins"
	"goland/internal/store"
)

const maxPluginUploadBytes = plugins.MaxPackageBytes + (1 << 20)

type pluginView struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Version     string            `json:"version"`
	APIVersion  int               `json:"apiVersion"`
	Description string            `json:"description,omitempty"`
	InstalledAt time.Time         `json:"installedAt"`
	Manifest    *plugins.Manifest `json:"manifest"`
}

func pluginViewFrom(rec store.PluginRecord) pluginView {
	view := pluginView{
		ID: rec.PluginID, Name: rec.Name, Version: rec.Version,
		APIVersion: rec.APIVersion, Description: rec.Description,
		InstalledAt: rec.InstalledAt,
	}
	var manifest plugins.Manifest
	if err := json.Unmarshal(rec.Manifest, &manifest); err == nil {
		view.Manifest = &manifest
	}
	return view
}

func (s *Server) listPlugins(w http.ResponseWriter, r *http.Request) {
	records, err := s.store.ListPlugins(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list plugins")
		return
	}
	views := make([]pluginView, 0, len(records))
	for _, rec := range records {
		views = append(views, pluginViewFrom(rec))
	}
	writeJSON(w, http.StatusOK, map[string]any{"plugins": views})
}

func (s *Server) installPluginFromPath(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	if strings.TrimSpace(body.Path) == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	installed, err := s.plugins.InstallDir(body.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_plugin", err.Error())
		return
	}
	s.finishInstall(w, r, installed)
}

func (s *Server) uploadPlugin(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPluginUploadBytes)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload", "expected a multipart zip upload in the package field")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("package")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload", "package file is required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxPluginUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload", "could not read package")
		return
	}
	if len(data) > maxPluginUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "plugin package is too large")
		return
	}
	installed, err := s.plugins.InstallZip(data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_plugin", err.Error())
		return
	}
	s.finishInstall(w, r, installed)
}

func (s *Server) finishInstall(w http.ResponseWriter, r *http.Request, installed *plugins.Installed) {
	user := currentUser(r)
	raw, err := json.Marshal(installed.Manifest)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not store plugin manifest")
		return
	}
	rec := &store.PluginRecord{
		PluginID: installed.Manifest.ID, Name: installed.Manifest.Name,
		Version: installed.Manifest.Version, APIVersion: installed.Manifest.APIVersion,
		Description: installed.Manifest.Description, Manifest: raw,
		PackageDir: installed.Dir, InstalledBy: user.ID,
	}
	if err := s.store.UpsertPlugin(r.Context(), rec); err != nil {
		s.log.Warn("store plugin failed", "plugin", rec.PluginID, "err", err)
		_ = s.plugins.RemoveVersion(rec.PluginID, rec.Version)
		writeError(w, http.StatusInternalServerError, "internal", "could not store plugin")
		return
	}
	s.audit(r, "plugin.install", rec.PluginID, rec.Version)
	writeJSON(w, http.StatusCreated, map[string]any{"plugin": pluginViewFrom(*rec)})
}

func (s *Server) uninstallPlugin(w http.ResponseWriter, r *http.Request) {
	pluginID := chi.URLParam(r, "pluginID")
	rec, err := s.store.FindPlugin(r.Context(), pluginID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "plugin not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin")
		return
	}
	s.pluginHosts.StopPlugin(pluginID)
	s.stopAllPluginWorkersForPlugin(pluginID)
	if err := s.plugins.RemoveAll(pluginID); err != nil {
		s.log.Warn("remove plugin package failed", "plugin", pluginID, "err", err)
	}
	if err := s.store.DeleteWorkspacePluginsForPlugin(r.Context(), pluginID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not detach plugin from workspaces")
		return
	}
	if err := s.store.DeletePlugin(r.Context(), pluginID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete plugin")
		return
	}
	s.audit(r, "plugin.uninstall", pluginID, rec.Version)
	w.WriteHeader(http.StatusNoContent)
}
