package workspace

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"goland/internal/config"
	"goland/internal/cryptoutil"
	"goland/internal/isolation"
	"goland/internal/store"
)

var (
	ErrPathNotAllowed = errors.New("path is outside configured workspace roots")
	ErrInvalidGitURL  = errors.New("git URL must be HTTPS (HTTP is allowed only for localhost)")
	ErrNotGitRepo     = errors.New("workspace is not a git repository")
)

type Manager struct {
	cfg       *config.Config
	store     *store.Store
	box       *cryptoutil.Box
	isolation *isolation.Manager
	now       func() time.Time
}

func New(cfg *config.Config, st *store.Store) (*Manager, error) {
	box, err := cryptoutil.New(cfg.MasterKey)
	if err != nil {
		return nil, err
	}
	iso, err := isolation.New(cfg)
	if err != nil {
		return nil, err
	}
	return &Manager{cfg: cfg, store: st, box: box, isolation: iso, now: time.Now}, nil
}

func (m *Manager) IsolationEnabled() bool { return m.isolation.Enabled() }

func (m *Manager) Prepare(ctx context.Context, w *store.Workspace) (*isolation.Identity, error) {
	root, err := m.Resolve(w)
	if err != nil {
		return nil, err
	}
	before := *w
	identity, err := m.isolation.Provision(ctx, w, root)
	if err != nil {
		return nil, err
	}
	if before.Prepared != w.Prepared || before.UnixUID != w.UnixUID || before.UnixGID != w.UnixGID || before.UnixUser != w.UnixUser {
		if err := m.store.UpdateWorkspace(ctx, w); err != nil {
			return nil, err
		}
	}
	return identity, nil
}

func (m *Manager) Identity(ctx context.Context, w *store.Workspace) (*isolation.Identity, error) {
	return m.Prepare(ctx, w)
}

func (m *Manager) PrepareAll(ctx context.Context) error {
	if !m.isolation.Enabled() {
		return nil
	}
	list, err := m.store.ListAllWorkspaces(ctx)
	if err != nil {
		return err
	}
	var failures []string
	for i := range list {
		if _, err := m.Prepare(ctx, &list[i]); err != nil {
			failures = append(failures, list[i].Name+": "+err.Error())
		}
	}
	if len(failures) > 0 {
		return errors.New("some workspaces could not be prepared: " + strings.Join(failures, "; "))
	}
	return nil
}

func (m *Manager) List(ctx context.Context, ownerID primitive.ObjectID) ([]store.Workspace, error) {
	return m.store.ListWorkspaces(ctx, ownerID)
}

func (m *Manager) Get(ctx context.Context, ownerID, id primitive.ObjectID) (*store.Workspace, error) {
	return m.store.FindWorkspace(ctx, ownerID, id)
}

func (m *Manager) CreateLocal(ctx context.Context, ownerID primitive.ObjectID, name, localPath string) (*store.Workspace, error) {
	if strings.TrimSpace(localPath) == "" {
		return nil, errors.New("path is required")
	}
	abs, err := filepath.Abs(localPath)
	if err != nil {
		return nil, err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, fmt.Errorf("resolve path: %w", err)
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, fmt.Errorf("stat path: %w", err)
	}
	if !info.IsDir() {
		return nil, errors.New("path must be a directory")
	}
	allowed := false
	for _, root := range m.cfg.WorkspaceRoots {
		if within(root, real) {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, ErrPathNotAllowed
	}
	if name == "" {
		name = filepath.Base(real)
	}
	w := &store.Workspace{
		ID: primitive.NewObjectID(), OwnerID: ownerID, Name: cleanName(name),
		RootPath: real, Source: "local", Managed: false,
	}
	if err := m.store.CreateWorkspace(ctx, w); err != nil {
		return nil, err
	}
	if _, err := m.Prepare(ctx, w); err != nil {
		_ = m.store.DeleteWorkspace(ctx, ownerID, w.ID)
		return nil, err
	}
	return w, nil
}

func (m *Manager) CreateGit(ctx context.Context, ownerID primitive.ObjectID, name, repoURL, branch, token string) (*store.Workspace, error) {
	repoURL = strings.TrimSpace(repoURL)
	u, err := url.Parse(repoURL)
	if err != nil {
		return nil, ErrInvalidGitURL
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && isLoopbackHost(u.Hostname())) {
		return nil, ErrInvalidGitURL
	}
	if u.User != nil || u.Host == "" {
		return nil, ErrInvalidGitURL
	}
	if branch != "" && (strings.HasPrefix(branch, "-") || strings.ContainsAny(branch, " \t\n\r")) {
		return nil, errors.New("invalid branch")
	}
	if name == "" {
		name = strings.TrimSuffix(path.Base(u.Path), ".git")
		if name == "" || name == "." {
			name = "repository"
		}
	}
	dest := filepath.Join(m.cfg.PrimaryWorkspaceRoot(), ownerID.Hex(), randomSlug())
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, err
	}

	cloneCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	args := []string{"clone", "--"}
	if branch != "" {
		args = []string{"clone", "--branch", branch, "--"}
	}
	args = append(args, repoURL, dest)
	cmd := exec.CommandContext(cloneCtx, "git", args...)
	cmd.Env = gitEnv(token)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.RemoveAll(dest)
		return nil, fmt.Errorf("git clone failed: %s", redactGitOutput(string(out), token))
	}

	actualBranch := branch
	if actualBranch == "" {
		cmd = exec.CommandContext(cloneCtx, "git", "-C", dest, "rev-parse", "--abbrev-ref", "HEAD")
		if out, err := cmd.Output(); err == nil {
			actualBranch = strings.TrimSpace(string(out))
		}
	}
	encToken, err := m.box.Encrypt(token)
	if err != nil {
		_ = os.RemoveAll(dest)
		return nil, err
	}
	w := &store.Workspace{
		ID: primitive.NewObjectID(), OwnerID: ownerID, Name: cleanName(name),
		RootPath: dest, Source: "git", RepoURL: repoURL, Branch: actualBranch,
		Managed: true, EncryptedToken: encToken,
	}
	if err := m.store.CreateWorkspace(ctx, w); err != nil {
		_ = os.RemoveAll(dest)
		return nil, err
	}
	if _, err := m.Prepare(ctx, w); err != nil {
		_ = m.store.DeleteWorkspace(ctx, ownerID, w.ID)
		_ = os.RemoveAll(dest)
		return nil, err
	}
	return w, nil
}

func (m *Manager) Delete(ctx context.Context, ownerID, id primitive.ObjectID) error {
	w, err := m.store.FindWorkspace(ctx, ownerID, id)
	if err != nil {
		return err
	}
	if err := m.store.DeleteWorkspace(ctx, ownerID, id); err != nil {
		return err
	}
	if w.Managed {
		real, err := filepath.EvalSymlinks(w.RootPath)
		if err == nil {
			for _, root := range m.cfg.WorkspaceRoots {
				if within(root, real) && real != root {
					_ = os.RemoveAll(real)
					break
				}
			}
		}
	}
	return nil
}

func (m *Manager) Token(w *store.Workspace) (string, error) {
	return m.box.Decrypt(w.EncryptedToken)
}

func (m *Manager) SetToken(w *store.Workspace, token string) error {
	enc, err := m.box.Encrypt(strings.TrimSpace(token))
	if err != nil {
		return err
	}
	w.EncryptedToken = enc
	return m.store.UpdateWorkspace(context.Background(), w)
}

func (m *Manager) Resolve(w *store.Workspace) (string, error) {
	real, err := filepath.EvalSymlinks(w.RootPath)
	if err != nil {
		return "", fmt.Errorf("workspace path unavailable: %w", err)
	}
	info, err := os.Stat(real)
	if err != nil || !info.IsDir() {
		return "", errors.New("workspace path is not a directory")
	}
	return real, nil
}

func (m *Manager) IsManagedPath(p string) bool {
	real, err := filepath.EvalSymlinks(p)
	if err != nil {
		return false
	}
	for _, root := range m.cfg.WorkspaceRoots {
		if within(root, real) {
			return true
		}
	}
	return false
}

func within(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

func randomSlug() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("ws-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func cleanName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "workspace"
	}
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == '/' || r == '\\' {
			return '-'
		}
		return r
	}, name)
	if len(name) > 80 {
		name = name[:80]
	}
	return name
}

func gitEnv(token string) []string {
	env := append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if token != "" {
		// Passing auth via environment-backed config avoids putting the token in argv.
		header := "Authorization: Basic " + basicAuth("x-access-token", token)
		env = append(env,
			"GIT_CONFIG_COUNT=1",
			"GIT_CONFIG_KEY_0=http.extraHeader",
			"GIT_CONFIG_VALUE_0="+header,
		)
	}
	return env
}

func basicAuth(user, token string) string {
	return base64.StdEncoding.EncodeToString([]byte(user + ":" + token))
}

func redactGitOutput(out, token string) string {
	if token == "" {
		return strings.TrimSpace(out)
	}
	return strings.ReplaceAll(strings.TrimSpace(out), token, "[REDACTED]")
}

func isLoopbackHost(h string) bool {
	return h == "127.0.0.1" || h == "localhost" || h == "::1"
}
