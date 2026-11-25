package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"goland/internal/git"
	"goland/internal/plugins"
)

func (s *Server) gitStatus(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	st, err := s.git.Status(r.Context(), ws)
	if err != nil {
		s.gitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) gitDiff(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	cached := r.URL.Query().Get("cached") == "true"
	diff, err := s.git.Diff(r.Context(), ws, cleanQueryPath(r), cached)
	if err != nil {
		s.gitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"diff": diff, "cached": cached})
}

func (s *Server) gitStage(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	if err := s.git.Stage(r.Context(), ws, body.Path); err != nil {
		s.gitError(w, err)
		return
	}
	s.audit(r, "git.stage", ws.ID.Hex(), body.Path)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gitUnstage(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Path string `json:"path"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	if err := s.git.Unstage(r.Context(), ws, body.Path); err != nil {
		s.gitError(w, err)
		return
	}
	s.audit(r, "git.unstage", ws.ID.Hex(), body.Path)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gitCommit(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	status, statusErr := s.git.Status(r.Context(), ws)
	files := []string{}
	branch := ws.Branch
	if statusErr == nil {
		branch = status.Branch
		for i, file := range status.Files {
			if i >= 200 {
				break
			}
			files = append(files, file.Path)
		}
	}
	_, hookErr := s.runPluginHooks(r.Context(), ws, plugins.HookPreCommit, plugins.HookRequest{
		Path: "", Branch: branch, Files: files, Message: body.Message,
		DiffStat: fmt.Sprintf("%d changed file(s)", len(files)),
	})
	if hookErr != nil {
		writeHookError(w, hookErr)
		return
	}
	user := currentUser(r)
	out, err := s.git.Commit(r.Context(), ws, body.Message, user.Name, user.Email)
	if err != nil {
		s.gitError(w, err)
		return
	}
	s.audit(r, "git.commit", ws.ID.Hex(), "")
	writeJSON(w, http.StatusOK, map[string]any{"output": out})
}

func (s *Server) gitBranches(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	branches, err := s.git.Branches(r.Context(), ws)
	if err != nil {
		s.gitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"branches": branches})
}

func (s *Server) gitCreateBranch(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Branch string `json:"branch"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	if err := s.git.CreateBranch(r.Context(), ws, body.Branch); err != nil {
		s.gitError(w, err)
		return
	}
	ws.Branch = body.Branch
	_ = s.store.UpdateWorkspace(r.Context(), ws)
	s.audit(r, "git.branch.create", ws.ID.Hex(), body.Branch)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gitCheckout(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Branch string `json:"branch"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	if err := s.git.Checkout(r.Context(), ws, body.Branch); err != nil {
		s.gitError(w, err)
		return
	}
	ws.Branch = body.Branch
	_ = s.store.UpdateWorkspace(r.Context(), ws)
	s.audit(r, "git.checkout", ws.ID.Hex(), body.Branch)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gitPull(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	out, err := s.git.Pull(r.Context(), ws)
	if err != nil {
		s.gitError(w, err)
		return
	}
	// Post-pull hooks are advisory: failures must not roll back a fast-forward.
	_, _ = s.runPluginHooks(r.Context(), ws, plugins.HookPostPull, plugins.HookRequest{Branch: ws.Branch})
	s.audit(r, "git.pull", ws.ID.Hex(), "")
	writeJSON(w, http.StatusOK, map[string]any{"output": out})
}

func (s *Server) gitPush(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	out, err := s.git.Push(r.Context(), ws)
	if err != nil {
		s.gitError(w, err)
		return
	}
	s.audit(r, "git.push", ws.ID.Hex(), "")
	writeJSON(w, http.StatusOK, map[string]any{"output": out})
}

func (s *Server) gitLog(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	out, err := s.git.Log(r.Context(), ws)
	if err != nil {
		s.gitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"log": out})
}

func (s *Server) gitError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, git.ErrNotRepo):
		writeError(w, http.StatusBadRequest, "not_a_repo", "workspace is not a git repository")
	case errors.Is(err, context.DeadlineExceeded):
		writeError(w, http.StatusGatewayTimeout, "git_timeout", "git operation timed out")
	default:
		writeError(w, http.StatusConflict, "git_failed", err.Error())
	}
}

func (s *Server) gitConflict(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	rel := cleanQueryPath(r)
	if rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	conflict, err := s.git.Conflict(r.Context(), ws, rel)
	if err != nil {
		s.gitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conflict)
}

func (s *Server) gitResolve(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Path       string `json:"path"`
		Resolution string `json:"resolution"`
		Content    string `json:"content"`
	}
	if !decodeJSON(w, r, &body, 6<<20) {
		return
	}
	if body.Path == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	if err := s.git.ResolveConflict(r.Context(), ws, body.Path, body.Resolution, body.Content); err != nil {
		s.gitError(w, err)
		return
	}
	s.audit(r, "git.resolve", ws.ID.Hex(), body.Path+":"+body.Resolution)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gitApplyPatch(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Patch   string `json:"patch"`
		Reverse bool   `json:"reverse"`
	}
	if !decodeJSON(w, r, &body, 3<<20) {
		return
	}
	if err := s.git.ApplyPatch(r.Context(), ws, body.Patch, body.Reverse); err != nil {
		s.gitError(w, err)
		return
	}
	s.audit(r, "git.patch", ws.ID.Hex(), "")
	w.WriteHeader(http.StatusNoContent)
}
