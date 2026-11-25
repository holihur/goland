// Command goland-agent is a Goland plugin embedding github.com/holihur/agent.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	agentpkg "github.com/holihur/agent"
)

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type initializeParams struct {
	WorkspaceID string         `json:"workspaceId"`
	RootPath    string         `json:"rootPath"`
	Config      map[string]any `json:"config"`
}

type commandParams struct {
	RequestID string         `json:"requestId"`
	CommandID string         `json:"commandId"`
	Args      []string       `json:"args"`
	Inputs    map[string]any `json:"inputs"`
	Path      string         `json:"path"`
}

type plugin struct {
	mu        sync.Mutex
	encoder   *json.Encoder
	api       string
	baseURL   string
	model     string
	apiKey    string
	session   string
	maxTurns  int
	fsTools   bool
	shellTool bool
	root      string
	cancel    map[string]context.CancelFunc
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 8<<20)
	p := &plugin{
		encoder: json.NewEncoder(os.Stdout), api: "anthropic",
		session: "goland", maxTurns: 8, fsTools: true, cancel: map[string]context.CancelFunc{},
	}
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			continue
		}
		switch req.Method {
		case "initialize":
			var params initializeParams
			_ = json.Unmarshal(req.Params, &params)
			p.root = params.RootPath
			p.applyConfig(params.Config)
			p.reply(req.ID, map[string]any{"name": "Agent", "version": "0.3.0"})
			p.updateStatus()
		case "health":
			p.reply(req.ID, map[string]any{"status": "ok"})
		case "shutdown":
			p.mu.Lock()
			for _, cancel := range p.cancel {
				cancel()
			}
			p.mu.Unlock()
			return
		case "command/execute":
			var params commandParams
			_ = json.Unmarshal(req.Params, &params)
			go p.execute(req.ID, params)
		case "command/cancel":
			var params struct {
				RequestID string `json:"requestId"`
			}
			_ = json.Unmarshal(req.Params, &params)
			p.mu.Lock()
			if cancel := p.cancel[params.RequestID]; cancel != nil {
				cancel()
			}
			p.mu.Unlock()
		}
	}
}

func (p *plugin) applyConfig(config map[string]any) {
	if value, ok := config["agent.settings.api"].(string); ok && strings.TrimSpace(value) != "" {
		p.api = strings.TrimSpace(value)
	}
	if value, ok := config["agent.settings.baseUrl"].(string); ok {
		p.baseURL = strings.TrimSpace(value)
	}
	if value, ok := config["agent.settings.model"].(string); ok {
		p.model = strings.TrimSpace(value)
	}
	if value, ok := config["agent.settings.apiKey"].(string); ok {
		p.apiKey = strings.TrimSpace(value)
	}
	if value, ok := config["agent.settings.session"].(string); ok && strings.TrimSpace(value) != "" {
		p.session = strings.TrimSpace(value)
	}
	if value, ok := config["agent.settings.maxTurns"].(float64); ok && value >= 1 && value <= 40 {
		p.maxTurns = int(value)
	}
	if value, ok := config["agent.settings.fsTools"].(bool); ok {
		p.fsTools = value
	}
	if value, ok := config["agent.settings.shellTool"].(bool); ok {
		p.shellTool = value
	}
}

func (p *plugin) updateStatus() {
	cfg := p.credentials()
	text := "Agent ready"
	tooltip := "Embedded agent is configured"
	if cfg.APIKey == "" || cfg.BaseURL == "" || cfg.Model == "" {
		text = "Agent: configure credentials"
		tooltip = "Set LLM_API_KEY/LLM_BASE_URL/LLM_MODEL in the workspace .env or plugin settings"
	}
	p.notify("ui/status", map[string]any{"id": "agent.status", "text": text, "tooltip": tooltip})
}

func (p *plugin) credentials() agentpkg.Config {
	values := readDotEnv(filepath.Join(p.root, ".env"))
	first := func(items ...string) string {
		for _, item := range items {
			if strings.TrimSpace(item) != "" {
				return strings.TrimSpace(item)
			}
		}
		return ""
	}
	return agentpkg.Config{
		APIKey:   first(p.apiKey, values["LLM_API_KEY"], values["LLM_APIKEY"], os.Getenv("LLM_API_KEY"), os.Getenv("LLM_APIKEY")),
		BaseURL:  first(p.baseURL, values["LLM_BASE_URL"], os.Getenv("LLM_BASE_URL")),
		Model:    first(p.model, values["LLM_MODEL"], os.Getenv("LLM_MODEL")),
		API:      first(p.api, values["LLM_API"], os.Getenv("LLM_API")),
		MaxTurns: p.maxTurns,
	}
}

func (p *plugin) execute(id *int64, params commandParams) {
	action := stringInput(params.Inputs, "action")
	switch params.CommandID {
	case "agent.ask":
		action = "ask"
	case "agent.sessions":
		action = "sessions"
	case "agent.run":
		if action == "" {
			action = "ask"
		}
	default:
		p.reply(id, map[string]any{"output": "unknown command " + params.CommandID})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	defer cancel()
	p.mu.Lock()
	p.cancel[params.RequestID] = cancel
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.cancel, params.RequestID)
		p.mu.Unlock()
	}()

	var output string
	var err error
	streamed := false
	switch action {
	case "sessions":
		output = p.listSessions()
	case "ask":
		prompt := stringInput(params.Inputs, "prompt")
		if prompt == "" {
			output = "prompt is required"
		} else {
			session := stringInput(params.Inputs, "session")
			if session == "" {
				session = p.session
			}
			output, streamed, err = p.ask(ctx, params.RequestID, prompt, session)
		}
	default:
		output = "unknown agent action " + action
	}
	if ctx.Err() == context.DeadlineExceeded {
		output += "\n[agent command timed out]"
	} else if ctx.Err() == context.Canceled {
		output += "\n[agent command cancelled]"
	}
	if err != nil && output == "" {
		output = err.Error()
	}
	if output == "" && !streamed {
		output = "(no output)"
	}
	status := "Agent ready"
	kind := "info"
	level := "info"
	if err != nil {
		status = "Agent failed"
		kind = "error"
		level = "error"
	} else if action == "ask" {
		status = "Agent answered"
		kind = "success"
	} else if action == "sessions" {
		status = "Agent sessions"
	}
	p.notify("ui/status", map[string]any{"id": "agent.status", "text": status, "tooltip": firstLine(output)})
	if level == "error" {
		p.notify("ui/notify", map[string]any{"level": level, "message": "Agent: " + firstLine(output)})
	}
	_ = kind
	p.reply(id, map[string]any{"output": output})
}

func (p *plugin) ask(ctx context.Context, requestID, prompt, session string) (string, bool, error) {
	cfg := p.credentials()
	if cfg.APIKey == "" || cfg.BaseURL == "" || cfg.Model == "" {
		return "", false, errors.New("agent credentials are missing: set LLM_APIKEY/LLM_BASE_URL/LLM_MODEL")
	}
	a, err := agentpkg.New(cfg)
	if err != nil {
		return "", false, err
	}
	defer a.Close()
	if p.fsTools {
		if err := a.FS(); err != nil {
			return "", false, err
		}
	}
	if p.shellTool {
		if err := a.Shell(); err != nil {
			return "", false, err
		}
	}
	streamed := false
	a.OnTextDelta(func(delta agentpkg.TextDelta) {
		if delta.Text != "" {
			streamed = true
			p.notify("command/output", map[string]any{"requestId": requestID, "chunk": delta.Text})
		}
	})
	if session != "" {
		if err := a.LoadSession(session); err != nil && !errors.Is(err, agentpkg.ErrSessionNotFound) {
			return "", false, err
		}
	}
	out, err := a.Run(ctx, prompt)
	if err != nil {
		return out, streamed, err
	}
	if session != "" {
		if saveErr := a.SaveSession(session); saveErr != nil {
			return out, streamed, saveErr
		}
	}
	if streamed {
		// The host prefixes streamed chunks to the result; avoid sending the
		// final answer twice.
		return "", true, nil
	}
	return out, false, nil
}

func (p *plugin) listSessions() string {
	dir := filepath.Join(p.root, ".agent", "sessions")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return "No saved sessions."
		}
		return err.Error()
	}
	names := []string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		names = append(names, strings.TrimSuffix(entry.Name(), ".jsonl"))
	}
	sort.Strings(names)
	if len(names) == 0 {
		return "No saved sessions."
	}
	return strings.Join(names, "\n")
}

func readDotEnv(path string) map[string]string {
	out := map[string]string{}
	data, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key = strings.TrimSpace(key); key != "" {
			out[key] = value
		}
	}
	return out
}

func (p *plugin) reply(id *int64, result any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	_ = p.encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func (p *plugin) notify(method string, params any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	_ = p.encoder.Encode(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func stringInput(inputs map[string]any, key string) string {
	value, _ := inputs[key].(string)
	return strings.TrimSpace(value)
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if index := strings.IndexByte(value, '\n'); index >= 0 {
		value = value[:index]
	}
	if len(value) > 180 {
		value = value[:180] + "…"
	}
	if value == "" {
		return "Agent command failed"
	}
	return value
}
