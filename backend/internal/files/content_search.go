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
	query := strings.TrimSpace(opts.Query)
	literal := !opts.Regex
	needle := query
	if literal && !opts.CaseSensitive {
		needle = strings.ToLower(needle)
	}
	literalASCII := literal && asciiOnly(needle)
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
		text := string(data)
		lineNumber := 0
		for start := 0; start <= len(text); {
			end := strings.IndexByte(text[start:], '\n')
			if end < 0 {
				end = len(text)
			} else {
				end += start
			}
			lineNumber++
			line := strings.TrimSuffix(text[start:end], "\r")
			var offsets [][2]int
			if literalASCII && asciiOnly(line) {
				hay := line
				if !opts.CaseSensitive {
					hay = strings.ToLower(line)
				}
				offset := 0
				for offset <= len(hay) {
					index := strings.Index(hay[offset:], needle)
					if index < 0 {
						break
					}
					from := offset + index
					offsets = append(offsets, [2]int{from, from + len(needle)})
					offset = from + len(needle)
				}
			} else {
				for _, loc := range pattern.FindAllStringIndex(line, -1) {
					offsets = append(offsets, [2]int{loc[0], loc[1]})
				}
			}
			for _, loc := range offsets {
				result.Matches = append(result.Matches, ContentMatch{
					Path:      rel,
					Line:      lineNumber,
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
			if end == len(text) {
				break
			}
			start = end + 1
		}
		return nil
	})
	result.Files = len(seenFiles)
	return result, err
}

func asciiOnly(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
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
