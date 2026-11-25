package server

import (
	"bytes"
	"net/http/httptest"
	"testing"
	"time"

	"goland/internal/config"
)

func TestOIDCStateSealAndRedirect(t *testing.T) {
	cfg := &config.Config{
		MasterKey: bytes.Repeat([]byte{9}, 32), OIDCIssuer: "https://id.example.com",
		OIDCClientID: "client", OIDCScopes: []string{"openid", "email"},
	}
	m := newOIDCManager(cfg)
	state := oidcState{
		State: "state", Nonce: "nonce", Verifier: "verifier",
		Redirect: "https://ide.example.com/api/auth/oidc/callback",
		Expires:  time.Now().Add(time.Minute).Unix(),
	}
	sealed, err := m.seal(state)
	if err != nil || sealed == "" {
		t.Fatalf("seal: %q %v", sealed, err)
	}
	opened, err := m.open(sealed)
	if err != nil || opened.State != state.State || opened.Nonce != state.Nonce || opened.Verifier != state.Verifier {
		t.Fatalf("open: %#v %v", opened, err)
	}
	if _, err := m.open(sealed + "x"); err == nil {
		t.Fatal("tampered state accepted")
	}
	expired := state
	expired.Expires = time.Now().Add(-time.Minute).Unix()
	sealedExpired, _ := m.seal(expired)
	if _, err := m.open(sealedExpired); err == nil {
		t.Fatal("expired state accepted")
	}

	req := httptest.NewRequest("GET", "http://127.0.0.1:8788/api/auth/oidc/login", nil)
	if got := m.redirectURL(req); got != "http://127.0.0.1:8788/api/auth/oidc/callback" {
		t.Fatalf("redirect: %s", got)
	}
	cfg.PublicURL = "https://ide.example.com"
	if got := m.redirectURL(req); got != "https://ide.example.com/api/auth/oidc/callback" {
		t.Fatalf("public redirect: %s", got)
	}
	cfg.OIDCRedirectURL = "https://login.example.com/callback"
	if got := m.redirectURL(req); got != cfg.OIDCRedirectURL {
		t.Fatalf("explicit redirect: %s", got)
	}
}
