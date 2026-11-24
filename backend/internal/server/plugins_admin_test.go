package server_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"goland/internal/auth"
	"goland/internal/plugins"
)

func pluginManifestJSON(t *testing.T) []byte {
	t.Helper()
	m := plugins.Manifest{
		APIVersion: plugins.APIVersion,
		ID:         "test.plugin",
		Name:       "Test Plugin",
		Version:    "1.0.0",
		Executable: "bin/plugin",
		Contributes: plugins.Contributions{
			Commands: []plugins.Command{{ID: "test.plugin.hello", Title: "Hello"}},
			Panels: []plugins.Panel{{
				ID: "test.plugin.panel", Title: "Test",
				Actions: []plugins.PanelAction{{ID: "run", Label: "Run", Command: "test.plugin.hello"}},
			}},
			Hooks: plugins.Hooks{
				OnOpen:    &plugins.Hook{Command: "test.plugin.hello"},
				OnSave:    &plugins.Hook{Command: "test.plugin.hello"},
				PreCommit: &plugins.Hook{Command: "test.plugin.hello"},
				PostPull:  &plugins.Hook{Command: "test.plugin.hello"},
			},
			Settings: []plugins.SettingsView{{
				ID: "test.plugin.settings", Title: "Test settings",
				Fields: []plugins.Field{
					{Key: "name", Type: "text", Label: "Name", Required: true},
					{Key: "mode", Type: "select", Label: "Mode", Default: "fast", Options: []plugins.Option{
						{Label: "Fast", Value: "fast"}, {Label: "Slow", Value: "slow"},
					}},
				},
			}},
		},
	}
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func writePluginPackage(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), pluginManifestJSON(t), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bin", "plugin"), []byte(fakePluginScript), 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

const fakePluginScript = `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) echo '{"jsonrpc":"2.0","id":1,"result":{"name":"test","version":"1.0.0"}}' ;;
    *'"method":"health"'*) echo '{"jsonrpc":"2.0","id":2,"result":{"status":"ok"}}' ;;
    *'"method":"shutdown"'*) exit 0 ;;
    *'"method":"command/execute"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
      rid=$(printf '%s' "$line" | sed -n 's/.*"requestId":"\([^"]*\)".*/\1/p')
      cid=$(printf '%s' "$line" | sed -n 's/.*"commandId":"\([^"]*\)".*/\1/p')
      printf '{"jsonrpc":"2.0","method":"command/output","params":{"requestId":"%s","chunk":"stream:"}}\n' "$rid"
      printf '{"jsonrpc":"2.0","id":%s,"result":{"output":"done:%s"}}\n' "$id" "$cid"
      ;;
    *'"method":"hook/onSave"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
      if printf '%s' "$line" | grep -q 'block-me'; then
        printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":false,"message":"save blocked by test plugin"}}\n' "$id"
      elif printf '%s' "$line" | grep -q 'format-me'; then
        printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":true,"content":"formatted"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":true}}\n' "$id"
      fi
      ;;
    *'"method":"hook/onOpen"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
      if printf '%s' "$line" | grep -q 'blocked.go'; then
        printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":false,"message":"open blocked by test plugin"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":true,"notes":["checked"]}}\n' "$id"
      fi
      ;;
    *'"method":"hook/preCommit"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
      if printf '%s' "$line" | grep -q 'block-precommit'; then
        printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":false,"message":"commit blocked by test plugin"}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":true}}\n' "$id"
      fi
      ;;
    *'"method":"hook/postPull"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
      printf '{"jsonrpc":"2.0","id":%s,"result":{"allow":true,"notes":["pulled"]}}\n' "$id"
      ;;
  esac
done
`

func pluginZip(t *testing.T) []byte {
	t.Helper()
	files := map[string]string{
		"manifest.json": string(pluginManifestJSON(t)),
		"bin/plugin":    fakePluginScript,
	}
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for name, body := range files {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0o644)
		if strings.HasPrefix(name, "bin/") {
			header.SetMode(0o755)
		}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (c *testClient) upload(path, field string, data []byte) *http.Response {
	c.t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile(field, "plugin.zip")
	if err != nil {
		c.t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		c.t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		c.t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, c.base+path, &body)
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Origin", c.base)
	req.Header.Set(auth.CSRFHeader, c.csrf)
	resp, err := c.client.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	return resp
}

type pluginListResponse struct {
	Plugins []struct {
		ID       string `json:"id"`
		Version  string `json:"version"`
		Manifest struct {
			ID string `json:"id"`
		} `json:"manifest"`
	} `json:"plugins"`
}

func TestPluginAdminInstallListAndUninstall(t *testing.T) {
	f := newExtraFixture(t)
	src := writePluginPackage(t)

	resp := f.admin.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": src}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("install: %d %s", resp.StatusCode, readBody(resp))
	}
	var installed struct {
		Plugin struct {
			ID      string `json:"id"`
			Version string `json:"version"`
		} `json:"plugin"`
	}
	decode(t, resp, &installed)
	if installed.Plugin.ID != "test.plugin" || installed.Plugin.Version != "1.0.0" {
		t.Fatalf("unexpected plugin: %+v", installed.Plugin)
	}

	resp = f.admin.do(http.MethodGet, "/api/admin/plugins", nil, true)
	var list pluginListResponse
	decode(t, resp, &list)
	if len(list.Plugins) != 1 || list.Plugins[0].ID != "test.plugin" || list.Plugins[0].Manifest.ID != "test.plugin" {
		t.Fatalf("unexpected list: %+v", list)
	}

	if resp := f.member.do(http.MethodGet, "/api/admin/plugins", nil, true); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member list: %d", resp.StatusCode)
	}
	if resp := f.member.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": src}, true); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member install: %d", resp.StatusCode)
	}
	if resp := f.member.do(http.MethodDelete, "/api/admin/plugins/test.plugin", nil, true); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member uninstall: %d", resp.StatusCode)
	}

	if resp := f.admin.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": filepath.Join(t.TempDir(), "missing")}, true); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid path install: %d", resp.StatusCode)
	}
	if resp := f.admin.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": ""}, true); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty path install: %d", resp.StatusCode)
	}

	resp = f.admin.upload("/api/admin/plugins/upload", "package", pluginZip(t))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)

	pluginDir := filepath.Join(f.cfg.DataDir, "plugins", "test.plugin", "1.0.0")
	if _, err := os.Stat(filepath.Join(pluginDir, "manifest.json")); err != nil {
		t.Fatalf("installed package missing: %v", err)
	}

	if resp := f.admin.do(http.MethodDelete, "/api/admin/plugins/test.plugin", nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("uninstall: %d %s", resp.StatusCode, readBody(resp))
	}
	if _, err := os.Stat(filepath.Join(f.cfg.DataDir, "plugins", "test.plugin")); !os.IsNotExist(err) {
		t.Fatalf("plugin directory still exists: %v", err)
	}
	if resp := f.admin.do(http.MethodDelete, "/api/admin/plugins/test.plugin", nil, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("second uninstall: %d", resp.StatusCode)
	}
	if resp := f.admin.do(http.MethodDelete, "/api/admin/plugins/unknown", nil, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown uninstall: %d", resp.StatusCode)
	}
}

func TestPluginAdminRejectsBadUploads(t *testing.T) {
	f := newExtraFixture(t)
	if resp := f.admin.upload("/api/admin/plugins/upload", "package", []byte("not a zip")); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid zip: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.admin.upload("/api/admin/plugins/upload", "missing", pluginZip(t)); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing field: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.admin.upload("/api/admin/plugins/upload", "package", []byte{}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty upload: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	// A zip without manifest is rejected and leaves no metadata behind.
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	entry, err := writer.Create("README.md")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.WriteString(entry, "x")
	_ = writer.Close()
	if resp := f.admin.upload("/api/admin/plugins/upload", "package", buf.Bytes()); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("zip without manifest: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	resp := f.admin.do(http.MethodGet, "/api/admin/plugins", nil, true)
	var list pluginListResponse
	decode(t, resp, &list)
	if len(list.Plugins) != 0 {
		t.Fatalf("bad uploads created metadata: %+v", list)
	}
}
