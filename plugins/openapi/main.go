// Command openapi is a Goland plugin for OpenAPI/Swagger inspection and request testing.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
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
	mu      sync.Mutex
	encoder *json.Encoder
	spec    string
	baseURL string
	timeout time.Duration
	root    string
}

type spec struct {
	path string
	doc  map[string]any
}

var httpMethods = []string{"get", "post", "put", "patch", "delete", "head", "options", "trace"}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	p := &plugin{encoder: json.NewEncoder(os.Stdout), timeout: 20 * time.Second}
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
			p.reply(req.ID, map[string]any{"name": "OpenAPI", "version": "0.1.0"})
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
	if value, ok := config["openapi.settings.spec"].(string); ok {
		p.spec = strings.TrimSpace(value)
	}
	if value, ok := config["openapi.settings.baseUrl"].(string); ok {
		p.baseURL = strings.TrimSpace(value)
	}
	if value, ok := config["openapi.settings.timeout"].(float64); ok && value >= 2 && value <= 60 {
		p.timeout = time.Duration(value) * time.Second
	}
}

func (p *plugin) updateStatus() {
	path := p.spec
	if path == "" {
		path = p.findSpec()
	}
	text := "OpenAPI ready"
	if path != "" {
		text = "OpenAPI: " + filepath.Base(path)
	} else {
		text = "OpenAPI: no spec"
	}
	p.notify("ui/status", map[string]any{"id": "openapi.status", "text": text, "tooltip": "OpenAPI plugin status"})
}

func (p *plugin) run(params commandParams) string {
	action := stringInput(params.Inputs, "action")
	switch params.CommandID {
	case "openapi.overview":
		action = "overview"
	case "openapi.endpoints":
		action = "endpoints"
	case "openapi.validate":
		action = "validate"
	case "openapi.request":
		action = "request"
	case "openapi.run":
		if action == "" {
			action = "overview"
		}
	default:
		return "unknown command " + params.CommandID
	}
	if action == "request" {
		out, err := p.request(params.Inputs)
		p.publish(action, out, err == nil)
		return out
	}
	s, err := p.load(stringInput(params.Inputs, "spec"))
	if err != nil {
		p.publish(action, err.Error(), false)
		return err.Error()
	}
	var out string
	switch action {
	case "overview":
		out = overview(s)
	case "endpoints":
		out = endpoints(s)
	case "validate":
		out = validate(s)
	default:
		out = "unknown OpenAPI action " + action
	}
	p.publish(action, out, true)
	return out
}

func (p *plugin) publish(action, out string, ok bool) {
	text := "OpenAPI ready"
	if !ok {
		text = "OpenAPI failed"
	} else if action == "endpoints" {
		text = "OpenAPI: endpoints"
	} else if action == "validate" {
		text = "OpenAPI: validated"
	} else if action == "request" {
		text = "OpenAPI: request sent"
	}
	p.notify("ui/status", map[string]any{"id": "openapi.status", "text": text, "tooltip": firstLine(out)})
	if !ok {
		p.notify("ui/notify", map[string]any{"level": "error", "message": "OpenAPI: " + firstLine(out)})
	}
}

func (p *plugin) load(input string) (*spec, error) {
	path := strings.TrimSpace(input)
	if path == "" {
		path = p.spec
	}
	if path == "" {
		path = p.findSpec()
	}
	if path == "" {
		return nil, fmt.Errorf("no OpenAPI/Swagger spec found; set a spec path")
	}
	full, err := p.resolve(path)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	doc := map[string]any{}
	if strings.HasSuffix(strings.ToLower(full), ".json") {
		err = json.Unmarshal(data, &doc)
	} else {
		err = yaml.Unmarshal(data, &doc)
	}
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return &spec{path: full, doc: doc}, nil
}

func (p *plugin) resolve(rel string) (string, error) {
	if strings.ContainsRune(rel, 0) || strings.Contains(rel, "\\") {
		return "", fmt.Errorf("invalid spec path")
	}
	full := rel
	if !filepath.IsAbs(full) {
		full = filepath.Join(p.root, filepath.FromSlash(rel))
	}
	full = filepath.Clean(full)
	root := filepath.Clean(p.root)
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("spec must be inside the workspace")
	}
	return full, nil
}

func (p *plugin) findSpec() string {
	var found []string
	_ = filepath.WalkDir(p.root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", "node_modules", "vendor", "dist", "build", "target", "coverage", ".next", ".cache":
				return filepath.SkipDir
			}
			return nil
		}
		lower := strings.ToLower(entry.Name())
		if lower == "openapi.json" || lower == "openapi.yaml" || lower == "openapi.yml" ||
			lower == "swagger.json" || lower == "swagger.yaml" || lower == "swagger.yml" {
			rel, _ := filepath.Rel(p.root, path)
			found = append(found, filepath.ToSlash(rel))
		}
		return nil
	})
	sort.Strings(found)
	if len(found) > 0 {
		return found[0]
	}
	return ""
}

func (p *plugin) request(inputs map[string]any) (string, error) {
	baseURL := stringInput(inputs, "baseUrl")
	if baseURL == "" {
		baseURL = p.baseURL
	}
	if baseURL == "" {
		if s, err := p.load(stringInput(inputs, "spec")); err == nil {
			baseURL = serverURL(s.doc)
		}
	}
	if baseURL == "" {
		return "", fmt.Errorf("base URL is required (set it in the console or add servers[0].url)")
	}
	baseURL = strings.TrimRight(baseURL, "/")
	method := strings.ToUpper(stringInput(inputs, "method"))
	if method == "" {
		method = http.MethodGet
	}
	path := stringInput(inputs, "path")
	if path == "" {
		return "", fmt.Errorf("request path is required")
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	body := stringInput(inputs, "body")
	var reader io.Reader
	if body != "" && method != http.MethodGet && method != http.MethodHead {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		return "", err
	}
	if body != "" && method != http.MethodGet && method != http.MethodHead {
		req.Header.Set("Content-Type", "application/json")
	}
	if headers := stringInput(inputs, "headers"); headers != "" {
		var values map[string]string
		if err := json.Unmarshal([]byte(headers), &values); err != nil {
			return "", fmt.Errorf("headers must be a JSON object: %w", err)
		}
		for key, value := range values {
			req.Header.Set(key, value)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), p.timeout)
	defer cancel()
	client := &http.Client{Timeout: p.timeout}
	resp, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var out strings.Builder
	fmt.Fprintf(&out, "%s %s\n%s\n", method, baseURL+path, resp.Status)
	for _, key := range []string{"Content-Type", "Content-Length", "Location"} {
		if value := resp.Header.Get(key); value != "" {
			fmt.Fprintf(&out, "%s: %s\n", key, value)
		}
	}
	content := strings.TrimSpace(string(data))
	if strings.Contains(resp.Header.Get("Content-Type"), "json") {
		var pretty bytes.Buffer
		if json.Indent(&pretty, data, "", "  ") == nil {
			content = pretty.String()
		}
	}
	out.WriteString("\n")
	out.WriteString(content)
	if len(out.String()) > 2<<20 {
		return out.String()[:2<<20] + "\n… output truncated", nil
	}
	return out.String(), nil
}

func overview(s *spec) string {
	info, _ := s.doc["info"].(map[string]any)
	title, _ := info["title"].(string)
	version, _ := info["version"].(string)
	openapi, _ := s.doc["openapi"].(string)
	swagger, _ := s.doc["swagger"].(string)
	paths, _ := s.doc["paths"].(map[string]any)
	var out strings.Builder
	fmt.Fprintf(&out, "Spec: %s\n", s.path)
	if openapi != "" {
		fmt.Fprintf(&out, "OpenAPI: %s\n", openapi)
	} else if swagger != "" {
		fmt.Fprintf(&out, "Swagger: %s\n", swagger)
	}
	if title != "" || version != "" {
		fmt.Fprintf(&out, "Title: %s %s\n", title, version)
	}
	fmt.Fprintf(&out, "Paths: %d\n", len(paths))
	if servers := servers(s.doc); len(servers) > 0 {
		fmt.Fprintf(&out, "Servers:\n  %s\n", strings.Join(servers, "\n  "))
	}
	return out.String()
}

func endpoints(s *spec) string {
	paths, _ := s.doc["paths"].(map[string]any)
	keys := make([]string, 0, len(paths))
	for key := range paths {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out strings.Builder
	count := 0
	for _, path := range keys {
		item, _ := paths[path].(map[string]any)
		for _, method := range httpMethods {
			op, ok := item[method].(map[string]any)
			if !ok {
				continue
			}
			count++
			summary, _ := op["summary"].(string)
			operationID, _ := op["operationId"].(string)
			line := fmt.Sprintf("%-6s %s", strings.ToUpper(method), path)
			if summary != "" {
				line += " — " + summary
			}
			if operationID != "" {
				line += " (" + operationID + ")"
			}
			out.WriteString(line + "\n")
			if count >= 500 {
				out.WriteString("… truncated at 500 endpoints\n")
				return out.String()
			}
		}
	}
	if count == 0 {
		return "No endpoints found."
	}
	return out.String()
}

func validate(s *spec) string {
	var problems []string
	if _, ok := s.doc["openapi"].(string); !ok {
		if _, ok := s.doc["swagger"].(string); !ok {
			problems = append(problems, "missing openapi/swagger version")
		}
	}
	info, _ := s.doc["info"].(map[string]any)
	if title, _ := info["title"].(string); title == "" {
		problems = append(problems, "info.title is required")
	}
	if version, _ := info["version"].(string); version == "" {
		problems = append(problems, "info.version is required")
	}
	paths, ok := s.doc["paths"].(map[string]any)
	if !ok || len(paths) == 0 {
		problems = append(problems, "paths must contain at least one path")
	} else {
		for path, raw := range paths {
			if !strings.HasPrefix(path, "/") {
				problems = append(problems, fmt.Sprintf("path %q must start with /", path))
			}
			item, ok := raw.(map[string]any)
			if !ok {
				problems = append(problems, fmt.Sprintf("path %q must be an object", path))
				continue
			}
			for _, method := range httpMethods {
				if op, ok := item[method]; ok {
					if _, ok := op.(map[string]any); !ok {
						problems = append(problems, fmt.Sprintf("%s %s must be an object", strings.ToUpper(method), path))
					}
				}
			}
		}
	}
	if len(problems) > 0 {
		return "Validation failed:\n- " + strings.Join(problems, "\n- ")
	}
	return fmt.Sprintf("Valid OpenAPI document: %s (%d paths)", s.path, len(paths))
}

func servers(doc map[string]any) []string {
	raw, _ := doc["servers"].([]any)
	var out []string
	for _, item := range raw {
		if server, ok := item.(map[string]any); ok {
			if url, _ := server["url"].(string); url != "" {
				out = append(out, url)
			}
		}
	}
	return out
}

func serverURL(doc map[string]any) string {
	servers := servers(doc)
	if len(servers) > 0 {
		return servers[0]
	}
	return ""
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
		return "OpenAPI command failed"
	}
	return value
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
