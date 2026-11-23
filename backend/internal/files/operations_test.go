package files

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
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
		MasterKey: bytes.Repeat([]byte{6}, 32),
	}
	wm, err := workspace.New(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	return New(wm), &store.Workspace{RootPath: root}, root
}

func TestListAndRead(t *testing.T) {
	m, w, root := testManager(t)
	if err := os.MkdirAll(filepath.Join(root, "dir", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"b.txt": "b", "A.txt": "a", ".DS_Store": "x", "dir/nested/x.go": "package x\n"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, ".git"), []byte("git"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("A.txt", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}

	entries, err := m.List(w, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 4 {
		t.Fatalf("entries: %#v", entries)
	}
	if entries[0].Name != "dir" || entries[0].Type != "dir" {
		t.Fatalf("directories should sort first: %#v", entries)
	}
	var linkType string
	for _, entry := range entries {
		if entry.Name == "link" {
			linkType = entry.Type
		}
	}
	if linkType != "symlink" {
		t.Fatalf("link type: %q", linkType)
	}

	content, err := m.Read(w, "A.txt")
	if err != nil || content.Content != "a" || content.Binary || content.ETag == "" {
		t.Fatalf("Read: %#v %v", content, err)
	}
	if _, err := m.Read(w, "dir"); !errors.Is(err, ErrIsDirectory) {
		t.Fatalf("read dir: %v", err)
	}
	if _, err := m.Read(w, "missing"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("read missing: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "binary"), []byte{'a', 0, 'b'}, 0o644); err != nil {
		t.Fatal(err)
	}
	if content, err := m.Read(w, "binary"); err != nil || !content.Binary || content.Content != "" {
		t.Fatalf("binary read: %#v %v", content, err)
	}
	if err := os.WriteFile(filepath.Join(root, "large"), bytes.Repeat([]byte("x"), MaxFileSize+1), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Read(w, "large"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large read: %v", err)
	}
}

func TestWriteConflictAndModes(t *testing.T) {
	m, w, root := testManager(t)
	created, err := m.Write(w, "dir/new.txt", "one", "")
	if err != nil || created.Content != "one" {
		t.Fatalf("create: %#v %v", created, err)
	}
	if info, err := os.Stat(filepath.Join(root, "dir", "new.txt")); err != nil || info.Mode().Perm() != 0o644 {
		t.Fatalf("mode: %v", err)
	}
	updated, err := m.Write(w, "dir/new.txt", "two", created.ETag)
	if err != nil || updated.Content != "two" {
		t.Fatalf("update: %#v %v", updated, err)
	}
	if _, err := m.Write(w, "dir/new.txt", "three", created.ETag); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflict: %v", err)
	}
	if _, err := m.Write(w, "dir/new.txt", "three", ""); err != nil {
		t.Fatalf("unconditional write: %v", err)
	}
	if err := os.Chmod(filepath.Join(root, "dir", "new.txt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Write(w, "dir/new.txt", "four", ""); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(filepath.Join(root, "dir", "new.txt")); info.Mode().Perm() != 0o600 {
		t.Fatalf("mode should be preserved: %v", info.Mode())
	}
	if _, err := m.Write(w, "dir", "x", ""); !errors.Is(err, ErrIsDirectory) {
		t.Fatalf("write dir: %v", err)
	}
	if _, err := m.Write(w, "big", strings.Repeat("x", MaxFileSize+1), ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("write large: %v", err)
	}
}

func TestCreateRenameDelete(t *testing.T) {
	m, w, root := testManager(t)
	file, err := m.Create(w, "a/b.txt", "file")
	if err != nil || file.Type != "file" {
		t.Fatalf("create file: %#v %v", file, err)
	}
	dir, err := m.Create(w, "a/sub", "dir")
	if err != nil || dir.Type != "dir" {
		t.Fatalf("create dir: %#v %v", dir, err)
	}
	if _, err := m.Create(w, "a/b.txt", "file"); !errors.Is(err, ErrConflict) {
		t.Fatalf("create existing: %v", err)
	}
	if err := m.Rename(w, "a/b.txt", "a/c.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "a", "c.txt")); err != nil {
		t.Fatal(err)
	}
	if err := m.Rename(w, "a/c.txt", "a/sub"); !errors.Is(err, ErrConflict) {
		t.Fatalf("rename onto existing: %v", err)
	}
	if err := m.Rename(w, "missing", "x"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rename missing: %v", err)
	}
	if err := m.Delete(w, "a/sub", false); err == nil {
		t.Fatal("non-recursive dir delete should fail")
	}
	if err := m.Delete(w, "a/sub", true); err != nil {
		t.Fatal(err)
	}
	if err := m.Delete(w, "a/c.txt", false); err != nil {
		t.Fatal(err)
	}
	if err := m.Delete(w, "missing", false); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("delete missing: %v", err)
	}
}

func TestSearch(t *testing.T) {
	m, w, root := testManager(t)
	for name := range map[string]bool{"alpha.go": true, "beta.go": true, "docs/readme.md": true, "node_modules/hidden/alpha.go": true, "dist/alpha.js": true} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	results, err := m.Search(w, " ALPHA ", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || !strings.Contains(results[0].Path, "alpha") {
		t.Fatalf("search limit: %#v", results)
	}
	all, err := m.Search(w, ".go", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("search should skip vendor dirs: %#v", all)
	}
	empty, err := m.Search(w, "   ", 10)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty query: %#v %v", empty, err)
	}
}

func TestResolveAndHelpers(t *testing.T) {
	m, w, root := testManager(t)
	if got, err := m.Root(w); err != nil || got != root {
		t.Fatalf("Root: %q %v", got, err)
	}
	if got, err := m.Resolve(w, ""); err != nil || got != root {
		t.Fatalf("Resolve: %q %v", got, err)
	}
	if _, err := m.Resolve(w, "../x"); !errors.Is(err, ErrPathEscape) {
		t.Fatalf("escape: %v", err)
	}
	if !isBinary(nil) == false || !isBinary([]byte{0xff}) {
		t.Fatal("binary detection")
	}
}

func TestRootErrors(t *testing.T) {
	m, w, root := testManager(t)
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	if _, err := m.List(w, ""); err == nil {
		t.Fatal("missing root should fail")
	}
	w.RootPath = filepath.Join(root, "missing")
	if _, err := m.Root(w); err == nil {
		t.Fatal("missing workspace should fail")
	}
}
