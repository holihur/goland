package files

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"goland/internal/store"
)

const (
	SearchLimitDefault = 200
	SearchLimitMax     = 1000
	SearchTextMax      = 500
)

type ContentOptions struct {
	Query         string
	Replacement   string
	Path          string
	Regex         bool
	CaseSensitive bool
	Limit         int
}

type ContentMatch struct {
	Path      string `json:"path"`
	Line      int    `json:"line"`
	Column    int    `json:"column"`
	EndColumn int    `json:"endColumn"`
	Text      string `json:"text"`
}

type ContentSearchResult struct {
	Matches   []ContentMatch `json:"matches"`
	Files     int            `json:"files"`
	Truncated bool           `json:"truncated"`
}

type ContentReplaceResult struct {
	ChangedFiles []string `json:"changedFiles"`
	Replacements int      `json:"replacements"`
}

func (m *Manager) ContentSearch(w *store.Workspace, opts ContentOptions) (*ContentSearchResult, error) {
	pattern, err := compileSearch(opts)
	if err != nil {
		return nil, err
	}
	limit := opts.Limit
	if limit <= 0 || limit > SearchLimitMax {
		limit = SearchLimitDefault
	}
	root, err := m.workspaces.Resolve(w)
	if err != nil {
		return nil, err
	}
	result := &ContentSearchResult{Matches: []ContentMatch{}}
	seenFiles := map[string]bool{}
	err = walkSearchFiles(w, m, root, opts.Path, func(rel, full string) error {
		if len(result.Matches) >= limit {
			result.Truncated = true
			return fs.SkipAll
		}
		data, ok := readSearchFile(full)
		if !ok {
			return nil
		}
		for lineNumber, line := range strings.Split(string(data), "\n") {
			if len(result.Matches) >= limit {
				result.Truncated = true
				return fs.SkipAll
			}
			line = strings.TrimSuffix(line, "\r")
			for _, loc := range pattern.FindAllStringIndex(line, -1) {
				result.Matches = append(result.Matches, ContentMatch{
					Path:      rel,
					Line:      lineNumber + 1,
					Column:    utf8.RuneCountInString(line[:loc[0]]) + 1,
					EndColumn: utf8.RuneCountInString(line[:loc[1]]) + 1,
					Text:      truncateRunes(line, SearchTextMax),
				})
				seenFiles[rel] = true
				if len(result.Matches) >= limit {
					result.Truncated = true
					return fs.SkipAll
				}
			}
		}
		return nil
	})
	result.Files = len(seenFiles)
	return result, err
}

func (m *Manager) ContentReplace(w *store.Workspace, opts ContentOptions) (*ContentReplaceResult, error) {
	pattern, err := compileSearch(opts)
	if err != nil {
		return nil, err
	}
	root, err := m.workspaces.Resolve(w)
	if err != nil {
		return nil, err
	}
	result := &ContentReplaceResult{ChangedFiles: []string{}}
	err = walkSearchFiles(w, m, root, opts.Path, func(rel, full string) error {
		data, ok := readSearchFile(full)
		if !ok {
			return nil
		}
		text := string(data)
		matches := pattern.FindAllStringIndex(text, -1)
		if len(matches) == 0 {
			return nil
		}
		next := pattern.ReplaceAllString(text, opts.Replacement)
		if next == text {
			return nil
		}
		if _, err := m.Write(w, rel, next, ""); err != nil {
			return err
		}
		result.ChangedFiles = append(result.ChangedFiles, rel)
		result.Replacements += len(matches)
		return nil
	})
	sort.Strings(result.ChangedFiles)
	return result, err
}

func compileSearch(opts ContentOptions) (*regexp.Regexp, error) {
	query := strings.TrimSpace(opts.Query)
	if query == "" {
		return nil, ErrInvalidQuery
	}
	expr := regexp.QuoteMeta(query)
	if opts.Regex {
		expr = query
	}
	prefix := ""
	if !opts.CaseSensitive {
		prefix = "(?i)"
	}
	pattern, err := regexp.Compile(prefix + expr)
	if err != nil {
		return nil, ErrInvalidQuery
	}
	return pattern, nil
}

func walkSearchFiles(w *store.Workspace, m *Manager, root, scope string, visit func(rel, full string) error) error {
	start := root
	if strings.TrimSpace(scope) != "" {
		resolved, err := m.Resolve(w, scope)
		if err != nil {
			return err
		}
		start = resolved
	}
	info, err := os.Stat(start)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		rel, err := filepath.Rel(root, start)
		if err != nil {
			return err
		}
		return visit(filepath.ToSlash(rel), start)
	}
	return filepath.WalkDir(start, func(full string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if full != start && searchSkipDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		rel, err := filepath.Rel(root, full)
		if err != nil {
			return nil
		}
		return visit(filepath.ToSlash(rel), full)
	})
}

var searchSkipDirs = map[string]bool{
	".git": true, ".next": true, ".cache": true, "node_modules": true,
	"dist": true, "build": true, "target": true, "vendor": true, "coverage": true,
}

func readSearchFile(full string) ([]byte, bool) {
	info, err := os.Stat(full)
	if err != nil || info.IsDir() || info.Size() > MaxFileSize {
		return nil, false
	}
	data, err := os.ReadFile(full)
	if err != nil || isBinary(data) {
		return nil, false
	}
	return data, true
}

func truncateRunes(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max]) + "…"
}
