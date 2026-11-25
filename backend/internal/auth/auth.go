package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"

	"goland/internal/store"
)

const (
	SessionCookie = "goland_session"
	CSRFCookie    = "goland_csrf"
	CSRFHeader    = "X-CSRF-Token"
)

type ctxKey struct{}
type tokenKey struct{}
type sessionKey struct{}

type Manager struct {
	Store   *store.Store
	TTL     time.Duration
	Secure  bool
	Now     func() time.Time
	Argon   argonParams
	randErr error
}

type argonParams struct {
	time    uint32
	memory  uint32
	threads uint8
	keyLen  uint32
	saltLen uint32
}

func NewManager(st *store.Store, ttl time.Duration, secure bool) *Manager {
	return &Manager{
		Store: st, TTL: ttl, Secure: secure, Now: time.Now,
		Argon: argonParams{time: 2, memory: 32 * 1024, threads: 2, keyLen: 32, saltLen: 16},
	}
}

func (m *Manager) HashPassword(password string) (string, error) {
	salt := make([]byte, m.Argon.saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, m.Argon.time, m.Argon.memory, m.Argon.threads, m.Argon.keyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		m.Argon.memory, m.Argon.time, m.Argon.threads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(want, got) == 1
}

func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func TokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (m *Manager) CreateSession(ctx context.Context, userID interface{ IsZero() bool }, r *http.Request) (*store.Session, string, string, error) {
	_ = userID
	return nil, "", "", errors.New("use CreateSessionForUser")
}

func (m *Manager) Login(ctx context.Context, user *store.User, r *http.Request) (sessionToken, csrfToken string, err error) {
	return m.CreateSessionForUser(ctx, user, r, true, m.TTL)
}

func (m *Manager) CreateSessionForUser(ctx context.Context, user *store.User, r *http.Request, mfaVerified bool, ttl time.Duration) (sessionToken, csrfToken string, err error) {
	token, err := RandomToken(32)
	if err != nil {
		return "", "", err
	}
	csrf, err := RandomToken(32)
	if err != nil {
		return "", "", err
	}
	if ttl <= 0 {
		ttl = m.TTL
	}
	now := m.Now().UTC()
	sess := &store.Session{
		UserID: user.ID, TokenHash: TokenHash(token), ExpiresAt: now.Add(ttl),
		CreatedAt: now, UserAgent: r.UserAgent(), MFAVerified: mfaVerified,
	}
	if err := m.Store.CreateSession(ctx, sess); err != nil {
		return "", "", err
	}
	return token, csrf, nil
}

func (m *Manager) SetCookies(w http.ResponseWriter, sessionToken, csrfToken string) {
	maxAge := int(m.TTL.Seconds())
	http.SetCookie(w, &http.Cookie{
		Name: SessionCookie, Value: sessionToken, Path: "/", HttpOnly: true,
		Secure: m.Secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	})
	http.SetCookie(w, &http.Cookie{
		Name: CSRFCookie, Value: csrfToken, Path: "/", HttpOnly: false,
		Secure: m.Secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	})
}

func (m *Manager) ClearCookies(w http.ResponseWriter) {
	for _, name := range []string{SessionCookie, CSRFCookie} {
		http.SetCookie(w, &http.Cookie{
			Name: name, Value: "", Path: "/", HttpOnly: name == SessionCookie,
			Secure: m.Secure, SameSite: http.SameSiteLaxMode, MaxAge: -1,
		})
	}
}

func (m *Manager) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(strings.ToLower(header), "bearer ") {
			raw := strings.TrimSpace(header[len("bearer "):])
			token, err := m.Store.FindAPITokenByHash(r.Context(), TokenHash(raw))
			if err != nil || (token.ExpiresAt != nil && token.ExpiresAt.Before(m.Now().UTC())) {
				http.Error(w, `{"error":{"code":"unauthorized","message":"invalid or expired API token"}}`, http.StatusUnauthorized)
				return
			}
			user, err := m.Store.FindUserByID(r.Context(), token.UserID)
			if err != nil {
				http.Error(w, `{"error":{"code":"unauthorized","message":"user not found"}}`, http.StatusUnauthorized)
				return
			}
			go m.Store.TouchAPIToken(context.Background(), token.ID)
			ctx := context.WithValue(r.Context(), ctxKey{}, user)
			ctx = context.WithValue(ctx, tokenKey{}, token)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		c, err := r.Cookie(SessionCookie)
		if err != nil || c.Value == "" {
			http.Error(w, `{"error":{"code":"unauthorized","message":"authentication required"}}`, http.StatusUnauthorized)
			return
		}
		sess, err := m.Store.FindSessionByHash(r.Context(), TokenHash(c.Value))
		if err != nil {
			http.Error(w, `{"error":{"code":"unauthorized","message":"session expired"}}`, http.StatusUnauthorized)
			return
		}
		user, err := m.Store.FindUserByID(r.Context(), sess.UserID)
		if err != nil {
			http.Error(w, `{"error":{"code":"unauthorized","message":"user not found"}}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), ctxKey{}, user)
		ctx = context.WithValue(ctx, sessionKey{}, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (m *Manager) RequireMFA(required bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path == "/api/auth/me" || path == "/api/auth/logout" || strings.HasPrefix(path, "/api/auth/mfa/") {
				next.ServeHTTP(w, r)
				return
			}
			if TokenFrom(r.Context()) != nil {
				next.ServeHTTP(w, r)
				return
			}
			user := UserFrom(r.Context())
			sess := SessionFrom(r.Context())
			if user == nil || sess == nil {
				http.Error(w, `{"error":{"code":"unauthorized","message":"authentication required"}}`, http.StatusUnauthorized)
				return
			}
			if user.MFAEnabled && !sess.MFAVerified {
				http.Error(w, `{"error":{"code":"mfa_required","message":"multi-factor authentication required"}}`, http.StatusForbidden)
				return
			}
			if required && !user.MFAEnabled {
				http.Error(w, `{"error":{"code":"mfa_setup_required","message":"multi-factor authentication enrollment required"}}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (m *Manager) CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if TokenFrom(r.Context()) != nil {
			next.ServeHTTP(w, r)
			return
		}
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		c, err := r.Cookie(CSRFCookie)
		header := r.Header.Get(CSRFHeader)
		if err != nil || c.Value == "" || header == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(header)) != 1 {
			http.Error(w, `{"error":{"code":"csrf","message":"invalid CSRF token"}}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (m *Manager) Logout(ctx context.Context, r *http.Request) {
	c, err := r.Cookie(SessionCookie)
	if err == nil && c.Value != "" {
		_ = m.Store.DeleteSessionByHash(ctx, TokenHash(c.Value))
	}
}

func UserFrom(ctx context.Context) *store.User {
	u, _ := ctx.Value(ctxKey{}).(*store.User)
	return u
}

func TokenFrom(ctx context.Context) *store.APIToken {
	token, _ := ctx.Value(tokenKey{}).(*store.APIToken)
	return token
}

func SessionFrom(ctx context.Context) *store.Session {
	sess, _ := ctx.Value(sessionKey{}).(*store.Session)
	return sess
}

func TokenHasScope(token *store.APIToken, scope string) bool {
	if token == nil {
		return false
	}
	for _, item := range token.Scopes {
		if item == scope || item == "*" {
			return true
		}
	}
	return false
}

var ValidTokenScopes = map[string]bool{
	"read": true, "write": true, "git": true, "run": true, "mcp": true, "ai": true,
}

func IsAdmin(u *store.User) bool { return u != nil && u.Role == "admin" }
