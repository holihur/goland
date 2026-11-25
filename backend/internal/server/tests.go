package server

import (
	"context"
	"errors"
	"net/http"
	"os/exec"
	"strings"
	"time"

	testpkg "goland/internal/tests"
)

func (s *Server) listTests(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	discovery, err := testpkg.Discover(root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tests_failed", "could not discover tests")
		return
	}
	writeJSON(w, http.StatusOK, discovery)
}

func (s *Server) runTest(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var item testpkg.Item
	if !decodeJSON(w, r, &item, 64<<10) {
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	command, args, err := testpkg.Command(root, item)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_test", err.Error())
		return
	}
	identity, err := s.workspaces.Identity(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "workspace_user", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	start := time.Now()
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = root
	cmd.Env = identity.Env(root)
	identity.Apply(cmd)
	out, err := cmd.CombinedOutput()
	output := string(out)
	if len(output) > 2<<20 {
		output = output[:2<<20] + "\n… output truncated"
	}
	result := testpkg.Result{
		Status: "success", ExitCode: 0, Output: strings.TrimSpace(output),
		DurationMS: time.Since(start).Milliseconds(),
	}
	if err != nil {
		result.Status = "failed"
		result.ExitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			result.ExitCode = exitErr.ExitCode()
		}
		if ctx.Err() != nil {
			result.Status = "timeout"
		}
	}
	s.audit(r, "test.run", ws.ID.Hex(), item.Kind+":"+item.Path+":"+item.Name)
	writeJSON(w, http.StatusOK, result)
}
