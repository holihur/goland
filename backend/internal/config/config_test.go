package config

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func baseEnv(t *testing.T) (string, string) {
	t.Helper()
	data := t.TempDir()
	root := filepath.Join(t.TempDir(), "workspaces")
	keys := []string{
		"GOLAND_ADDR", "GOLAND_MONGO_URI", "GOLAND_MONGO_DB", "GOLAND_SESSION_TTL",
		"GOLAND_ADMIN_EMAIL", "GOLAND_ADMIN_PASSWORD", "GOLAND_ADMIN_NAME",
		"GOLAND_SECURE_COOKIES", "GOLAND_WEB_DIST", "GOLAND_ALLOWED_ORIGINS",
		"GOLAND_DEV_PERMISSIONS", "GOLAND_GOPLS", "GOLAND_TSSERVER", "GOLAND_DLV",
		"GOLAND_NODE", "GOLAND_JS_DEBUG", "GOLAND_CHROME", "GOLAND_MASTER_KEY",
	}
	for _, key := range keys {
		t.Setenv(key, "x")
		if err := os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("GOLAND_DATA_DIR", data)
	t.Setenv("GOLAND_WORKSPACE_ROOTS", root)
	t.Setenv("GOLAND_MASTER_KEY_FILE", filepath.Join(data, "master.key"))
	t.Setenv("GOLAND_ISOLATION", "none")
	return data, root
}

func TestLoadDefaults(t *testing.T) {
	data, root := baseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:8788" || cfg.Isolation != "none" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
	if len(cfg.WorkspaceRoots) != 1 || cfg.WorkspaceRoots[0] != root {
		t.Fatalf("workspace roots: %#v", cfg.WorkspaceRoots)
	}
	if cfg.SessionTTL != 168*time.Hour {
		t.Fatalf("session ttl: %v", cfg.SessionTTL)
	}
	if len(cfg.MasterKey) != 32 {
		t.Fatalf("master key length: %d", len(cfg.MasterKey))
	}
	if _, err := os.Stat(filepath.Join(data, "master.key")); err != nil {
		t.Fatalf("master key file: %v", err)
	}
	if cfg.WebDist != "" {
		t.Fatalf("web dist should be empty: %q", cfg.WebDist)
	}
}

func TestLoadOverridesAndPaths(t *testing.T) {
	_, root := baseEnv(t)
	web := filepath.Join(t.TempDir(), "dist")
	if err := os.MkdirAll(web, 0o755); err != nil {
		t.Fatal(err)
	}
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))
	t.Setenv("GOLAND_ADDR", "0.0.0.0:9999")
	t.Setenv("GOLAND_MONGO_URI", "mongodb://example:27017")
	t.Setenv("GOLAND_MONGO_DB", "custom")
	t.Setenv("GOLAND_SESSION_TTL", "2h")
	t.Setenv("GOLAND_ADMIN_EMAIL", "Admin@Example.COM")
	t.Setenv("GOLAND_ADMIN_PASSWORD", "long-password")
	t.Setenv("GOLAND_ADMIN_NAME", "Admin")
	t.Setenv("GOLAND_SECURE_COOKIES", "true")
	t.Setenv("GOLAND_WEB_DIST", web)
	t.Setenv("GOLAND_ALLOWED_ORIGINS", "http://a/, http://b ,")
	t.Setenv("GOLAND_GOPLS", "/opt/gopls")
	t.Setenv("GOLAND_TSSERVER", "/opt/tsserver")
	t.Setenv("GOLAND_DLV", "/opt/dlv")
	t.Setenv("GOLAND_NODE", "/opt/node")
	t.Setenv("GOLAND_JS_DEBUG", "/opt/dap.js")
	t.Setenv("GOLAND_CHROME", "/opt/chrome")
	t.Setenv("GOLAND_MASTER_KEY", key)
	t.Setenv("GOLAND_WORKSPACE_ROOTS", root+string(os.PathListSeparator)+filepath.Join(root, "second"))

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "0.0.0.0:9999" || cfg.MongoDB != "custom" || cfg.SessionTTL != 2*time.Hour {
		t.Fatalf("unexpected config: %#v", cfg)
	}
	if cfg.AdminEmail != "admin@example.com" || !cfg.SecureCookies {
		t.Fatalf("admin/security: %#v", cfg)
	}
	if cfg.WebDist != web {
		t.Fatalf("web dist: %q want %q", cfg.WebDist, web)
	}
	if len(cfg.WorkspaceRoots) != 2 {
		t.Fatalf("roots: %#v", cfg.WorkspaceRoots)
	}
	if got := cfg.PrimaryWorkspaceRoot(); got != root {
		t.Fatalf("primary root: %q", got)
	}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "http://a" || cfg.AllowedOrigins[1] != "http://b" {
		t.Fatalf("origins: %#v", cfg.AllowedOrigins)
	}
	for _, path := range []string{cfg.GoPLS, cfg.TSServer, cfg.DLV, cfg.Node, cfg.JsDebug, cfg.Chrome} {
		if path == "" {
			t.Fatal("expected configured tool path")
		}
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	baseEnv(t)
	for _, tc := range []struct {
		name, key, value string
	}{
		{"bad ttl", "GOLAND_SESSION_TTL", "nope"},
		{"zero ttl", "GOLAND_SESSION_TTL", "0s"},
		{"bad isolation", "GOLAND_ISOLATION", "container"},
		{"bad master key", "GOLAND_MASTER_KEY", "dGlueQ=="},
		{"empty roots", "GOLAND_WORKSPACE_ROOTS", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatalf("Load should fail for %s=%q", tc.key, tc.value)
			}
			if tc.key != "GOLAND_ISOLATION" {
				t.Setenv(tc.key, "")
			} else {
				t.Setenv("GOLAND_ISOLATION", "none")
			}
		})
	}
}

func TestLoadMasterKeyFileAndInvalidFile(t *testing.T) {
	data, _ := baseEnv(t)
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("z", 32)))
	path := filepath.Join(data, "custom.key")
	if err := os.WriteFile(path, []byte(key+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOLAND_MASTER_KEY_FILE", path)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if string(cfg.MasterKey) != strings.Repeat("z", 32) {
		t.Fatal("key file was not loaded")
	}
	if err := os.WriteFile(path, []byte("bad"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(); err == nil {
		t.Fatal("invalid key file should fail")
	}
}

func TestHelpers(t *testing.T) {
	cases := map[string]bool{"1": true, "true": true, "TRUE": true, "0": false, "false": false, "junk": true}
	for value, want := range cases {
		t.Setenv("TEST_BOOL", value)
		if got := envBool("TEST_BOOL", true); got != want {
			t.Errorf("envBool(%q) = %v want %v", value, got, want)
		}
	}
	t.Setenv("TEST_BOOL", "")
	os.Unsetenv("TEST_BOOL")
	if !envBool("TEST_BOOL", true) || envBool("TEST_BOOL", false) {
		t.Fatal("missing env should return fallback")
	}
	got := splitCSV(" a , b/ ,, c ")
	if len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("splitCSV: %#v", got)
	}
}
