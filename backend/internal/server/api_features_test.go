package server_test

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContentSearchAndReplaceAPI(t *testing.T) {
	f := newExtraFixture(t)
	if err := os.WriteFile(filepath.Join(f.wsDir, "util.go"), []byte("package main\n\nfunc helper() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resp := f.member.do(http.MethodGet, f.path("/search/content?q=helper&caseSensitive=true"), nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("content search: %d %s", resp.StatusCode, readBody(resp))
	}
	var result struct {
		Matches []struct {
			Path string `json:"path"`
			Line int    `json:"line"`
		} `json:"matches"`
		Files int `json:"files"`
	}
	decode(t, resp, &result)
	if len(result.Matches) != 1 || result.Matches[0].Path != "util.go" || result.Matches[0].Line != 3 || result.Files != 1 {
		t.Fatalf("content search result: %#v", result)
	}
	resp = f.member.do(http.MethodGet, f.path("/search/content?q=%28&regex=true"), nil, false)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid regex: %d", resp.StatusCode)
	}
	readBody(resp)

	resp = f.member.do(http.MethodPost, f.path("/search/replace"), map[string]any{
		"query": "helper", "replacement": "renamed", "caseSensitive": true,
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("replace: %d %s", resp.StatusCode, readBody(resp))
	}
	var replaced struct {
		ChangedFiles []string `json:"changedFiles"`
		Replacements int      `json:"replacements"`
	}
	decode(t, resp, &replaced)
	if replaced.Replacements != 1 || len(replaced.ChangedFiles) != 1 || replaced.ChangedFiles[0] != "util.go" {
		t.Fatalf("replace result: %#v", replaced)
	}
	data, err := os.ReadFile(filepath.Join(f.wsDir, "util.go"))
	if err != nil || !strings.Contains(string(data), "func renamed()") {
		t.Fatalf("replaced file: %s %v", data, err)
	}
}

func TestTestDiscoveryAndRunAPI(t *testing.T) {
	f := newExtraFixture(t)
	if err := os.WriteFile(filepath.Join(f.wsDir, "go.mod"), []byte("module example.test/project\n\ngo 1.22\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	testFile := "package main\n\nimport \"testing\"\n\nfunc TestAPI(t *testing.T) {}\n"
	if err := os.WriteFile(filepath.Join(f.wsDir, "main_test.go"), []byte(testFile), 0o644); err != nil {
		t.Fatal(err)
	}
	resp := f.member.do(http.MethodGet, f.path("/tests"), nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list tests: %d %s", resp.StatusCode, readBody(resp))
	}
	var discovery struct {
		Tests []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Path string `json:"path"`
			Line int    `json:"line"`
			Kind string `json:"kind"`
		} `json:"tests"`
	}
	decode(t, resp, &discovery)
	if len(discovery.Tests) != 1 || discovery.Tests[0].Name != "TestAPI" || discovery.Tests[0].Path != "main_test.go" || discovery.Tests[0].Line != 5 {
		t.Fatalf("discovered tests: %#v", discovery.Tests)
	}
	item := discovery.Tests[0]
	resp = f.member.do(http.MethodPost, f.path("/tests/run"), map[string]any{
		"id": item.ID, "name": item.Name, "path": item.Path, "line": item.Line, "kind": item.Kind, "framework": "go",
	}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("run test: %d %s", resp.StatusCode, readBody(resp))
	}
	var result struct {
		Status string `json:"status"`
		Output string `json:"output"`
	}
	decode(t, resp, &result)
	if result.Status != "success" || !strings.Contains(result.Output, "PASS") {
		t.Fatalf("test result: %#v", result)
	}
	if resp := f.member.do(http.MethodPost, f.path("/tests/run"), map[string]any{"kind": "go", "path": "main.go", "name": "TestBad"}, true); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid test: %d", resp.StatusCode)
	} else {
		readBody(resp)
	}
}
