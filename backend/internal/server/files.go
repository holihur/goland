package server

import (
	"net/http"
	"strconv"
	"strings"

	"goland/internal/files"
)

func (s *Server) listTree(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	entries, err := s.files.List(ws, cleanQueryPath(r))
	if err != nil {
		mapFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "path": cleanQueryPath(r)})
}

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	rel := cleanQueryPath(r)
	if rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	content, err := s.files.Read(ws, rel)
	if err != nil {
		mapFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, content)
}

func (s *Server) writeFile(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		ETag    string `json:"etag"`
	}
	if !decodeJSON(w, r, &body, 16<<20) {
		return
	}
	if strings.TrimSpace(body.Path) == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	content, err := s.files.Write(ws, body.Path, body.Content, body.ETag)
	if err != nil {
		mapFileError(w, err)
		return
	}
	s.audit(r, "file.write", ws.ID.Hex(), body.Path)
	writeJSON(w, http.StatusOK, content)
}

func (s *Server) createEntry(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Path string `json:"path"`
		Kind string `json:"kind"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	body.Kind = strings.TrimSpace(body.Kind)
	if body.Kind != "file" && body.Kind != "dir" {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind must be file or dir")
		return
	}
	if strings.TrimSpace(body.Path) == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	entry, err := s.files.Create(ws, body.Path, body.Kind)
	if err != nil {
		mapFileError(w, err)
		return
	}
	s.audit(r, "file.create", ws.ID.Hex(), body.Path)
	writeJSON(w, http.StatusCreated, entry)
}

func (s *Server) renameEntry(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if !decodeJSON(w, r, &body, 32<<10) {
		return
	}
	if strings.TrimSpace(body.From) == "" || strings.TrimSpace(body.To) == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "from and to are required")
		return
	}
	if err := s.files.Rename(ws, body.From, body.To); err != nil {
		mapFileError(w, err)
		return
	}
	s.audit(r, "file.rename", ws.ID.Hex(), body.From+" -> "+body.To)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteEntry(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	rel := cleanQueryPath(r)
	if rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	recursive, _ := strconv.ParseBool(r.URL.Query().Get("recursive"))
	if err := s.files.Delete(ws, rel, recursive); err != nil {
		mapFileError(w, err)
		return
	}
	s.audit(r, "file.delete", ws.ID.Hex(), rel)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	results, err := s.files.Search(ws, r.URL.Query().Get("q"), limit)
	if err != nil {
		mapFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

var _ = files.MaxFileSize
