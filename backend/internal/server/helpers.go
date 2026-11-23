package server

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"goland/internal/auth"
	"goland/internal/files"
	"goland/internal/store"
)

type apiError struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var e apiError
	e.Error.Code, e.Error.Message = code, message
	writeJSON(w, status, e)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any, limit int64) bool {
	if limit <= 0 {
		limit = 1 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "request body is too large")
		} else {
			writeError(w, http.StatusBadRequest, "bad_json", "invalid JSON body")
		}
		return false
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		writeError(w, http.StatusBadRequest, "bad_json", "request body must contain a single JSON object")
		return false
	}
	return true
}

func currentUser(r *http.Request) *store.User { return auth.UserFrom(r.Context()) }

func parseID(w http.ResponseWriter, raw string) (primitive.ObjectID, bool) {
	id, err := primitive.ObjectIDFromHex(raw)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return primitive.NilObjectID, false
	}
	return id, true
}

func (s *Server) workspaceFor(w http.ResponseWriter, r *http.Request) (*store.Workspace, bool) {
	user := auth.UserFrom(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return nil, false
	}
	id, ok := parseID(w, chi.URLParam(r, "workspaceID"))
	if !ok {
		return nil, false
	}
	ws, err := s.workspaces.Get(r.Context(), user.ID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "workspace not found")
		return nil, false
	}
	return ws, true
}

func (s *Server) audit(r *http.Request, action, resource, detail string) {
	var userID *primitive.ObjectID
	if u := auth.UserFrom(r.Context()); u != nil {
		id := u.ID
		userID = &id
	}
	s.store.RecordAudit(r.Context(), &store.AuditEvent{
		UserID: userID, Action: action, Resource: resource,
		Detail: detail, IP: r.RemoteAddr, CreatedAt: time.Now().UTC(),
	})
}

func mapFileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, files.ErrPathEscape):
		writeError(w, http.StatusBadRequest, "invalid_path", "path escapes the workspace")
	case errors.Is(err, files.ErrProtected):
		writeError(w, http.StatusForbidden, "protected_path", "path is protected")
	case errors.Is(err, files.ErrIsDirectory):
		writeError(w, http.StatusBadRequest, "is_directory", "path is a directory")
	case errors.Is(err, files.ErrNotDirectory):
		writeError(w, http.StatusBadRequest, "not_directory", "path is not a directory")
	case errors.Is(err, files.ErrConflict):
		writeError(w, http.StatusConflict, "conflict", "file changed since it was read")
	case errors.Is(err, files.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "file is too large")
	case errors.Is(err, files.ErrBinary):
		writeError(w, http.StatusUnsupportedMediaType, "binary", "binary file")
	case errors.Is(err, fs.ErrNotExist):
		writeError(w, http.StatusNotFound, "not_found", "file not found")
	default:
		writeError(w, http.StatusInternalServerError, "internal", "filesystem operation failed")
	}
}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
