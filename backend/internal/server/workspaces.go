package server

import (
	"errors"
	"net/http"
	"strings"

	"goland/internal/store"
	"goland/internal/workspace"
)

func (s *Server) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	list, err := s.workspaces.List(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list workspaces")
		return
	}
	if list == nil {
		list = []store.Workspace{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": list})
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		Source  string `json:"source"`
		Path    string `json:"path"`
		RepoURL string `json:"repoUrl"`
		Branch  string `json:"branch"`
		Token   string `json:"token"`
	}
	if !decodeJSON(w, r, &body, 128<<10) {
		return
	}
	if len(body.Name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_name", "name is too long")
		return
	}
	user := currentUser(r)
	var (
		ws  *store.Workspace
		err error
	)
	switch body.Source {
	case "local":
		ws, err = s.workspaces.CreateLocal(r.Context(), user.ID, body.Name, body.Path)
	case "git":
		ws, err = s.workspaces.CreateGit(r.Context(), user.ID, body.Name, body.RepoURL, body.Branch, body.Token)
	default:
		writeError(w, http.StatusBadRequest, "invalid_source", "source must be local or git")
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, workspace.ErrPathNotAllowed):
			writeError(w, http.StatusForbidden, "path_not_allowed", err.Error())
		case errors.Is(err, workspace.ErrInvalidGitURL):
			writeError(w, http.StatusBadRequest, "invalid_git_url", err.Error())
		default:
			s.log.Warn("create workspace failed", "err", err)
			writeError(w, http.StatusBadRequest, "workspace_failed", err.Error())
		}
		return
	}
	s.audit(r, "workspace.create", ws.ID.Hex(), body.Source)
	writeJSON(w, http.StatusCreated, map[string]any{"workspace": ws})
}

func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace": ws})
}

func (s *Server) deleteWorkspace(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	if err := s.workspaces.Delete(r.Context(), ws.OwnerID, ws.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not delete workspace")
		return
	}
	s.audit(r, "workspace.delete", ws.ID.Hex(), ws.Name)
	w.WriteHeader(http.StatusNoContent)
}

func cleanQueryPath(r *http.Request) string {
	return strings.TrimSpace(r.URL.Query().Get("path"))
}
