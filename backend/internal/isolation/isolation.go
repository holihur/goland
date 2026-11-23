package isolation

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"goland/internal/config"
	"goland/internal/store"
)

type Identity struct {
	User    string
	UID     uint32
	GID     uint32
	Home    string
	Enabled bool
}

type Manager struct {
	enabled bool
	dataDir string
	mu      sync.Mutex
}

func New(cfg *config.Config) (*Manager, error) {
	m := &Manager{enabled: cfg.Isolation == "user", dataDir: cfg.DataDir}
	if !m.enabled {
		return m, nil
	}
	if os.Geteuid() != 0 {
		return nil, errors.New("workspace isolation requires root")
	}
	if err := m.prepareHost(cfg); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) Enabled() bool { return m.enabled }

func (m *Manager) prepareHost(cfg *config.Config) error {
	homes := filepath.Join(m.dataDir, "homes")
	if err := os.MkdirAll(homes, 0o711); err != nil {
		return err
	}
	if cfg.DevPermissions {
		// Development runs binaries from the operator's home. Grant traverse
		// only; directory listings and dotfiles remain protected.
		if err := os.Chmod("/root", 0o711); err != nil {
			return fmt.Errorf("chmod /root: %w", err)
		}
		_ = os.Chmod("/root/.cache", 0o711)
		_ = os.Chmod("/root/.cache/ms-playwright", 0o755)
		_ = os.Chmod(m.dataDir, 0o711)
		_ = os.Chmod(homes, 0o711)
		for _, root := range cfg.WorkspaceRoots {
			_ = os.Chmod(root, 0o711)
		}
		for _, sensitive := range []string{
			filepath.Join(m.dataDir, "mongo"),
			filepath.Join(m.dataDir, "logs"),
		} {
			if info, err := os.Stat(sensitive); err == nil && info.IsDir() {
				_ = os.Chmod(sensitive, 0o700)
			}
		}
		if info, err := os.Stat(filepath.Join(m.dataDir, "master.key")); err == nil && !info.IsDir() {
			_ = os.Chmod(filepath.Join(m.dataDir, "master.key"), 0o600)
		}
	}
	return nil
}

func (m *Manager) Provision(ctx context.Context, w *store.Workspace, root string) (*Identity, error) {
	if !m.enabled {
		return &Identity{UID: uint32(os.Geteuid()), GID: uint32(os.Getegid()), Home: os.Getenv("HOME")}, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	home := filepath.Join(m.dataDir, "homes", w.ID.Hex())
	if w.UnixUID <= 0 {
		identity, err := m.createUser(ctx, w, home)
		if err != nil {
			return nil, err
		}
		w.UnixUser, w.UnixUID, w.UnixGID = identity.User, int(identity.UID), int(identity.GID)
		w.Prepared = false
	} else {
		info, err := user.LookupId(strconv.Itoa(w.UnixUID))
		if err != nil {
			return nil, fmt.Errorf("workspace user uid %d no longer exists: %w", w.UnixUID, err)
		}
		w.UnixUser = info.Username
		gid, _ := strconv.Atoi(info.Gid)
		w.UnixGID = gid
	}
	if err := m.ensureHome(home, uint32(w.UnixUID), uint32(w.UnixGID)); err != nil {
		return nil, err
	}
	if !w.Prepared {
		if root == "/" || root == "" {
			return nil, errors.New("refusing to chown filesystem root")
		}
		chownCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		uidgid := fmt.Sprintf("%d:%d", w.UnixUID, w.UnixGID)
		cmd := exec.CommandContext(chownCtx, "chown", "-R", "--", uidgid, root)
		if out, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("chown workspace: %s", strings.TrimSpace(string(out)))
		}
		if err := os.Chmod(root, 0o700); err != nil {
			return nil, fmt.Errorf("chmod workspace: %w", err)
		}
		w.Prepared = true
	}
	return &Identity{
		User: w.UnixUser, UID: uint32(w.UnixUID), GID: uint32(w.UnixGID),
		Home: home, Enabled: true,
	}, nil
}

func (m *Manager) createUser(ctx context.Context, w *store.Workspace, home string) (*Identity, error) {
	name := "goland-" + strings.ToLower(w.ID.Hex()[:8])
	if info, err := user.Lookup(name); err == nil {
		uid, _ := strconv.ParseUint(info.Uid, 10, 32)
		gid, _ := strconv.ParseUint(info.Gid, 10, 32)
		return &Identity{User: name, UID: uint32(uid), GID: uint32(gid), Home: home, Enabled: true}, nil
	}

	sum := sha256.Sum256([]byte(w.ID.Hex()))
	start := 200000 + int(binary.BigEndian.Uint32(sum[:4])%500000)
	uid := start
	for i := 0; i < 1000; i++ {
		if _, err := user.LookupId(strconv.Itoa(uid)); err != nil {
			break
		}
		uid++
	}
	if _, err := user.LookupGroup(name); err == nil {
		_ = exec.CommandContext(ctx, "groupdel", name).Run()
	}
	if out, err := exec.CommandContext(ctx, "groupadd", "--gid", strconv.Itoa(uid), name).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("groupadd: %s", strings.TrimSpace(string(out)))
	}
	args := []string{
		"--uid", strconv.Itoa(uid), "--gid", strconv.Itoa(uid),
		"--no-create-home", "--home-dir", home, "--shell", "/usr/sbin/nologin",
		"--no-log-init", name,
	}
	if out, err := exec.CommandContext(ctx, "useradd", args...).CombinedOutput(); err != nil {
		_ = exec.CommandContext(ctx, "groupdel", name).Run()
		return nil, fmt.Errorf("useradd: %s", strings.TrimSpace(string(out)))
	}
	return &Identity{User: name, UID: uint32(uid), GID: uint32(uid), Home: home, Enabled: true}, nil
}

func (m *Manager) ensureHome(home string, uid, gid uint32) error {
	dirs := []string{
		home,
		filepath.Join(home, ".cache"),
		filepath.Join(home, ".cache", "go-build"),
		filepath.Join(home, ".npm"),
		filepath.Join(home, ".local"),
		filepath.Join(home, ".local", "share"),
		filepath.Join(home, ".local", "share", "pnpm"),
		filepath.Join(home, "go"),
		filepath.Join(home, "go", "pkg"),
		filepath.Join(home, "go", "pkg", "mod"),
		filepath.Join(home, "tmp"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
		if err := os.Chown(dir, int(uid), int(gid)); err != nil {
			return err
		}
	}
	return nil
}

func (id *Identity) Env(root string) []string {
	tmpDir := filepath.Join(id.Home, "tmp")
	if _, err := os.Stat(tmpDir); err != nil {
		tmpDir = os.TempDir()
	}
	env := []string{
		"HOME=" + id.Home,
		"USER=" + id.User,
		"LOGNAME=" + id.User,
		"SHELL=/bin/bash",
		"TERM=dumb",
		"LANG=C.UTF-8",
		"LC_ALL=C.UTF-8",
		"GIT_TERMINAL_PROMPT=0",
		"GOLAND_WORKSPACE=" + root,
		"XDG_CACHE_HOME=" + filepath.Join(id.Home, ".cache"),
		"XDG_CONFIG_HOME=" + filepath.Join(id.Home, ".config"),
		"XDG_DATA_HOME=" + filepath.Join(id.Home, ".local", "share"),
		"TMPDIR=" + tmpDir,
		"GOPATH=" + filepath.Join(id.Home, "go"),
		"GOCACHE=" + filepath.Join(id.Home, ".cache", "go-build"),
		"GOMODCACHE=" + filepath.Join(id.Home, "go", "pkg", "mod"),
		"NPM_CONFIG_CACHE=" + filepath.Join(id.Home, ".npm"),
		"PNPM_HOME=" + filepath.Join(id.Home, ".local", "share", "pnpm"),
	}
	for _, key := range []string{
		"PATH", "GOROOT", "GOTOOLCHAIN", "GOPROXY", "GOSUMDB", "GONOSUMDB",
		"GOFLAGS", "NODE_PATH", "CHROME_BIN",
	} {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func (id *Identity) Apply(cmd *exec.Cmd) {
	if !id.Enabled {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Credential = &syscall.Credential{Uid: id.UID, Gid: id.GID, Groups: []uint32{}}
}
