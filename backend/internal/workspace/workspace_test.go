package workspace

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"goland/internal/config"
	"goland/internal/store"
)

func testConfig(t *testing.T) *config.Config {
	t.Helper()
	root := filepath.Join(t.TempDir(), "workspaces")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	return &config.Config{
		DataDir: t.TempDir(), WorkspaceRoots: []string{root}, Isolation: "none",
		MasterKey: bytes.Repeat([]byte{5}, 32), AdminEmail: "admin@test.local",
		AdminPassword: "admin-password-1", AdminName: "Admin", SessionTTL: time.Hour,
	}
}

func testStore(t *testing.T, cfg *config.Config) *store.Store {
	t.Helper()
	uri := os.Getenv("GOLAND_TEST_MONGO_URI")
	if uri == "" {
		uri = "mongodb://127.0.0.1:27019"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := store.Connect(ctx, uri, "goland_ws_test_"+time.Now().Format("150405000000000"))
	if err != nil {
		t.Skipf("MongoDB unavailable: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DropDatabase(context.Background())
		_ = st.Disconnect(context.Background())
	})
	return st
}

func TestHelpers(t *testing.T) {
	if !within("/a", "/a") || !within("/a", "/a/b") {
		t.Fatal("within should accept root and children")
	}
	for _, target := range []string{"/b", "/a/../b", "/ab"} {
		if within("/a", target) {
			t.Errorf("within(%q) should be false", target)
		}
	}
	if got := cleanName("  a/b\\c\x01d  "); got != "a-b-c-d" {
		t.Fatalf("cleanName: %q", got)
	}
	if got := cleanName(""); got != "workspace" {
		t.Fatalf("empty name: %q", got)
	}
	long := strings.Repeat("x", 100)
	if got := cleanName(long); len(got) != 80 {
		t.Fatalf("long name length: %d", len(got))
	}
	a, b := randomSlug(), randomSlug()
	if len(a) != 16 || a == b {
		t.Fatalf("randomSlug: %q %q", a, b)
	}
	if !isLoopbackHost("localhost") || !isLoopbackHost("127.0.0.1") || !isLoopbackHost("::1") || isLoopbackHost("example.com") {
		t.Fatal("isLoopbackHost mismatch")
	}
	if basicAuth("u", "t") != "dTp0" {
		t.Fatalf("basicAuth: %q", basicAuth("u", "t"))
	}
	if got := redactGitOutput(" token \n", "token"); got != "[REDACTED]" {
		t.Fatalf("redact: %q", got)
	}
	if got := redactGitOutput(" plain \n", ""); got != "plain" {
		t.Fatalf("trim: %q", got)
	}
	env := strings.Join(gitEnv("secret"), "\n")
	if !strings.Contains(env, "GIT_TERMINAL_PROMPT=0") || !strings.Contains(env, "GIT_CONFIG_KEY_0=http.extraHeader") || !strings.Contains(env, "GIT_CONFIG_VALUE_0=Authorization: Basic ") {
		t.Fatalf("gitEnv: %s", env)
	}
}

func TestResolveManagedPathAndIsolation(t *testing.T) {
	cfg := testConfig(t)
	m, err := New(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if m.IsolationEnabled() {
		t.Fatal("isolation should be disabled")
	}
	dir := filepath.Join(cfg.WorkspaceRoots[0], "project")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "file"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := &store.Workspace{RootPath: dir}
	if got, err := m.Resolve(w); err != nil || got != dir {
		t.Fatalf("Resolve: %q %v", got, err)
	}
	notDir := filepath.Join(dir, "file")
	if _, err := m.Resolve(&store.Workspace{RootPath: notDir}); err == nil {
		t.Fatal("file workspace should fail")
	}
	if _, err := m.Resolve(&store.Workspace{RootPath: filepath.Join(dir, "missing")}); err == nil {
		t.Fatal("missing workspace should fail")
	}
	if !m.IsManagedPath(dir) || m.IsManagedPath(t.TempDir()) {
		t.Fatal("IsManagedPath mismatch")
	}
}

func TestCreateLocalAndDelete(t *testing.T) {
	cfg := testConfig(t)
	st := testStore(t, cfg)
	m, err := New(cfg, st)
	if err != nil {
		t.Fatal(err)
	}
	owner := primitive.NewObjectID()
	root := cfg.WorkspaceRoots[0]
	dir := filepath.Join(root, "project")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	w, err := m.CreateLocal(context.Background(), owner, "", dir)
	if err != nil {
		t.Fatal(err)
	}
	if w.Name != "project" || w.Source != "local" || w.Managed {
		t.Fatalf("unexpected workspace: %#v", w)
	}
	if list, err := m.List(context.Background(), owner); err != nil || len(list) != 1 {
		t.Fatalf("List: %#v %v", list, err)
	}
	if got, err := m.Get(context.Background(), owner, w.ID); err != nil || got.ID != w.ID {
		t.Fatalf("Get: %#v %v", got, err)
	}
	if err := m.SetToken(w, "secret-token"); err != nil {
		t.Fatal(err)
	}
	if token, err := m.Token(w); err != nil || token != "secret-token" {
		t.Fatalf("Token: %q %v", token, err)
	}
	if err := m.Delete(context.Background(), owner, w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Get(context.Background(), owner, w.ID); err == nil {
		t.Fatal("deleted workspace still exists")
	}
}

func TestCreateLocalValidation(t *testing.T) {
	cfg := testConfig(t)
	st := testStore(t, cfg)
	m, _ := New(cfg, st)
	owner := primitive.NewObjectID()
	if _, err := m.CreateLocal(context.Background(), owner, "x", " "); err == nil {
		t.Fatal("empty path should fail")
	}
	if _, err := m.CreateLocal(context.Background(), owner, "x", filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Fatal("missing path should fail")
	}
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.CreateLocal(context.Background(), owner, "x", file); err == nil {
		t.Fatal("file path should fail")
	}
	if _, err := m.CreateLocal(context.Background(), owner, "x", t.TempDir()); err != ErrPathNotAllowed {
		t.Fatalf("outside root: %v", err)
	}
}

func TestCreateGitValidation(t *testing.T) {
	cfg := testConfig(t)
	st := testStore(t, cfg)
	m, _ := New(cfg, st)
	owner := primitive.NewObjectID()
	for _, repo := range []string{"ftp://example.com/x.git", "http://example.com/x.git", "https://user@example.com/x.git", "://bad"} {
		if _, err := m.CreateGit(context.Background(), owner, "", repo, "", ""); err != ErrInvalidGitURL {
			t.Errorf("CreateGit(%q): %v", repo, err)
		}
	}
	if _, err := m.CreateGit(context.Background(), owner, "", "http://127.0.0.1:1/x.git", "-bad", ""); err == nil {
		t.Fatal("invalid branch should fail")
	}
	if _, err := m.CreateGit(context.Background(), owner, "", "http://127.0.0.1:1/x.git", "bad branch", ""); err == nil {
		t.Fatal("branch with space should fail")
	}
	if _, err := m.CreateGit(context.Background(), owner, "", "http://127.0.0.1:1/x.git", "", "token"); err == nil || !strings.Contains(err.Error(), "git clone failed") {
		t.Fatalf("clone failure: %v", err)
	}
}

func TestCreateGitLocalRemote(t *testing.T) {
	if _, err := os.Stat("/usr/bin/git"); err != nil {
		t.Skip("git unavailable")
	}
	cfg := testConfig(t)
	st := testStore(t, cfg)
	m, _ := New(cfg, st)
	owner := primitive.NewObjectID()

	remote := filepath.Join(t.TempDir(), "remote.git")
	runGit(t, "", "init", "--bare", remote)
	work := t.TempDir()
	runGit(t, work, "init")
	runGit(t, work, "config", "user.email", "test@example.com")
	runGit(t, work, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(work, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, work, "add", ".")
	runGit(t, work, "commit", "-m", "init")
	runGit(t, work, "remote", "add", "origin", remote)
	runGit(t, work, "push", "origin", "HEAD:main")
	runGit(t, "", "--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main")
	runGit(t, "", "--git-dir", remote, "update-server-info")

	srv := serveGitHTTP(t, filepath.Dir(remote))
	defer srv.Close()
	w, err := m.CreateGit(context.Background(), owner, "demo", srv.URL+"/remote.git", "main", "super-secret")
	if err != nil {
		t.Fatal(err)
	}
	if w.Source != "git" || !w.Managed || w.Branch != "main" || w.EncryptedToken == "" || w.EncryptedToken == "super-secret" {
		t.Fatalf("unexpected git workspace: %#v", w)
	}
	if token, err := m.Token(w); err != nil || token != "super-secret" {
		t.Fatalf("token: %q %v", token, err)
	}
	if _, err := os.Stat(filepath.Join(w.RootPath, "README.md")); err != nil {
		t.Fatalf("clone missing file: %v", err)
	}
	if err := m.Delete(context.Background(), owner, w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(w.RootPath); !os.IsNotExist(err) {
		t.Fatalf("managed clone should be removed: %v", err)
	}
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

func serveGitHTTP(t *testing.T, parent string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.FileServer(http.Dir(parent)))
	t.Cleanup(srv.Close)
	return srv
}
