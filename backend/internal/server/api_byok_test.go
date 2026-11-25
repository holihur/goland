package server_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBYOKAnthropicProtocol(t *testing.T) {
	f := newExtraFixture(t)
	var chatPayload map[string]any
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "sk-ant" || r.Header.Get("anthropic-version") != "2023-06-01" {
			http.Error(w, "bad anthropic auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": "claude-b"}, {"id": "claude-a"}}})
		case "/v1/messages":
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &chatPayload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"model": "claude-a", "stop_reason": "end_turn",
				"content": []map[string]string{{"type": "text", "text": "pong"}, {"type": "thinking", "text": "hidden"}},
				"usage":   map[string]any{"input_tokens": 2},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	resp := f.member.do(http.MethodPost, "/api/auth/byok", map[string]any{
		"provider": "anthropic", "label": "Claude", "api": "anthropic", "baseUrl": provider.URL,
		"model": "claude-a", "apiKey": "sk-ant",
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create anthropic byok: %d %s", resp.StatusCode, readBody(resp))
	}
	var created struct {
		Key struct {
			ID  string `json:"id"`
			API string `json:"api"`
		} `json:"key"`
	}
	decode(t, resp, &created)
	if created.Key.API != "anthropic" {
		t.Fatalf("api style = %q", created.Key.API)
	}

	resp = f.member.do(http.MethodPost, "/api/ai/models", map[string]any{"keyId": created.Key.ID}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("anthropic models: %d %s", resp.StatusCode, readBody(resp))
	}
	var models struct {
		Models []string `json:"models"`
	}
	decode(t, resp, &models)
	if len(models.Models) != 2 || models.Models[0] != "claude-a" {
		t.Fatalf("models: %#v", models.Models)
	}

	resp = f.member.do(http.MethodPost, "/api/ai/chat", map[string]any{
		"keyId": created.Key.ID, "temperature": 0.2,
		"messages": []map[string]string{
			{"role": "system", "content": "be nice"},
			{"role": "user", "content": "ping"},
		},
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("anthropic chat: %d %s", resp.StatusCode, readBody(resp))
	}
	var chat struct {
		Content string `json:"content"`
		Role    string `json:"role"`
		Finish  string `json:"finish"`
	}
	decode(t, resp, &chat)
	if chat.Content != "pong" || chat.Role != "assistant" || chat.Finish != "end_turn" {
		t.Fatalf("chat: %#v", chat)
	}
	if chatPayload["system"] != "be nice" || chatPayload["model"] != "claude-a" || chatPayload["temperature"] != 0.2 {
		t.Fatalf("payload: %#v", chatPayload)
	}
	messages, _ := chatPayload["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("system message leaked into messages: %#v", chatPayload["messages"])
	}
}

func TestBYOKValidationAndErrors(t *testing.T) {
	f := newExtraFixture(t)
	cases := []map[string]any{
		{"provider": "p", "label": "l", "api": "other", "baseUrl": "https://example.com", "model": "m", "apiKey": "key1"},
		{"provider": "", "label": "l", "baseUrl": "https://example.com", "model": "m", "apiKey": "key1"},
		{"provider": "p", "label": "", "baseUrl": "https://example.com", "model": "m", "apiKey": "key1"},
		{"provider": "p", "label": "l", "baseUrl": "ftp://example.com", "model": "m", "apiKey": "key1"},
		{"provider": "p", "label": "l", "baseUrl": "https://example.com", "model": "", "apiKey": "key1"},
		{"provider": "p", "label": "l", "baseUrl": "https://example.com", "model": "m", "apiKey": "x"},
	}
	for _, body := range cases {
		resp := f.member.do(http.MethodPost, "/api/auth/byok", body, true)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("body %#v: status %d %s", body, resp.StatusCode, readBody(resp))
		}
	}
	resp := f.member.do(http.MethodDelete, "/api/auth/byok/not-an-id", nil, true)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("invalid delete: %d", resp.StatusCode)
	}
	resp = f.member.do(http.MethodPost, "/api/ai/models", map[string]any{"baseUrl": "https://example.com", "apiKey": ""}, true)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing secret: %d %s", resp.StatusCode, readBody(resp))
	}
	resp = f.member.do(http.MethodPost, "/api/ai/models", map[string]any{"keyId": "not-an-id"}, true)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid key id: %d", resp.StatusCode)
	}
	resp = f.member.do(http.MethodPost, "/api/ai/models", map[string]any{"keyId": "507f1f77bcf86cd799439011"}, true)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing key: %d", resp.StatusCode)
	}
	resp = f.member.do(http.MethodPost, "/api/ai/chat", map[string]any{
		"keyId": "507f1f77bcf86cd799439011", "messages": []map[string]string{{"role": "user", "content": "hi"}},
	}, true)
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(readBody(resp), "not found") {
		t.Fatalf("chat missing key: %d", resp.StatusCode)
	}
	resp = f.member.do(http.MethodPost, "/api/ai/chat", map[string]any{"keyId": "bad", "messages": []map[string]string{{"role": "user", "content": "hi"}}}, true)
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("chat invalid key: %d", resp.StatusCode)
	}
}

func TestBYOKProviderFailures(t *testing.T) {
	f := newExtraFixture(t)
	status := http.StatusInternalServerError
	payload := "not json"
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(payload))
	}))
	defer provider.Close()
	resp := f.member.do(http.MethodPost, "/api/auth/byok", map[string]any{
		"provider": "p", "label": "l", "baseUrl": provider.URL, "model": "m", "apiKey": "secret-key",
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %s", resp.StatusCode, readBody(resp))
	}
	var created struct {
		Key struct {
			ID string `json:"id"`
		} `json:"key"`
	}
	decode(t, resp, &created)
	resp = f.member.do(http.MethodPost, "/api/ai/models", map[string]any{"keyId": created.Key.ID}, true)
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(readBody(resp), "provider returned") {
		t.Fatalf("models provider failure: %d", resp.StatusCode)
	}
	status = http.StatusOK
	resp = f.member.do(http.MethodPost, "/api/ai/models", map[string]any{"keyId": created.Key.ID}, true)
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(readBody(resp), "invalid JSON") {
		t.Fatalf("models invalid json: %d", resp.StatusCode)
	}
	payload = `{"model":"m","choices":[]}`
	resp = f.member.do(http.MethodPost, "/api/ai/chat", map[string]any{
		"keyId": created.Key.ID, "messages": []map[string]string{{"role": "user", "content": "hi"}},
	}, true)
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(readBody(resp), "no choices") {
		t.Fatalf("chat no choices: %d", resp.StatusCode)
	}
}
