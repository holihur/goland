package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
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
}
