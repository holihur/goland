package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"goland/internal/auth"
	"goland/internal/files"
	"goland/internal/store"
	testpkg "goland/internal/tests"
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

var mcpTools = []mcpTool{
	tool("list_workspaces", "List workspaces owned by the token user.", obj(nil)),
	tool("get_workspace", "Get metadata for one workspace.", obj(map[string]any{"workspaceId": str("Workspace id")}, "workspaceId")),
	tool("list_files", "List files or directories in a workspace.", obj(map[string]any{"workspaceId": str("Workspace id"), "path": str("Relative directory path")}, "workspaceId")),
	tool("read_file", "Read a UTF-8 text file.", obj(map[string]any{"workspaceId": str("Workspace id"), "path": str("Relative file path")}, "workspaceId", "path")),
	tool("search_files", "Search workspace paths by substring.", obj(map[string]any{"workspaceId": str("Workspace id"), "query": str("Path substring"), "limit": num("Maximum results")}, "workspaceId", "query")),
	tool("search_content", "Search file contents with optional regex and case sensitivity.", obj(map[string]any{"workspaceId": str("Workspace id"), "query": str("Text or regex"), "regex": boolean("Treat query as regex"), "caseSensitive": boolean("Match case"), "limit": num("Maximum matches")}, "workspaceId", "query")),
	tool("write_file", "Write a text file, optionally guarded by an etag.", obj(map[string]any{"workspaceId": str("Workspace id"), "path": str("Relative file path"), "content": str("File content"), "etag": str("Expected current etag")}, "workspaceId", "path", "content")),
	tool("replace_content", "Replace content across workspace files.", obj(map[string]any{"workspaceId": str("Workspace id"), "query": str("Text or regex"), "replacement": str("Replacement text"), "regex": boolean("Treat query as regex"), "caseSensitive": boolean("Match case")}, "workspaceId", "query", "replacement")),
	tool("git_status", "Read Git status for a workspace.", obj(map[string]any{"workspaceId": str("Workspace id")}, "workspaceId")),
	tool("git_diff", "Read a Git diff for a file or the whole workspace.", obj(map[string]any{"workspaceId": str("Workspace id"), "path": str("Optional relative file path"), "cached": boolean("Show staged diff")}, "workspaceId")),
	tool("list_tests", "Discover Go and Vitest tests.", obj(map[string]any{"workspaceId": str("Workspace id")}, "workspaceId")),
	tool("run_test", "Run one Go or Vitest test.", obj(map[string]any{"workspaceId": str("Workspace id"), "kind": str("go or vitest"), "path": str("Test file path"), "name": str("Test name")}, "workspaceId", "kind", "path", "name")),
}

func str(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}
func num(description string) map[string]any {
	return map[string]any{"type": "number", "description": description}
}
func boolean(description string) map[string]any {
	return map[string]any{"type": "boolean", "description": description}
}
func obj(properties map[string]any, required ...string) map[string]any {
	if properties == nil {
		properties = map[string]any{}
	}
	out := map[string]any{"type": "object", "properties": properties}
	if len(required) > 0 {
		out["required"] = required
	}
	return out
}
func tool(name, description string, schema map[string]any) mcpTool {
	return mcpTool{Name: name, Description: description, InputSchema: schema}
}

func (s *Server) mcpEndpoint(w http.ResponseWriter, r *http.Request) {
	token := auth.TokenFrom(r.Context())
	if token == nil || !auth.TokenHasScope(token, "mcp") {
		writeError(w, http.StatusForbidden, "mcp_scope_required", "a personal access token with the mcp scope is required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req mcpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		mcpError(w, nil, -32700, "invalid JSON")
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		mcpError(w, req.ID, -32600, "invalid JSON-RPC request")
		return
	}
	switch req.Method {
	case "initialize":
		mcpResult(w, req.ID, map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "goland", "version": "1.0.0"},
		})
	case "notifications/initialized", "notifications/cancelled":
		w.WriteHeader(http.StatusAccepted)
	case "ping":
		mcpResult(w, req.ID, map[string]any{})
	case "tools/list":
		mcpResult(w, req.ID, map[string]any{"tools": mcpTools})
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			mcpError(w, req.ID, -32602, "invalid tool arguments")
			return
		}
		text, err := s.callMCPTool(r.Context(), token, params.Name, params.Arguments)
		if err != nil {
			mcpResult(w, req.ID, map[string]any{
				"content": []map[string]any{{"type": "text", "text": err.Error()}},
				"isError": true,
			})
			return
		}
		mcpResult(w, req.ID, map[string]any{
			"content": []map[string]any{{"type": "text", "text": text}},
			"isError": false,
		})
	default:
		mcpError(w, req.ID, -32601, "method not found")
	}
}

func (s *Server) callMCPTool(ctx context.Context, token *store.APIToken, name string, raw json.RawMessage) (string, error) {
	s.auditRequest(ctx, "mcp.tool", token.UserID.Hex(), name)
	if !auth.TokenHasScope(token, scopeForTool(name)) {
		return "", fmt.Errorf("token is missing the %q scope", scopeForTool(name))
	}
	var args map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return "", errors.New("arguments must be a JSON object")
		}
	}
	if args == nil {
		args = map[string]any{}
	}
	switch name {
	case "list_workspaces":
		list, err := s.workspaces.List(ctx, token.UserID)
		if err != nil {
			return "", err
		}
		return jsonText(list)
	case "get_workspace":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		return jsonText(ws)
	case "list_files":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		entries, err := s.files.List(ws, argString(args, "path"))
		if err != nil {
			return "", err
		}
		return jsonText(entries)
	case "read_file":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		content, err := s.files.Read(ws, argString(args, "path"))
		if err != nil {
			return "", err
		}
		if content.Binary {
			return "", errors.New("file is binary")
		}
		return content.Content, nil
	case "search_files":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		results, err := s.files.Search(ws, argString(args, "query"), argInt(args, "limit"))
		if err != nil {
			return "", err
		}
		return jsonText(results)
	case "search_content":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		result, err := s.files.ContentSearch(ws, files.ContentOptions{
			Query: argString(args, "query"), Regex: argBool(args, "regex"),
			CaseSensitive: argBool(args, "caseSensitive"), Limit: argInt(args, "limit"),
		})
		if err != nil {
			return "", err
		}
		return jsonText(result)
	case "write_file":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		content, err := s.files.Write(ws, argString(args, "path"), argString(args, "content"), argString(args, "etag"))
		if err != nil {
			return "", err
		}
		s.auditRequest(ctx, "mcp.file.write", ws.ID.Hex(), argString(args, "path"))
		return jsonText(content)
	case "replace_content":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		result, err := s.files.ContentReplace(ws, files.ContentOptions{
			Query: argString(args, "query"), Replacement: argString(args, "replacement"),
			Regex: argBool(args, "regex"), CaseSensitive: argBool(args, "caseSensitive"),
		})
		if err != nil {
			return "", err
		}
		s.auditRequest(ctx, "mcp.file.replace", ws.ID.Hex(), argString(args, "query"))
		return jsonText(result)
	case "git_status":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		status, err := s.git.Status(ctx, ws)
		if err != nil {
			return "", err
		}
		return jsonText(status)
	case "git_diff":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		diff, err := s.git.Diff(ctx, ws, argString(args, "path"), argBool(args, "cached"))
		if err != nil {
			return "", err
		}
		return diff, nil
	case "list_tests":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		root, err := s.workspaces.Resolve(ws)
		if err != nil {
			return "", err
		}
		discovery, err := testpkg.Discover(root)
		if err != nil {
			return "", err
		}
		return jsonText(discovery)
	case "run_test":
		ws, err := s.mcpWorkspace(ctx, token, args)
		if err != nil {
			return "", err
		}
		root, err := s.workspaces.Resolve(ws)
		if err != nil {
			return "", err
		}
		item := testpkg.Item{Kind: argString(args, "kind"), Path: argString(args, "path"), Name: argString(args, "name")}
		command, commandArgs, err := testpkg.Command(root, item)
		if err != nil {
			return "", err
		}
		identity, err := s.workspaces.Identity(ctx, ws)
		if err != nil {
			return "", err
		}
		runCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(runCtx, command, commandArgs...)
		cmd.Dir = root
		cmd.Env = identity.Env(root)
		identity.Apply(cmd)
		out, runErr := cmd.CombinedOutput()
		result := map[string]any{"status": "success", "exitCode": 0, "output": strings.TrimSpace(string(out))}
		if runErr != nil {
			result["status"] = "failed"
			result["exitCode"] = -1
			var exitErr *exec.ExitError
			if errors.As(runErr, &exitErr) {
				result["exitCode"] = exitErr.ExitCode()
			}
		}
		return jsonText(result)
	default:
		return "", fmt.Errorf("unknown tool %q", name)
	}
}

func scopeForTool(name string) string {
	switch name {
	case "write_file", "replace_content":
		return "write"
	case "git_status", "git_diff":
		return "git"
	case "run_test":
		return "run"
	default:
		return "read"
	}
}

func (s *Server) mcpWorkspace(ctx context.Context, token *store.APIToken, args map[string]any) (*store.Workspace, error) {
	id, err := primitive.ObjectIDFromHex(argString(args, "workspaceId"))
	if err != nil {
		return nil, errors.New("workspaceId is required")
	}
	return s.workspaces.Get(ctx, token.UserID, id)
}

func mcpResult(w http.ResponseWriter, id json.RawMessage, result any) {
	if len(id) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id), "result": result})
}

func mcpError(w http.ResponseWriter, id json.RawMessage, code int, message string) {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"jsonrpc": "2.0", "id": json.RawMessage(id),
		"error": map[string]any{"code": code, "message": message},
	})
}

func jsonText(value any) (string, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func argString(args map[string]any, key string) string {
	value, _ := args[key].(string)
	return strings.TrimSpace(value)
}

func argBool(args map[string]any, key string) bool {
	value, _ := args[key].(bool)
	return value
}

func argInt(args map[string]any, key string) int {
	switch value := args[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}

func (s *Server) auditRequest(ctx context.Context, action, resource, detail string) {
	s.store.RecordAudit(ctx, &store.AuditEvent{Action: action, Resource: resource, Detail: detail, CreatedAt: time.Now().UTC()})
}
