// Package plugins defines the plugin manifest, host protocol and lifecycle
// primitives used by the Goland plugin system.
package plugins

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// APIVersion is the manifest/protocol version understood by this server.
const APIVersion = 1

// ManifestFileName is the required file at the root of an installed package.
const ManifestFileName = "manifest.json"

const (
	MaxManifestBytes = 256 << 10
	MaxCommands      = 100
	MaxPanels        = 20
	MaxStatusItems   = 20
	MaxSettingsViews = 20
	MaxEditorActions = 50
	MaxMenus         = 20
	MaxMenuItems     = 100
	MaxKeybindings   = 100
	MaxLanguages     = 20
	MaxDebuggers     = 10
	MaxFrontends     = 20
	MaxFields        = 50
	MaxOptions       = 100
)

var (
	idPattern     = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`)
	semverPattern = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
	kindPattern   = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`)
	fieldPattern  = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]{0,63}$`)
)

// Manifest is the declarative description of a plugin package.
type Manifest struct {
	APIVersion  int           `json:"apiVersion"`
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Version     string        `json:"version"`
	Description string        `json:"description,omitempty"`
	Homepage    string        `json:"homepage,omitempty"`
	Icon        string        `json:"icon,omitempty"`
	Executable  string        `json:"executable"`
	Contributes Contributions `json:"contributes"`
}

// Contributions lists every extension point exposed by a plugin.
type Contributions struct {
	Commands      []Command      `json:"commands,omitempty"`
	Panels        []Panel        `json:"panels,omitempty"`
	Status        []StatusItem   `json:"status,omitempty"`
	Settings      []SettingsView `json:"settings,omitempty"`
	Hooks         Hooks          `json:"hooks,omitempty"`
	EditorActions []EditorAction `json:"editorActions,omitempty"`
	Menus         []Menu         `json:"menus,omitempty"`
	Keybindings   []Keybinding   `json:"keybindings,omitempty"`
	Languages     []Language     `json:"languages,omitempty"`
	Debuggers     []Debugger     `json:"debuggers,omitempty"`
	Frontends     []Frontend     `json:"frontends,omitempty"`
}

// Command is an executable action contributed to the command palette.
type Command struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Category    string   `json:"category,omitempty"`
	Args        []string `json:"args,omitempty"`
}

// Menu contributes entries to a named IDE menu. Built-in menu ids are file,
// edit, view, run, tools and help; unknown ids create a plugin menu.
type Menu struct {
	ID    string     `json:"id"`
	Label string     `json:"label"`
	Items []MenuItem `json:"items"`
}

// MenuItem places a command in a menu. Group controls the label shown before
// the item in the menu dropdown.
type MenuItem struct {
	Command string `json:"command"`
	Label   string `json:"label,omitempty"`
	Group   string `json:"group,omitempty"`
}

// Keybinding is a default keyboard shortcut for a contributed command. Users
// can override it from the command center.
type Keybinding struct {
	Command string `json:"command"`
	Key     string `json:"key"`
}

// Panel is a declarative sidebar view. The frontend only renders predefined
// field types; no plugin JavaScript is executed.
type Panel struct {
	ID      string        `json:"id"`
	Title   string        `json:"title"`
	Icon    string        `json:"icon,omitempty"`
	Fields  []Field       `json:"fields,omitempty"`
	Actions []PanelAction `json:"actions,omitempty"`
}

// PanelAction is a button rendered in a panel and bound to a command.
type PanelAction struct {
	ID      string         `json:"id"`
	Label   string         `json:"label"`
	Command string         `json:"command"`
	Args    map[string]any `json:"args,omitempty"`
}

// StatusItem is a status bar entry. Plugins can update Text/Tooltip at runtime.
type StatusItem struct {
	ID      string `json:"id"`
	Text    string `json:"text"`
	Tooltip string `json:"tooltip,omitempty"`
	Command string `json:"command,omitempty"`
}

// SettingsView is a declarative settings form for plugin configuration.
type SettingsView struct {
	ID     string  `json:"id"`
	Title  string  `json:"title"`
	Fields []Field `json:"fields"`
}

// Field is a form field shared by panels and settings.
type Field struct {
	Key         string   `json:"key"`
	Type        string   `json:"type"`
	Label       string   `json:"label"`
	Placeholder string   `json:"placeholder,omitempty"`
	Help        string   `json:"help,omitempty"`
	Required    bool     `json:"required,omitempty"`
	Default     any      `json:"default,omitempty"`
	Options     []Option `json:"options,omitempty"`
	Min         *float64 `json:"min,omitempty"`
	Max         *float64 `json:"max,omitempty"`
}

// Option is a select option.
type Option struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// EditorAction is a command scoped to the active editor selection.
type EditorAction struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Command string `json:"command"`
}

// Hooks are optional command bindings invoked by the host.
type Hooks struct {
	OnOpen    *Hook `json:"onOpen,omitempty"`
	OnSave    *Hook `json:"onSave,omitempty"`
	PreCommit *Hook `json:"preCommit,omitempty"`
	PostPull  *Hook `json:"postPull,omitempty"`
}

// Hook binds a file/Git lifecycle event to a plugin command.
type Hook struct {
	Command string `json:"command"`
	// Failure is "open" (default for open/save/postPull) or "closed"
	// (default for preCommit). It controls what happens when the plugin fails.
	Failure string `json:"failure,omitempty"`
}

// Language registers file extensions and a plugin-provided LSP server.
type Language struct {
	ID         string   `json:"id"`
	Extensions []string `json:"extensions"`
	LanguageID string   `json:"languageId"`
	Server     Server   `json:"server"`
}

// Server describes a plugin-provided language/debug adapter process.
type Server struct {
	Command   string   `json:"command"`
	Args      []string `json:"args,omitempty"`
	Transport string   `json:"transport,omitempty"` // only "stdio" is supported
}

// Debugger registers a plugin-provided DAP adapter kind.
type Debugger struct {
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Server Server `json:"server"`
}

// Frontend is an ES module panel shipped with the plugin package. The module
// exports mount(container, api) and may return a cleanup function.
type Frontend struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Icon        string `json:"icon,omitempty"`
	Entry       string `json:"entry"`
	Description string `json:"description,omitempty"`
}

// HookKind identifies a lifecycle hook for failure-mode defaults.
type HookKind string

const (
	HookOpen      HookKind = "onOpen"
	HookSave      HookKind = "onSave"
	HookPreCommit HookKind = "preCommit"
	HookPostPull  HookKind = "postPull"
)

// FailureMode returns "open" or "closed" for a hook.
func (h *Hook) FailureMode(kind HookKind) string {
	if h == nil {
		return "open"
	}
	if h.Failure == "closed" {
		return "closed"
	}
	if h.Failure == "open" {
		return "open"
	}
	if kind == HookPreCommit {
		return "closed"
	}
	return "open"
}

// ParseManifest decodes and validates a manifest with strict unknown-field
// rejection and a byte limit.
func ParseManifest(data []byte) (*Manifest, error) {
	if len(data) == 0 {
		return nil, errors.New("manifest is empty")
	}
	if len(data) > MaxManifestBytes {
		return nil, fmt.Errorf("manifest exceeds %d bytes", MaxManifestBytes)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var m Manifest
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("decode manifest: %w", err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("manifest must contain a single JSON object")
	}
	if err := Validate(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

// LoadManifest reads and validates manifest.json inside dir.
func LoadManifest(dir string) (*Manifest, error) {
	data, err := os.ReadFile(filepath.Join(dir, ManifestFileName))
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	m, err := ParseManifest(data)
	if err != nil {
		return nil, err
	}
	if err := ValidatePackage(m, dir); err != nil {
		return nil, err
	}
	return m, nil
}

// Validate checks manifest structure, identifiers, contribution limits and
// cross-references. It does not touch the filesystem.
func Validate(m *Manifest) error {
	if m == nil {
		return errors.New("manifest is nil")
	}
	if m.APIVersion != APIVersion {
		return fmt.Errorf("unsupported apiVersion %d (host supports %d)", m.APIVersion, APIVersion)
	}
	if !idPattern.MatchString(m.ID) || len(m.ID) > 64 {
		return errors.New("id must match [a-z][a-z0-9]*([.-][a-z0-9]+)* and be at most 64 characters")
	}
	if strings.TrimSpace(m.Name) == "" || len(m.Name) > 100 {
		return errors.New("name is required and must be at most 100 characters")
	}
	if !semverPattern.MatchString(m.Version) {
		return fmt.Errorf("version %q is not valid semver", m.Version)
	}
	if m.Icon != "" && (!idPattern.MatchString(m.Icon) || len(m.Icon) > 40) {
		return errors.New("icon must be a lowercase identifier such as container or sparkles")
	}
	if err := validateRelativePath(m.Executable); err != nil {
		return fmt.Errorf("executable: %w", err)
	}

	c := &m.Contributes
	if len(c.Commands) > MaxCommands {
		return fmt.Errorf("too many commands (max %d)", MaxCommands)
	}
	if len(c.Panels) > MaxPanels {
		return fmt.Errorf("too many panels (max %d)", MaxPanels)
	}
	if len(c.Status) > MaxStatusItems {
		return fmt.Errorf("too many status items (max %d)", MaxStatusItems)
	}
	if len(c.Settings) > MaxSettingsViews {
		return fmt.Errorf("too many settings views (max %d)", MaxSettingsViews)
	}
	if len(c.EditorActions) > MaxEditorActions {
		return fmt.Errorf("too many editor actions (max %d)", MaxEditorActions)
	}
	if len(c.Menus) > MaxMenus {
		return fmt.Errorf("too many menus (max %d)", MaxMenus)
	}
	if len(c.Keybindings) > MaxKeybindings {
		return fmt.Errorf("too many keybindings (max %d)", MaxKeybindings)
	}
	if len(c.Languages) > MaxLanguages {
		return fmt.Errorf("too many languages (max %d)", MaxLanguages)
	}
	if len(c.Debuggers) > MaxDebuggers {
		return fmt.Errorf("too many debuggers (max %d)", MaxDebuggers)
	}
	if len(c.Frontends) > MaxFrontends {
		return fmt.Errorf("too many frontends (max %d)", MaxFrontends)
	}

	commands := make(map[string]bool, len(c.Commands))
	for i := range c.Commands {
		cmd := &c.Commands[i]
		if err := validateContributionID(m.ID, cmd.ID, "command"); err != nil {
			return err
		}
		if commands[cmd.ID] {
			return fmt.Errorf("duplicate command id %q", cmd.ID)
		}
		if strings.TrimSpace(cmd.Title) == "" || len(cmd.Title) > 120 {
			return fmt.Errorf("command %q title is required", cmd.ID)
		}
		if len(cmd.Category) > 60 {
			return fmt.Errorf("command %q category is too long", cmd.ID)
		}
		commands[cmd.ID] = true
	}

	menuIDs := make(map[string]bool, len(c.Menus))
	menuItems := 0
	for i := range c.Menus {
		menu := &c.Menus[i]
		if !idPattern.MatchString(menu.ID) || len(menu.ID) > 40 {
			return fmt.Errorf("menu %q id must be a lowercase identifier", menu.ID)
		}
		if menuIDs[menu.ID] {
			return fmt.Errorf("duplicate menu id %q", menu.ID)
		}
		if strings.TrimSpace(menu.Label) == "" || len(menu.Label) > 120 {
			return fmt.Errorf("menu %q label is required", menu.ID)
		}
		for _, item := range menu.Items {
			menuItems++
			if menuItems > MaxMenuItems {
				return fmt.Errorf("too many menu items (max %d)", MaxMenuItems)
			}
			if !commands[item.Command] {
				return fmt.Errorf("menu %q references unknown command %q", menu.ID, item.Command)
			}
			if len(item.Label) > 120 || len(item.Group) > 60 {
				return fmt.Errorf("menu %q item labels are too long", menu.ID)
			}
		}
		menuIDs[menu.ID] = true
	}

	bound := make(map[string]bool, len(c.Keybindings))
	for _, binding := range c.Keybindings {
		if !commands[binding.Command] {
			return fmt.Errorf("keybinding references unknown command %q", binding.Command)
		}
		key := strings.TrimSpace(binding.Key)
		if key == "" || len(key) > 80 || strings.ContainsAny(key, "\r\n") {
			return fmt.Errorf("keybinding for %q needs a valid key", binding.Command)
		}
		if bound[binding.Command] {
			return fmt.Errorf("duplicate keybinding for command %q", binding.Command)
		}
		bound[binding.Command] = true
	}

	panels := make(map[string]bool, len(c.Panels))
	for i := range c.Panels {
		p := &c.Panels[i]
		if err := validateContributionID(m.ID, p.ID, "panel"); err != nil {
			return err
		}
		if panels[p.ID] {
			return fmt.Errorf("duplicate panel id %q", p.ID)
		}
		if strings.TrimSpace(p.Title) == "" || len(p.Title) > 120 {
			return fmt.Errorf("panel %q title is required", p.ID)
		}
		if err := validateFields(p.ID, p.Fields); err != nil {
			return err
		}
		for _, action := range p.Actions {
			if strings.TrimSpace(action.ID) == "" || strings.TrimSpace(action.Label) == "" {
				return fmt.Errorf("panel %q action id and label are required", p.ID)
			}
			if !commands[action.Command] {
				return fmt.Errorf("panel %q action %q references unknown command %q", p.ID, action.ID, action.Command)
			}
		}
		panels[p.ID] = true
	}

	status := make(map[string]bool, len(c.Status))
	for i := range c.Status {
		item := &c.Status[i]
		if err := validateContributionID(m.ID, item.ID, "status"); err != nil {
			return err
		}
		if status[item.ID] {
			return fmt.Errorf("duplicate status id %q", item.ID)
		}
		if strings.TrimSpace(item.Text) == "" || len(item.Text) > 80 {
			return fmt.Errorf("status %q text is required", item.ID)
		}
		if item.Command != "" && !commands[item.Command] {
			return fmt.Errorf("status %q references unknown command %q", item.ID, item.Command)
		}
		status[item.ID] = true
	}

	for i := range c.Settings {
		view := &c.Settings[i]
		if err := validateContributionID(m.ID, view.ID, "settings view"); err != nil {
			return err
		}
		if strings.TrimSpace(view.Title) == "" || len(view.Title) > 120 {
			return fmt.Errorf("settings view %q title is required", view.ID)
		}
		if len(view.Fields) == 0 {
			return fmt.Errorf("settings view %q must declare fields", view.ID)
		}
		if err := validateFields(view.ID, view.Fields); err != nil {
			return err
		}
	}

	for i := range c.EditorActions {
		action := &c.EditorActions[i]
		if err := validateContributionID(m.ID, action.ID, "editor action"); err != nil {
			return err
		}
		if strings.TrimSpace(action.Title) == "" || len(action.Title) > 120 {
			return fmt.Errorf("editor action %q title is required", action.ID)
		}
		if !commands[action.Command] {
			return fmt.Errorf("editor action %q references unknown command %q", action.ID, action.Command)
		}
	}

	for _, hook := range []struct {
		kind HookKind
		hook *Hook
	}{{HookOpen, c.Hooks.OnOpen}, {HookSave, c.Hooks.OnSave}, {HookPreCommit, c.Hooks.PreCommit}, {HookPostPull, c.Hooks.PostPull}} {
		if hook.hook == nil {
			continue
		}
		if !commands[hook.hook.Command] {
			return fmt.Errorf("%s references unknown command %q", hook.kind, hook.hook.Command)
		}
		switch hook.hook.Failure {
		case "", "open", "closed":
		default:
			return fmt.Errorf("%s failure must be open or closed", hook.kind)
		}
	}

	languages := make(map[string]bool, len(c.Languages))
	extensions := make(map[string]bool)
	for i := range c.Languages {
		lang := &c.Languages[i]
		if err := validateContributionID(m.ID, lang.ID, "language"); err != nil {
			return err
		}
		if languages[lang.ID] {
			return fmt.Errorf("duplicate language id %q", lang.ID)
		}
		if len(lang.Extensions) == 0 {
			return fmt.Errorf("language %q must declare extensions", lang.ID)
		}
		if strings.TrimSpace(lang.LanguageID) == "" {
			return fmt.Errorf("language %q languageId is required", lang.ID)
		}
		for _, ext := range lang.Extensions {
			if !strings.HasPrefix(ext, ".") || len(ext) < 2 || len(ext) > 20 || strings.ToLower(ext) != ext {
				return fmt.Errorf("language %q extension %q must be a lowercase suffix such as .demo", lang.ID, ext)
			}
			if extensions[ext] {
				return fmt.Errorf("duplicate extension %q", ext)
			}
			extensions[ext] = true
		}
		if err := validateServer(lang.ID, &lang.Server); err != nil {
			return err
		}
		languages[lang.ID] = true
	}

	kinds := make(map[string]bool, len(c.Debuggers))
	for i := range c.Debuggers {
		dbg := &c.Debuggers[i]
		if !kindPattern.MatchString(dbg.Kind) || len(dbg.Kind) > 64 {
			return fmt.Errorf("debugger kind %q is invalid", dbg.Kind)
		}
		if !strings.HasPrefix(dbg.Kind, m.ID+".") {
			return fmt.Errorf("debugger kind %q must start with %q", dbg.Kind, m.ID+".")
		}
		if kinds[dbg.Kind] {
			return fmt.Errorf("duplicate debugger kind %q", dbg.Kind)
		}
		if strings.TrimSpace(dbg.Label) == "" || len(dbg.Label) > 120 {
			return fmt.Errorf("debugger %q label is required", dbg.Kind)
		}
		if err := validateServer(dbg.Kind, &dbg.Server); err != nil {
			return err
		}
		kinds[dbg.Kind] = true
	}

	frontends := make(map[string]bool, len(c.Frontends))
	for i := range c.Frontends {
		view := &c.Frontends[i]
		if err := validateContributionID(m.ID, view.ID, "frontend"); err != nil {
			return err
		}
		if frontends[view.ID] {
			return fmt.Errorf("duplicate frontend id %q", view.ID)
		}
		if strings.TrimSpace(view.Title) == "" || len(view.Title) > 120 {
			return fmt.Errorf("frontend %q title is required", view.ID)
		}
		if err := validateRelativePath(view.Entry); err != nil {
			return fmt.Errorf("frontend %q entry: %w", view.ID, err)
		}
		if !strings.HasSuffix(strings.ToLower(view.Entry), ".js") && !strings.HasSuffix(strings.ToLower(view.Entry), ".mjs") {
			return fmt.Errorf("frontend %q entry must be a .js or .mjs module", view.ID)
		}
		frontends[view.ID] = true
	}
	return nil
}

// ValidatePackage verifies that executable paths referenced by the manifest
// exist as regular files inside dir and that symlinks do not escape it.
func ValidatePackage(m *Manifest, dir string) error {
	if m == nil {
		return errors.New("manifest is nil")
	}
	root, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("package dir: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("package dir %q is not a directory", dir)
	}
	if err := checkPackageFile(root, m.Executable); err != nil {
		return fmt.Errorf("executable: %w", err)
	}
	for _, lang := range m.Contributes.Languages {
		if err := checkPackageFile(root, lang.Server.Command); err != nil {
			return fmt.Errorf("language %q server: %w", lang.ID, err)
		}
	}
	for _, dbg := range m.Contributes.Debuggers {
		if err := checkPackageFile(root, dbg.Server.Command); err != nil {
			return fmt.Errorf("debugger %q server: %w", dbg.Kind, err)
		}
	}
	for _, view := range m.Contributes.Frontends {
		if err := checkPackageFile(root, view.Entry); err != nil {
			return fmt.Errorf("frontend %q entry: %w", view.ID, err)
		}
	}
	return nil
}

func checkPackageFile(root, rel string) error {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path %q escapes the package", rel)
	}
	full := filepath.Join(root, clean)
	resolved, err := filepath.EvalSymlinks(full)
	if err != nil {
		return fmt.Errorf("path %q is not accessible: %w", rel, err)
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("package dir: %w", err)
	}
	prefix := resolvedRoot + string(filepath.Separator)
	if resolved != resolvedRoot && !strings.HasPrefix(resolved, prefix) {
		return fmt.Errorf("path %q escapes the package", rel)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return fmt.Errorf("path %q: %w", rel, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("path %q is not a regular file", rel)
	}
	return nil
}

func validateRelativePath(rel string) error {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "" || clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path %q must be relative to the package root", rel)
	}
	if strings.Contains(rel, "\\") {
		return fmt.Errorf("path %q must use forward slashes", rel)
	}
	return nil
}

func validateContributionID(pluginID, id, kind string) error {
	if !idPattern.MatchString(id) || len(id) > 100 {
		return fmt.Errorf("%s id %q is invalid", kind, id)
	}
	if !strings.HasPrefix(id, pluginID+".") {
		return fmt.Errorf("%s id %q must start with %q", kind, id, pluginID+".")
	}
	return nil
}

func validateServer(owner string, server *Server) error {
	if err := validateRelativePath(server.Command); err != nil {
		return fmt.Errorf("%s server command: %w", owner, err)
	}
	switch server.Transport {
	case "", "stdio":
	case "tcp":
		return fmt.Errorf("%s server transport tcp is not supported (use stdio)", owner)
	default:
		return fmt.Errorf("%s server transport %q is unsupported", owner, server.Transport)
	}
	for _, arg := range server.Args {
		if strings.ContainsRune(arg, '\x00') {
			return fmt.Errorf("%s server arg contains a NUL byte", owner)
		}
	}
	return nil
}

func validateFields(owner string, fields []Field) error {
	if len(fields) > MaxFields {
		return fmt.Errorf("%s has too many fields (max %d)", owner, MaxFields)
	}
	seen := make(map[string]bool, len(fields))
	for i := range fields {
		f := &fields[i]
		if !fieldPattern.MatchString(f.Key) {
			return fmt.Errorf("%s field key %q is invalid", owner, f.Key)
		}
		if seen[f.Key] {
			return fmt.Errorf("%s duplicate field key %q", owner, f.Key)
		}
		seen[f.Key] = true
		if strings.TrimSpace(f.Label) == "" || len(f.Label) > 120 {
			return fmt.Errorf("%s field %q label is required", owner, f.Key)
		}
		switch f.Type {
		case "text", "textarea", "boolean", "number", "select":
		default:
			return fmt.Errorf("%s field %q has unsupported type %q", owner, f.Key, f.Type)
		}
		if f.Type == "select" {
			if len(f.Options) == 0 || len(f.Options) > MaxOptions {
				return fmt.Errorf("%s field %q must declare 1-%d options", owner, f.Key, MaxOptions)
			}
			for _, opt := range f.Options {
				if strings.TrimSpace(opt.Label) == "" || opt.Value == "" {
					return fmt.Errorf("%s field %q has an invalid option", owner, f.Key)
				}
			}
		} else if len(f.Options) > 0 {
			return fmt.Errorf("%s field %q options are only valid for select fields", owner, f.Key)
		}
		if f.Min != nil && f.Max != nil && *f.Min > *f.Max {
			return fmt.Errorf("%s field %q min must be <= max", owner, f.Key)
		}
		if f.Type == "number" && (f.Min != nil || f.Max != nil) && f.Default != nil {
			num, ok := toFloat(f.Default)
			if !ok {
				return fmt.Errorf("%s field %q default must be numeric", owner, f.Key)
			}
			if f.Min != nil && num < *f.Min || f.Max != nil && num > *f.Max {
				return fmt.Errorf("%s field %q default is out of range", owner, f.Key)
			}
		}
		if f.Default != nil {
			if err := validateDefault(owner, f); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateDefault(owner string, f *Field) error {
	switch f.Type {
	case "text", "textarea", "select":
		value, ok := f.Default.(string)
		if !ok {
			return fmt.Errorf("%s field %q default must be a string", owner, f.Key)
		}
		if f.Type == "select" {
			valid := false
			for _, opt := range f.Options {
				if opt.Value == value {
					valid = true
					break
				}
			}
			if !valid {
				return fmt.Errorf("%s field %q default is not one of its options", owner, f.Key)
			}
		}
	case "boolean":
		if _, ok := f.Default.(bool); !ok {
			return fmt.Errorf("%s field %q default must be a boolean", owner, f.Key)
		}
	case "number":
		if _, ok := toFloat(f.Default); !ok {
			return fmt.Errorf("%s field %q default must be numeric", owner, f.Key)
		}
	}
	return nil
}

func toFloat(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case json.Number:
		parsed, err := strconv.ParseFloat(string(number), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

// ConfigDefaults returns default values derived from all settings views.
func (m *Manifest) ConfigDefaults() map[string]any {
	out := make(map[string]any)
	for _, view := range m.Contributes.Settings {
		for _, field := range view.Fields {
			key := view.ID + "." + field.Key
			if field.Default != nil {
				out[key] = field.Default
			}
		}
	}
	return out
}

// SortedContributionIDs is used by tests and diagnostics.
func (m *Manifest) SortedContributionIDs() []string {
	var ids []string
	for _, cmd := range m.Contributes.Commands {
		ids = append(ids, cmd.ID)
	}
	sort.Strings(ids)
	return ids
}
