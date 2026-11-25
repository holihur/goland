package server

import (
	"net/http"
	"strconv"
	"strings"

	"goland/internal/files"
)

func (s *Server) contentSearch(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	regex, _ := strconv.ParseBool(r.URL.Query().Get("regex"))
	caseSensitive, _ := strconv.ParseBool(r.URL.Query().Get("caseSensitive"))
	result, err := s.files.ContentSearch(ws, files.ContentOptions{
		Query: r.URL.Query().Get("q"), Path: cleanQueryPath(r),
		Regex: regex, CaseSensitive: caseSensitive, Limit: limit,
	})
	if err != nil {
		mapFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) replaceContent(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		Query         string `json:"query"`
		Replacement   string `json:"replacement"`
		Path          string `json:"path"`
		Regex         bool   `json:"regex"`
		CaseSensitive bool   `json:"caseSensitive"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	if strings.TrimSpace(body.Query) == "" {
		writeError(w, http.StatusBadRequest, "invalid_query", "query is required")
		return
	}
	result, err := s.files.ContentReplace(ws, files.ContentOptions{
		Query: body.Query, Replacement: body.Replacement, Path: body.Path,
		Regex: body.Regex, CaseSensitive: body.CaseSensitive,
	})
	if err != nil {
		mapFileError(w, err)
		return
	}
	s.audit(r, "file.replace", ws.ID.Hex(), body.Query)
	writeJSON(w, http.StatusOK, result)
}
