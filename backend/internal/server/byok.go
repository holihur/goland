package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"goland/internal/auth"
	"goland/internal/store"
)

type byokView struct {
	ID         string     `json:"id"`
	Provider   string     `json:"provider"`
	Label      string     `json:"label"`
	API        string     `json:"api"`
	BaseURL    string     `json:"baseUrl"`
	Model      string     `json:"model"`
	HasKey     bool       `json:"hasKey"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func byokViewFrom(key store.BYOKKey) byokView {
	return byokView{
		ID: key.ID.Hex(), Provider: key.Provider, Label: key.Label, API: key.API, BaseURL: key.BaseURL,
		Model: key.Model, HasKey: key.EncryptedKey != "", LastUsedAt: key.LastUsedAt, CreatedAt: key.CreatedAt,
	}
}

func (s *Server) listBYOKKeys(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	keys, err := s.store.ListBYOKKeys(r.Context(), currentUser(r).ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not list AI keys")
		return
	}
	views := make([]byokView, 0, len(keys))
	for _, key := range keys {
		views = append(views, byokViewFrom(key))
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": views})
}

func (s *Server) createBYOKKey(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	var body struct {
		Provider string `json:"provider"`
		Label    string `json:"label"`
		API      string `json:"api"`
		BaseURL  string `json:"baseUrl"`
		Model    string `json:"model"`
		APIKey   string `json:"apiKey"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	body.Provider = strings.TrimSpace(body.Provider)
	body.Label = strings.TrimSpace(body.Label)
	body.API = strings.TrimSpace(body.API)
	if body.API == "" {
		body.API = "openai"
	}
	if body.API != "openai" && body.API != "anthropic" {
		writeError(w, http.StatusBadRequest, "invalid_api", "api must be openai or anthropic")
		return
	}
	body.BaseURL = strings.TrimRight(strings.TrimSpace(body.BaseURL), "/")
	body.Model = strings.TrimSpace(body.Model)
	body.APIKey = strings.TrimSpace(body.APIKey)
	if body.Provider == "" || len(body.Provider) > 40 {
		writeError(w, http.StatusBadRequest, "invalid_provider", "provider is required")
		return
	}
	if body.Label == "" || len(body.Label) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_label", "label is required and must be at most 100 characters")
		return
	}
	parsed, err := url.Parse(body.BaseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeError(w, http.StatusBadRequest, "invalid_base_url", "baseUrl must be an absolute http(s) URL")
		return
	}
	if body.Model == "" || len(body.Model) > 200 {
		writeError(w, http.StatusBadRequest, "invalid_model", "model is required")
		return
	}
	if len(body.APIKey) < 4 || len(body.APIKey) > 4096 {
		writeError(w, http.StatusBadRequest, "invalid_api_key", "apiKey must be between 4 and 4096 characters")
		return
	}
	box, err := s.mfaBox()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "encryption is unavailable")
		return
	}
	encrypted, err := box.Encrypt(body.APIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not protect API key")
		return
	}
	key := &store.BYOKKey{
		UserID: currentUser(r).ID, Provider: body.Provider, Label: body.Label, API: body.API,
		BaseURL: body.BaseURL, Model: body.Model, EncryptedKey: encrypted,
	}
	if err := s.store.CreateBYOKKey(r.Context(), key); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save AI key")
		return
	}
	s.audit(r, "auth.byok.create", key.ID.Hex(), body.Provider)
	writeJSON(w, http.StatusCreated, map[string]any{"key": byokViewFrom(*key)})
}

func (s *Server) deleteBYOKKey(w http.ResponseWriter, r *http.Request) {
	if sessionRequired(w, r) {
		return
	}
	id, err := primitive.ObjectIDFromHex(chi.URLParam(r, "keyID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "key not found")
		return
	}
	if err := s.store.DeleteBYOKKey(r.Context(), currentUser(r).ID, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "key not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not delete key")
		return
	}
	s.audit(r, "auth.byok.delete", id.Hex(), "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) aiChat(w http.ResponseWriter, r *http.Request) {
	if token := auth.TokenFrom(r.Context()); token != nil && !auth.TokenHasScope(token, "ai") {
		writeError(w, http.StatusForbidden, "ai_scope_required", "token is missing the ai scope")
		return
	}
	var body struct {
		KeyID       string        `json:"keyId"`
		Model       string        `json:"model"`
		Messages    []chatMessage `json:"messages"`
		Temperature *float64      `json:"temperature"`
	}
	if !decodeJSON(w, r, &body, 4<<20) {
		return
	}
	if len(body.Messages) == 0 || len(body.Messages) > 200 {
		writeError(w, http.StatusBadRequest, "invalid_messages", "messages are required")
		return
	}
	user := currentUser(r)
	result, err := s.chatCompletion(r.Context(), user.ID, body.KeyID, body.Model, body.Messages, body.Temperature)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ai_failed", err.Error())
		return
	}
	s.audit(r, "ai.chat", body.KeyID, "")
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) aiModels(w http.ResponseWriter, r *http.Request) {
	if token := auth.TokenFrom(r.Context()); token != nil && !auth.TokenHasScope(token, "ai") {
		writeError(w, http.StatusForbidden, "ai_scope_required", "token is missing the ai scope")
		return
	}
	var body struct {
		API     string `json:"api"`
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
		KeyID   string `json:"keyId"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	baseURL := strings.TrimRight(strings.TrimSpace(body.BaseURL), "/")
	apiStyle := strings.TrimSpace(body.API)
	secret := strings.TrimSpace(body.APIKey)
	if body.KeyID != "" {
		id, err := primitive.ObjectIDFromHex(body.KeyID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_key", "invalid keyId")
			return
		}
		key, err := s.store.FindBYOKKey(r.Context(), currentUser(r).ID, id)
		if err != nil {
			writeError(w, http.StatusNotFound, "not_found", "AI key not found")
			return
		}
		baseURL = strings.TrimRight(key.BaseURL, "/")
		apiStyle = key.API
		box, err := s.mfaBox()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "encryption is unavailable")
			return
		}
		secret, err = box.Decrypt(key.EncryptedKey)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "could not decrypt AI key")
			return
		}
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeError(w, http.StatusBadRequest, "invalid_base_url", "baseUrl must be an absolute http(s) URL")
		return
	}
	if secret == "" {
		writeError(w, http.StatusBadRequest, "invalid_api_key", "apiKey or keyId is required")
		return
	}
	endpoint := apiURL(baseURL, apiStyle, "models")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	if apiStyle == "anthropic" {
		req.Header.Set("x-api-key", secret)
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ai_failed", err.Error())
		return
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, "ai_failed", "could not read provider response")
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, "ai_failed", fmt.Sprintf("provider returned %s: %s", resp.Status, truncateText(string(raw), 300)))
		return
	}
	var parsedResponse struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []string `json:"models"`
	}
	if err := json.Unmarshal(raw, &parsedResponse); err != nil {
		writeError(w, http.StatusBadGateway, "ai_failed", "provider returned invalid JSON")
		return
	}
	models := parsedResponse.Models
	for _, item := range parsedResponse.Data {
		if item.ID != "" {
			models = append(models, item.ID)
		}
	}
	sort.Strings(models)
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (s *Server) chatCompletion(ctx context.Context, userID primitive.ObjectID, keyID, model string, messages []chatMessage, temperature *float64) (map[string]any, error) {
	id, err := primitive.ObjectIDFromHex(keyID)
	if err != nil {
		return nil, errors.New("keyId is required")
	}
	key, err := s.store.FindBYOKKey(ctx, userID, id)
	if err != nil {
		return nil, errors.New("AI key not found")
	}
	box, err := s.mfaBox()
	if err != nil {
		return nil, errors.New("encryption is unavailable")
	}
	secret, err := box.Decrypt(key.EncryptedKey)
	if err != nil || secret == "" {
		return nil, errors.New("could not decrypt AI key")
	}
	if model == "" {
		model = key.Model
	}
	var payload any
	if key.API == "anthropic" {
		system := []string{}
		converted := make([]chatMessage, 0, len(messages))
		for _, message := range messages {
			if message.Role == "system" {
				system = append(system, message.Content)
				continue
			}
			converted = append(converted, message)
		}
		body := map[string]any{"model": model, "max_tokens": 4096, "messages": converted}
		if len(system) > 0 {
			body["system"] = strings.Join(system, "\n\n")
		}
		if temperature != nil {
			body["temperature"] = *temperature
		}
		payload = body
	} else {
		body := map[string]any{"model": model, "messages": messages}
		if temperature != nil {
			body["temperature"] = *temperature
		}
		payload = body
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	endpoint := apiURL(strings.TrimRight(key.BaseURL, "/"), key.API, "chat")
	callCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+secret)
	if key.API == "anthropic" {
		req.Header.Set("x-api-key", secret)
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	resp, err := (&http.Client{Timeout: 2 * time.Minute}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned %s: %s", resp.Status, truncateText(string(raw), 500))
	}
	if key.API == "anthropic" {
		var parsed struct {
			Model   string `json:"model"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			StopReason string         `json:"stop_reason"`
			Usage      map[string]any `json:"usage"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return nil, errors.New("provider returned invalid JSON")
		}
		var content strings.Builder
		for _, block := range parsed.Content {
			if block.Type == "text" {
				content.WriteString(block.Text)
			}
		}
		if content.Len() == 0 {
			return nil, errors.New("provider returned no text content")
		}
		s.store.TouchBYOKKey(context.Background(), key.ID)
		return map[string]any{
			"content": content.String(), "role": "assistant", "model": parsed.Model,
			"finish": parsed.StopReason, "usage": parsed.Usage,
		}, nil
	}
	var parsed struct {
		Model   string `json:"model"`
		Choices []struct {
			Message chatMessage `json:"message"`
			Finish  string      `json:"finish_reason"`
		} `json:"choices"`
		Usage map[string]any `json:"usage"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, errors.New("provider returned invalid JSON")
	}
	if len(parsed.Choices) == 0 {
		return nil, errors.New("provider returned no choices")
	}
	s.store.TouchBYOKKey(context.Background(), key.ID)
	return map[string]any{
		"content": parsed.Choices[0].Message.Content,
		"role":    parsed.Choices[0].Message.Role,
		"model":   parsed.Model,
		"finish":  parsed.Choices[0].Finish,
		"usage":   parsed.Usage,
	}, nil
}

func apiURL(base, style, operation string) string {
	base = strings.TrimRight(base, "/")
	hasV1 := strings.HasSuffix(base, "/v1")
	if style == "anthropic" {
		if operation == "models" {
			if hasV1 {
				return base + "/models"
			}
			return base + "/v1/models"
		}
		if hasV1 {
			return base + "/messages"
		}
		return base + "/v1/messages"
	}
	if operation == "models" {
		if hasV1 {
			return base + "/models"
		}
		return base + "/v1/models"
	}
	if hasV1 {
		return base + "/chat/completions"
	}
	return base + "/v1/chat/completions"
}

func truncateText(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max] + "…"
}
