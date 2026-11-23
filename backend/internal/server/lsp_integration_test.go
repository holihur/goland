package server_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"goland/internal/auth"
	"goland/internal/config"
	"goland/internal/files"
	"goland/internal/git"
	"goland/internal/server"
	"goland/internal/store"
	"goland/internal/workspace"
)

type rpcMessage struct {
	ID     *int            `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  json.RawMessage `json:"error,omitempty"`
}

type lspTestServer struct {
	base      string
	workspace string
	root      string
	cookie    *http.Cookie
	tools     map[string]string
}

func TestRealLSP(t *testing.T) {
	uri := os.Getenv("GOLAND_TEST_MONGO_URI")
	if uri == "" {
		uri = "mongodb://127.0.0.1:27019"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	st, err := store.Connect(ctx, uri, "goland_lsp_"+fmt.Sprint(time.Now().UnixNano()))
	if err != nil {
		t.Skipf("MongoDB unavailable: %v", err)
	}
	defer func() {
		_ = st.DropDatabase(context.Background())
		_ = st.Disconnect(context.Background())
	}()
	root := t.TempDir()
	cfg := &config.Config{
		DataDir: t.TempDir(), WorkspaceRoots: []string{root}, SessionTTL: time.Hour,
		AdminEmail: "lsp-admin@test.local", AdminPassword: "admin-password-1", AdminName: "Admin",
		MasterKey: []byte("01234567890123456789012345678901"), Isolation: "none",
	}
	cfg.GoPLS = findTool(t, "../../../bin/tools/gopls", "gopls")
	cfg.TSServer = findTool(t, "../../../frontend/node_modules/.bin/typescript-language-server", "typescript-language-server")
	if err := server.BootstrapAdmin(context.Background(), st, cfg); err != nil {
		t.Fatal(err)
	}
	wm, err := workspace.New(cfg, st)
	if err != nil {
		t.Fatal(err)
	}
	h := server.New(cfg, st, auth.NewManager(st, time.Hour, false), wm, files.New(wm), git.New(wm), slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))
	ts := httptest.NewServer(h)
	defer ts.Close()
	jar, _ := cookiejar.New(nil)
	httpClient := &http.Client{Jar: jar, Timeout: 15 * time.Second}
	loginResp, err := httpClient.Post(ts.URL+"/api/auth/login", "application/json", strings.NewReader(`{"email":"lsp-admin@test.local","password":"admin-password-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	loginResp.Body.Close()
	u, _ := url.Parse(ts.URL)
	var session *http.Cookie
	for _, c := range jar.Cookies(u) {
		if c.Name == auth.SessionCookie {
			session = c
		}
	}
	if session == nil {
		t.Fatal("no session cookie")
	}
	dir := filepath.Join(root, "lsp-workspace")
	if err := os.MkdirAll(filepath.Join(dir, "web"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module example.com/lsp\n\ngo 1.22\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	goSource := `package main

import "fmt"

func greet(name string) string { return "hi " + name }

func main() { fmt.Println(greet("world")) }
`
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(goSource), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bad.go"), []byte("package main\n\nvar bad int = \"not an int\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "format.go"), []byte("package main\nfunc  badlyFormatted( ){println( \"x\" )}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "web", "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"ESNext","strict":true,"noEmit":true},"include":["*.ts"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	tsSource := `type User = { name: string; age: number };

function greeting(user: User): string { return "hello " + user.name; }

const u: User = { name: "Ada", age: 36 };
console.log(greeting(u));
`
	if err := os.WriteFile(filepath.Join(dir, "web", "app.ts"), []byte(tsSource), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "web", "bad.ts"), []byte("const broken: number = \"string\";\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "web", "format.ts"), []byte("const   x=1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Create workspace through the API to exercise auth/ownership.
	client := &http.Client{Jar: jar}
	body := strings.NewReader(fmt.Sprintf(`{"name":"lsp","source":"local","path":%q}`, dir))
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/workspaces", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ts.URL)
	// Obtain CSRF from the login response cookies.
	for _, c := range jar.Cookies(u) {
		if c.Name == auth.CSRFCookie {
			req.Header.Set(auth.CSRFHeader, c.Value)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("create workspace: %d %s", resp.StatusCode, data)
	}
	var created struct {
		Workspace struct {
			ID string `json:"id"`
		} `json:"workspace"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	base := lspTestServer{base: ts.URL, workspace: created.Workspace.ID, root: dir, cookie: session, tools: map[string]string{"go": cfg.GoPLS, "typescript": cfg.TSServer}}

	// Unauthenticated WebSocket is rejected.
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/ws/workspaces/" + created.Workspace.ID + "/lsp?language=go"
	header := http.Header{"Origin": []string{ts.URL}}
	if conn, _, err := websocket.DefaultDialer.Dial(wsURL, header); err == nil {
		conn.Close()
		t.Fatal("unauthenticated LSP websocket was accepted")
	}

	testGoLSP(t, base, goSource)
	testTypeScriptLSP(t, base, tsSource)
}

func testGoLSP(t *testing.T, base lspTestServer, source string) {
	conn := dialLSP(t, base, "go")
	defer conn.Close()
	uri := "file://" + filepath.Join(base.root, "main.go")
	init := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{
		"rootUri": "file://" + base.root, "rootPath": base.root,
		"workspaceFolders": []any{map[string]any{"uri": "file://" + base.root, "name": "workspace"}},
		"capabilities":     map[string]any{"textDocument": map[string]any{}},
	}}
	sendRPC(t, conn, init)
	waitRPC(t, conn, func(m rpcMessage) bool { return m.ID != nil && *m.ID == 1 }, 20*time.Second)
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "method": "initialized", "params": map[string]any{}})
	open := map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
		"textDocument": map[string]any{"uri": uri, "languageId": "go", "version": 1, "text": source},
	}}
	sendRPC(t, conn, open)
	time.Sleep(6 * time.Second)

	badURI := "file://" + filepath.Join(base.root, "bad.go")
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
		"textDocument": map[string]any{"uri": badURI, "languageId": "go", "version": 1, "text": "package main\n\nvar bad int = \"not an int\"\n"},
	}})
	diag := waitRPC(t, conn, func(m rpcMessage) bool {
		params := string(m.Params)
		return m.Method == "textDocument/publishDiagnostics" && strings.Contains(params, "bad.go") && !strings.Contains(params, `"diagnostics":[]`) && !strings.Contains(params, "No packages found")
	}, 30*time.Second)
	if !strings.Contains(strings.ToLower(string(diag.Params)), "cannot use") && !strings.Contains(strings.ToLower(string(diag.Params)), "type") {
		t.Errorf("unexpected gopls diagnostics: %s", diag.Params)
	}

	completion := lspRequest(t, conn, 2, base, uri, "textDocument/completion", goPosition(source, "fmt.Println", 4))
	if !strings.Contains(string(completion.Result), "Println") {
		t.Errorf("completion missing Println: %s", completion.Result)
	}
	hover := lspRequest(t, conn, 3, base, uri, "textDocument/hover", goPosition(source, "greet(\"world\")", 1))
	if !strings.Contains(strings.ToLower(string(hover.Result)), "greet") {
		t.Errorf("hover missing greet: %s", hover.Result)
	}
	definition := lspRequest(t, conn, 4, base, uri, "textDocument/definition", goPosition(source, "greet(\"world\")", 1))
	if !strings.Contains(string(definition.Result), "main.go") {
		t.Errorf("definition missing main.go: %s", definition.Result)
	}
	references := lspRequest(t, conn, 5, base, uri, "textDocument/references", goPosition(source, "func greet", 6))
	if !strings.Contains(string(references.Result), "main.go") {
		t.Errorf("references missing main.go: %s", references.Result)
	}
	formatURI := "file://" + filepath.Join(base.root, "format.go")
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
		"textDocument": map[string]any{"uri": formatURI, "languageId": "go", "version": 1, "text": "package main\nfunc  badlyFormatted( ){println( \"x\" )}\n"},
	}})
	format := lspRequest(t, conn, 6, base, formatURI, "textDocument/formatting", map[string]any{"line": 0, "character": 0})
	if !strings.Contains(string(format.Result), "newText") {
		t.Errorf("formatting returned no edits: %s", format.Result)
	}
	conn.Close()
	assertNoOrphan(t, base.root, 10*time.Second)
}

func testTypeScriptLSP(t *testing.T, base lspTestServer, source string) {
	conn := dialLSP(t, base, "typescript")
	defer conn.Close()
	file := filepath.Join(base.root, "web", "app.ts")
	uri := "file://" + file
	init := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{
		"processId": nil, "clientInfo": map[string]any{"name": "goland-test", "version": "0.1.0"},
		"rootUri": "file://" + filepath.Join(base.root, "web"), "rootPath": filepath.Join(base.root, "web"),
		"workspaceFolders": []any{map[string]any{"uri": "file://" + filepath.Join(base.root, "web"), "name": "web"}},
		"capabilities": map[string]any{
			"textDocument": map[string]any{
				"synchronization": map[string]any{"didSave": true},
				"completion":      map[string]any{"completionItem": map[string]any{"snippetSupport": false}},
				"hover":           map[string]any{"contentFormat": []string{"markdown", "plaintext"}},
				"definition":      map[string]any{"linkSupport": true},
				"references":      map[string]any{}, "formatting": map[string]any{},
				"publishDiagnostics": map[string]any{"relatedInformation": true},
			},
			"workspace": map[string]any{"workspaceFolders": true, "configuration": true},
			"window":    map[string]any{"workDoneProgress": true},
		},
	}}
	sendRPC(t, conn, init)
	waitRPC(t, conn, func(m rpcMessage) bool { return m.ID != nil && *m.ID == 1 }, 20*time.Second)
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "method": "initialized", "params": map[string]any{}})
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
		"textDocument": map[string]any{"uri": uri, "languageId": "typescript", "version": 1, "text": source},
	}})
	badURI := "file://" + filepath.Join(base.root, "web", "bad.ts")
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
		"textDocument": map[string]any{"uri": badURI, "languageId": "typescript", "version": 1, "text": "const broken: number = \"string\";\n"},
	}})
	diag := waitRPC(t, conn, func(m rpcMessage) bool {
		params := string(m.Params)
		return m.Method == "textDocument/publishDiagnostics" && strings.Contains(params, "bad.ts") && !strings.Contains(params, `"diagnostics":[]`)
	}, 35*time.Second)
	if !strings.Contains(strings.ToLower(string(diag.Params)), "string") && !strings.Contains(strings.ToLower(string(diag.Params)), "number") {
		t.Errorf("unexpected tsserver diagnostics: %s", diag.Params)
	}
	time.Sleep(2 * time.Second)
	completion := lspRequest(t, conn, 2, base, uri, "textDocument/completion", tsPosition(source, "greeting(u)", 10))
	if !strings.Contains(string(completion.Result), "greeting") {
		t.Errorf("TS completion missing greeting: %s", completion.Result)
	}
	hover := lspRequest(t, conn, 3, base, uri, "textDocument/hover", tsPosition(source, "greeting(u)", 1))
	if !strings.Contains(strings.ToLower(string(hover.Result)), "greeting") {
		t.Errorf("TS hover missing greeting: %s", hover.Result)
	}
	definition := lspRequest(t, conn, 4, base, uri, "textDocument/definition", tsPosition(source, "greeting(u)", 1))
	if !strings.Contains(string(definition.Result), "app.ts") {
		t.Errorf("TS definition missing app.ts: %s", definition.Result)
	}
	references := lspRequest(t, conn, 5, base, uri, "textDocument/references", tsPosition(source, "function greeting", 12))
	if !strings.Contains(string(references.Result), "app.ts") {
		t.Errorf("TS references missing app.ts: %s", references.Result)
	}
	formatURI := "file://" + filepath.Join(base.root, "web", "format.ts")
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
		"textDocument": map[string]any{"uri": formatURI, "languageId": "typescript", "version": 1, "text": "const   x=1;\n"},
	}})
	time.Sleep(time.Second)
	format := lspRequest(t, conn, 6, base, formatURI, "textDocument/formatting", map[string]any{"line": 0, "character": 0})
	if !strings.Contains(string(format.Result), "newText") {
		t.Errorf("TS formatting returned no edits: %s", format.Result)
	}
	conn.Close()
	assertNoOrphan(t, base.root, 10*time.Second)
}

func dialLSP(t *testing.T, base lspTestServer, language string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(base.base, "http") + "/api/ws/workspaces/" + base.workspace + "/lsp?language=" + language
	header := http.Header{"Origin": []string{base.base}, "Cookie": []string{base.cookie.Name + "=" + base.cookie.Value}}
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("dial %s: %v (status %d)", language, err, status)
	}
	return conn
}

func sendRPC(t *testing.T, conn *websocket.Conn, value map[string]any) {
	t.Helper()
	if err := conn.WriteJSON(value); err != nil {
		t.Fatal(err)
	}
}

func waitRPC(t *testing.T, conn *websocket.Conn, match func(rpcMessage) bool, timeout time.Duration) rpcMessage {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		_ = conn.SetReadDeadline(deadline)
		var msg rpcMessage
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("read LSP: %v", err)
		}
		if msg.Method != "" && msg.ID != nil {
			var result any = nil
			if msg.Method == "workspace/configuration" {
				result = []any{map[string]any{}}
			}
			_ = conn.WriteJSON(map[string]any{"jsonrpc": "2.0", "id": *msg.ID, "result": result})
			continue
		}
		if match(msg) {
			return msg
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for LSP message")
		}
	}
}

func lspRequest(t *testing.T, conn *websocket.Conn, id int, base lspTestServer, uri, method string, position any) rpcMessage {
	t.Helper()
	sendRPC(t, conn, map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": map[string]any{
		"textDocument": map[string]any{"uri": uri},
		"position":     position,
		"options":      map[string]any{"tabSize": 2, "insertSpaces": true},
		"context":      map[string]any{"includeDeclaration": true},
	}})
	return waitRPC(t, conn, func(m rpcMessage) bool { return m.ID != nil && *m.ID == id }, 20*time.Second)
}

func goPosition(source, needle string, offset int) map[string]any {
	index := strings.Index(source, needle)
	if index < 0 {
		return map[string]any{"line": 0, "character": 0}
	}
	before := source[:index+offset]
	line := strings.Count(before, "\n")
	column := len([]rune(before[strings.LastIndex(before, "\n")+1:]))
	return map[string]any{"line": line, "character": column}
}

func tsPosition(source, needle string, offset int) map[string]any {
	return goPosition(source, needle, offset)
}

func findTool(t *testing.T, local, name string) string {
	t.Helper()
	if info, err := os.Stat(local); err == nil && !info.IsDir() {
		abs, _ := filepath.Abs(local)
		return abs
	}
	if path, err := exec.LookPath(name); err == nil {
		return path
	}
	t.Skipf("%s is not installed", name)
	return ""
}

func assertNoOrphan(t *testing.T, root string, timeout time.Duration) {
	t.Helper()
	target, _ := filepath.EvalSymlinks(root)
	deadline := time.Now().Add(timeout)
	for {
		found := []string{}
		entries, _ := os.ReadDir("/proc")
		for _, entry := range entries {
			if _, err := fmt.Sscan(entry.Name(), new(int)); err != nil {
				continue
			}
			cwd, err := os.Readlink(filepath.Join("/proc", entry.Name(), "cwd"))
			if err != nil || cwd != target {
				continue
			}
			comm, _ := os.ReadFile(filepath.Join("/proc", entry.Name(), "comm"))
			name := strings.TrimSpace(string(comm))
			if name == "gopls" || name == "typescript-language-server" || name == "node" || name == "tsserver" {
				if name == "node" {
					cmdline, _ := os.ReadFile(filepath.Join("/proc", entry.Name(), "cmdline"))
					if !strings.Contains(string(cmdline), "typescript-language-server") && !strings.Contains(string(cmdline), "tsserver") {
						continue
					}
				}
				found = append(found, entry.Name()+":"+name)
			}
		}
		if len(found) == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("orphan language processes: %v", found)
		}
		time.Sleep(250 * time.Millisecond)
	}
}
