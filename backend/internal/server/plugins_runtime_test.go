package server_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

func installAndEnablePlugin(t *testing.T, f *extraFixture) {
	t.Helper()
	if resp := f.admin.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": writePluginPackage(t)}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("install: %d %s", resp.StatusCode, readBody(resp))
	}
	enable := map[string]any{"enabled": true, "config": map[string]any{"test.plugin.settings.name": "demo"}}
	if resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), enable, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("enable: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
}

func TestPluginCommandExecutionEventsAndAudit(t *testing.T) {
	f := newExtraFixture(t)
	installAndEnablePlugin(t, f)

	// Subscribe to plugin UI events before executing the command.
	conn := f.dialWS(t, "/api/ws/workspaces/"+f.wsID+"/plugins")
	_ = conn.SetReadDeadline(time.Now().Add(20 * time.Second))
	var hello map[string]any
	if err := conn.ReadJSON(&hello); err != nil {
		t.Fatal(err)
	}
	if hello["type"] != "hello" {
		t.Fatalf("expected hello, got %+v", hello)
	}

	resp := f.member.do(http.MethodPost, f.path("/plugins/test.plugin/commands/test.plugin.hello"), map[string]any{
		"requestId": "req-1",
		"inputs":    map[string]any{"name": "demo"},
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("command: %d %s", resp.StatusCode, readBody(resp))
	}
	var result struct {
		RequestID string `json:"requestId"`
		CommandID string `json:"commandId"`
		Output    string `json:"output"`
	}
	decode(t, resp, &result)
	if result.RequestID != "req-1" || result.CommandID != "test.plugin.hello" {
		t.Fatalf("unexpected command result: %+v", result)
	}
	if !strings.Contains(result.Output, "stream:") || !strings.Contains(result.Output, "done:test.plugin.hello") {
		t.Fatalf("unexpected output: %q", result.Output)
	}

	// The same output is streamed over the plugin event websocket.
	seenOutput := false
	for i := 0; i < 10; i++ {
		var event map[string]any
		if err := conn.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event["type"] == "output" && event["pluginId"] == "test.plugin" && event["requestId"] == "req-1" {
			if event["chunk"] != "stream:" {
				t.Fatalf("unexpected chunk: %+v", event)
			}
			seenOutput = true
			break
		}
	}
	if !seenOutput {
		t.Fatal("did not receive output event")
	}

	count, err := f.st.Audit.CountDocuments(context.Background(), bson.M{"action": "plugin.command"})
	if err != nil {
		t.Fatal(err)
	}
	if count == 0 {
		t.Fatal("command was not audited")
	}

	if resp := f.member.do(http.MethodPost, f.path("/plugins/test.plugin/cancel"), map[string]any{"requestId": "req-1"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("cancel: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodPost, f.path("/plugins/test.plugin/cancel"), map[string]any{}, true); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("cancel without request id: %d", resp.StatusCode)
	}

	if resp := f.member.do(http.MethodPost, f.path("/plugins/test.plugin/commands/test.plugin.missing"), map[string]any{}, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown command: %d", resp.StatusCode)
	}
}

func TestPluginCommandRequiresEnabledAndOwnership(t *testing.T) {
	f := newExtraFixture(t)
	installAndEnablePlugin(t, f)
	disabled := map[string]any{"enabled": false, "config": map[string]any{"test.plugin.settings.name": "demo"}}
	if resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), disabled, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("disable: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodPost, f.path("/plugins/test.plugin/commands/test.plugin.hello"), map[string]any{}, true); resp.StatusCode != http.StatusConflict {
		t.Fatalf("disabled command: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}

	if resp := f.admin.do(http.MethodPost, "/api/admin/users", map[string]any{
		"email": "carol-plugin@test.local", "name": "Carol", "password": "member-password-1", "role": "member",
	}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create carol: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	carol := newClient(t, f.ts.URL)
	carol.login("carol-plugin@test.local", "member-password-1")
	if resp := carol.do(http.MethodPost, f.path("/plugins/test.plugin/commands/test.plugin.hello"), map[string]any{}, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-tenant command: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
}

func TestPluginHealthInWorkspaceList(t *testing.T) {
	f := newExtraFixture(t)
	installAndEnablePlugin(t, f)
	resp := f.member.do(http.MethodGet, f.path("/plugins"), nil, true)
	var list struct {
		Plugins []struct {
			ID     string `json:"id"`
			Health string `json:"health"`
		} `json:"plugins"`
	}
	decode(t, resp, &list)
	if len(list.Plugins) != 1 || list.Plugins[0].Health != "running" {
		t.Fatalf("unexpected health: %+v", list)
	}
	disable := map[string]any{"enabled": false, "config": map[string]any{"test.plugin.settings.name": "demo"}}
	if resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), disable, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("disable: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	resp = f.member.do(http.MethodGet, f.path("/plugins"), nil, true)
	list.Plugins = nil
	decode(t, resp, &list)
	if list.Plugins[0].Health != "stopped" {
		t.Fatalf("plugin still running: %+v", list)
	}
}
