package files

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContentSearchAndReplace(t *testing.T) {
	m, w, root := testManager(t)
	files := map[string]string{
		"main.go":              "package main\n\nfunc Foo() {}\n// foo bar\n",
		"src/util.go":          "package src\n\nfunc FooHelper() {}\n",
		"node_modules/skip.go": "func Foo() {}\n",
		"binary.bin":           "foo\x00bar",
	}
	for name, content := range files {
		full := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	result, err := m.ContentSearch(w, ContentOptions{Query: "foo"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 3 || result.Files != 2 || result.Truncated {
		t.Fatalf("case-insensitive search: %#v", result)
	}
	if result.Matches[0].Path != "main.go" || result.Matches[0].Line != 3 || result.Matches[0].Column != 6 {
		t.Fatalf("first match: %#v", result.Matches[0])
	}
	if result.Matches[3-1].Text == "" {
		t.Fatal("expected matching line text")
	}

	exact, err := m.ContentSearch(w, ContentOptions{Query: "Foo", CaseSensitive: true, Path: "src"})
	if err != nil || len(exact.Matches) != 1 || exact.Matches[0].Path != "src/util.go" {
		t.Fatalf("scoped search: %#v %v", exact, err)
	}

	re, err := m.ContentSearch(w, ContentOptions{Query: `Foo\w*`, Regex: true, CaseSensitive: true})
	if err != nil || len(re.Matches) != 2 {
		t.Fatalf("regex search: %#v %v", re, err)
	}

	if _, err := m.ContentSearch(w, ContentOptions{Query: "(", Regex: true}); err != ErrInvalidQuery {
		t.Fatalf("invalid regex: %v", err)
	}
	if _, err := m.ContentSearch(w, ContentOptions{Query: "   "}); err != ErrInvalidQuery {
		t.Fatalf("empty query: %v", err)
	}

	limit, err := m.ContentSearch(w, ContentOptions{Query: "foo", Limit: 1})
	if err != nil || len(limit.Matches) != 1 || !limit.Truncated {
		t.Fatalf("limit: %#v %v", limit, err)
	}

	replaced, err := m.ContentReplace(w, ContentOptions{Query: "Foo", Replacement: "Bar", CaseSensitive: true})
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Replacements != 2 || len(replaced.ChangedFiles) != 2 {
		t.Fatalf("replace result: %#v", replaced)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "main.go")); !strings.Contains(string(got), "Bar()") || strings.Contains(string(got), "Foo()") {
		t.Fatalf("replace main.go: %s", got)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "node_modules/skip.go")); !strings.Contains(string(got), "Foo()") {
		t.Fatalf("skipped dir should be unchanged: %s", got)
	}
}
