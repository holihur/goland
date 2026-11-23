package git

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"goland/internal/config"
	"goland/internal/store"
	"goland/internal/workspace"
)

func testManager(t *testing.T) (*Manager, *store.Workspace, string) {
	t.Helper()
	root := t.TempDir()
	cfg := &config.Config{
		DataDir: t.TempDir(), WorkspaceRoots: []string{root}, Isolation: "none",
		MasterKey: bytes.Repeat([]byte{8}, 32),
	}
	wm, err := workspace.New(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	return New(wm), &store.Workspace{RootPath: root}, root
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

func initRepo(t *testing.T, dir string) {
	t.Helper()
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.email", "test@example.com")
	runGit(t, dir, "config", "user.name", "Test")
}

func TestParseBranchHeader(t *testing.T) {
	cases := []struct {
		header string
		want   Status
	}{
		{"HEAD (no branch)", Status{Detached: true}},
		{"No commits yet on main", Status{Branch: "main"}},
		{"main", Status{Branch: "main"}},
		{"feature...origin/feature [ahead 2, behind 3]", Status{Branch: "feature", Ahead: 2, Behind: 3}},
		{"main...origin/main [behind 1]", Status{Branch: "main", Behind: 1}},
		{"main...origin/main [ahead 4]", Status{Branch: "main", Ahead: 4}},
	}
	for _, tc := range cases {
		var st Status
		parseBranchHeader(&st, tc.header)
		if !reflect.DeepEqual(st, tc.want) {
			t.Errorf("%q: %#v want %#v", tc.header, st, tc.want)
		}
	}
}

func TestSafePathAndEnv(t *testing.T) {
	for _, ok := range []string{"", "a", "a/b", "./a", "dir/file.txt"} {
		if _, err := safePath(ok); err != nil {
			t.Errorf("safePath(%q): %v", ok, err)
		}
	}
	for _, bad := range []string{"../x", "/abs", `a\b`, ".git", ".git/config", "-flag", "a\x00b"} {
		if _, err := safePath(bad); err == nil {
			t.Errorf("safePath(%q) should fail", bad)
		}
	}
	env := strings.Join(gitEnv([]string{"A=1"}, "token"), "\n")
	if !strings.Contains(env, "A=1") || !strings.Contains(env, "GIT_TERMINAL_PROMPT=0") || !strings.Contains(env, "GIT_CONFIG_VALUE_0=Authorization: Basic ") {
		t.Fatalf("gitEnv: %s", env)
	}
	if strings.Contains(strings.Join(gitEnv(nil, ""), "\n"), "http.extraHeader") {
		t.Fatal("empty token should not set auth header")
	}
}

func TestNotRepoAndErrors(t *testing.T) {
	m, w, root := testManager(t)
	if _, err := m.Status(context.Background(), w); !errors.Is(err, ErrNotRepo) {
		t.Fatalf("status non-repo: %v", err)
	}
	if _, err := m.Diff(context.Background(), w, "", false); !errors.Is(err, ErrNotRepo) {
		t.Fatalf("diff non-repo: %v", err)
	}
	if err := m.Stage(context.Background(), w, ""); !errors.Is(err, ErrNotRepo) {
		t.Fatalf("stage non-repo: %v", err)
	}
	_ = root
	initRepo(t, root)
	if _, err := m.run(context.Background(), w, root); err == nil {
		t.Fatal("empty git args should fail")
	}
}

func TestStatusDiffStageCommit(t *testing.T) {
	m, w, root := testManager(t)
	initRepo(t, root)
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	st, err := m.Status(context.Background(), w)
	if err != nil {
		t.Fatal(err)
	}
	if st.Branch == "" || len(st.Files) != 1 || st.Files[0].Path != "main.go" || st.Files[0].Worktree != "?" {
		t.Fatalf("status: %#v", st)
	}
	if err := m.Stage(context.Background(), w, "main.go"); err != nil {
		t.Fatal(err)
	}
	if diff, err := m.Diff(context.Background(), w, "main.go", true); err != nil || !strings.Contains(diff, "package main") {
		t.Fatalf("staged diff: %q %v", diff, err)
	}
	if _, err := m.Commit(context.Background(), w, " ", "", ""); err == nil {
		t.Fatal("empty commit message should fail")
	}
	if _, err := m.Commit(context.Background(), w, strings.Repeat("x", 5001), "", ""); err == nil {
		t.Fatal("long commit message should fail")
	}
	if out, err := m.Commit(context.Background(), w, "initial", "", ""); err != nil || !strings.Contains(out, "initial") {
		t.Fatalf("commit: %q %v", out, err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n\n// changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if diff, err := m.Diff(context.Background(), w, "", false); err != nil || !strings.Contains(diff, "changed") {
		t.Fatalf("diff: %q %v", diff, err)
	}
	if err := m.Stage(context.Background(), w, "main.go"); err != nil {
		t.Fatal(err)
	}
	if err := m.Unstage(context.Background(), w, "main.go"); err != nil {
		t.Fatal(err)
	}
	if err := m.Stage(context.Background(), w, ""); err != nil {
		t.Fatal(err)
	}
	if out, err := m.Commit(context.Background(), w, "second", "", ""); err != nil || !strings.Contains(out, "second") {
		t.Fatalf("second commit: %q %v", out, err)
	}
	st, _ = m.Status(context.Background(), w)
	if st.Branch == "" || len(st.Files) != 0 {
		t.Fatalf("clean status: %#v", st)
	}
	if log, err := m.Log(context.Background(), w); err != nil || !strings.Contains(log, "initial") {
		t.Fatalf("log: %q %v", log, err)
	}
}

func TestBranchesCheckoutAndRemote(t *testing.T) {
	m, w, root := testManager(t)
	initRepo(t, root)
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", ".")
	if _, err := m.Commit(context.Background(), w, "init", "A", "a@example.com"); err != nil {
		t.Fatal(err)
	}

	branches, err := m.Branches(context.Background(), w)
	if err != nil || len(branches) != 1 || !branches[0].Current {
		t.Fatalf("branches: %#v %v", branches, err)
	}
	if err := m.CreateBranch(context.Background(), w, "feature"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "-x", "a b", "a\tb"} {
		if err := m.CreateBranch(context.Background(), w, bad); err == nil {
			t.Errorf("CreateBranch(%q) should fail", bad)
		}
		if err := m.Checkout(context.Background(), w, bad); err == nil {
			t.Errorf("Checkout(%q) should fail", bad)
		}
	}
	branches, _ = m.Branches(context.Background(), w)
	if len(branches) != 2 {
		t.Fatalf("branches after create: %#v", branches)
	}
	current, _ := m.run(context.Background(), w, root, "rev-parse", "--abbrev-ref", "HEAD")
	if strings.TrimSpace(current) != "feature" {
		t.Fatalf("current branch: %q", current)
	}
	if err := m.Checkout(context.Background(), w, "master"); err != nil {
		// Some git versions default to main.
		if err := m.Checkout(context.Background(), w, "main"); err != nil {
			t.Fatal(err)
		}
	}

	remote := filepath.Join(t.TempDir(), "remote.git")
	runGit(t, "", "init", "--bare", remote)
	runGit(t, root, "remote", "add", "origin", remote)
	if out, err := m.Push(context.Background(), w); err != nil || out == "" {
		t.Fatalf("push: %q %v", out, err)
	}
	branch := runGit(t, root, "rev-parse", "--abbrev-ref", "HEAD")
	runGit(t, root, "branch", "--set-upstream-to=origin/"+branch, branch)
	if _, err := m.Pull(context.Background(), w); err != nil {
		t.Fatalf("pull: %v", err)
	}
}

func TestStatusRenamesAndDetached(t *testing.T) {
	m, w, root := testManager(t)
	initRepo(t, root)
	if err := os.WriteFile(filepath.Join(root, "old.txt"), []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-m", "init")
	runGit(t, root, "mv", "old.txt", "new.txt")
	st, err := m.Status(context.Background(), w)
	if err != nil || len(st.Files) != 1 || st.Files[0].OrigPath != "old.txt" {
		t.Fatalf("rename status: %#v %v", st, err)
	}
	runGit(t, root, "checkout", "--detach", "HEAD")
	st, _ = m.Status(context.Background(), w)
	if !st.Detached {
		t.Fatalf("detached status: %#v", st)
	}
}
