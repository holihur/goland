package server

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"goland/internal/auth"
	"goland/internal/config"
	"goland/internal/store"
)

type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]*loginEntry
}

type loginEntry struct {
	failures int
	blocked  time.Time
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{entries: make(map[string]*loginEntry)}
}

func (l *loginLimiter) key(ip, email string) string { return ip + "|" + email }

func (l *loginLimiter) blocked(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[key]
	if e == nil || e.blocked.IsZero() {
		return false, 0
	}
	if time.Now().After(e.blocked) {
		delete(l.entries, key)
		return false, 0
	}
	return true, time.Until(e.blocked)
}

func (l *loginLimiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[key]
	if e == nil {
		e = &loginEntry{}
		l.entries[key] = e
	}
	e.failures++
	if e.failures >= 5 {
		e.failures = 0
		e.blocked = time.Now().Add(time.Minute)
	}
}

func (l *loginLimiter) success(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

func BootstrapAdmin(ctx context.Context, st *store.Store, cfg *config.Config) error {
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return errors.New("GOLAND_ADMIN_EMAIL and GOLAND_ADMIN_PASSWORD are required for bootstrap")
	}
	_, err := st.FindUserByEmail(ctx, cfg.AdminEmail)
	if err == nil {
		return nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	if len(cfg.AdminPassword) < 10 {
		return errors.New("GOLAND_ADMIN_PASSWORD must be at least 10 characters")
	}
	am := auth.NewManager(st, cfg.SessionTTL, cfg.SecureCookies)
	hash, err := am.HashPassword(cfg.AdminPassword)
	if err != nil {
		return err
	}
	u := &store.User{
		Email: cfg.AdminEmail, Name: cfg.AdminName, Role: "admin", PasswordHash: hash,
	}
	return st.CreateUser(ctx, u)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	email := normalizeEmail(body.Email)
	if email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "invalid_credentials", "email and password are required")
		return
	}
	ip := r.RemoteAddr
	key := s.limiter.key(ip, email)
	if blocked, wait := s.limiter.blocked(key); blocked {
		w.Header().Set("Retry-After", strings.TrimSpace(wait.Round(time.Second).String()))
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many login attempts")
		return
	}
	user, err := s.store.FindUserByEmail(r.Context(), email)
	if err != nil || !auth.VerifyPassword(user.PasswordHash, body.Password) {
		s.limiter.fail(key)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}
	s.limiter.success(key)
	if user.MFAEnabled {
		challenge, _, err := s.auth.CreateSessionForUser(r.Context(), user, r, false, 5*time.Minute)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not create MFA challenge")
			return
		}
		s.audit(r, "auth.login.mfa_challenge", user.ID.Hex(), "")
		writeJSON(w, http.StatusOK, map[string]any{"mfaRequired": true, "challengeToken": challenge, "user": user})
		return
	}
	verified := !s.cfg.MFARequired
	token, csrf, err := s.auth.CreateSessionForUser(r.Context(), user, r, verified, s.auth.TTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not create session")
		return
	}
	s.auth.SetCookies(w, token, csrf)
	s.audit(r, "auth.login", user.ID.Hex(), "")
	writeJSON(w, http.StatusOK, map[string]any{
		"user": user, "csrfToken": csrf,
		"mfaSetupRequired": s.cfg.MFARequired && !user.MFAEnabled,
	})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.auth.Logout(r.Context(), r)
	s.auth.ClearCookies(w)
	s.audit(r, "auth.logout", "", "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list users")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	email := normalizeEmail(body.Email)
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		writeError(w, http.StatusBadRequest, "invalid_email", "a valid email is required")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	if len(name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_name", "name is too long")
		return
	}
	if len(body.Password) < 10 || len(body.Password) > 256 {
		writeError(w, http.StatusBadRequest, "weak_password", "password must be 10-256 characters")
		return
	}
	role := body.Role
	if role == "" {
		role = "member"
	}
	if role != "member" && role != "admin" {
		writeError(w, http.StatusBadRequest, "invalid_role", "role must be member or admin")
		return
	}
	hash, err := s.auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not hash password")
		return
	}
	user := &store.User{Email: email, Name: name, Role: role, PasswordHash: hash}
	if err := s.store.CreateUser(r.Context(), user); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "email_taken", "email is already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not create user")
		return
	}
	s.audit(r, "admin.user.create", user.ID.Hex(), role)
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}
