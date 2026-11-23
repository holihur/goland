package tasks

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var ErrTaskNotFound = errors.New("task not found")

type Task struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Kind    string   `json:"kind"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

type packageJSON struct {
	Scripts map[string]string `json:"scripts"`
}

var scriptName = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,80}$`)

func Discover(root string) ([]Task, error) {
	var out []Task
	if hasGoModule(root) {
		out = append(out,
			Task{ID: "go:test", Label: "go test ./...", Kind: "go", Command: "go", Args: []string{"test", "./..."}},
			Task{ID: "go:build", Label: "go build ./...", Kind: "go", Command: "go", Args: []string{"build", "./..."}},
			Task{ID: "go:vet", Label: "go vet ./...", Kind: "go", Command: "go", Args: []string{"vet", "./..."}},
		)
		if hasMainPackage(root) {
			out = append(out, Task{ID: "go:run", Label: "go run .", Kind: "go", Command: "go", Args: []string{"run", "."}})
		}
	}
	if data, err := os.ReadFile(filepath.Join(root, "package.json")); err == nil {
		var pkg packageJSON
		if json.Unmarshal(data, &pkg) == nil {
			names := make([]string, 0, len(pkg.Scripts))
			for name := range pkg.Scripts {
				if scriptName.MatchString(name) {
					names = append(names, name)
				}
			}
			sort.Strings(names)
			for _, name := range names {
				out = append(out, Task{
					ID: "pnpm:" + name, Label: "pnpm run " + name, Kind: "pnpm",
					Command: "pnpm", Args: []string{"run", name},
				})
			}
		}
	}
	return out, nil
}

func Find(root, id string) (*Task, error) {
	list, err := Discover(root)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == id {
			return &list[i], nil
		}
	}
	return nil, ErrTaskNotFound
}

func hasGoModule(root string) bool {
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err == nil {
		return true
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".go") {
			return true
		}
	}
	return false
}

func hasMainPackage(root string) bool {
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == "node_modules" || name == "vendor" || name == "dist" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".go") || strings.HasSuffix(d.Name(), "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err == nil && strings.HasPrefix(strings.TrimSpace(strings.TrimPrefix(string(data), "\ufeff")), "package main") {
			return errors.New("found")
		}
		return nil
	})
	return err != nil && err.Error() == "found"
}
