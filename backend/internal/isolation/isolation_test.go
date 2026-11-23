package isolation

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"goland/internal/config"
	"goland/internal/store"
)

func TestDisabledManager(t *testing.T) {
	m, err := New(&config.Config{Isolation: "none", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if m.Enabled() {
		t.Fatal("none isolation should be disabled")
	}
	identity, err := m.Provision(context.Background(), &store.Workspace{}, "/tmp")
	if err != nil {
		t.Fatal(err)
	}
	if identity.Enabled || identity.UID != uint32(os.Geteuid()) || identity.GID != uint32(os.Getegid()) {
		t.Fatalf("unexpected identity: %#v", identity)
	}
}

func TestUserManagerPreparesHomes(t *testing.T) {
	data := t.TempDir()
	m, err := New(&config.Config{Isolation: "user", DataDir: data, WorkspaceRoots: []string{t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	if !m.Enabled() {
		t.Fatal("user isolation should be enabled")
	}
	info, err := os.Stat(filepath.Join(data, "homes"))
	if err != nil || !info.IsDir() {
		t.Fatalf("homes directory: %v", err)
	}
}

func TestEnsureHome(t *testing.T) {
	m := &Manager{dataDir: t.TempDir()}
	home := filepath.Join(t.TempDir(), "home")
	if err := m.ensureHome(home, uint32(os.Geteuid()), uint32(os.Getegid())); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"", ".cache", ".cache/go-build", ".npm", ".local/share/pnpm", "go/pkg/mod", "tmp"} {
		info, err := os.Stat(filepath.Join(home, rel))
		if err != nil || !info.IsDir() {
			t.Errorf("missing %q: %v", rel, err)
		}
	}
}

func TestIdentityEnv(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "tmp"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", "/usr/bin")
	t.Setenv("GOROOT", "/go")
	id := &Identity{User: "alice", UID: 1234, GID: 5678, Home: home, Enabled: true}
	env := strings.Join(id.Env("/workspace"), "\n")
	for _, want := range []string{"HOME=" + home, "USER=alice", "PATH=/usr/bin", "GOROOT=/go", "GOLAND_WORKSPACE=/workspace", "TMPDIR=" + filepath.Join(home, "tmp")} {
		if !strings.Contains(env, want) {
			t.Errorf("env missing %q in %s", want, env)
		}
	}

	missingHome := &Identity{User: "bob", Home: filepath.Join(t.TempDir(), "missing")}
	if got := missingHome.Env("/ws"); !strings.Contains(strings.Join(got, "\n"), "TMPDIR="+os.TempDir()) {
		t.Errorf("expected fallback TMPDIR, got %#v", got)
	}
}

func TestIdentityApply(t *testing.T) {
	cmd := exec.Command("true")
	disabled := &Identity{}
	disabled.Apply(cmd)
	if cmd.SysProcAttr != nil && cmd.SysProcAttr.Credential != nil {
		t.Fatal("disabled identity must not set credentials")
	}
	enabled := &Identity{Enabled: true, UID: 123, GID: 456}
	enabled.Apply(cmd)
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.Credential == nil {
		t.Fatal("expected credentials")
	}
	if cmd.SysProcAttr.Credential.Uid != 123 || cmd.SysProcAttr.Credential.Gid != 456 || len(cmd.SysProcAttr.Credential.Groups) != 0 {
		t.Fatalf("unexpected credential: %#v", cmd.SysProcAttr.Credential)
	}
}
