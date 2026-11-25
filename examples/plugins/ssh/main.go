// Command ssh is a Goland plugin for non-interactive SSH commands and config hosts.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
	config   string
	user     string
	port     string
	identity string
	strict   string
	timeout  time.Duration
	root     string
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	p := &plugin{
		encoder: json.NewEncoder(os.Stdout), binary: "ssh", port: "22",
		strict: "accept-new", timeout: 10 * time.Second,
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
			p.reply(req.ID, map[string]any{"name": "SSH", "version": "0.1.0"})
			p.updateStatus()
		case "health":
			p.reply(req.ID, map[string]any{"status": "ok"})
		case "shutdown":
			return
		case "command/execute":
			var params commandParams
			_ = json.Unmarshal(req.Params, &params)
			p.reply(req.ID, map[string]any{"output": p.run(params)})
		}
	}
}

func (p *plugin) applyConfig(config map[string]any) {
	if value, ok := config["ssh.settings.binary"].(string); ok && strings.TrimSpace(value) != "" {
		p.binary = strings.TrimSpace(value)
	}
	if value, ok := config["ssh.settings.config"].(string); ok {
		p.config = strings.TrimSpace(value)
	}
	if value, ok := config["ssh.settings.user"].(string); ok {
		p.user = strings.TrimSpace(value)
	}
	if value, ok := config["ssh.settings.port"].(string); ok && strings.TrimSpace(value) != "" {
		p.port = strings.TrimSpace(value)
	}
	if value, ok := config["ssh.settings.identity"].(string); ok {
		p.identity = strings.TrimSpace(value)
	}
	if value, ok := config["ssh.settings.strictHostKeyChecking"].(string); ok && value != "" {
		p.strict = value
	}
	if value, ok := config["ssh.settings.timeout"].(float64); ok && value >= 2 && value <= 45 {
		p.timeout = time.Duration(value) * time.Second
	}
}

func (p *plugin) updateStatus() {
	out, err := p.exec(context.Background(), 3*time.Second, "-V")
	text := "SSH ready"
	tooltip := firstLine(out)
	if err != nil {
		text = "SSH unavailable"
		if tooltip == "" {
			tooltip = "ssh binary not found"
		}
	}
	p.notify("ui/status", map[string]any{"id": "ssh.status", "text": text, "tooltip": tooltip})
}

func (p *plugin) run(params commandParams) string {
	action := stringInput(params.Inputs, "action")
	switch params.CommandID {
	case "ssh.exec":
		action = "exec"
	case "ssh.test":
		action = "test"
	case "ssh.hosts":
		action = "hosts"
	case "ssh.panel.run":
		if action == "" {
			action = "exec"
		}
	default:
		return "unknown command " + params.CommandID
	}
	if action == "hosts" {
		hosts, err := p.hosts()
		if err != nil {
			return err.Error()
		}
		out := strings.Join(hosts, "\n")
		if out == "" {
			out = "No Host entries found in SSH config."
		}
		p.publish(action, out, true)
		return out
	}
	host := stringInput(params.Inputs, "host")
	if host == "" {
		return "host is required"
	}
	if err := validateHost(host); err != nil {
		return err.Error()
	}
	user := stringInput(params.Inputs, "user")
	if user == "" {
		user = p.user
	}
	port := stringInput(params.Inputs, "port")
	if port == "" {
		port = p.port
	}
	if err := validatePort(port); err != nil {
		return err.Error()
	}
	identity := stringInput(params.Inputs, "identity")
	if identity == "" {
		identity = p.identity
	}
	command := stringInput(params.Inputs, "command")
	if action == "test" {
		command = "true"
	}
	if command == "" {
		return "command is required"
	}
	args := []string{
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=" + fmt.Sprintf("%d", int(p.timeout.Seconds())),
		"-o", "StrictHostKeyChecking=" + p.strict,
		"-p", port,
	}
	if identity != "" {
		args = append(args, "-i", expandHome(identity))
	}
	target := host
	if user != "" {
		if err := validateUser(user); err != nil {
			return err.Error()
		}
		target = user + "@" + host
	}
	args = append(args, "--", target, command)
	out, err := p.exec(context.Background(), p.timeout+10*time.Second, args...)
	if err != nil && out == "" {
		out = err.Error()
	}
	p.publish(action, out, err == nil)
	return out
}

func (p *plugin) publish(action, out string, ok bool) {
	p.notify("ui/panel", map[string]any{
		"panelId": "ssh.panel", "output": out,
		"state": map[string]any{"action": action, "ok": ok},
	})
	text := "SSH ready"
	if !ok {
		text = "SSH command failed"
	} else if action == "test" {
		text = "SSH connected"
	} else if action == "exec" {
		text = "SSH command finished"
	} else if action == "hosts" {
		text = "SSH hosts listed"
	}
	p.notify("ui/status", map[string]any{"id": "ssh.status", "text": text, "tooltip": firstLine(out)})
	if !ok {
		p.notify("ui/notify", map[string]any{"level": "error", "message": "SSH: " + firstLine(out)})
	}
}

func (p *plugin) hosts() ([]string, error) {
	path := p.config
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		path = filepath.Join(home, ".ssh", "config")
	}
	path = expandHome(path)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 5 || strings.ToLower(line[:4]) != "host" {
			continue
		}
		for _, host := range strings.Fields(line[4:]) {
			if host == "*" || strings.ContainsAny(host, "?!") {
				continue
			}
			out = append(out, host)
		}
	}
	return out, nil
}

func (p *plugin) exec(ctx context.Context, timeout time.Duration, args ...string) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, p.binary, args...)
	cmd.Dir = p.root
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

func validateHost(host string) error {
	if strings.HasPrefix(host, "-") || strings.ContainsAny(host, " \t\n\r\x00") {
		return fmt.Errorf("invalid host")
	}
	return nil
}

func validateUser(user string) error {
	if strings.HasPrefix(user, "-") || strings.ContainsAny(user, " \t\n\r\x00@") {
		return fmt.Errorf("invalid user")
	}
	return nil
}

func validatePort(port string) error {
	if port == "" {
		return nil
	}
	var value int
	if _, err := fmt.Sscanf(port, "%d", &value); err != nil || value < 1 || value > 65535 || fmt.Sprintf("%d", value) != port {
		return fmt.Errorf("invalid port")
	}
	return nil
}

func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(path, "~/"))
		}
	}
	return path
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
		return "SSH command failed"
	}
	return value
}
