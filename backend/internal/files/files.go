package files

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"goland/internal/store"
	"goland/internal/workspace"
)

var (
	ErrPathEscape   = errors.New("path escapes workspace")
	ErrProtected    = errors.New("path is protected")
	ErrIsDirectory  = errors.New("path is a directory")
	ErrNotDirectory = errors.New("path is not a directory")
	ErrConflict     = errors.New("file changed since it was read")
	ErrTooLarge     = errors.New("file is too large")
	ErrBinary       = errors.New("binary file")
	ErrInvalidQuery = errors.New("invalid search query")
)

const MaxFileSize = 5 << 20

type Manager struct {
	workspaces *workspace.Manager
}

type Entry struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Type       string    `json:"type"`
	Size       int64     `json:"size,omitempty"`
	ModifiedAt time.Time `json:"modifiedAt,omitempty"`
}

type Content struct {
	Path       string    `json:"path"`
	Content    string    `json:"content,omitempty"`
	ETag       string    `json:"etag,omitempty"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modifiedAt"`
	Binary     bool      `json:"binary"`
}

func New(wm *workspace.Manager) *Manager { return &Manager{workspaces: wm} }

func (m *Manager) Root(w *store.Workspace) (string, error) { return m.workspaces.Resolve(w) }

func (m *Manager) Resolve(w *store.Workspace, rel string) (string, error) {
	root, err := m.workspaces.Resolve(w)
	if err != nil {
		return "", err
	}
	return SecureJoin(root, rel)
}

func SecureJoin(root, rel string) (string, error) {
	if strings.ContainsRune(rel, 0) {
		return "", ErrPathEscape
	}
	rel = strings.TrimSpace(rel)
	if rel == "" || rel == "." || rel == "/" {
		return root, nil
	}
	if strings.Contains(rel, "\\") {
		return "", ErrPathEscape
	}
	if path.IsAbs(rel) {
		return "", ErrPathEscape
	}
	for _, part := range strings.Split(rel, "/") {
		if part == ".." || part == ".git" {
			if part == ".git" {
				return "", ErrProtected
			}
			return "", ErrPathEscape
		}
	}
	clean := path.Clean("/" + rel)
	clean = strings.TrimPrefix(clean, "/")
	target := filepath.Join(root, filepath.FromSlash(clean))

	// Resolve the deepest existing ancestor so a symlinked parent cannot
	// redirect reads or writes outside of the workspace.
	probe := target
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(probe)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			if !within(root, resolved) {
				return "", ErrPathEscape
			}
			return resolved, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			break
		}
		suffix = append(suffix, filepath.Base(probe))
		probe = parent
	}
	return "", fmt.Errorf("resolve path: %w", fs.ErrNotExist)
}

func (m *Manager) List(w *store.Workspace, rel string) ([]Entry, error) {
	dir, err := m.Resolve(w, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, ErrNotDirectory
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(entries))
	for _, de := range entries {
		name := de.Name()
		if name == ".git" || name == ".DS_Store" {
			continue
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		typ := "file"
		if de.IsDir() {
			typ = "dir"
		} else if info.Mode()&os.ModeSymlink != 0 {
			typ = "symlink"
		}
		out = append(out, Entry{
			Name: name, Path: path.Join(rel, name), Type: typ,
			Size: info.Size(), ModifiedAt: info.ModTime().UTC(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type == "dir"
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func (m *Manager) Read(w *store.Workspace, rel string) (*Content, error) {
	full, err := m.Resolve(w, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, ErrIsDirectory
	}
	if info.Size() > MaxFileSize {
		return nil, ErrTooLarge
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	binary := isBinary(data)
	out := &Content{
		Path: rel, Size: info.Size(), ModifiedAt: info.ModTime().UTC(),
		ETag: etag(data), Binary: binary,
	}
	if !binary {
		out.Content = string(data)
	}
	return out, nil
}

func (m *Manager) Write(w *store.Workspace, rel, content, expectedETag string) (*Content, error) {
	if len(content) > MaxFileSize {
		return nil, ErrTooLarge
	}
	full, err := m.Resolve(w, rel)
	if err != nil {
		return nil, err
	}
	if info, err := os.Stat(full); err == nil {
		if info.IsDir() {
			return nil, ErrIsDirectory
		}
		old, err := os.ReadFile(full)
		if err != nil {
			return nil, err
		}
		if expectedETag != "" && etag(old) != expectedETag {
			return nil, ErrConflict
		}
	}
	dir := filepath.Dir(full)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	mode := os.FileMode(0o644)
	if info, err := os.Stat(full); err == nil {
		mode = info.Mode().Perm()
	}
	tmp, err := os.CreateTemp(dir, ".goland-write-*")
	if err != nil {
		return nil, err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if _, err := tmp.WriteString(content); err != nil {
		_ = tmp.Close()
		return nil, err
	}
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		return nil, err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	if err := os.Rename(tmpName, full); err != nil {
		return nil, err
	}
	return m.Read(w, rel)
}

func (m *Manager) Create(w *store.Workspace, rel, kind string) (*Entry, error) {
	full, err := m.Resolve(w, rel)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(full); err == nil {
		return nil, ErrConflict
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return nil, err
	}
	typ := "file"
	if kind == "dir" {
		if err := os.Mkdir(full, 0o755); err != nil {
			return nil, err
		}
		typ = "dir"
	} else {
		f, err := os.OpenFile(full, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, err
		}
		if err := f.Close(); err != nil {
			return nil, err
		}
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	return &Entry{Name: filepath.Base(full), Path: rel, Type: typ, Size: info.Size(), ModifiedAt: info.ModTime().UTC()}, nil
}

func (m *Manager) Rename(w *store.Workspace, from, to string) error {
	src, err := m.Resolve(w, from)
	if err != nil {
		return err
	}
	dst, err := m.Resolve(w, to)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(dst); err == nil {
		return ErrConflict
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if _, err := os.Lstat(src); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

func (m *Manager) Delete(w *store.Workspace, rel string, recursive bool) error {
	full, err := m.Resolve(w, rel)
	if err != nil {
		return err
	}
	info, err := os.Lstat(full)
	if err != nil {
		return err
	}
	if info.IsDir() {
		if !recursive {
			return errors.New("directory delete requires recursive=true")
		}
		return os.RemoveAll(full)
	}
	return os.Remove(full)
}

func (m *Manager) Search(w *store.Workspace, query string, limit int) ([]Entry, error) {
	root, err := m.workspaces.Resolve(w)
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return []Entry{}, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	skip := map[string]bool{".git": true, "node_modules": true, "dist": true, ".next": true, "vendor": true}
	var out []Entry
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skip[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if strings.Contains(strings.ToLower(rel), query) {
			info, err := d.Info()
			if err == nil {
				out = append(out, Entry{Name: d.Name(), Path: rel, Type: "file", Size: info.Size(), ModifiedAt: info.ModTime().UTC()})
			}
			if len(out) >= limit {
				return fs.SkipAll
			}
		}
		return nil
	})
	return out, err
}

func within(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

func etag(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func isBinary(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	probe := data
	if len(probe) > 8192 {
		probe = probe[:8192]
	}
	if strings.IndexByte(string(probe), 0) >= 0 {
		return true
	}
	return !utf8.Valid(probe)
}
