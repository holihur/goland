// Command goland-agent is a Goland plugin wrapping the local agent CLI.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
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
	binary    string
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
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	p := &plugin{
		encoder: json.NewEncoder(os.Stdout), binary: "agent", api: "anthropic",
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
			p.reply(req.ID, map[string]any{"name": "Agent", "version": "0.1.0"})
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
	if value, ok := config["agent.settings.binary"].(string); ok && strings.TrimSpace(value) != "" {
		p.binary = strings.TrimSpace(value)
	}
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
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := p.exec(ctx, 5*time.Second, "-version")
	text := "Agent ready"
	tooltip := firstLine(out)
	if err != nil {
		text = "Agent unavailable"
		if tooltip == "" {
			tooltip = "agent binary not found"
		}
	}
	p.notify("ui/status", map[string]any{"id": "agent.status", "text": text, "tooltip": tooltip})
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
	var out string
	var err error
	if action == "sessions" {
		out, err = p.exec(ctx, 20*time.Second, "-sessions")
	} else {
		prompt := stringInput(params.Inputs, "prompt")
		if prompt == "" {
			out = "prompt is required"
		} else {
			session := stringInput(params.Inputs, "session")
			if session == "" {
				session = p.session
			}
			args := p.askArgs(prompt, session)
			out, err = p.execStreaming(ctx, params.RequestID, args...)
		}
	}
	if ctx.Err() == context.DeadlineExceeded {
		out += "\n[agent command timed out]"
	} else if ctx.Err() == context.Canceled {
		out += "\n[agent command cancelled]"
	}
	if err != nil && out == "" {
		out = err.Error()
	}
	if out == "" {
		out = "(no output)"
	}
	text := "Agent ready"
	if err != nil {
		text = "Agent failed"
		p.notify("ui/notify", map[string]any{"level": "error", "message": "Agent: " + firstLine(out)})
	} else if action == "ask" {
		text = "Agent answered"
	} else if action == "sessions" {
		text = "Agent sessions"
	}
	p.notify("ui/status", map[string]any{"id": "agent.status", "text": text, "tooltip": firstLine(out)})
	p.reply(id, map[string]any{"output": out})
}

func (p *plugin) askArgs(prompt, session string) []string {
	args := []string{"-q", prompt, "-max-turns", strconv.Itoa(p.maxTurns)}
	if p.api != "" {
		args = append(args, "-api", p.api)
	}
	if p.model != "" {
		args = append(args, "-model", p.model)
	}
	if session != "" {
		args = append(args, "-session", session)
	}
	if p.fsTools {
		args = append(args, "-fs", "on")
	} else {
		args = append(args, "-fs", "off")
	}
	if p.shellTool {
		args = append(args, "-shell", "on")
	} else {
		args = append(args, "-shell", "off")
	}
	return args
}

func (p *plugin) exec(ctx context.Context, timeout time.Duration, args ...string) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, p.binary, args...)
	cmd.Dir = p.root
	cmd.Env = p.env()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	text := strings.TrimSpace(string(out))
	if extra := strings.TrimSpace(stderr.String()); extra != "" {
		if text != "" {
			text += "\n"
		}
		text += extra
	}
	if err != nil && text == "" {
		text = err.Error()
	}
	return text, err
}

func (p *plugin) execStreaming(ctx context.Context, requestID string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, p.binary, args...)
	cmd.Dir = p.root
	cmd.Env = p.env()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}
	var output strings.Builder
	var mu sync.Mutex
	read := func(reader interface{ Read([]byte) (int, error) }) {
		buffer := make([]byte, 16<<10)
		for {
			n, err := reader.Read(buffer)
			if n > 0 {
				chunk := string(buffer[:n])
				mu.Lock()
				if output.Len() < 2<<20 {
					output.WriteString(chunk)
				}
				mu.Unlock()
				p.notify("command/output", map[string]any{"requestId": requestID, "chunk": chunk})
			}
			if err != nil {
				return
			}
		}
	}
	var readers sync.WaitGroup
	readers.Add(2)
	go func() { defer readers.Done(); read(stdout) }()
	go func() { defer readers.Done(); read(stderr) }()
	readers.Wait()
	err = cmd.Wait()
	return strings.TrimSpace(output.String()), err
}

func (p *plugin) env() []string {
	values := map[string]string{}
	for _, item := range os.Environ() {
		if index := strings.IndexByte(item, '='); index > 0 {
			values[item[:index]] = item[index+1:]
		}
	}
	for key, value := range readDotEnv(filepath.Join(p.root, ".env")) {
		if _, ok := values[key]; !ok {
			values[key] = value
		}
	}
	overrides := map[string]string{
		"LLM_API_KEY": p.apiKey, "LLM_APIKEY": p.apiKey,
		"LLM_BASE_URL": p.baseURL, "LLM_MODEL": p.model, "LLM_API": p.api,
	}
	for key, value := range overrides {
		if value != "" {
			values[key] = value
		}
	}
	out := make([]string, 0, len(values))
	for key, value := range values {
		out = append(out, key+"="+value)
	}
	return out
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
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key != "" {
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
