package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"

	"goland/internal/plugins"
)

func TestPluginFileHooksTransformBlockAndAudit(t *testing.T) {
	f := newExtraFixture(t)
	installAndEnablePlugin(t, f)

	put := func(content string) *http.Response {
		return f.member.do(http.MethodPut, f.path("/file"), map[string]any{
			"path": "main.go", "content": content,
		}, true)
	}
	resp := put("package main\n// format-me\n")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("format save: %d %s", resp.StatusCode, readBody(resp))
	}
	var saved struct {
		Content     string   `json:"content"`
		PluginNotes []string `json:"pluginNotes"`
	}
	decode(t, resp, &saved)
	if saved.Content != "formatted" {
		t.Fatalf("save hook did not transform content: %q", saved.Content)
	}

	resp = f.member.do(http.MethodGet, f.path("/file?path=main.go"), nil, true)
	var read struct {
		Content     string   `json:"content"`
		PluginNotes []string `json:"pluginNotes"`
	}
	decode(t, resp, &read)
	if read.Content != "formatted" || len(read.PluginNotes) == 0 || read.PluginNotes[0] != "checked" {
		t.Fatalf("open hook response: %+v", read)
	}

	resp = put("// block-me\n")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("blocked save: %d %s", resp.StatusCode, readBody(resp))
	}
	var blocked struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	decode(t, resp, &blocked)
	if blocked.Error.Code != "plugin_blocked" || blocked.Error.Message == "" {
		t.Fatalf("unexpected block error: %+v", blocked)
	}
	onDisk, err := os.ReadFile(filepath.Join(f.wsDir, "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "formatted" {
		t.Fatalf("blocked save modified disk: %q", onDisk)
	}

	if err := os.WriteFile(filepath.Join(f.wsDir, "blocked.go"), []byte("package blocked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resp = f.member.do(http.MethodGet, f.path("/file?path=blocked.go"), nil, true)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("blocked open: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)

	count, err := f.st.Audit.CountDocuments(context.Background(), bson.M{"action": "plugin.hook"})
	if err != nil {
		t.Fatal(err)
	}
	if count < 3 {
		t.Fatalf("hooks were not audited: %d", count)
	}

	// Disabling the plugin stops invoking hooks.
	disable := map[string]any{"enabled": false, "config": map[string]any{"test.plugin.settings.name": "demo"}}
	if resp := f.member.do(http.MethodPut, f.path("/plugins/test.plugin"), disable, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("disable: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	resp = put("// block-me\n")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save after disable: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)
}

func TestPluginPreCommitHookBlocksAndAllows(t *testing.T) {
	f := newExtraFixture(t)
	installAndEnablePlugin(t, f)

	resp := f.member.do(http.MethodPost, f.path("/git/commit"), map[string]any{"message": "block-precommit"}, true)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("blocked commit: %d %s", resp.StatusCode, readBody(resp))
	}
	var blockErr struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decode(t, resp, &blockErr)
	if blockErr.Error.Code != "plugin_blocked" {
		t.Fatalf("unexpected code: %+v", blockErr)
	}

	// An allowing hook proceeds to the real git operation, which fails because
	// this fixture workspace is not a repository.
	resp = f.member.do(http.MethodPost, f.path("/git/commit"), map[string]any{"message": "allowed"}, true)
	if resp.StatusCode == http.StatusForbidden {
		t.Fatalf("allowed commit was blocked: %s", readBody(resp))
	}
	readBody(resp)
}

func gitRun(t *testing.T, dir string, args ...string) string {
	t.Helper()
	commandArgs := append([]string{"-c", "user.name=Test", "-c", "user.email=test@example.com"}, args...)
	cmd := exec.Command("git", commandArgs...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

func TestPluginPostPullHookRunsAfterFastForward(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	f := newExtraFixture(t)
	if err := os.WriteFile(filepath.Join(f.wsDir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	bare := filepath.Join(t.TempDir(), "remote.git")
	gitRun(t, t.TempDir(), "init", "--bare", "-q", bare)
	gitRun(t, f.wsDir, "init", "-q")
	gitRun(t, f.wsDir, "add", "-A")
	gitRun(t, f.wsDir, "commit", "-q", "-m", "initial")
	branch := strings.TrimSpace(gitRun(t, f.wsDir, "rev-parse", "--abbrev-ref", "HEAD"))
	gitRun(t, f.wsDir, "remote", "add", "origin", bare)
	gitRun(t, f.wsDir, "push", "-q", "-u", "origin", branch)

	clone := filepath.Join(t.TempDir(), "clone")
	gitRun(t, t.TempDir(), "clone", "-q", bare, clone)
	if err := os.WriteFile(filepath.Join(clone, "second.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, clone, "add", "-A")
	gitRun(t, clone, "commit", "-q", "-m", "second")
	gitRun(t, clone, "push", "-q")

	installAndEnablePlugin(t, f)
	resp := f.member.do(http.MethodPost, f.path("/git/pull"), nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pull: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)
	if _, err := os.Stat(filepath.Join(f.wsDir, "second.go")); err != nil {
		t.Fatalf("fast-forward did not apply: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		cursor, err := f.st.Audit.Find(context.Background(), bson.M{"action": "plugin.hook", "detail": bson.M{"$regex": "postPull"}})
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		for cursor.Next(context.Background()) {
			count++
		}
		_ = cursor.Close(context.Background())
		if count > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("postPull hook was not audited")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func writeFailingHookPlugin(t *testing.T, id, failure string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := plugins.Manifest{
		APIVersion: plugins.APIVersion, ID: id, Name: id, Version: "1.0.0", Executable: "bin/plugin",
		Contributes: plugins.Contributions{
			Commands: []plugins.Command{{ID: id + ".hook", Title: "Hook"}},
			Hooks:    plugins.Hooks{OnSave: &plugins.Hook{Command: id + ".hook", Failure: failure}},
		},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	script := `#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) echo '{"jsonrpc":"2.0","id":1,"result":{}}' ;;
    *'"method":"health"'*) echo '{"jsonrpc":"2.0","id":2,"result":{"status":"ok"}}' ;;
    *'"method":"hook/onSave"'*) exit 7 ;;
    *'"method":"shutdown"'*) exit 0 ;;
  esac
done
`
	if err := os.WriteFile(filepath.Join(dir, "bin", "plugin"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestPluginHookFailOpenAndFailClosed(t *testing.T) {
	for _, test := range []struct {
		failure string
		status  int
		code    string
	}{
		{"open", http.StatusOK, ""},
		{"closed", http.StatusForbidden, "plugin_blocked"},
	} {
		t.Run(test.failure, func(t *testing.T) {
			f := newExtraFixture(t)
			if resp := f.admin.do(http.MethodPost, "/api/admin/plugins", map[string]any{"path": writeFailingHookPlugin(t, "fail."+test.failure, test.failure)}, true); resp.StatusCode != http.StatusCreated {
				t.Fatalf("install: %d %s", resp.StatusCode, readBody(resp))
			}
			enable := map[string]any{"enabled": true, "config": map[string]any{}}
			if resp := f.member.do(http.MethodPut, f.path("/plugins/fail."+test.failure), enable, true); resp.StatusCode != http.StatusOK {
				t.Fatalf("enable: %d %s", resp.StatusCode, readBody(resp))
			} else {
				readBody(resp)
			}
			resp := f.member.do(http.MethodPut, f.path("/file"), map[string]any{"path": "a.go", "content": "x"}, true)
			if resp.StatusCode != test.status {
				t.Fatalf("save: %d %s", resp.StatusCode, readBody(resp))
			}
			if test.code != "" {
				var body struct {
					Error struct {
						Code string `json:"code"`
					} `json:"error"`
				}
				decode(t, resp, &body)
				if body.Error.Code != test.code {
					t.Fatalf("code = %q", body.Error.Code)
				}
			} else {
				readBody(resp)
			}
		})
	}
}
