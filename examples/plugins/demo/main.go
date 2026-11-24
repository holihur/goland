// Command demo is the example Goland plugin. It speaks newline-delimited
// JSON-RPC 2.0 with the host and implements commands, UI events and hooks.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
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

type hookParams struct {
	RequestID string   `json:"requestId"`
	Kind      string   `json:"kind"`
	Path      string   `json:"path"`
	Content   string   `json:"content"`
	Message   string   `json:"message"`
	Files     []string `json:"files"`
}

type plugin struct {
	mu           sync.Mutex
	encoder      *json.Encoder
	greeting     string
	formatOnSave bool
	commands     int
	lastOutput   string
	cancelled    map[string]bool
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	encoder := json.NewEncoder(os.Stdout)
	p := &plugin{encoder: encoder, greeting: "Hello", formatOnSave: true, cancelled: map[string]bool{}}
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			continue
		}
		reply := func(result any) { p.reply(req.ID, result) }
		switch req.Method {
		case "initialize":
			var params initializeParams
			_ = json.Unmarshal(req.Params, &params)
			p.applyConfig(params.Config)
			reply(map[string]any{"name": "Demo Toolkit", "version": "1.0.0"})
			p.notify("ui/status", map[string]any{"id": "demo.status", "text": "Demo ready", "tooltip": "Demo plugin"})
		case "health":
			reply(map[string]any{"status": "ok"})
		case "shutdown":
			return
		case "command/execute":
			var params commandParams
			_ = json.Unmarshal(req.Params, &params)
			if params.CommandID == "demo.slow" {
				go p.slow(req.ID, params)
				continue
			}
			p.command(params)
			reply(map[string]any{"output": p.lastOutput})
		case "command/cancel":
			var params struct {
				RequestID string `json:"requestId"`
			}
			_ = json.Unmarshal(req.Params, &params)
			p.mu.Lock()
			p.cancelled[params.RequestID] = true
			p.mu.Unlock()
		case "hook/onOpen":
			reply(map[string]any{"allow": true, "notes": []string{"demo: file checked"}})
		case "hook/onSave":
			var params hookParams
			_ = json.Unmarshal(req.Params, &params)
			if !p.formatOnSave {
				reply(map[string]any{"allow": true})
				continue
			}
			formatted := format(params.Content)
			reply(map[string]any{"allow": true, "content": formatted, "notes": []string{"demo: formatted on save"}})
		case "hook/preCommit":
			var params hookParams
			_ = json.Unmarshal(req.Params, &params)
			if strings.Contains(strings.ToLower(params.Message), "block") {
				reply(map[string]any{"allow": false, "message": "Demo plugin blocks commits containing \"block\""})
			} else {
				reply(map[string]any{"allow": true})
			}
		}
	}
}

func (p *plugin) applyConfig(config map[string]any) {
	if value, ok := config["demo.settings.greeting"].(string); ok && value != "" {
		p.greeting = value
	}
	if value, ok := config["demo.settings.formatOnSave"].(bool); ok {
		p.formatOnSave = value
	}
}

func (p *plugin) command(params commandParams) {
	p.commands++
	switch params.CommandID {
	case "demo.hello":
		name := stringInput(params.Inputs, "name")
		message := p.greeting
		if name != "" {
			message += ", " + name
		}
		p.lastOutput = message + "!"
		p.notify("ui/status", map[string]any{"id": "demo.status", "text": fmt.Sprintf("Demo: greeted %d", p.commands)})
		p.notify("ui/notify", map[string]any{"level": "info", "message": p.lastOutput})
	case "demo.scan":
		query := stringInput(params.Inputs, "query")
		if query == "" {
			query = "*"
		}
		files, err := scan(query)
		if err != nil {
			p.lastOutput = "scan failed: " + err.Error()
			return
		}
		p.lastOutput = fmt.Sprintf("%d file(s) matching %s", len(files), query)
		p.notify("ui/panel", map[string]any{
			"panelId": "demo.panel", "output": strings.Join(files, "\n"),
			"state": map[string]any{"query": query, "count": len(files)},
		})
		p.notify("ui/status", map[string]any{"id": "demo.status", "text": fmt.Sprintf("Demo: %d files", len(files))})
	case "demo.format":
		p.lastOutput = p.formatPath(params.Path)
		p.notify("ui/notify", map[string]any{"level": "info", "message": p.lastOutput})
	default:
		p.lastOutput = "unknown command " + params.CommandID
	}
}

func (p *plugin) slow(id *int64, params commandParams) {
	for i := 1; i <= 40; i++ {
		p.mu.Lock()
		cancelled := p.cancelled[params.RequestID]
		p.mu.Unlock()
		if cancelled {
			p.mu.Lock()
			delete(p.cancelled, params.RequestID)
			p.mu.Unlock()
			p.notify("command/output", map[string]any{"requestId": params.RequestID, "chunk": "[cancelled]\n"})
			p.reply(id, map[string]any{"output": "cancelled"})
			return
		}
		p.notify("command/output", map[string]any{"requestId": params.RequestID, "chunk": fmt.Sprintf("chunk %d\n", i)})
		time.Sleep(250 * time.Millisecond)
	}
	p.reply(id, map[string]any{"output": "stream complete"})
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

func (p *plugin) formatPath(path string) string {
	if path == "" {
		return "no file selected"
	}
	clean := filepath.Clean(path)
	data, err := os.ReadFile(clean)
	if err != nil {
		return "format failed: " + err.Error()
	}
	formatted := format(string(data))
	if err := os.WriteFile(clean, []byte(formatted), 0o644); err != nil {
		return "format failed: " + err.Error()
	}
	return "formatted " + path
}

func stringInput(inputs map[string]any, key string) string {
	value, _ := inputs[key].(string)
	return strings.TrimSpace(value)
}

func scan(query string) ([]string, error) {
	root, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	var files []string
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == ".git" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		matched, _ := filepath.Match(query, entry.Name())
		if matched || query == "*" {
			rel, _ := filepath.Rel(root, path)
			files = append(files, rel)
		}
		if len(files) >= 200 {
			return filepath.SkipAll
		}
		return nil
	})
	return files, err
}

func format(content string) string {
	lines := strings.Split(content, "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " \t")
	}
	out := strings.TrimRight(strings.Join(lines, "\n"), "\n")
	return out + "\n"
}
