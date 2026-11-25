package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiscoverAndCommand(t *testing.T) {
	root := t.TempDir()
	write := func(name, content string) {
		full := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("go.mod", "module example\n")
	write("a_test.go", "package a\n\nfunc TestOne(t *testing.T) {}\nfunc TestMain(m *testing.M) {}\n")
	write("pkg/b_test.go", "package pkg\n\nfunc TestTwo(t *testing.T) {}\n")
	write("package.json", `{"devDependencies":{"vitest":"1"}}`)
	write("web/app.test.ts", "it('renders app', () => {})\n\ntest(\"works\", () => {})\n")
	write("node_modules/x.test.ts", "it('hidden', () => {})\n")

	discovery, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(discovery.Tests) != 4 {
		t.Fatalf("tests: %#v", discovery.Tests)
	}
	if len(discovery.Frameworks) != 2 || discovery.Frameworks[0] != "go" || discovery.Frameworks[1] != "vitest" {
		t.Fatalf("frameworks: %#v", discovery.Frameworks)
	}
	goItem := discovery.Tests[0]
	if goItem.Kind != "go" || goItem.Line != 3 {
		t.Fatalf("go item: %#v", goItem)
	}
	cmd, args, err := Command(root, goItem)
	if err != nil || cmd != "go" || strings.Join(args, " ") != "test . -run ^TestOne$ -count=1 -v" {
		t.Fatalf("go command: %s %v %v", cmd, args, err)
	}
	var js Item
	for _, item := range discovery.Tests {
		if item.Kind == "vitest" {
			js = item
			break
		}
	}
	cmd, args, err = Command(root, js)
	if err != nil || cmd != "pnpm" || !strings.Contains(strings.Join(args, " "), "vitest run") {
		t.Fatalf("vitest command: %s %v %v", cmd, args, err)
	}
	if _, _, err := Command(root, Item{Kind: "go", Path: "go.mod", Name: "TestBad"}); err == nil {
		t.Fatal("invalid go path should fail")
	}
	if _, _, err := Command(root, Item{Kind: "vitest", Path: "web/app.test.ts", Name: strings.Repeat("x", 501)}); err == nil {
		t.Fatal("long name should fail")
	}
}
