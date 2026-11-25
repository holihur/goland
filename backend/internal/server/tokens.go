package server

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"goland/internal/auth"
	"goland/internal/store"
)

type tokenView struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Scopes     []string   `json:"scopes"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

func tokenViewFrom(token store.APIToken) tokenView {
	return tokenView{
		ID: token.ID.Hex(), Name: token.Name, Scopes: token.Scopes,
		ExpiresAt: token.ExpiresAt, LastUsedAt: token.LastUsedAt, CreatedAt: token.CreatedAt,
	}
}

func sessionRequired(w http.ResponseWriter, r *http.Request) bool {
	if auth.TokenFrom(r.Context()) != nil {
		writeError(w, http.StatusForbidden, "session_required", "personal access tokens cannot manage tokens")
		return true
	}
	return false
}

func (s *Server) listAPITokens(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	user := currentUser(r)
	tokens, err := s.store.ListAPITokens(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list tokens")
		return
	}
	views := make([]tokenView, 0, len(tokens))
	for _, token := range tokens {
		views = append(views, tokenViewFrom(token))
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": views})
}

func (s *Server) createAPIToken(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	var body struct {
		Name          string   `json:"name"`
		Scopes        []string `json:"scopes"`
		ExpiresInDays int      `json:"expiresInDays"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_name", "token name is required and must be at most 100 characters")
		return
	}
	if len(body.Scopes) == 0 {
		body.Scopes = []string{"read", "write", "git", "run", "mcp"}
	}
	seen := map[string]bool{}
	scopes := make([]string, 0, len(body.Scopes))
	for _, scope := range body.Scopes {
		scope = strings.TrimSpace(scope)
		if !auth.ValidTokenScopes[scope] {
			writeError(w, http.StatusBadRequest, "invalid_scope", "unknown token scope: "+scope)
			return
		}
		if !seen[scope] {
			seen[scope] = true
			scopes = append(scopes, scope)
		}
	}
	if len(scopes) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_scope", "at least one scope is required")
		return
	}
	if body.ExpiresInDays < 0 || body.ExpiresInDays > 3650 {
		writeError(w, http.StatusBadRequest, "invalid_expiry", "expiry must be between 1 and 3650 days, or 0 for never")
		return
	}
	raw, err := auth.RandomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not generate token")
		return
	}
	value := "glpat_" + raw
	token := &store.APIToken{
		UserID: currentUser(r).ID, Name: name, TokenHash: auth.TokenHash(value), Scopes: scopes,
	}
	if body.ExpiresInDays > 0 {
		expires := time.Now().UTC().Add(time.Duration(body.ExpiresInDays) * 24 * time.Hour)
		token.ExpiresAt = &expires
	}
	if err := s.store.CreateAPIToken(r.Context(), token); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save token")
		return
	}
	s.audit(r, "auth.token.create", token.ID.Hex(), strings.Join(scopes, ","))
	writeJSON(w, http.StatusCreated, map[string]any{
		"token": value, "record": tokenViewFrom(*token),
	})
}

func (s *Server) deleteAPIToken(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "tokenID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "token not found")
		return
	}
	if err := s.store.DeleteAPIToken(r.Context(), currentUser(r).ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "token not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not delete token")
		return
	}
	s.audit(r, "auth.token.delete", id.Hex(), "")
	w.WriteHeader(http.StatusNoContent)
}
