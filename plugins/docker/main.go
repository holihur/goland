// Command docker is a Goland plugin that exposes common Docker CLI workflows.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"sync"
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
	mu       sync.Mutex
	encoder  *json.Encoder
	binary   string
	host     string
	file     string
	timeout  time.Duration
	root     string
	output   string
	lastKind string
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	p := &plugin{encoder: json.NewEncoder(os.Stdout), binary: "docker", file: "docker-compose.yml", timeout: 55 * time.Second}
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
			p.reply(req.ID, map[string]any{"name": "Docker", "version": "0.1.0"})
			p.refreshStatus()
		case "health":
			p.reply(req.ID, map[string]any{"status": "ok"})
		case "shutdown":
			return
		case "command/execute":
			var params commandParams
			_ = json.Unmarshal(req.Params, &params)
			output := p.runCommand(params)
			p.reply(req.ID, map[string]any{"output": output})
		}
	}
}

func (p *plugin) applyConfig(config map[string]any) {
	if value, ok := config["docker.settings.binary"].(string); ok && strings.TrimSpace(value) != "" {
		p.binary = strings.TrimSpace(value)
	}
	if value, ok := config["docker.settings.host"].(string); ok {
		p.host = strings.TrimSpace(value)
	}
	if value, ok := config["docker.settings.composeFile"].(string); ok && strings.TrimSpace(value) != "" {
		p.file = strings.TrimSpace(value)
	}
	if value, ok := config["docker.settings.timeout"].(float64); ok && value >= 5 && value <= 55 {
		p.timeout = time.Duration(value) * time.Second
	}
}

func (p *plugin) refreshStatus() {
	ctx, cancel := context.WithTimeout(context.Background(), minDuration(p.timeout, 8*time.Second))
	defer cancel()
	out, err := p.exec(ctx, "version", "--format", "{{.Server.Version}}")
	text := "Docker ready"
	tooltip := "Docker CLI is available"
	if err != nil {
		text = "Docker unavailable"
		tooltip = firstLine(out)
		if tooltip == "" {
			tooltip = firstLine(err.Error())
		}
	}
	p.notify("ui/status", map[string]any{"id": "docker.status", "text": text, "tooltip": tooltip})
}

func (p *plugin) runCommand(params commandParams) string {
	action := stringInput(params.Inputs, "action")
	switch params.CommandID {
	case "docker.ps":
		action = "ps"
	case "docker.images":
		action = "images"
	case "docker.version":
		action = "version"
	case "docker.compose.up":
		action = "compose-up"
	case "docker.compose.down":
		action = "compose-down"
	case "docker.compose.logs":
		action = "compose-logs"
	case "docker.logs":
		action = "logs"
	case "docker.build":
		action = "build"
	case "docker.run":
		if action == "" {
			action = "ps"
		}
	default:
		return "unknown command " + params.CommandID
	}
	ctx, cancel := context.WithTimeout(context.Background(), p.timeout)
	defer cancel()
	var (
		out string
		err error
	)
	switch action {
	case "ps":
		out, err = p.exec(ctx, "ps", "-a", "--format", "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}")
	case "images":
		out, err = p.exec(ctx, "images", "--format", "table {{.Repository}}:{{.Tag}}\\t{{.ID}}\\t{{.Size}}")
	case "version":
		out, err = p.exec(ctx, "version")
	case "compose-up":
		out, err = p.compose(ctx, "up", "-d", stringInput(params.Inputs, "service"))
	case "compose-down":
		out, err = p.compose(ctx, "down", stringInput(params.Inputs, "service"))
	case "compose-logs":
		out, err = p.compose(ctx, "logs", "--tail=200", stringInput(params.Inputs, "service"))
	case "logs":
		container := stringInput(params.Inputs, "container")
		if container == "" {
			return "container is required for logs"
		}
		if strings.HasPrefix(container, "-") {
			return "invalid container name"
		}
		out, err = p.exec(ctx, "logs", "--tail=200", container)
	case "build":
		image := stringInput(params.Inputs, "image")
		contextDir := stringInput(params.Inputs, "context")
		dockerfile := stringInput(params.Inputs, "dockerfile")
		if image == "" {
			return "image tag is required for build"
		}
		if contextDir == "" {
			contextDir = "."
		}
		if dockerfile == "" {
			dockerfile = "Dockerfile"
		}
		out, err = p.exec(ctx, "build", "-t", image, "-f", dockerfile, contextDir)
	default:
		return "unknown Docker action " + action
	}
	if err != nil {
		if out == "" {
			out = err.Error()
		} else {
			out = out + "\n" + err.Error()
		}
	}
	p.output = out
	p.lastKind = action
	p.notify("ui/status", map[string]any{
		"id":      "docker.status",
		"text":    statusText(action, err == nil),
		"tooltip": firstLine(out),
	})
	if err != nil {
		p.notify("ui/notify", map[string]any{"level": "error", "message": "Docker: " + firstLine(out)})
	}
	return out
}

func statusText(action string, ok bool) string {
	if !ok {
		return "Docker command failed"
	}
	switch action {
	case "ps":
		return "Docker: containers"
	case "images":
		return "Docker: images"
	case "compose-up":
		return "Docker: compose up"
	case "compose-down":
		return "Docker: compose down"
	case "build":
		return "Docker: image built"
	default:
		return "Docker ready"
	}
}

func (p *plugin) compose(ctx context.Context, args ...string) (string, error) {
	file := p.file
	if file == "" {
		file = "docker-compose.yml"
	}
	service := ""
	if len(args) > 0 {
		last := args[len(args)-1]
		if last == "" {
			args = args[:len(args)-1]
		} else if !strings.HasPrefix(last, "-") && (strings.HasPrefix(args[0], "up") || strings.HasPrefix(args[0], "down") || strings.HasPrefix(args[0], "logs")) {
			service = last
			args = args[:len(args)-1]
		}
	}
	cmdArgs := []string{"compose", "-f", file}
	cmdArgs = append(cmdArgs, args...)
	if service != "" {
		cmdArgs = append(cmdArgs, service)
	}
	return p.exec(ctx, cmdArgs...)
}

func (p *plugin) exec(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, p.binary, args...)
	cmd.Dir = p.root
	if p.host != "" {
		cmd.Env = append(os.Environ(), "DOCKER_HOST="+p.host)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	text := strings.TrimSpace(string(out))
	errText := strings.TrimSpace(stderr.String())
	if errText != "" {
		if text != "" {
			text += "\n"
		}
		text += errText
	}
	if err != nil && text == "" {
		text = err.Error()
	}
	if len(text) > 2<<20 {
		text = text[:2<<20] + "\n… output truncated"
	}
	return text, err
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
		return "Docker command failed"
	}
	return value
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
