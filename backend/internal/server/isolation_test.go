package server_test

import (
	"bytes"
	"context"
	"encoding/json"
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

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"goland/internal/auth"

	"goland/internal/config"
	"goland/internal/files"
	"goland/internal/git"
	"goland/internal/server"
	"goland/internal/store"
	"goland/internal/workspace"
)

type testClient struct {
	t      *testing.T
	base   string
	client *http.Client
	csrf   string
	userID string
}

func TestTenantIsolation(t *testing.T) {
	uri := os.Getenv("GOLAND_TEST_MONGO_URI")
	if uri == "" {
		uri = "mongodb://127.0.0.1:27019"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	dbName := "goland_test_" + time.Now().Format("20060102150405")
	st, err := store.Connect(ctx, uri, dbName)
	if err != nil {
		t.Skipf("MongoDB unavailable: %v", err)
	}
	defer func() {
		_ = st.DropDatabase(context.Background())
		_ = st.Disconnect(context.Background())
	}()

	root := t.TempDir()
	cfg := &config.Config{
		DataDir: t.TempDir(), WorkspaceRoots: []string{root}, MongoDB: dbName,
		SessionTTL: time.Hour, AdminEmail: "admin@test.local", AdminPassword: "admin-password-1",
		AdminName: "Admin", MasterKey: bytes.Repeat([]byte{7}, 32), Isolation: "none",
		GoPLS: "gopls", TSServer: "typescript-language-server", DLV: "dlv", Node: "node",
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
	defer ts.Close()

	admin := newClient(t, ts.URL)
	admin.login("admin@test.local", "admin-password-1")
	for _, email := range []string{"alice@test.local", "bob@test.local"} {
		resp := admin.do(http.MethodPost, "/api/admin/users", map[string]any{
			"email": email, "name": strings.Split(email, "@")[0], "password": "member-password-1", "role": "member",
		}, true)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("create %s: %d %s", email, resp.StatusCode, readBody(resp))
		}
	}

	alice := newClient(t, ts.URL)
	alice.login("alice@test.local", "member-password-1")
	bob := newClient(t, ts.URL)
	bob.login("bob@test.local", "member-password-1")

	aliceDir := filepath.Join(root, "alice-workspace")
	if err := os.MkdirAll(aliceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(aliceDir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resp := alice.do(http.MethodPost, "/api/workspaces", map[string]any{"name": "alice", "source": "local", "path": aliceDir}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create workspace: %d %s", resp.StatusCode, readBody(resp))
	}
	var created struct {
		Workspace struct {
			ID string `json:"id"`
		} `json:"workspace"`
	}
	decode(t, resp, &created)
	if created.Workspace.ID == "" {
		t.Fatal("missing workspace id")
	}

	for _, path := range []string{
		"/api/workspaces/" + created.Workspace.ID,
		"/api/workspaces/" + created.Workspace.ID + "/tree",
		"/api/workspaces/" + created.Workspace.ID + "/file?path=main.go",
		"/api/workspaces/" + created.Workspace.ID + "/tasks",
		"/api/workspaces/" + created.Workspace.ID + "/debug/config",
		"/api/ws/workspaces/" + created.Workspace.ID + "/terminal",
		"/api/ws/workspaces/" + created.Workspace.ID + "/lsp?language=go",
		"/api/ws/workspaces/" + created.Workspace.ID + "/debug/go",
	} {
		resp := bob.do(http.MethodGet, path, nil, false)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("bob %s: got %d, want 404 (%s)", path, resp.StatusCode, readBody(resp))
		}
	}
	if resp := bob.do(http.MethodDelete, "/api/workspaces/"+created.Workspace.ID, nil, true); resp.StatusCode != http.StatusNotFound {
		t.Errorf("bob delete: got %d", resp.StatusCode)
	}
	if resp := bob.do(http.MethodGet, "/api/admin/users", nil, false); resp.StatusCode != http.StatusForbidden {
		t.Errorf("member admin access: got %d, want 403", resp.StatusCode)
	}
	if resp := alice.do(http.MethodGet, "/api/workspaces/"+created.Workspace.ID+"/file?path=../bob", nil, false); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("path escape: got %d, want 400", resp.StatusCode)
	}

	// Reject local imports outside the configured root and symlink escapes.
	outside := t.TempDir()
	if resp := alice.do(http.MethodPost, "/api/workspaces", map[string]any{"name": "outside", "source": "local", "path": outside}, true); resp.StatusCode != http.StatusForbidden {
		t.Errorf("outside root import: got %d, want 403", resp.StatusCode)
	}
	escape := filepath.Join(root, "escape-link")
	if err := os.Symlink(outside, escape); err != nil {
		t.Fatal(err)
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces", map[string]any{"name": "escape", "source": "local", "path": escape}, true); resp.StatusCode != http.StatusForbidden {
		t.Errorf("symlink escape import: got %d, want 403", resp.StatusCode)
	}

	// Clone through a loopback dumb-HTTP Git server and verify token sealing.
	t.Setenv("GIT_SSL_NO_VERIFY", "true")
	gitURL, bareRepo := makeBareRepo(t)
	const token = "super-secret-git-token"
	resp = alice.do(http.MethodPost, "/api/workspaces", map[string]any{
		"name": "git-demo", "source": "git", "repoUrl": gitURL, "token": token,
	}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("git clone: %d %s", resp.StatusCode, readBody(resp))
	}
	var cloned struct {
		Workspace struct {
			ID       string `json:"id"`
			RootPath string `json:"rootPath"`
		} `json:"workspace"`
	}
	decode(t, resp, &cloned)
	if cloned.Workspace.ID == "" || cloned.Workspace.RootPath == "" {
		t.Fatal("missing cloned workspace data")
	}
	if !strings.Contains(bareRepo, "repo.git") {
		t.Fatal("bad test repo")
	}
	if _, err := os.Stat(filepath.Join(cloned.Workspace.RootPath, "README.md")); err != nil {
		t.Fatalf("cloned file missing: %v", err)
	}
	aliceID, _ := primitive.ObjectIDFromHex(alice.userID)
	cloneID, _ := primitive.ObjectIDFromHex(cloned.Workspace.ID)
	doc, err := st.FindWorkspace(context.Background(), aliceID, cloneID)
	if err != nil {
		t.Fatal(err)
	}
	if doc.EncryptedToken == "" || doc.EncryptedToken == token {
		t.Fatal("git token was not encrypted")
	}
	plain, err := wm.Token(doc)
	if err != nil || plain != token {
		t.Fatalf("token round-trip failed: %v", err)
	}
	if resp := bob.do(http.MethodGet, "/api/workspaces/"+cloned.Workspace.ID, nil, false); resp.StatusCode != http.StatusNotFound {
		t.Errorf("cross-user git workspace: got %d, want 404", resp.StatusCode)
	}

	// Exercise the full Git workflow against the cloned workspace. Point the
	// remote at the local bare repository so push/pull are writable.
	runGit(t, cloned.Workspace.RootPath, "remote", "set-url", "origin", bareRepo)
	if err := os.WriteFile(filepath.Join(cloned.Workspace.RootPath, "hello.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	status := alice.do(http.MethodGet, "/api/workspaces/"+cloned.Workspace.ID+"/git/status", nil, false)
	if status.StatusCode != http.StatusOK {
		t.Fatalf("git status: %d", status.StatusCode)
	}
	var stPayload struct {
		Files []struct {
			Path string `json:"path"`
		} `json:"files"`
	}
	decode(t, status, &stPayload)
	if len(stPayload.Files) == 0 {
		t.Error("expected untracked file in git status")
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/stage", map[string]any{"path": "hello.txt"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("stage: %d", resp.StatusCode)
	}
	if resp := alice.do(http.MethodGet, "/api/workspaces/"+cloned.Workspace.ID+"/git/diff?path=hello.txt&cached=true", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("staged diff: %d", resp.StatusCode)
	} else {
		var diff struct {
			Diff string `json:"diff"`
		}
		decode(t, resp, &diff)
		if !strings.Contains(diff.Diff, "hello") {
			t.Error("staged diff does not contain file content")
		}
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/unstage", map[string]any{"path": "hello.txt"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("unstage: %d", resp.StatusCode)
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/stage", map[string]any{"path": "hello.txt"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("restage: %d", resp.StatusCode)
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/commit", map[string]any{"message": "add hello"}, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("commit: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/branch", map[string]any{"branch": "feature"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("create branch: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := alice.do(http.MethodGet, "/api/workspaces/"+cloned.Workspace.ID+"/git/branches", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("branches: %d", resp.StatusCode)
	} else {
		var branches struct {
			Branches []struct {
				Name    string `json:"name"`
				Current bool   `json:"current"`
			} `json:"branches"`
		}
		decode(t, resp, &branches)
		found := false
		for _, b := range branches.Branches {
			if b.Name == "feature" && b.Current {
				found = true
			}
		}
		if !found {
			t.Error("feature branch was not created/current")
		}
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/checkout", map[string]any{"branch": "main"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("checkout main: %d", resp.StatusCode)
	}
	// Push the local commit.
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/push", nil, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("push: %d %s", resp.StatusCode, readBody(resp))
	}
	if head := runGit(t, bareRepo, "rev-parse", "main"); !strings.Contains(head, runGit(t, cloned.Workspace.RootPath, "rev-parse", "main")) {
		t.Error("remote main does not contain workspace commit")
	}
	// Advance the remote, then fast-forward pull.
	remoteWork := filepath.Join(t.TempDir(), "remote-work")
	runGit(t, "", "clone", bareRepo, remoteWork)
	runGit(t, remoteWork, "config", "user.email", "remote@example.com")
	runGit(t, remoteWork, "config", "user.name", "Remote")
	if err := os.WriteFile(filepath.Join(remoteWork, "remote.txt"), []byte("remote\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, remoteWork, "add", "remote.txt")
	runGit(t, remoteWork, "commit", "-m", "remote advance")
	runGit(t, remoteWork, "push", "origin", "main")
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/pull", nil, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("fast-forward pull: %d %s", resp.StatusCode, readBody(resp))
	}
	if _, err := os.Stat(filepath.Join(cloned.Workspace.RootPath, "remote.txt")); err != nil {
		t.Error("pulled file missing")
	}
	// Create divergence: local and remote both commit, pull must fail without damage.
	if err := os.WriteFile(filepath.Join(cloned.Workspace.RootPath, "local.txt"), []byte("local\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, cloned.Workspace.RootPath, "add", "local.txt")
	runGit(t, cloned.Workspace.RootPath, "commit", "-m", "local diverge")
	if err := os.WriteFile(filepath.Join(remoteWork, "remote2.txt"), []byte("remote2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, remoteWork, "add", "remote2.txt")
	runGit(t, remoteWork, "commit", "-m", "remote diverge")
	runGit(t, remoteWork, "push", "origin", "main")
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+cloned.Workspace.ID+"/git/pull", nil, true); resp.StatusCode != http.StatusConflict {
		t.Errorf("non-fast-forward pull: got %d, want 409", resp.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(cloned.Workspace.RootPath, "local.txt")); err != nil {
		t.Error("non-fast-forward pull damaged local workspace")
	}

	// Re-instantiate the server against the same Mongo database and filesystem.
	wm2, err := workspace.New(cfg, st)
	if err != nil {
		t.Fatal(err)
	}
	handler2 := server.New(cfg, st, auth.NewManager(st, cfg.SessionTTL, false), wm2, files.New(wm2), git.New(wm2), slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts2 := httptest.NewServer(handler2)
	defer ts2.Close()
	alice2 := newClient(t, ts2.URL)
	alice2.login("alice@test.local", "member-password-1")
	if resp := alice2.do(http.MethodGet, "/api/workspaces/"+cloned.Workspace.ID, nil, false); resp.StatusCode != http.StatusOK {
		t.Errorf("workspace after server restart: got %d", resp.StatusCode)
	}
	if resp := alice2.do(http.MethodGet, "/api/workspaces/"+cloned.Workspace.ID+"/file?path=README.md", nil, false); resp.StatusCode != http.StatusOK {
		t.Errorf("file after server restart: got %d", resp.StatusCode)
	}

	// File CRUD, binary handling, size limits and traversal defenses.
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+created.Workspace.ID+"/entry", map[string]any{"path": "docs", "kind": "dir"}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create dir: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+created.Workspace.ID+"/entry", map[string]any{"path": "docs/hello.txt", "kind": "file"}, true); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create file: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := alice.do(http.MethodPut, "/api/workspaces/"+created.Workspace.ID+"/file", map[string]any{"path": "docs/hello.txt", "content": "hello file\n"}, true); resp.StatusCode != http.StatusOK {
		t.Fatalf("write file: %d %s", resp.StatusCode, readBody(resp))
	}
	if data, err := os.ReadFile(filepath.Join(aliceDir, "docs/hello.txt")); err != nil || string(data) != "hello file\n" {
		t.Fatalf("disk content: %v %q", err, string(data))
	}
	if resp := alice.do(http.MethodPost, "/api/workspaces/"+created.Workspace.ID+"/rename", map[string]any{"from": "docs/hello.txt", "to": "docs/renamed.txt"}, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("rename: %d %s", resp.StatusCode, readBody(resp))
	}
	if _, err := os.Stat(filepath.Join(aliceDir, "docs/hello.txt")); !os.IsNotExist(err) {
		t.Fatal("old path still exists after rename")
	}
	if resp := alice.do(http.MethodDelete, "/api/workspaces/"+created.Workspace.ID+"/entry?path=docs/renamed.txt", nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d %s", resp.StatusCode, readBody(resp))
	}
	if _, err := os.Stat(filepath.Join(aliceDir, "docs/renamed.txt")); !os.IsNotExist(err) {
		t.Fatal("file still exists after delete")
	}

	if err := os.WriteFile(filepath.Join(aliceDir, "binary.dat"), []byte{'a', 0, 'b'}, 0o644); err != nil {
		t.Fatal(err)
	}
	if resp := alice.do(http.MethodGet, "/api/workspaces/"+created.Workspace.ID+"/file?path=binary.dat", nil, false); resp.StatusCode != http.StatusOK {
		t.Fatalf("binary read: %d", resp.StatusCode)
	} else {
		var payload struct {
			Binary bool `json:"binary"`
		}
		decode(t, resp, &payload)
		if !payload.Binary {
			t.Error("binary flag not set")
		}
	}
	large := filepath.Join(aliceDir, "large.bin")
	if err := os.WriteFile(large, make([]byte, files.MaxFileSize+1), 0o644); err != nil {
		t.Fatal(err)
	}
	if resp := alice.do(http.MethodGet, "/api/workspaces/"+created.Workspace.ID+"/file?path=large.bin", nil, false); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("large read: got %d, want 413", resp.StatusCode)
	}
	for _, path := range []string{
		"/api/workspaces/" + created.Workspace.ID + "/file?path=/etc/passwd",
		"/api/workspaces/" + created.Workspace.ID + "/file?path=%2e%2e%2fetc%2fpasswd",
		"/api/workspaces/" + created.Workspace.ID + "/file?path=.git%2fconfig",
	} {
		if resp := alice.do(http.MethodGet, path, nil, false); resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusForbidden {
			t.Errorf("protected path %s: got %d", path, resp.StatusCode)
		}
	}
	if err := os.Symlink(outside, filepath.Join(aliceDir, "leak")); err != nil {
		t.Fatal(err)
	}
	if resp := alice.do(http.MethodGet, "/api/workspaces/"+created.Workspace.ID+"/file?path=leak/secret", nil, false); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("symlink escape: got %d, want 400", resp.StatusCode)
	}

	// Expire Alice's server-side session and verify it is rejected.
	aliceURL, _ := url.Parse(alice.base)
	var sessionCookie *http.Cookie
	for _, cookie := range alice.client.Jar.Cookies(aliceURL) {
		if cookie.Name == auth.SessionCookie {
			sessionCookie = cookie
		}
	}
	if sessionCookie == nil {
		t.Fatal("missing session cookie")
	}
	_, err = st.Sessions.UpdateOne(context.Background(), bson.M{"tokenHash": auth.TokenHash(sessionCookie.Value)}, bson.M{"$set": bson.M{"expiresAt": time.Now().Add(-time.Minute)}})
	if err != nil {
		t.Fatal(err)
	}
	if resp := alice.do(http.MethodGet, "/api/auth/me", nil, false); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expired session: got %d, want 401", resp.StatusCode)
	}

	// Log in again and verify explicit revocation works.
	alice.login("alice@test.local", "member-password-1")
	alice.logout()
	if resp := alice.do(http.MethodGet, "/api/auth/me", nil, false); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("after logout: got %d, want 401", resp.StatusCode)
	}
}

func newClient(t *testing.T, base string) *testClient {
	jar, _ := cookiejar.New(nil)
	return &testClient{t: t, base: base, client: &http.Client{Jar: jar, Timeout: 10 * time.Second}}
}

func (c *testClient) login(email, password string) {
	resp := c.do(http.MethodPost, "/api/auth/login", map[string]any{"email": email, "password": password}, false)
	if resp.StatusCode != http.StatusOK {
		c.t.Fatalf("login %s: %d %s", email, resp.StatusCode, readBody(resp))
	}
	var body struct {
		CSRFToken string `json:"csrfToken"`
		User      struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	decode(c.t, resp, &body)
	c.csrf = body.CSRFToken
	c.userID = body.User.ID
}

func (c *testClient) logout() {
	resp := c.do(http.MethodPost, "/api/auth/logout", nil, true)
	if resp.StatusCode != http.StatusNoContent {
		c.t.Fatalf("logout: %d", resp.StatusCode)
	}
}

func (c *testClient) do(method, path string, body any, csrf bool) *http.Response {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		c.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Origin", c.base)
	if csrf {
		req.Header.Set(auth.CSRFHeader, c.csrf)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	return resp
}

func decode(t *testing.T, resp *http.Response, dst any) {
	t.Helper()
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		t.Fatal(err)
	}
}

func readBody(resp *http.Response) string {
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return string(data)
}

func makeBareRepo(t *testing.T) (string, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	parent := t.TempDir()
	bare := filepath.Join(parent, "repo.git")
	work := filepath.Join(parent, "work")
	commands := [][]string{
		{"init", "--bare", bare},
		{"init", "-q", work},
		{"-C", work, "config", "user.email", "test@example.com"},
		{"-C", work, "config", "user.name", "Test"},
		{"-C", work, "remote", "add", "origin", bare},
	}
	for _, args := range commands {
		cmd := exec.Command("git", args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(work, "README.md"), []byte("# Test repository\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"-C", work, "add", "README.md"},
		{"-C", work, "commit", "-m", "initial"},
		{"-C", work, "push", "origin", "HEAD:main"},
		{"-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"},
		{"-C", bare, "update-server-info"},
	} {
		cmd := exec.Command("git", args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	server := httptest.NewTLSServer(http.FileServer(http.Dir(parent)))
	t.Cleanup(server.Close)
	return server.URL + "/repo.git", bare
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	if dir != "" {
		args = append([]string{"-C", dir}, args...)
	}
	cmd := exec.Command("git", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}
