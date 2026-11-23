package tasks

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func ids(list []Task) map[string]Task {
	out := make(map[string]Task, len(list))
	for _, task := range list {
		out[task.ID] = task
	}
	return out
}

func TestDiscoverGoAndPackageScripts(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "go.mod", "module example.com/app\n\ngo 1.22\n")
	write(t, dir, "main.go", "package main\n\nfunc main() {}\n")
	write(t, dir, "package.json", `{"scripts":{"test":"vitest","build":"vite build","bad name":"x","":"x","a:b-c_d":"x"}}`)

	list, err := Discover(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := ids(list)
	for _, want := range []string{"go:test", "go:build", "go:vet", "go:run", "pnpm:test", "pnpm:build", "pnpm:a:b-c_d"} {
		if _, ok := got[want]; !ok {
			t.Errorf("missing task %q in %#v", want, list)
		}
	}
	if _, ok := got["pnpm:bad name"]; ok {
		t.Error("invalid script name should be ignored")
	}
	if got["go:test"].Command != "go" || len(got["go:test"].Args) != 2 {
		t.Errorf("unexpected go task: %#v", got["go:test"])
	}
}

func TestDiscoverWithoutManifests(t *testing.T) {
	list, err := Discover(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("expected no tasks, got %#v", list)
	}
}

func TestHasGoModuleAndMainPackage(t *testing.T) {
	dir := t.TempDir()
	if hasGoModule(dir) {
		t.Fatal("empty dir should not have a module")
	}
	write(t, dir, "lib.go", "package lib\n")
	if !hasGoModule(dir) {
		t.Fatal("go source should count as a module")
	}
	if hasMainPackage(dir) {
		t.Fatal("library package should not count as main")
	}
	write(t, dir, "cmd/app/main.go", "\ufeffpackage main\n")
	if !hasMainPackage(dir) {
		t.Fatal("nested package main should be found")
	}
	write(t, dir, "node_modules/x/main.go", "package main\n")
	if !hasMainPackage(dir) {
		t.Fatal("skip dirs should not break discovery")
	}
}

func TestFind(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "go.mod", "module example.com/app\n")
	write(t, dir, "main.go", "package main\n")
	task, err := Find(dir, "go:build")
	if err != nil || task.ID != "go:build" {
		t.Fatalf("Find build: %#v %v", task, err)
	}
	if _, err := Find(dir, "missing"); !errors.Is(err, ErrTaskNotFound) {
		t.Fatalf("expected ErrTaskNotFound, got %v", err)
	}
}

func TestDiscoverIgnoresMalformedPackageJSON(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "package.json", "{")
	list, err := Discover(dir)
	if err != nil || len(list) != 0 {
		t.Fatalf("malformed package.json: %#v %v", list, err)
	}
}
