package server_test

import (
	"context"
	"net/http"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type workspacePluginList struct {
	Plugins []struct {
		ID       string         `json:"id"`
		Enabled  bool           `json:"enabled"`
		Config   map[string]any `json:"config"`
		Defaults map[string]any `json:"defaults"`
		Manifest struct {
			ID string `json:"id"`
		} `json:"manifest"`
	} `json:"plugins"`
}

func TestWorkspacePluginEnableConfigAndIsolation(t *testing.T) {
	f := newExtraFixture(t)
	src := writePluginPackage(t)
	if resp := f.admin.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": src}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("install: %d %s", resp.StatusCode, readBody(resp))
	}

	listPath := f.path("/plugins")
	resp := f.member.do(http.MethodGet, listPath, nil, true)
	var list workspacePluginList
	decode(t, resp, &list)
	if len(list.Plugins) != 1 || list.Plugins[0].Enabled {
		t.Fatalf("unexpected initial list: %+v", list)
	}
	if list.Plugins[0].Defaults["test.plugin.settings.mode"] != "fast" {
		t.Fatalf("defaults missing: %+v", list.Plugins[0].Defaults)
	}

	enable := map[string]any{
		"enabled": true,
		"config":  map[string]any{"test.plugin.settings.name": "demo"},
	}
	resp = f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), enable, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("enable: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)

	// The state is stored in Mongo, so it survives a server restart.
	workspaceID, _ := primitive.ObjectIDFromHex(f.wsID)
	ownerID, _ := primitive.ObjectIDFromHex(f.member.userID)
	state, err := f.st.FindWorkspacePlugin(context.Background(), ownerID, workspaceID, "test.plugin")
	if err != nil {
		t.Fatalf("stored state: %v", err)
	}
	if !state.Enabled || state.Config["test.plugin.settings.name"] != "demo" {
		t.Fatalf("unexpected stored state: %+v", state)
	}

	resp = f.member.do(http.MethodGet, listPath, nil, true)
	list = workspacePluginList{}
	decode(t, resp, &list)
	if !list.Plugins[0].Enabled || list.Plugins[0].Config["test.plugin.settings.name"] != "demo" {
		t.Fatalf("unexpected enabled list: %+v", list)
	}

	for name, body := range map[string]map[string]any{
		"unknown key":      {"enabled": true, "config": map[string]any{"test.plugin.settings.unknown": true}},
		"wrong type":       {"enabled": true, "config": map[string]any{"test.plugin.settings.mode": 3}},
		"bad option":       {"enabled": true, "config": map[string]any{"test.plugin.settings.mode": "slowish"}},
		"missing required": {"enabled": true, "config": map[string]any{"test.plugin.settings.mode": "fast"}},
	} {
		resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), body, true)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", name, resp.StatusCode, readBody(resp))
		}
		readBody(resp)
	}

	// Disabling keeps configuration but stops exposing the plugin as enabled.
	disable := map[string]any{"enabled": false, "config": map[string]any{"test.plugin.settings.name": "demo"}}
	resp = f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), disable, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("disable: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)
	resp = f.member.do(http.MethodGet, listPath, nil, true)
	list = workspacePluginList{}
	decode(t, resp, &list)
	if list.Plugins[0].Enabled {
		t.Fatal("plugin still enabled")
	}

	// Cross-tenant workspace access is indistinguishable from a missing one.
	resp = f.admin.do(http.MethodPost, "/api/admin/users", map[string]any{
		"email": "bob-plugin@test.local", "name": "Bob", "password": "member-password-1", "role": "member",
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create bob: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)
	bob := newClient(t, f.ts.URL)
	bob.login("bob-plugin@test.local", "member-password-1")
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		var body any
		path := f.path("/plugins/test.plugin")
		if method == http.MethodGet {
			path = listPath
		}
		if method == http.MethodPut {
			body = enable
		}
		resp := bob.do(method, path, body, true)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("bob %s: %d", method, resp.StatusCode)
		}
		readBody(resp)
	}

	if resp := f.member.do(http.MethodDelete, f.path("/plugins/test.plugin"), nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("remove state: %d %s", resp.StatusCode, readBody(resp))
	}
	resp = f.member.do(http.MethodGet, listPath, nil, true)
	list = workspacePluginList{}
	decode(t, resp, &list)
	if list.Plugins[0].Enabled {
		t.Fatal("state survived deletion")
	}
}

func TestWorkspacePluginUnknownAndAdminOnlyInstall(t *testing.T) {
	f := newExtraFixture(t)
	if resp := f.member.do(http.MethodPut, f.path("/plugins/missing.plugin"), map[string]any{"enabled": true}, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown plugin enable: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodDelete, f.path("/plugins/missing.plugin"), nil, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown plugin remove: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
}
