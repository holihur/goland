package plugins

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validManifest() *Manifest {
	return &Manifest{
		APIVersion: APIVersion,
		ID:         "demo.plugin",
		Name:       "Demo Plugin",
		Version:    "1.2.3",
		Executable: "bin/demo",
		Contributes: Contributions{
			Commands: []Command{
				{ID: "demo.plugin.hello", Title: "Hello"},
				{ID: "demo.plugin.format", Title: "Format", Args: []string{"--format"}},
			},
			Panels: []Panel{{
				ID:    "demo.plugin.panel",
				Title: "Demo",
				Fields: []Field{
					{Key: "query", Type: "text", Label: "Query"},
					{Key: "mode", Type: "select", Label: "Mode", Options: []Option{{Label: "A", Value: "a"}}, Default: "a"},
					{Key: "enabled", Type: "boolean", Label: "Enabled", Default: true},
				},
				Actions: []PanelAction{{ID: "run", Label: "Run", Command: "demo.plugin.hello"}},
			}},
			Status: []StatusItem{{ID: "demo.plugin.status", Text: "Demo", Command: "demo.plugin.hello"}},
			Settings: []SettingsView{{
				ID:    "demo.plugin.settings",
				Title: "Demo settings",
				Fields: []Field{
					{Key: "formatOnSave", Type: "boolean", Label: "Format on save", Default: false},
				},
			}},
			Hooks: Hooks{
				OnSave:    &Hook{Command: "demo.plugin.format"},
				PreCommit: &Hook{Command: "demo.plugin.hello", Failure: "closed"},
			},
			EditorActions: []EditorAction{{ID: "demo.plugin.action", Title: "Demo action", Command: "demo.plugin.hello"}},
			Languages: []Language{{
				ID: "demo.plugin.lang", Extensions: []string{".demo"}, LanguageID: "demo",
				Server: Server{Command: "bin/lsp"},
			}},
			Debuggers: []Debugger{{
				Kind: "demo.plugin.debug", Label: "Demo debug", Server: Server{Command: "bin/dap"},
			}},
		},
	}
}

func TestParseManifestStrict(t *testing.T) {
	data, err := json.Marshal(validManifest())
	if err != nil {
		t.Fatal(err)
	}
	m, err := ParseManifest(data)
	if err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	if m.ID != "demo.plugin" || len(m.Contributes.Commands) != 2 {
		t.Fatalf("unexpected manifest: %+v", m)
	}

	for name, payload := range map[string]string{
		"unknown field": `{"apiVersion":1,"id":"p.a","name":"P","version":"1.0.0","executable":"bin/x","extra":true}`,
		"two objects":   `{"apiVersion":1,"id":"p.a","name":"P","version":"1.0.0","executable":"bin/x"}{}`,
		"empty":         ``,
		"invalid json":  `{`,
	} {
		if _, err := ParseManifest([]byte(payload)); err == nil {
			t.Fatalf("%s: expected error", name)
		}
	}
	if _, err := ParseManifest([]byte(strings.Repeat(" ", MaxManifestBytes+1))); err == nil {
		t.Fatal("oversized manifest accepted")
	}
}

func TestValidateManifestFields(t *testing.T) {
	cases := map[string]func(*Manifest){
		"api version":    func(m *Manifest) { m.APIVersion = 2 },
		"bad id":         func(m *Manifest) { m.ID = "Bad ID" },
		"long id":        func(m *Manifest) { m.ID = "a." + strings.Repeat("b", 64) },
		"empty name":     func(m *Manifest) { m.Name = " " },
		"invalid semver": func(m *Manifest) { m.Version = "1.0" },
		"absolute executable": func(m *Manifest) {
			m.Executable = "/bin/sh"
		},
		"escaping executable": func(m *Manifest) { m.Executable = "../bin/sh" },
		"backslash executable": func(m *Manifest) {
			m.Executable = `bin\x`
		},
		"too many commands": func(m *Manifest) {
			for i := 0; i <= MaxCommands; i++ {
				m.Contributes.Commands = append(m.Contributes.Commands, Command{ID: "demo.plugin.c" + string(rune('a'+i)), Title: "x"})
			}
		},
		"bad command id": func(m *Manifest) {
			m.Contributes.Commands[0].ID = "other.hello"
		},
		"duplicate command": func(m *Manifest) {
			m.Contributes.Commands[1].ID = m.Contributes.Commands[0].ID
		},
		"empty command title": func(m *Manifest) {
			m.Contributes.Commands[0].Title = ""
		},
		"duplicate panel": func(m *Manifest) {
			m.Contributes.Panels = append(m.Contributes.Panels, m.Contributes.Panels[0])
		},
		"panel title": func(m *Manifest) {
			m.Contributes.Panels[0].Title = ""
		},
		"panel unknown command": func(m *Manifest) {
			m.Contributes.Panels[0].Actions[0].Command = "demo.plugin.missing"
		},
		"panel action empty": func(m *Manifest) {
			m.Contributes.Panels[0].Actions[0].Label = ""
		},
		"duplicate status": func(m *Manifest) {
			m.Contributes.Status = append(m.Contributes.Status, m.Contributes.Status[0])
		},
		"status text": func(m *Manifest) {
			m.Contributes.Status[0].Text = ""
		},
		"status unknown command": func(m *Manifest) {
			m.Contributes.Status[0].Command = "demo.plugin.missing"
		},
		"settings empty fields": func(m *Manifest) {
			m.Contributes.Settings[0].Fields = nil
		},
		"settings title": func(m *Manifest) {
			m.Contributes.Settings[0].Title = ""
		},
		"editor action unknown command": func(m *Manifest) {
			m.Contributes.EditorActions[0].Command = "demo.plugin.missing"
		},
		"editor action title": func(m *Manifest) {
			m.Contributes.EditorActions[0].Title = ""
		},
		"hook unknown command": func(m *Manifest) {
			m.Contributes.Hooks.OnSave.Command = "demo.plugin.missing"
		},
		"hook failure": func(m *Manifest) {
			m.Contributes.Hooks.OnSave.Failure = "maybe"
		},
		"language extensions missing": func(m *Manifest) {
			m.Contributes.Languages[0].Extensions = nil
		},
		"language id missing": func(m *Manifest) {
			m.Contributes.Languages[0].LanguageID = ""
		},
		"language extension invalid": func(m *Manifest) {
			m.Contributes.Languages[0].Extensions = []string{"DEMO"}
		},
		"language extension duplicate": func(m *Manifest) {
			m.Contributes.Languages = append(m.Contributes.Languages, Language{
				ID: "demo.plugin.lang2", Extensions: []string{".demo"}, LanguageID: "demo2",
				Server: Server{Command: "bin/lsp"},
			})
		},
		"language server missing": func(m *Manifest) {
			m.Contributes.Languages[0].Server.Command = ""
		},
		"language transport": func(m *Manifest) {
			m.Contributes.Languages[0].Server.Transport = "tcp"
		},
		"language transport unknown": func(m *Manifest) {
			m.Contributes.Languages[0].Server.Transport = "udp"
		},
		"language server arg nul": func(m *Manifest) {
			m.Contributes.Languages[0].Server.Args = []string{"a\x00b"}
		},
		"debugger kind prefix": func(m *Manifest) {
			m.Contributes.Debuggers[0].Kind = "other.debug"
		},
		"debugger duplicate": func(m *Manifest) {
			m.Contributes.Debuggers = append(m.Contributes.Debuggers, m.Contributes.Debuggers[0])
		},
		"debugger label": func(m *Manifest) {
			m.Contributes.Debuggers[0].Label = ""
		},
		"debugger server missing": func(m *Manifest) {
			m.Contributes.Debuggers[0].Server.Command = ""
		},
		"field key invalid": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[0].Key = "Bad Key"
		},
		"field duplicate key": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[1].Key = m.Contributes.Panels[0].Fields[0].Key
		},
		"field label": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[0].Label = ""
		},
		"field type": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[0].Type = "richtext"
		},
		"select no options": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[1].Options = nil
		},
		"select bad option": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[1].Options[0].Value = ""
		},
		"options on text": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[0].Options = []Option{{Label: "x", Value: "x"}}
		},
		"min greater than max": func(m *Manifest) {
			min, max := 10.0, 1.0
			m.Contributes.Panels[0].Fields = append(m.Contributes.Panels[0].Fields, Field{Key: "n", Type: "number", Label: "N", Min: &min, Max: &max})
		},
		"number default not numeric": func(m *Manifest) {
			m.Contributes.Panels[0].Fields = append(m.Contributes.Panels[0].Fields, Field{Key: "n", Type: "number", Label: "N", Default: "x"})
		},
		"number default out of range": func(m *Manifest) {
			min := 5.0
			m.Contributes.Panels[0].Fields = append(m.Contributes.Panels[0].Fields, Field{Key: "n", Type: "number", Label: "N", Min: &min, Default: 1.0})
		},
		"text default wrong": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[0].Default = 12
		},
		"boolean default wrong": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[2].Default = "yes"
		},
		"select default wrong": func(m *Manifest) {
			m.Contributes.Panels[0].Fields[1].Default = "missing"
		},
	}
	for name, mutate := range cases {
		m := validManifest()
		mutate(m)
		if err := Validate(m); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

func TestValidateAllowsHookDefaults(t *testing.T) {
	m := validManifest()
	if err := Validate(m); err != nil {
		t.Fatal(err)
	}
	if got := m.Contributes.Hooks.OnSave.FailureMode(HookSave); got != "open" {
		t.Fatalf("onSave default = %q", got)
	}
	if got := m.Contributes.Hooks.PreCommit.FailureMode(HookPreCommit); got != "closed" {
		t.Fatalf("preCommit mode = %q", got)
	}
	m.Contributes.Hooks.PreCommit.Failure = "open"
	if got := m.Contributes.Hooks.PreCommit.FailureMode(HookPreCommit); got != "open" {
		t.Fatalf("explicit mode = %q", got)
	}
	if got := (*Hook)(nil).FailureMode(HookOpen); got != "open" {
		t.Fatalf("nil hook = %q", got)
	}
}

func TestValidatePackage(t *testing.T) {
	dir := t.TempDir()
	write := func(rel string) {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write("bin/demo")
	write("bin/lsp")
	write("bin/dap")
	if err := ValidatePackage(validManifest(), dir); err != nil {
		t.Fatalf("valid package rejected: %v", err)
	}

	if err := ValidatePackage(validManifest(), filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing package dir accepted")
	}
	if err := ValidatePackage(validManifest(), filepath.Join(dir, "bin", "demo")); err == nil {
		t.Fatal("file as package dir accepted")
	}

	missing := validManifest()
	missing.Executable = "bin/missing"
	if err := ValidatePackage(missing, dir); err == nil {
		t.Fatal("missing executable accepted")
	}

	missingLang := validManifest()
	missingLang.Contributes.Languages[0].Server.Command = "bin/missing-lsp"
	if err := ValidatePackage(missingLang, dir); err == nil {
		t.Fatal("missing language server accepted")
	}

	missingDAP := validManifest()
	missingDAP.Contributes.Debuggers[0].Server.Command = "bin/missing-dap"
	if err := ValidatePackage(missingDAP, dir); err == nil {
		t.Fatal("missing debugger server accepted")
	}

	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "bin", "link")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	symlink := validManifest()
	symlink.Executable = "bin/link"
	if err := ValidatePackage(symlink, dir); err == nil {
		t.Fatal("symlink escape accepted")
	}

	inPackage := filepath.Join(dir, "bin", "demo")
	if err := os.Symlink(inPackage, filepath.Join(dir, "bin", "inside-link")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	inside := validManifest()
	inside.Executable = "bin/inside-link"
	if err := ValidatePackage(inside, dir); err != nil {
		t.Fatalf("inside symlink rejected: %v", err)
	}
}

func TestLoadManifest(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadManifest(dir); err == nil {
		t.Fatal("missing manifest accepted")
	}
	data, _ := json.Marshal(validManifest())
	if err := os.WriteFile(filepath.Join(dir, ManifestFileName), data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"demo", "lsp", "dap"} {
		if err := os.WriteFile(filepath.Join(dir, "bin", name), []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	m, err := LoadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if m.ID != "demo.plugin" {
		t.Fatalf("unexpected manifest: %+v", m)
	}
	if err := os.WriteFile(filepath.Join(dir, ManifestFileName), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadManifest(dir); err == nil {
		t.Fatal("corrupt manifest accepted")
	}
}

func TestManifestHelpers(t *testing.T) {
	m := validManifest()
	defaults := m.ConfigDefaults()
	if defaults["demo.plugin.settings.formatOnSave"] != false {
		t.Fatalf("defaults = %#v", defaults)
	}
	ids := m.SortedContributionIDs()
	if len(ids) != 2 || ids[0] != "demo.plugin.format" || ids[1] != "demo.plugin.hello" {
		t.Fatalf("sorted ids = %#v", ids)
	}
	if err := Validate(nil); err == nil {
		t.Fatal("nil manifest accepted")
	}
}
