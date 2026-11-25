package tests

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var (
	goTestName = regexp.MustCompile(`(?m)^func\s+(Test[A-Za-z0-9_]+)\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s+\*testing\.T\s*\)`)
	jsTestName = regexp.MustCompile("(?m)^\\s*(?:it|test)\\s*\\(\\s*['\"`]([^'\"`\\n]+)['\"`]")
	testFile   = regexp.MustCompile(`\.(test|spec)\.(ts|tsx|js|jsx)$`)
)

type Item struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Line      int    `json:"line"`
	Kind      string `json:"kind"`
	Framework string `json:"framework"`
}

type Discovery struct {
	Tests      []Item   `json:"tests"`
	Frameworks []string `json:"frameworks"`
}

type Result struct {
	Status     string `json:"status"`
	ExitCode   int    `json:"exitCode"`
	Output     string `json:"output"`
	DurationMS int64  `json:"durationMs"`
}

var skipDirs = map[string]bool{
	".git": true, ".next": true, ".cache": true, "node_modules": true,
	"dist": true, "build": true, "target": true, "vendor": true, "coverage": true,
}

func Discover(root string) (*Discovery, error) {
	out := &Discovery{Tests: []Item{}, Frameworks: []string{}}
	seenFramework := map[string]bool{}
	hasVitest := detectVitest(root)
	hasGo := hasGoModule(root)
	if hasGo {
		out.Frameworks = append(out.Frameworks, "go")
		seenFramework["go"] = true
	}
	if hasVitest {
		out.Frameworks = append(out.Frameworks, "vitest")
		seenFramework["vitest"] = true
	}
	if len(out.Frameworks) == 0 {
		return out, nil
	}
	err := filepath.WalkDir(root, func(full string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if full != root && skipDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, full)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		switch {
		case hasGo && strings.HasSuffix(rel, "_test.go"):
			data, err := os.ReadFile(full)
			if err != nil {
				return nil
			}
			for _, match := range goTestName.FindAllStringSubmatchIndex(string(data), -1) {
				name := string(data[match[2]:match[3]])
				if name == "TestMain" {
					continue
				}
				out.Tests = append(out.Tests, Item{
					ID: "go:" + rel + ":" + name, Name: name, Path: rel,
					Line: lineAt(data, match[0]), Kind: "go", Framework: "go",
				})
			}
		case hasVitest && testFile.MatchString(rel):
			data, err := os.ReadFile(full)
			if err != nil {
				return nil
			}
			for _, match := range jsTestName.FindAllStringSubmatchIndex(string(data), -1) {
				name := strings.TrimSpace(string(data[match[2]:match[3]]))
				if name == "" {
					continue
				}
				out.Tests = append(out.Tests, Item{
					ID: "vitest:" + rel + ":" + name, Name: name, Path: rel,
					Line: lineAt(data, match[0]), Kind: "vitest", Framework: "vitest",
				})
			}
		}
		if len(out.Tests) >= 1000 {
			return fs.SkipAll
		}
		return nil
	})
	sort.Slice(out.Tests, func(i, j int) bool {
		if out.Tests[i].Path != out.Tests[j].Path {
			return out.Tests[i].Path < out.Tests[j].Path
		}
		return out.Tests[i].Line < out.Tests[j].Line
	})
	sort.Strings(out.Frameworks)
	return out, err
}

func Command(root string, item Item) (string, []string, error) {
	rel, err := safePath(item.Path)
	if err != nil {
		return "", nil, err
	}
	switch item.Kind {
	case "go":
		if !strings.HasSuffix(rel, "_test.go") {
			return "", nil, errors.New("not a Go test file")
		}
		if !regexp.MustCompile(`^[A-Za-z0-9_]+$`).MatchString(item.Name) || !strings.HasPrefix(item.Name, "Test") {
			return "", nil, errors.New("invalid Go test name")
		}
		dir := path.Dir(rel)
		target := "."
		if dir != "." {
			target = "./" + dir
		}
		return "go", []string{"test", target, "-run", "^" + item.Name + "$", "-count=1", "-v"}, nil
	case "vitest":
		if !testFile.MatchString(rel) {
			return "", nil, errors.New("not a Vitest test file")
		}
		if item.Name == "" || len(item.Name) > 500 {
			return "", nil, errors.New("invalid test name")
		}
		return "pnpm", []string{"exec", "vitest", "run", rel, "-t", item.Name, "--reporter=basic"}, nil
	default:
		return "", nil, errors.New("unknown test kind")
	}
}

func safePath(rel string) (string, error) {
	if rel == "" || strings.ContainsRune(rel, 0) || strings.Contains(rel, "\\") || filepath.IsAbs(rel) {
		return "", errors.New("invalid path")
	}
	clean := filepath.ToSlash(filepath.Clean(rel))
	if clean == ".." || strings.HasPrefix(clean, "../") || clean == ".git" || strings.HasPrefix(clean, ".git/") {
		return "", errors.New("invalid path")
	}
	return clean, nil
}

func lineAt(data []byte, offset int) int {
	if offset > len(data) {
		offset = len(data)
	}
	return strings.Count(string(data[:offset]), "\n") + 1
}

func hasGoModule(root string) bool {
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err == nil {
		return true
	}
	found := false
	_ = filepath.WalkDir(root, func(full string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if full != root && skipDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".go") {
			found = true
			return fs.SkipAll
		}
		return nil
	})
	return found
}

func detectVitest(root string) bool {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return false
	}
	var pkg struct {
		Scripts         map[string]string `json:"scripts"`
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if json.Unmarshal(data, &pkg) != nil {
		return false
	}
	if _, ok := pkg.Dependencies["vitest"]; ok {
		return true
	}
	if _, ok := pkg.DevDependencies["vitest"]; ok {
		return true
	}
	for _, script := range pkg.Scripts {
		if strings.Contains(script, "vitest") {
			return true
		}
	}
	return false
}
