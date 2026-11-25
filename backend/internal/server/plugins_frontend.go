package server

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"goland/internal/store"
)

func (s *Server) pluginFrontendAsset(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	pluginID := chi.URLParam(r, "pluginID")
	state, err := s.store.FindWorkspacePlugin(r.Context(), ws.OwnerID, ws.ID, pluginID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && !state.Enabled) {
		writeError(w, http.StatusNotFound, "not_found", "plugin is not enabled")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin state")
		return
	}
	rec, err := s.store.FindPlugin(r.Context(), pluginID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "plugin not found")
		return
	}
	if err != nil || rec.PackageDir == "" {
		writeError(w, http.StatusInternalServerError, "internal", "could not load plugin package")
		return
	}
	asset := strings.TrimSpace(chi.URLParam(r, "*"))
	if asset == "" {
		writeError(w, http.StatusNotFound, "not_found", "asset not found")
		return
	}
	clean := filepath.Clean("/" + asset)
	rel := strings.TrimPrefix(clean, "/")
	if rel == "" || rel == "." || strings.HasPrefix(rel, "..") {
		writeError(w, http.StatusNotFound, "not_found", "asset not found")
		return
	}
	root, err := filepath.EvalSymlinks(rec.PackageDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "plugin package unavailable")
		return
	}
	full, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil || (full != root && !strings.HasPrefix(full, root+string(os.PathSeparator))) {
		writeError(w, http.StatusNotFound, "not_found", "asset not found")
		return
	}
	info, err := os.Stat(full)
	if err != nil || !info.Mode().IsRegular() {
		writeError(w, http.StatusNotFound, "not_found", "asset not found")
		return
	}
	if strings.HasSuffix(strings.ToLower(rel), ".html") || strings.HasSuffix(strings.ToLower(rel), ".htm") {
		w.Header().Set(
			"Content-Security-Policy",
			"default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'self'",
		)
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, full)
}
