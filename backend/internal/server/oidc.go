package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"goland/internal/auth"
	"goland/internal/config"
	"goland/internal/store"
)

const oidcStateCookie = "goland_oidc_state"

type oidcManager struct {
	cfg      *config.Config
	mu       sync.Mutex
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	lastErr  error
	loadedAt time.Time
}

type oidcState struct {
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
	Redirect string `json:"redirect"`
	Expires  int64  `json:"expires"`
}

type oidcClaims struct {
	Email             string `json:"email"`
	EmailVerified     bool   `json:"email_verified"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
}

func newOIDCManager(cfg *config.Config) *oidcManager {
	return &oidcManager{cfg: cfg}
}

func (m *oidcManager) enabled() bool {
	return m.cfg.OIDCIssuer != "" && m.cfg.OIDCClientID != ""
}

func (m *oidcManager) load(ctx context.Context) (*oidc.Provider, *oidc.IDTokenVerifier, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.provider != nil && time.Since(m.loadedAt) < 30*time.Minute {
		return m.provider, m.verifier, nil
	}
	if !m.enabled() {
		return nil, nil, errors.New("OIDC is not configured")
	}
	loadCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	provider, err := oidc.NewProvider(loadCtx, m.cfg.OIDCIssuer)
	if err != nil {
		m.lastErr = err
		return nil, nil, fmt.Errorf("OIDC discovery failed: %w", err)
	}
	m.provider = provider
	m.verifier = provider.Verifier(&oidc.Config{ClientID: m.cfg.OIDCClientID})
	m.loadedAt = time.Now()
	m.lastErr = nil
	return m.provider, m.verifier, nil
}

func (m *oidcManager) redirectURL(r *http.Request) string {
	if m.cfg.OIDCRedirectURL != "" {
		return m.cfg.OIDCRedirectURL
	}
	base := m.cfg.PublicURL
	if base == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]); forwarded == "http" || forwarded == "https" {
			scheme = forwarded
		}
		base = scheme + "://" + r.Host
	}
	return strings.TrimRight(base, "/") + "/api/auth/oidc/callback"
}

func (m *oidcManager) oauth(redirect string, provider *oidc.Provider) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     m.cfg.OIDCClientID,
		ClientSecret: m.cfg.OIDCClientSecret,
		RedirectURL:  redirect,
		Endpoint:     provider.Endpoint(),
		Scopes:       m.cfg.OIDCScopes,
	}
}

func (m *oidcManager) seal(value oidcState) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(data)
	mac := hmac.New(sha256.New, m.cfg.MasterKey)
	_, _ = mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payload + "." + sig, nil
}

func (m *oidcManager) open(value string) (*oidcState, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return nil, errors.New("invalid state cookie")
	}
	mac := hmac.New(sha256.New, m.cfg.MasterKey)
	_, _ = mac.Write([]byte(parts[0]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || subtle.ConstantTimeCompare(sig, mac.Sum(nil)) != 1 {
		return nil, errors.New("invalid state signature")
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	var state oidcState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if state.Expires < time.Now().Unix() {
		return nil, errors.New("state expired")
	}
	return &state, nil
}

func (s *Server) oidcConfig(w http.ResponseWriter, r *http.Request) {
	if s.oidc == nil || !s.oidc.enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	_, _, err := s.oidc.load(r.Context())
	response := map[string]any{
		"enabled": true, "name": s.cfg.OIDCProviderName,
		"issuer": s.cfg.OIDCIssuer, "loginUrl": "/api/auth/oidc/login",
	}
	if err != nil {
		response["error"] = err.Error()
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) oidcLogin(w http.ResponseWriter, r *http.Request) {
	if s.oidc == nil || !s.oidc.enabled() {
		s.redirectOIDCError(w, r, "OIDC is not configured")
		return
	}
	provider, _, err := s.oidc.load(r.Context())
	if err != nil {
		s.redirectOIDCError(w, r, err.Error())
		return
	}
	state, err := auth.RandomToken(24)
	if err != nil {
		s.redirectOIDCError(w, r, "could not start OIDC login")
		return
	}
	nonce, _ := auth.RandomToken(24)
	verifier, _ := auth.RandomToken(48)
	redirect := s.oidc.redirectURL(r)
	payload := oidcState{State: state, Nonce: nonce, Verifier: verifier, Redirect: redirect, Expires: time.Now().Add(10 * time.Minute).Unix()}
	sealed, err := s.oidc.seal(payload)
	if err != nil {
		s.redirectOIDCError(w, r, "could not protect OIDC state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookie, Value: sealed, Path: "/api/auth/oidc", HttpOnly: true,
		Secure: s.cfg.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: 600,
	})
	config := s.oidc.oauth(redirect, provider)
	challenge := sha256.Sum256([]byte(verifier))
	url := config.AuthCodeURL(state,
		oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:])),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		oauth2.AccessTypeOnline,
	)
	_ = provider
	http.Redirect(w, r, url, http.StatusFound)
}

func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if s.oidc == nil || !s.oidc.enabled() {
		s.redirectOIDCError(w, r, "OIDC is not configured")
		return
	}
	if message := r.URL.Query().Get("error_description"); message != "" {
		s.redirectOIDCError(w, r, message)
		return
	}
	cookie, err := r.Cookie(oidcStateCookie)
	if err != nil || cookie.Value == "" {
		s.redirectOIDCError(w, r, "OIDC state cookie is missing")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: oidcStateCookie, Value: "", Path: "/api/auth/oidc", HttpOnly: true, Secure: s.cfg.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	state, err := s.oidc.open(cookie.Value)
	if err != nil || subtle.ConstantTimeCompare([]byte(state.State), []byte(r.URL.Query().Get("state"))) != 1 {
		s.redirectOIDCError(w, r, "OIDC state is invalid or expired")
		return
	}
	provider, verifier, err := s.oidc.load(r.Context())
	if err != nil {
		s.redirectOIDCError(w, r, err.Error())
		return
	}
	config := s.oidc.oauth(state.Redirect, provider)
	token, err := config.Exchange(r.Context(), r.URL.Query().Get("code"),
		oauth2.VerifierOption(state.Verifier),
	)
	if err != nil {
		s.redirectOIDCError(w, r, "token exchange failed")
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		s.redirectOIDCError(w, r, "OIDC provider did not return an ID token")
		return
	}
	idToken, err := verifier.Verify(r.Context(), rawIDToken)
	if err != nil {
		s.redirectOIDCError(w, r, "ID token verification failed")
		return
	}
	if idToken.Nonce != "" && idToken.Nonce != state.Nonce {
		s.redirectOIDCError(w, r, "ID token nonce mismatch")
		return
	}
	_ = provider
	var claims oidcClaims
	if err := idToken.Claims(&claims); err != nil {
		s.redirectOIDCError(w, r, "ID token claims are invalid")
		return
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if email == "" {
		s.redirectOIDCError(w, r, "OIDC provider did not return an email address")
		return
	}
	if s.cfg.OIDCRequireVerifiedEmail && !claims.EmailVerified {
		s.redirectOIDCError(w, r, "OIDC email address is not verified")
		return
	}
	user, err := s.store.FindUserByEmail(r.Context(), email)
	if errors.Is(err, store.ErrNotFound) && s.cfg.OIDCAutoCreate {
		password, _ := auth.RandomToken(32)
		hash, hashErr := s.auth.HashPassword(password)
		if hashErr != nil {
			s.redirectOIDCError(w, r, "could not provision OIDC user")
			return
		}
		name := strings.TrimSpace(claims.Name)
		if name == "" {
			name = claims.PreferredUsername
		}
		if name == "" {
			name = strings.Split(email, "@")[0]
		}
		user = &store.User{Email: email, Name: name, Role: "member", PasswordHash: hash}
		if err := s.store.CreateUser(r.Context(), user); err != nil {
			s.redirectOIDCError(w, r, "could not provision OIDC user")
			return
		}
		s.audit(r, "auth.oidc.provision", user.ID.Hex(), email)
	} else if err != nil {
		s.redirectOIDCError(w, r, "no local account matches this OIDC identity")
		return
	}

	if s.cfg.MFARequired && !user.MFAEnabled {
		sessionToken, csrf, err := s.auth.CreateSessionForUser(r.Context(), user, r, false, s.auth.TTL)
		if err != nil {
			s.redirectOIDCError(w, r, "could not create session")
			return
		}
		s.auth.SetCookies(w, sessionToken, csrf)
		s.audit(r, "auth.oidc.login", user.ID.Hex(), "mfa_setup_required")
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	if user.MFAEnabled && !s.cfg.OIDCTrustMFA {
		challenge, _, err := s.auth.CreateSessionForUser(r.Context(), user, r, false, 5*time.Minute)
		if err != nil {
			s.redirectOIDCError(w, r, "could not create MFA challenge")
			return
		}
		s.audit(r, "auth.oidc.login", user.ID.Hex(), "local_mfa_challenge")
		http.Redirect(w, r, "/?mfa_challenge="+url.QueryEscape(challenge), http.StatusFound)
		return
	}
	sessionToken, csrf, err := s.auth.CreateSessionForUser(r.Context(), user, r, true, s.auth.TTL)
	if err != nil {
		s.redirectOIDCError(w, r, "could not create session")
		return
	}
	s.auth.SetCookies(w, sessionToken, csrf)
	s.audit(r, "auth.oidc.login", user.ID.Hex(), "")
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *Server) redirectOIDCError(w http.ResponseWriter, r *http.Request, message string) {
	s.log.Warn("OIDC login failed", "err", message, "ip", r.RemoteAddr)
	http.Redirect(w, r, "/?oidc_error="+url.QueryEscape(message), http.StatusFound)
}
