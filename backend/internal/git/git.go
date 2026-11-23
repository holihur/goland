package git

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"goland/internal/store"
	"goland/internal/workspace"
)

var ErrNotRepo = errors.New("workspace is not a git repository")

type Manager struct {
	workspaces *workspace.Manager
}

type FileStatus struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath,omitempty"`
	Index    string `json:"index"`
	Worktree string `json:"worktree"`
}

type Status struct {
	Branch   string       `json:"branch"`
	Detached bool         `json:"detached"`
	Ahead    int          `json:"ahead"`
	Behind   int          `json:"behind"`
	Files    []FileStatus `json:"files"`
}

type Branch struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
}

var trackRe = regexp.MustCompile(`\[(.*?)\]`)

func New(wm *workspace.Manager) *Manager { return &Manager{workspaces: wm} }

func (m *Manager) root(w *store.Workspace) (string, error) {
	root, err := m.workspaces.Resolve(w)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	identity, err := m.workspaces.Identity(ctx, w)
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--is-inside-work-tree")
	identity.Apply(cmd)
	cmd.Env = identity.Env(root)
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) != "true" {
		return "", ErrNotRepo
	}
	return root, nil
}

func (m *Manager) Status(ctx context.Context, w *store.Workspace) (*Status, error) {
	root, err := m.root(w)
	if err != nil {
		return nil, err
	}
	out, err := m.run(ctx, w, root, "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	st := &Status{Files: []FileStatus{}}
	fields := strings.Split(out, "\x00")
	for i := 0; i < len(fields); i++ {
		f := fields[i]
		if f == "" {
			continue
		}
		if strings.HasPrefix(f, "## ") {
			parseBranchHeader(st, strings.TrimPrefix(f, "## "))
			continue
		}
		if len(f) < 4 {
			continue
		}
		fs := FileStatus{Index: string(f[0]), Worktree: string(f[1]), Path: f[3:]}
		if fs.Index == "R" || fs.Index == "C" || fs.Worktree == "R" || fs.Worktree == "C" {
			if i+1 < len(fields) {
				fs.OrigPath = fields[i+1]
				i++
			}
		}
		st.Files = append(st.Files, fs)
	}
	return st, nil
}

func parseBranchHeader(st *Status, h string) {
	if strings.HasPrefix(h, "HEAD (no branch)") {
		st.Detached = true
		return
	}
	if strings.HasPrefix(h, "No commits yet on ") {
		st.Branch = strings.TrimPrefix(h, "No commits yet on ")
		return
	}
	name := h
	if idx := strings.Index(name, "..."); idx >= 0 {
		name = name[:idx]
	}
	if idx := strings.Index(name, " ["); idx >= 0 {
		name = name[:idx]
	}
	st.Branch = strings.TrimSpace(name)
	if match := trackRe.FindStringSubmatch(h); len(match) == 2 {
		for _, part := range strings.Split(match[1], ",") {
			part = strings.TrimSpace(part)
			if strings.HasPrefix(part, "ahead ") {
				_, _ = fmt.Sscanf(part, "ahead %d", &st.Ahead)
			}
			if strings.HasPrefix(part, "behind ") {
				_, _ = fmt.Sscanf(part, "behind %d", &st.Behind)
			}
		}
	}
}

func (m *Manager) Diff(ctx context.Context, w *store.Workspace, rel string, cached bool) (string, error) {
	root, err := m.root(w)
	if err != nil {
		return "", err
	}
	args := []string{"diff", "--no-color", "--no-ext-diff", "--no-textconv"}
	if cached {
		args = append(args, "--cached")
	}
	args = append(args, "--")
	if rel != "" {
		p, err := safePath(rel)
		if err != nil {
			return "", err
		}
		args = append(args, p)
	}
	return m.run(ctx, w, root, args...)
}

func (m *Manager) Stage(ctx context.Context, w *store.Workspace, rel string) error {
	root, err := m.root(w)
	if err != nil {
		return err
	}
	args := []string{"add", "--"}
	if rel == "" {
		args = append(args, ".")
	} else {
		p, err := safePath(rel)
		if err != nil {
			return err
		}
		args = append(args, p)
	}
	_, err = m.run(ctx, w, root, args...)
	return err
}

func (m *Manager) Unstage(ctx context.Context, w *store.Workspace, rel string) error {
	root, err := m.root(w)
	if err != nil {
		return err
	}
	args := []string{"restore", "--staged", "--"}
	if rel == "" {
		args = append(args, ".")
	} else {
		p, err := safePath(rel)
		if err != nil {
			return err
		}
		args = append(args, p)
	}
	_, err = m.run(ctx, w, root, args...)
	return err
}

func (m *Manager) Commit(ctx context.Context, w *store.Workspace, message, authorName, authorEmail string) (string, error) {
	root, err := m.root(w)
	if err != nil {
		return "", err
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return "", errors.New("commit message is required")
	}
	if len(message) > 5000 {
		return "", errors.New("commit message is too long")
	}
	if authorName == "" {
		authorName = "Goland User"
	}
	if authorEmail == "" {
		authorEmail = "user@goland.local"
	}
	args := []string{"-c", "user.name=" + authorName, "-c", "user.email=" + authorEmail,
		"commit", "--no-gpg-sign", "-m", message}
	return m.run(ctx, w, root, args...)
}

func (m *Manager) Log(ctx context.Context, w *store.Workspace) (string, error) {
	root, err := m.root(w)
	if err != nil {
		return "", err
	}
	return m.run(ctx, w, root, "log", "--oneline", "--decorate", "-n", "30")
}

func (m *Manager) Branches(ctx context.Context, w *store.Workspace) ([]Branch, error) {
	root, err := m.root(w)
	if err != nil {
		return nil, err
	}
	out, err := m.run(ctx, w, root, "branch", "--format=%(refname:short)")
	if err != nil {
		return nil, err
	}
	current, _ := m.run(ctx, w, root, "rev-parse", "--abbrev-ref", "HEAD")
	current = strings.TrimSpace(current)
	var branches []Branch
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		branches = append(branches, Branch{Name: line, Current: line == current})
	}
	return branches, nil
}

func (m *Manager) CreateBranch(ctx context.Context, w *store.Workspace, branch string) error {
	root, err := m.root(w)
	if err != nil {
		return err
	}
	if branch == "" || strings.HasPrefix(branch, "-") || strings.ContainsAny(branch, " \t\n\r\x00") {
		return errors.New("invalid branch name")
	}
	_, err = m.run(ctx, w, root, "switch", "-c", branch)
	return err
}

func (m *Manager) Checkout(ctx context.Context, w *store.Workspace, branch string) error {
	root, err := m.root(w)
	if err != nil {
		return err
	}
	if branch == "" || strings.HasPrefix(branch, "-") || strings.ContainsAny(branch, " \t\n\r\x00") {
		return errors.New("invalid branch name")
	}
	_, err = m.run(ctx, w, root, "switch", "--", branch)
	return err
}

func (m *Manager) Pull(ctx context.Context, w *store.Workspace) (string, error) {
	root, err := m.root(w)
	if err != nil {
		return "", err
	}
	return m.run(ctx, w, root, "pull", "--ff-only")
}

func (m *Manager) Push(ctx context.Context, w *store.Workspace) (string, error) {
	root, err := m.root(w)
	if err != nil {
		return "", err
	}
	// Never force-push: this is intentionally a plain push.
	return m.run(ctx, w, root, "push", "origin", "HEAD")
}

func (m *Manager) run(ctx context.Context, w *store.Workspace, root string, args ...string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("empty git command")
	}
	runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	identity, err := m.workspaces.Identity(ctx, w)
	if err != nil {
		return "", fmt.Errorf("prepare workspace user: %w", err)
	}
	cmd := exec.CommandContext(runCtx, "git", append([]string{"-C", root}, args...)...)
	identity.Apply(cmd)
	token, _ := m.workspaces.Token(w)
	cmd.Env = gitEnv(identity.Env(root), token)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if token != "" {
		text = strings.ReplaceAll(text, token, "[REDACTED]")
	}
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		return text, fmt.Errorf("git %s: %s", args[0], text)
	}
	if len(text) > 2<<20 {
		text = text[:2<<20] + "\n… output truncated"
	}
	return text, nil
}

func safePath(rel string) (string, error) {
	if strings.ContainsRune(rel, 0) || strings.Contains(rel, "\\") || filepath.IsAbs(rel) {
		return "", errors.New("invalid path")
	}
	clean := filepath.ToSlash(filepath.Clean(rel))
	if clean == ".." || strings.HasPrefix(clean, "../") || clean == ".git" || strings.HasPrefix(clean, ".git/") {
		return "", errors.New("invalid path")
	}
	if strings.HasPrefix(clean, "-") {
		return "", errors.New("invalid path")
	}
	return clean, nil
}

func gitEnv(base []string, token string) []string {
	env := append([]string{}, base...)
	env = append(env, "GIT_TERMINAL_PROMPT=0")
	if token != "" {
		header := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:"+token))
		env = append(env,
			"GIT_CONFIG_COUNT=1",
			"GIT_CONFIG_KEY_0=http.extraHeader",
			"GIT_CONFIG_VALUE_0="+header,
		)
	}
	return env
}
