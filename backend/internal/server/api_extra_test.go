package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
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

type extraFixture struct {
	t      *testing.T
	ts     *httptest.Server
	st     *store.Store
	cfg    *config.Config
	root   string
	admin  *testClient
	member *testClient
	wsID   string
	wsDir  string
}

func newExtraFixture(t *testing.T) *extraFixture {
	t.Helper()
	uri := os.Getenv("GOLAND_TEST_MONGO_URI")
	if uri == "" {
		uri = "mongodb://127.0.0.1:27019"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	dbName := "goland_api_test_" + time.Now().Format("150405000000000")
	st, err := store.Connect(ctx, uri, dbName)
	if err != nil {
		t.Skipf("MongoDB unavailable: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DropDatabase(context.Background())
		_ = st.Disconnect(context.Background())
	})

	root := t.TempDir()
	cfg := &config.Config{
		DataDir: t.TempDir(), WorkspaceRoots: []string{root}, MongoDB: dbName,
		SessionTTL: time.Hour, AdminEmail: "admin@test.local", AdminPassword: "admin-password-1",
		AdminName: "Admin", MasterKey: bytes.Repeat([]byte{2}, 32), Isolation: "none",
		GoPLS: "gopls", TSServer: "typescript-language-server", DLV: "dlv", Node: "node",
		Chrome: "",
	}
	if err := server.BootstrapAdmin(context.Background(), st, cfg); err != nil {
		t.Fatal(err)
	}
	wm, err := workspace.New(cfg, st)
	if err != nil {
		t.Fatal(err)
	}
	handler := server.New(cfg, st, auth.NewManager(st, cfg.SessionTTL, false), wm, files.New(wm), git.New(wm), slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	f := &extraFixture{t: t, ts: ts, st: st, cfg: cfg, root: root}
	f.admin = newClient(t, ts.URL)
	f.admin.login("admin@test.local", "admin-password-1")
	resp := f.admin.do(http.MethodPost, "/api/admin/users", map[string]any{
		"email": "member@test.local", "name": "Member", "password": "member-password-1", "role": "member",
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create member: %d %s", resp.StatusCode, readBody(resp))
	}
	f.member = newClient(t, ts.URL)
	f.member.login("member@test.local", "member-password-1")

	f.wsDir = filepath.Join(root, "project")
	if err := os.MkdirAll(f.wsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.wsDir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resp = f.member.do(http.MethodPost, "/api/workspaces", map[string]any{"name": "project", "source": "local", "path": f.wsDir}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", resp.StatusCode, readBody(resp))
	}
	var created struct {
		Workspace struct {
			ID string `json:"id"`
		} `json:"workspace"`
	}
	decode(t, resp, &created)
	f.wsID = created.Workspace.ID
	return f
}

func (f *extraFixture) path(suffix string) string { return "/api/workspaces/" + f.wsID + suffix }

func TestAPIHealthAuthAndValidation(t *testing.T) {
	f := newExtraFixture(t)
	resp := f.member.do(http.MethodGet, "/api/health", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health: %d", resp.StatusCode)
	}
	if resp.Header.Get("X-Frame-Options") != "DENY" || resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing security headers")
	}
	readBody(resp)

	if resp := f.member.do(http.MethodGet, "/api/nope", nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("api 404: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodGet, "/", nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("spa without dist: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}

	anon := newClient(t, f.ts.URL)
	if resp := anon.do(http.MethodGet, "/api/auth/me", nil, false); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous me: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := anon.do(http.MethodPost, "/api/auth/login", nil, false); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty login: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	badJSON := anon.do(http.MethodPost, "/api/auth/login", nil, false)
	_ = badJSON
	req, _ := http.NewRequest(http.MethodPost, f.ts.URL+"/api/auth/login", strings.NewReader("{"))
	req.Header.Set("Content-Type", "application/json")
	raw, _ := http.DefaultClient.Do(req)
	if raw.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad json: %d", raw.StatusCode)
	}
	readBody(raw)

	if resp := anon.do(http.MethodPost, "/api/auth/login", map[string]any{"email": "missing@test.local", "password": "wrong"}, false); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong login: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}

	// CSRF is required for state-changing requests.
	if resp := f.member.do(http.MethodPost, "/api/auth/logout", nil, false); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("csrf: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodGet, "/api/auth/me", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("me: %d", resp.StatusCode)
	} else {
		var body struct {
			User struct {
				Email string `json:"email"`
			} `json:"user"`
		}
		decode(t, resp, &body)
		if body.User.Email != "member@test.local" {
			t.Fatalf("me user: %#v", body)
		}
	}

	// Login rate limiting keys on IP and normalized email.
	limited := "locked@test.local"
	for i := 0; i < 5; i++ {
		if resp := anon.do(http.MethodPost, "/api/auth/login", map[string]any{"email": " LOCKED@test.local ", "password": "wrong"}, false); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, resp.StatusCode)
		} else {
			readBody(resp)
		}
	}
	if resp := anon.do(http.MethodPost, "/api/auth/login", map[string]any{"email": limited, "password": "wrong"}, false); resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("rate limit: %d %q", resp.StatusCode, resp.Header.Get("Retry-After"))
	} else {
		readBody(resp)
	}
}

func TestAPIAdminAndWorkspaceErrors(t *testing.T) {
	f := newExtraFixture(t)
	if resp := f.member.do(http.MethodGet, "/api/admin/users", nil, false); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member admin: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.admin.do(http.MethodGet, "/api/admin/users", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("list users: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}

	for _, tc := range []struct {
		name string
		body map[string]any
		want int
	}{
		{"invalid email", map[string]any{"email": "bad"}, http.StatusBadRequest},
		{"long name", map[string]any{"email": "x@test.local", "name": strings.Repeat("x", 101), "password": "long-password"}, http.StatusBadRequest},
		{"weak", map[string]any{"email": "x@test.local", "password": "short"}, http.StatusBadRequest},
		{"bad role", map[string]any{"email": "x@test.local", "password": "long-password", "role": "owner"}, http.StatusBadRequest},
		{"duplicate", map[string]any{"email": "member@test.local", "password": "long-password"}, http.StatusConflict},
	} {
		if resp := f.admin.do(http.MethodPost, "/api/admin/users", tc.body, true); resp.StatusCode != tc.want {
			t.Errorf("%s: %d %s", tc.name, resp.StatusCode, readBody(resp))
		} else {
			readBody(resp)
		}
	}
	if resp := f.admin.do(http.MethodPost, "/api/admin/users", map[string]any{"email": "second@test.local", "password": "second-password"}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create second: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}

	if resp := f.member.do(http.MethodGet, "/api/workspaces", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("list workspaces: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodGet, "/api/workspaces/not-an-id", nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("bad id: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodGet, "/api/workspaces/000000000000000000000000", nil, false); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing workspace: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	for _, tc := range []struct {
		name string
		body map[string]any
		want int
	}{
		{"long name", map[string]any{"name": strings.Repeat("x", 101), "source": "local", "path": f.wsDir}, http.StatusBadRequest},
		{"bad source", map[string]any{"name": "x", "source": "svn"}, http.StatusBadRequest},
		{"empty path", map[string]any{"name": "x", "source": "local", "path": " "}, http.StatusBadRequest},
		{"outside", map[string]any{"name": "x", "source": "local", "path": t.TempDir()}, http.StatusForbidden},
		{"bad git", map[string]any{"name": "x", "source": "git", "repoUrl": "ftp://example.com/x"}, http.StatusBadRequest},
	} {
		if resp := f.member.do(http.MethodPost, "/api/workspaces", tc.body, true); resp.StatusCode != tc.want {
			t.Errorf("%s: %d %s", tc.name, resp.StatusCode, readBody(resp))
		} else {
			readBody(resp)
		}
	}
	// Deleting a workspace twice exposes the missing-resource path.
	if resp := f.member.do(http.MethodDelete, f.path(""), nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete workspace: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodDelete, f.path(""), nil, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("delete twice: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
}

func TestAPIFilesTasksAndGitErrors(t *testing.T) {
	f := newExtraFixture(t)
	read := func(suffix string) *http.Response { return f.member.do(http.MethodGet, f.path(suffix), nil, false) }
	write := func(method, suffix string, body any) *http.Response {
		return f.member.do(method, f.path(suffix), body, true)
	}

	if resp := read("/tree"); resp.StatusCode != http.StatusOK {
		t.Fatalf("tree: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/file"); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("read no path: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/file?path=missing.go"); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("read missing: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/file?path=../secret"); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("read escape: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/file?path=.git/config"); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("read protected: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPut, "/file", map[string]any{"content": "x"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("write no path: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	first := write(http.MethodPut, "/file", map[string]any{"path": "main.go", "content": "package main\n\n// one\n"})
	if first.StatusCode != http.StatusOK {
		t.Fatalf("write: %d %s", first.StatusCode, readBody(first))
	}
	var saved struct {
		ETag string `json:"etag"`
	}
	decode(t, first, &saved)
	if resp := write(http.MethodPut, "/file", map[string]any{"path": "main.go", "content": "changed", "etag": "stale"}); resp.StatusCode != http.StatusConflict {
		t.Fatalf("conflict: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPut, "/file", map[string]any{"path": "main.go", "content": "changed", "etag": saved.ETag}); resp.StatusCode != http.StatusOK {
		t.Fatalf("conditional write: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/entry", map[string]any{"path": "x", "kind": "link"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad kind: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/entry", map[string]any{"kind": "file"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("entry no path: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/entry", map[string]any{"path": "new.txt", "kind": "file"}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create entry: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/entry", map[string]any{"path": "new.txt", "kind": "file"}); resp.StatusCode != http.StatusConflict {
		t.Fatalf("create duplicate: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/rename", map[string]any{"from": "new.txt"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("rename missing target: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/rename", map[string]any{"from": "new.txt", "to": "renamed.txt"}); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("rename: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := write(http.MethodDelete, "/entry", nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("delete no path: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodDelete, "/entry?path=renamed.txt", nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := read("/search?q=main&limit=1"); resp.StatusCode != http.StatusOK {
		t.Fatalf("search: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/tasks"); resp.StatusCode != http.StatusOK {
		t.Fatalf("tasks: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/tasks/runs"); resp.StatusCode != http.StatusOK {
		t.Fatalf("task runs: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/debug/config"); resp.StatusCode != http.StatusOK {
		t.Fatalf("debug config: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := read("/terminal"); resp.StatusCode != http.StatusOK {
		t.Fatalf("terminal info: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}

	// Local workspace is not a git repository.
	for _, suffix := range []string{"/git/status", "/git/diff", "/git/log", "/git/branches"} {
		if resp := read(suffix); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d %s", suffix, resp.StatusCode, readBody(resp))
		} else {
			readBody(resp)
		}
	}
	if resp := write(http.MethodPost, "/git/stage", map[string]any{"path": "main.go"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("stage non-repo: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/git/unstage", map[string]any{"path": "main.go"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unstage non-repo: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/git/commit", map[string]any{"message": "x"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("commit non-repo: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}

	// Browser session validation and missing-session cleanup.
	if resp := write(http.MethodPost, "/browser/session", map[string]any{"url": "file:///etc/passwd"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad browser url: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/browser/session", map[string]any{"url": "https://example.com"}); resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("missing chrome: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodDelete, "/browser/session/missing", nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("stop missing browser: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := write(http.MethodPost, "/browser/session/missing/reload", nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("reload missing browser: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
}

func TestAPIGitWorkspace(t *testing.T) {
	if _, err := os.Stat("/usr/bin/git"); err != nil {
		t.Skip("git unavailable")
	}
	f := newExtraFixture(t)
	dir := filepath.Join(f.root, "repo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@example.com")
	runGit(t, dir, "config", "user.name", "Test")
	runGit(t, dir, "checkout", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "init")
	resp := f.member.do(http.MethodPost, "/api/workspaces", map[string]any{"name": "repo", "source": "local", "path": dir}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create repo workspace: %d %s", resp.StatusCode, readBody(resp))
	}
	var created struct {
		Workspace struct {
			ID string `json:"id"`
		} `json:"workspace"`
	}
	decode(t, resp, &created)
	base := "/api/workspaces/" + created.Workspace.ID

	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"/git/status", "/git/branches", "/git/log"} {
		if resp := f.member.do(http.MethodGet, base+suffix, nil, false); resp.StatusCode != http.StatusOK {
			t.Errorf("%s: %d %s", suffix, resp.StatusCode, readBody(resp))
		} else {
			readBody(resp)
		}
	}
	if resp := f.member.do(http.MethodGet, base+"/git/diff?path=b.txt&cached=true", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("diff: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodPost, base+"/git/stage", map[string]any{"path": "b.txt"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("stage: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodPost, base+"/git/unstage", map[string]any{"path": "b.txt"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("unstage: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodPost, base+"/git/stage", map[string]any{"path": "b.txt"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("restage: %d", resp.StatusCode)
	}
	if resp := f.member.do(http.MethodPost, base+"/git/commit", map[string]any{"message": "add b"}, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("commit: %d %s", resp.StatusCode, readBody(resp))
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodPost, base+"/git/branch", map[string]any{"branch": "feature"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("branch: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodPost, base+"/git/checkout", map[string]any{"branch": "main"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("checkout: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodPost, base+"/git/branch", map[string]any{"branch": "bad branch"}, true); resp.StatusCode != http.StatusConflict {
		t.Fatalf("bad branch: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	// No remote configured: pull and push surface git errors.
	if resp := f.member.do(http.MethodPost, base+"/git/pull", nil, true); resp.StatusCode != http.StatusConflict {
		t.Fatalf("pull no remote: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
	if resp := f.member.do(http.MethodPost, base+"/git/push", nil, true); resp.StatusCode != http.StatusConflict {
		t.Fatalf("push no remote: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
}

func TestSPAServing(t *testing.T) {
	// Build a tiny dist and exercise SPA fallback, assets and traversal.
	f := newExtraFixture(t)
	dist := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dist, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><title>spa</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "assets", "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	f.cfg.WebDist = dist
	// Existing handler captured config by pointer, so update is visible.
	for _, path := range []string{"/", "/workspaces/1"} {
		resp, err := http.Get(f.ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "spa") {
			t.Fatalf("%s: %d %q", path, resp.StatusCode, body)
		}
	}
	resp, err := http.Get(f.ts.URL + "/assets/app.js")
	if err != nil {
		t.Fatal(err)
	}
	readBody(resp)
	if resp.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset cache: %q", resp.Header.Get("Cache-Control"))
	}
	resp, err = http.Get(f.ts.URL + "/assets/../../secret")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("traversal: %d", resp.StatusCode)
	}
	readBody(resp)
}

func TestDecodeJSONLimits(t *testing.T) {
	f := newExtraFixture(t)
	body := strings.NewReader(`{"email":"a@b.c","password":"` + strings.Repeat("x", 70<<10) + `"}`)
	req, _ := http.NewRequest(http.MethodPost, f.ts.URL+"/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("large body: %d", resp.StatusCode)
	}
	readBody(resp)

	req, _ = http.NewRequest(http.MethodPost, f.ts.URL+"/api/auth/login", strings.NewReader(`{"email":"a@b.c"} {}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("two objects: %d", resp.StatusCode)
	}
	readBody(resp)
}

func TestRequestIDAndJSONContentType(t *testing.T) {
	f := newExtraFixture(t)
	resp := f.member.do(http.MethodGet, "/api/health", nil, false)
	if resp.Header.Get("Content-Type") != "application/json; charset=utf-8" || resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("headers: %#v", resp.Header)
	}
	readBody(resp)
	var raw map[string]any
	resp = f.member.do(http.MethodGet, "/api/workspaces", nil, false)
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if raw["workspaces"] == nil {
		t.Fatalf("workspaces payload: %#v", raw)
	}
}

func (f *extraFixture) dialWS(t *testing.T, path string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(f.ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	var cookies []string
	for _, c := range f.member.client.Jar.Cookies(u) {
		cookies = append(cookies, c.Name+"="+c.Value)
	}
	header := http.Header{}
	header.Set("Origin", f.ts.URL)
	header.Set("Cookie", strings.Join(cookies, "; "))
	wsURL := "ws" + strings.TrimPrefix(f.ts.URL, "http") + path
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			t.Fatalf("dial websocket: %v (status %d)", err, resp.StatusCode)
		}
		t.Fatalf("dial websocket: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestWebSocketTaskAndTerminal(t *testing.T) {
	f := newExtraFixture(t)
	if err := os.WriteFile(filepath.Join(f.wsDir, "go.mod"), []byte("module example.com/ws\n\ngo 1.22\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.wsDir, "main_test.go"), []byte("package main\n\nimport \"testing\"\n\nfunc TestOK(t *testing.T) {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	conn := f.dialWS(t, "/api/ws/workspaces/"+f.wsID+"/run?task=go:test")
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	seenStart, seenExit := false, false
	for i := 0; i < 200; i++ {
		var msg map[string]any
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("read task message: %v", err)
		}
		switch msg["type"] {
		case "started":
			seenStart = true
		case "exit":
			seenExit = true
			if msg["status"] != "success" {
				t.Fatalf("task exit: %#v", msg)
			}
		}
		if seenExit {
			break
		}
	}
	if !seenStart || !seenExit {
		t.Fatalf("task messages start=%v exit=%v", seenStart, seenExit)
	}
	_ = conn.Close()

	// Unknown task and bad origin are rejected before upgrade.
	bad := f.dialWSRaw(t, "/api/ws/workspaces/"+f.wsID+"/run?task=missing", f.ts.URL)
	if bad != nil {
		t.Fatal("unknown task should not upgrade")
	}
	bad = f.dialWSRaw(t, "/api/ws/workspaces/"+f.wsID+"/run?task=go:test", "http://evil.example")
	if bad != nil {
		t.Fatal("bad origin should not upgrade")
	}

	// Cancel a long-running task.
	if err := os.WriteFile(filepath.Join(f.wsDir, "main_test.go"), []byte("package main\n\nimport (\n\t\"testing\"\n\t\"time\"\n)\n\nfunc TestSlow(t *testing.T) { time.Sleep(30 * time.Second) }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cancel := f.dialWS(t, "/api/ws/workspaces/"+f.wsID+"/run?task=go:test")
	_ = cancel.SetReadDeadline(time.Now().Add(90 * time.Second))
	for {
		var msg map[string]any
		if err := cancel.ReadJSON(&msg); err != nil {
			t.Fatalf("read cancel message: %v", err)
		}
		if msg["type"] == "started" {
			break
		}
	}
	if err := cancel.WriteJSON(map[string]string{"type": "cancel"}); err != nil {
		t.Fatal(err)
	}
	seenCancel := false
	for i := 0; i < 200; i++ {
		var msg map[string]any
		if err := cancel.ReadJSON(&msg); err != nil {
			break
		}
		if msg["type"] == "exit" {
			seenCancel = msg["status"] == "cancelled"
			break
		}
	}
	if !seenCancel {
		t.Fatal("task was not cancelled")
	}
	_ = cancel.Close()

	// Terminal echo and resize smoke test.
	term := f.dialWS(t, "/api/ws/workspaces/"+f.wsID+"/terminal")
	_ = term.SetReadDeadline(time.Now().Add(30 * time.Second))
	if err := term.WriteJSON(map[string]any{"type": "resize", "cols": 120, "rows": 40}); err != nil {
		t.Fatal(err)
	}
	if err := term.WriteMessage(websocket.TextMessage, []byte("not-json")); err != nil {
		t.Fatal(err)
	}
	if err := term.WriteJSON(map[string]any{"type": "input", "data": "exit\n"}); err != nil {
		t.Fatal(err)
	}
	gotExit := false
	for i := 0; i < 100; i++ {
		kind, data, err := term.ReadMessage()
		if err != nil {
			break
		}
		if kind == websocket.TextMessage {
			var msg map[string]any
			if json.Unmarshal(data, &msg) == nil && msg["type"] == "exit" {
				gotExit = true
				break
			}
		}
	}
	if !gotExit {
		t.Fatal("terminal did not exit")
	}
}

func (f *extraFixture) dialWSRaw(t *testing.T, path, origin string) *websocket.Conn {
	t.Helper()
	u, _ := url.Parse(f.ts.URL)
	var cookies []string
	for _, c := range f.member.client.Jar.Cookies(u) {
		cookies = append(cookies, c.Name+"="+c.Value)
	}
	header := http.Header{}
	header.Set("Origin", origin)
	header.Set("Cookie", strings.Join(cookies, "; "))
	wsURL := "ws" + strings.TrimPrefix(f.ts.URL, "http") + path
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		return nil
	}
	return conn
}
