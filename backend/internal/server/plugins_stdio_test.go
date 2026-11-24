package server_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"goland/internal/plugins"
)

func buildPluginWorker(t *testing.T) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "pluginworker")
	cmd := exec.Command("go", "build", "-o", out, "./testdata/pluginworker")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("build plugin worker: %v\n%s", err, output)
	}
	return out
}

func writeTransportPluginPackage(t *testing.T) string {
	t.Helper()
	worker := buildPluginWorker(t)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bin", "plugin"), []byte(fakePluginScript), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"lsp", "dap"} {
		if err := os.WriteFile(filepath.Join(dir, "bin", name), []byte(readFileForTest(t, worker)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	manifest := plugins.Manifest{
		APIVersion: plugins.APIVersion,
		ID:         "test.plugin",
		Name:       "Test Plugin",
		Version:    "1.0.0",
		Executable: "bin/plugin",
		Contributes: plugins.Contributions{
			Commands: []plugins.Command{{ID: "test.plugin.hello", Title: "Hello"}},
			Languages: []plugins.Language{{
				ID: "test.plugin.demo", Extensions: []string{".demo"}, LanguageID: "demo",
				Server: plugins.Server{Command: "bin/lsp", Args: []string{"-mode", "lsp"}},
			}},
			Debuggers: []plugins.Debugger{{
				Kind: "test.plugin.debug", Label: "Test debugger",
				Server: plugins.Server{Command: "bin/dap", Args: []string{"-mode", "dap"}},
			}},
		},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func readFileForTest(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func installTransportPlugin(t *testing.T, f *extraFixture) string {
	t.Helper()
	dir := writeTransportPluginPackage(t)
	if resp := f.admin.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": dir}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("install transport plugin: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), map[string]any{"enabled": true}, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("enable transport plugin: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
	return dir
}

func waitNoProcess(t *testing.T, binary string) {
	t.Helper()
	if _, err := exec.LookPath("pgrep"); err != nil {
		t.Log("pgrep unavailable; skipping process cleanup assertion")
		return
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		cmd := exec.Command("pgrep", "-f", binary)
		output, err := cmd.Output()
		if err != nil && len(output) == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("worker process still running for %s: %s", binary, output)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func dialWSAs(t *testing.T, f *extraFixture, client *testClient, path string) (*websocket.Conn, int, error) {
	t.Helper()
	u, err := url.Parse(f.ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	var cookies []string
	for _, cookie := range client.client.Jar.Cookies(u) {
		cookies = append(cookies, cookie.Name+"="+cookie.Value)
	}
	header := http.Header{}
	header.Set("Origin", f.ts.URL)
	header.Set("Cookie", strings.Join(cookies, "; "))
	wsURL := "ws" + strings.TrimPrefix(f.ts.URL, "http") + path
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	return conn, status, err
}

func readJSONMessage(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	var message map[string]any
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatal(err)
	}
	return message
}

func sendJSON(t *testing.T, conn *websocket.Conn, value any) {
	t.Helper()
	if err := conn.WriteJSON(value); err != nil {
		t.Fatal(err)
	}
}

func TestPluginLSPWebSocketRouting(t *testing.T) {
	f := newExtraFixture(t)
	dir := installTransportPlugin(t, f)
	conn := f.dialWS(t, "/api/ws/workspaces/"+f.wsID+"/plugins/test.plugin/lsp/test.plugin.demo")
	sendJSON(t, conn, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{}})
	response := readJSONMessage(t, conn)
	if response["id"] != float64(1) || response["result"] == nil {
		t.Fatalf("unexpected initialize response: %+v", response)
	}
	sendJSON(t, conn, map[string]any{
		"jsonrpc": "2.0", "method": "textDocument/didOpen",
		"params": map[string]any{"textDocument": map[string]any{"uri": "file:///workspace/main.demo", "languageId": "demo", "version": 1, "text": "x"}},
	})
	notification := readJSONMessage(t, conn)
	if notification["method"] != "textDocument/publishDiagnostics" {
		t.Fatalf("unexpected notification: %+v", notification)
	}
	_ = conn.Close()
	waitNoProcess(t, filepath.Join(dir, "bin", "lsp"))

	// Another tenant cannot open the same plugin worker.
	if resp := f.admin.do(http.MethodPost, "/api/admin/users", map[string]any{
		"email": "dave-plugin@test.local", "name": "Dave", "password": "member-password-1", "role": "member",
	}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create dave: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	dave := newClient(t, f.ts.URL)
	dave.login("dave-plugin@test.local", "member-password-1")
	if conn, status, err := dialWSAs(t, f, dave, "/api/ws/workspaces/"+f.wsID+"/plugins/test.plugin/lsp/test.plugin.demo"); err == nil || status != http.StatusNotFound {
		if conn != nil {
			_ = conn.Close()
		}
		t.Fatalf("cross-tenant websocket: status=%d err=%v", status, err)
	}
}

func TestPluginDAPWebSocketRouting(t *testing.T) {
	f := newExtraFixture(t)
	dir := installTransportPlugin(t, f)
	conn := f.dialWS(t, "/api/ws/workspaces/"+f.wsID+"/plugins/test.plugin/debug/test.plugin.debug")
	sendJSON(t, conn, map[string]any{"seq": 1, "type": "request", "command": "initialize", "arguments": map[string]any{}})
	initialize := readJSONMessage(t, conn)
	if initialize["command"] != "initialize" || initialize["success"] != true {
		t.Fatalf("unexpected initialize: %+v", initialize)
	}
	sendJSON(t, conn, map[string]any{
		"seq": 2, "type": "request", "command": "setBreakpoints",
		"arguments": map[string]any{"source": map[string]any{"path": "main.go"}, "breakpoints": []map[string]any{{"line": 6}}},
	})
	breakpoints := readJSONMessage(t, conn)
	if breakpoints["command"] != "setBreakpoints" || breakpoints["success"] != true {
		t.Fatalf("unexpected breakpoints: %+v", breakpoints)
	}
	sendJSON(t, conn, map[string]any{"seq": 3, "type": "request", "command": "launch", "arguments": map[string]any{"program": "."}})
	events := map[string]bool{}
	for i := 0; i < 3; i++ {
		message := readJSONMessage(t, conn)
		if event, ok := message["event"].(string); ok {
			events[event] = true
		}
	}
	if !events["stopped"] {
		t.Fatalf("missing stopped event: %+v", events)
	}
	sendJSON(t, conn, map[string]any{"seq": 4, "type": "request", "command": "stackTrace", "arguments": map[string]any{"threadId": 1}})
	stack := readJSONMessage(t, conn)
	body, _ := stack["body"].(map[string]any)
	frames, _ := body["stackFrames"].([]any)
	if len(frames) == 0 {
		t.Fatalf("missing stack frames: %+v", stack)
	}
	frame, _ := frames[0].(map[string]any)
	if frame["name"] != "main.add" {
		t.Fatalf("unexpected frame: %+v", frame)
	}
	sendJSON(t, conn, map[string]any{"seq": 5, "type": "request", "command": "scopes", "arguments": map[string]any{"frameId": 7}})
	scopes := readJSONMessage(t, conn)
	scopeBody, _ := scopes["body"].(map[string]any)
	scopesList, _ := scopeBody["scopes"].([]any)
	if len(scopesList) == 0 {
		t.Fatalf("missing scopes: %+v", scopes)
	}
	sendJSON(t, conn, map[string]any{"seq": 6, "type": "request", "command": "variables", "arguments": map[string]any{"variablesReference": 42}})
	variables := readJSONMessage(t, conn)
	variableBody, _ := variables["body"].(map[string]any)
	variableList, _ := variableBody["variables"].([]any)
	if len(variableList) == 0 {
		t.Fatalf("missing variables: %+v", variables)
	}
	firstVariable, _ := variableList[0].(map[string]any)
	if firstVariable["name"] != "a" || firstVariable["value"] != "2" {
		t.Fatalf("unexpected variable: %+v", firstVariable)
	}
	sendJSON(t, conn, map[string]any{"seq": 7, "type": "request", "command": "continue", "arguments": map[string]any{"threadId": 1}})
	_ = conn.Close()
	waitNoProcess(t, filepath.Join(dir, "bin", "dap"))
}

func TestPluginDisableCleansUpWorker(t *testing.T) {
	f := newExtraFixture(t)
	dir := installTransportPlugin(t, f)
	conn := f.dialWS(t, "/api/ws/workspaces/"+f.wsID+"/plugins/test.plugin/lsp/test.plugin.demo")
	sendJSON(t, conn, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{}})
	_ = readJSONMessage(t, conn)
	if resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), map[string]any{"enabled": false}, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("disable: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
	waitNoProcess(t, filepath.Join(dir, "bin", "lsp"))
	_ = conn.Close()
}

func TestPluginLSPRequiresEnabledPlugin(t *testing.T) {
	f := newExtraFixture(t)
	_ = installTransportPlugin(t, f)
	disable := map[string]any{"enabled": false}
	if resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), disable, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("disable: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if conn, status, err := dialWSAs(t, f, f.member, "/api/ws/workspaces/"+f.wsID+"/plugins/test.plugin/lsp/test.plugin.demo"); err == nil || status != http.StatusConflict {
		if conn != nil {
			_ = conn.Close()
		}
		t.Fatalf("disabled plugin websocket: status=%d err=%v", status, err)
	}
}
