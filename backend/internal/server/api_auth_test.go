package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"goland/internal/auth"
)

func TestAPITokensAndMCP(t *testing.T) {
	f := newExtraFixture(t)
	resp := f.member.do(http.MethodPost, "/api/auth/tokens", map[string]any{
		"name": "mcp", "scopes": []string{"mcp", "read"}, "expiresInDays": 1,
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create token: %d %s", resp.StatusCode, readBody(resp))
	}
	var created struct {
		Token  string `json:"token"`
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	decode(t, resp, &created)
	if !strings.HasPrefix(created.Token, "glpat_") || created.Record.ID == "" {
		t.Fatalf("token response: %#v", created)
	}

	call := func(body map[string]any) map[string]any {
		data, _ := json.Marshal(body)
		req, err := http.NewRequest(http.MethodPost, f.ts.URL+"/api/mcp", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+created.Token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("mcp status: %d %s", resp.StatusCode, readBody(resp))
		}
		var out map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	init := call(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize"})
	if init["result"] == nil {
		t.Fatalf("initialize: %#v", init)
	}
	list := call(map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
	result := list["result"].(map[string]any)
	if len(result["tools"].([]any)) < 5 {
		t.Fatalf("tools: %#v", result)
	}
	workspaces := call(map[string]any{
		"jsonrpc": "2.0", "id": 20, "method": "tools/call",
		"params": map[string]any{"name": "list_workspaces", "arguments": map[string]any{}},
	})
	if workspaces["result"].(map[string]any)["isError"] == true {
		t.Fatalf("list_workspaces: %#v", workspaces)
	}
	unknown := call(map[string]any{"jsonrpc": "2.0", "id": 21, "method": "unknown/method"})
	if unknown["error"] == nil {
		t.Fatalf("unknown method: %#v", unknown)
	}
	read := call(map[string]any{
		"jsonrpc": "2.0", "id": 3, "method": "tools/call",
		"params": map[string]any{"name": "read_file", "arguments": map[string]any{"workspaceId": f.wsID, "path": "main.go"}},
	})
	readResult := read["result"].(map[string]any)
	if readResult["isError"] == true || !strings.Contains(readResult["content"].([]any)[0].(map[string]any)["text"].(string), "package main") {
		t.Fatalf("read_file: %#v", read)
	}

	// Bearer tokens must not be able to mint or manage other tokens.
	req, _ := http.NewRequest(http.MethodGet, f.ts.URL+"/api/auth/tokens", nil)
	req.Header.Set("Authorization", "Bearer "+created.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("token management with bearer: %d", resp.StatusCode)
	}
	readBody(resp)

	resp = f.member.do(http.MethodDelete, "/api/auth/tokens/"+created.Record.ID, nil, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke token: %d %s", resp.StatusCode, readBody(resp))
	}
	req, _ = http.NewRequest(http.MethodGet, f.ts.URL+"/api/workspaces", nil)
	req.Header.Set("Authorization", "Bearer "+created.Token)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked token accepted: %d", resp.StatusCode)
	}
	readBody(resp)
}

func TestMFAEnrollmentAndLoginChallenge(t *testing.T) {
	f := newExtraFixture(t)
	resp := f.member.do(http.MethodPost, "/api/auth/mfa/setup", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("mfa setup: %d %s", resp.StatusCode, readBody(resp))
	}
	var setup struct {
		Secret string `json:"secret"`
	}
	decode(t, resp, &setup)
	code, err := auth.TOTPCode(setup.Secret, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	resp = f.member.do(http.MethodPost, "/api/auth/mfa/enable", map[string]any{"code": code}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("mfa enable: %d %s", resp.StatusCode, readBody(resp))
	}
	var enabled struct {
		RecoveryCodes []string `json:"recoveryCodes"`
	}
	decode(t, resp, &enabled)
	if len(enabled.RecoveryCodes) != 10 {
		t.Fatalf("recovery codes: %#v", enabled.RecoveryCodes)
	}

	client := newClient(t, f.ts.URL)
	resp = client.do(http.MethodPost, "/api/auth/login", map[string]any{
		"email": "member@test.local", "password": "member-password-1",
	}, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("challenge login: %d %s", resp.StatusCode, readBody(resp))
	}
	var challenge struct {
		MFARequired    bool   `json:"mfaRequired"`
		ChallengeToken string `json:"challengeToken"`
		CSRFToken      string `json:"csrfToken"`
	}
	decode(t, resp, &challenge)
	if !challenge.MFARequired || challenge.ChallengeToken == "" || challenge.CSRFToken != "" {
		t.Fatalf("challenge response: %#v", challenge)
	}
	code, _ = auth.TOTPCode(setup.Secret, time.Now().UTC())
	resp = client.do(http.MethodPost, "/api/auth/mfa/verify", map[string]any{
		"challengeToken": challenge.ChallengeToken, "code": code,
	}, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("mfa verify: %d %s", resp.StatusCode, readBody(resp))
	}
	var verified struct {
		CSRFToken string `json:"csrfToken"`
	}
	decode(t, resp, &verified)
	client.csrf = verified.CSRFToken
	if resp := client.do(http.MethodGet, "/api/workspaces", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("workspace after MFA: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
	statusResp := client.do(http.MethodGet, "/api/auth/mfa/status", nil, false)
	if statusResp.StatusCode != http.StatusOK {
		t.Fatalf("mfa status: %d %s", statusResp.StatusCode, readBody(statusResp))
	}
	readBody(statusResp)
	code, _ = auth.TOTPCode(setup.Secret, time.Now().UTC())
	resp = client.do(http.MethodPost, "/api/auth/mfa/disable", map[string]any{
		"password": "member-password-1", "code": code,
	}, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("mfa disable: %d %s", resp.StatusCode, readBody(resp))
	}
}

func TestBYOKKeysModelsAndChat(t *testing.T) {
	f := newExtraFixture(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			http.Error(w, "bad auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": "model-b"}, {"id": "model-a"}}})
		case "/v1/chat/completions":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"model": "model-a",
				"choices": []map[string]any{{
					"message":       map[string]string{"role": "assistant", "content": "pong"},
					"finish_reason": "stop",
				}},
				"usage": map[string]any{"total_tokens": 3},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	resp := f.member.do(http.MethodPost, "/api/auth/byok", map[string]any{
		"provider": "openai", "label": "Test", "baseUrl": provider.URL + "/v1",
		"model": "model-a", "apiKey": "sk-test",
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create byok: %d %s", resp.StatusCode, readBody(resp))
	}
	var created struct {
		Key struct {
			ID    string `json:"id"`
			Model string `json:"model"`
		} `json:"key"`
	}
	decode(t, resp, &created)
	resp = f.member.do(http.MethodGet, "/api/auth/byok", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list byok: %d %s", resp.StatusCode, readBody(resp))
	}
	var listed struct {
		Keys []map[string]any `json:"keys"`
	}
	decode(t, resp, &listed)
	if len(listed.Keys) != 1 || listed.Keys[0]["hasKey"] != true || listed.Keys[0]["apiKey"] != nil {
		t.Fatalf("byok list: %#v", listed.Keys)
	}
	resp = f.member.do(http.MethodPost, "/api/ai/models", map[string]any{
		"baseUrl": provider.URL + "/v1", "apiKey": "sk-test",
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("models: %d %s", resp.StatusCode, readBody(resp))
	}
	var models struct {
		Models []string `json:"models"`
	}
	decode(t, resp, &models)
	if len(models.Models) != 2 || models.Models[0] != "model-a" {
		t.Fatalf("models: %#v", models.Models)
	}
	resp = f.member.do(http.MethodPost, "/api/ai/chat", map[string]any{
		"keyId": created.Key.ID, "messages": []map[string]string{{"role": "user", "content": "ping"}},
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("chat: %d %s", resp.StatusCode, readBody(resp))
	}
	var chat struct {
		Content string `json:"content"`
		Model   string `json:"model"`
	}
	decode(t, resp, &chat)
	if chat.Content != "pong" || chat.Model != "model-a" {
		t.Fatalf("chat: %#v", chat)
	}
	resp = f.member.do(http.MethodDelete, "/api/auth/byok/"+created.Key.ID, nil, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete byok: %d %s", resp.StatusCode, readBody(resp))
	}
}

func TestOIDCConfigDisabled(t *testing.T) {
	f := newExtraFixture(t)
	resp := f.member.do(http.MethodGet, "/api/auth/oidc/config", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("oidc config: %d", resp.StatusCode)
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	decode(t, resp, &body)
	if body.Enabled {
		t.Fatal("OIDC should be disabled in the test fixture")
	}
}
