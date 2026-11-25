package server_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"

	"goland/internal/config"
)

func TestOIDCLoginCallback(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	var nonce string
	var idp *httptest.Server
	idp = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"issuer": issuer, "authorization_endpoint": issuer + "/authorize",
				"token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks",
				"response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"},
				"id_token_signing_alg_values_supported": []string{"RS256"},
			})
		case "/jwks":
			exponent := big.NewInt(int64(key.PublicKey.E)).Bytes()
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
				"kty": "RSA", "kid": "test", "use": "sig", "alg": "RS256",
				"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(exponent),
			}}})
		case "/token":
			if err := r.ParseForm(); err != nil || r.FormValue("code") != "good-code" {
				http.Error(w, "bad code", http.StatusBadRequest)
				return
			}
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test"))
			if err != nil {
				t.Logf("signer: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			payload, _ := json.Marshal(map[string]any{
				"iss": issuer, "aud": "client", "sub": "member", "nonce": nonce,
				"exp": time.Now().Add(5 * time.Minute).Unix(), "iat": time.Now().Unix(),
				"email": "member@test.local", "email_verified": true, "name": "Member",
			})
			jws, err := signer.Sign(payload)
			if err != nil {
				t.Logf("sign: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			compact, _ := jws.CompactSerialize()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "access", "token_type": "Bearer", "id_token": compact,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer idp.Close()
	issuer = idp.URL

	f := newExtraFixtureWithConfig(t, func(cfg *config.Config) {
		cfg.OIDCIssuer = idp.URL
		cfg.OIDCClientID = "client"
		cfg.OIDCClientSecret = "secret"
		cfg.OIDCProviderName = "Test SSO"
		cfg.OIDCScopes = []string{"openid", "email", "profile"}
		cfg.OIDCTrustMFA = true
		cfg.OIDCRequireVerifiedEmail = true
	})

	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Jar: jar,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, _ := http.NewRequest(http.MethodGet, f.ts.URL+"/api/auth/oidc/login", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("oidc login status: %d %s", resp.StatusCode, readBody(resp))
	}
	location, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := location.Query().Get("state")
	nonce = location.Query().Get("nonce")
	if state == "" || nonce == "" || location.Query().Get("code_challenge") == "" {
		t.Fatalf("authorize url: %s", location.String())
	}
	readBody(resp)

	req, _ = http.NewRequest(http.MethodGet, f.ts.URL+"/api/auth/oidc/callback?code=good-code&state="+url.QueryEscape(state), nil)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("callback status: %d %s", resp.StatusCode, readBody(resp))
	}
	if target := resp.Header.Get("Location"); target != "/" {
		t.Fatalf("callback redirect: %q", target)
	}
	readBody(resp)

	req, _ = http.NewRequest(http.MethodGet, f.ts.URL+"/api/workspaces", nil)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("workspaces after OIDC: %d %s", resp.StatusCode, readBody(resp))
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "project") {
		t.Fatalf("workspace response: %s", body)
	}
}
