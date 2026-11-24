package plugins

import (
	"encoding/json"
	"strings"
	"testing"
)

func configManifest() *Manifest {
	min, max := 1.0, 10.0
	return &Manifest{
		APIVersion: APIVersion,
		ID:         "demo.plugin",
		Name:       "Demo",
		Version:    "1.0.0",
		Executable: "bin/demo",
		Contributes: Contributions{
			Settings: []SettingsView{{
				ID:    "demo.plugin.settings",
				Title: "Settings",
				Fields: []Field{
					{Key: "name", Type: "text", Label: "Name", Required: true},
					{Key: "notes", Type: "textarea", Label: "Notes"},
					{Key: "enabled", Type: "boolean", Label: "Enabled", Default: true},
					{Key: "level", Type: "number", Label: "Level", Min: &min, Max: &max, Default: 5.0},
					{Key: "mode", Type: "select", Label: "Mode", Options: []Option{{Label: "Fast", Value: "fast"}}, Default: "fast"},
				},
			}},
		},
	}
}

func TestConfigFieldsAndDefaults(t *testing.T) {
	m := configManifest()
	fields := ConfigFields(m)
	if len(fields) != 5 {
		t.Fatalf("fields = %d", len(fields))
	}
	if fields[0].Key != "demo.plugin.settings.name" {
		t.Fatalf("first key = %q", fields[0].Key)
	}
	defaults := ConfigWithDefaults(m, map[string]any{"demo.plugin.settings.name": "x"})
	if defaults["demo.plugin.settings.enabled"] != true || defaults["demo.plugin.settings.level"] != 5.0 {
		t.Fatalf("defaults = %#v", defaults)
	}
	if defaults["demo.plugin.settings.name"] != "x" {
		t.Fatalf("override missing: %#v", defaults)
	}
}

func TestValidateConfig(t *testing.T) {
	m := configManifest()
	valid := map[string]any{
		"demo.plugin.settings.name":  "demo",
		"demo.plugin.settings.notes": strings.Repeat("a", 100),
		"demo.plugin.settings.level": 3.0,
		"demo.plugin.settings.mode":  "fast",
	}
	if err := ValidateConfig(m, valid); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	if err := ValidateConfig(m, nil); err == nil {
		t.Fatal("missing required name accepted")
	}
	if err := ValidateConfig(m, map[string]any{"demo.plugin.settings.name": "  "}); err == nil {
		t.Fatal("blank required name accepted")
	}

	cases := map[string]map[string]any{
		"unknown key":     {"demo.plugin.settings.other": true},
		"text number":     {"demo.plugin.settings.name": 1},
		"textarea number": {"demo.plugin.settings.name": "x", "demo.plugin.settings.notes": 1},
		"too long":        {"demo.plugin.settings.name": strings.Repeat("a", 2001)},
		"notes too long":  {"demo.plugin.settings.name": "x", "demo.plugin.settings.notes": strings.Repeat("a", 20001)},
		"boolean string":  {"demo.plugin.settings.name": "x", "demo.plugin.settings.enabled": "true"},
		"number string":   {"demo.plugin.settings.name": "x", "demo.plugin.settings.level": "3"},
		"number low":      {"demo.plugin.settings.name": "x", "demo.plugin.settings.level": 0.0},
		"number high":     {"demo.plugin.settings.name": "x", "demo.plugin.settings.level": 11.0},
		"select invalid":  {"demo.plugin.settings.name": "x", "demo.plugin.settings.mode": "slow"},
		"select number":   {"demo.plugin.settings.name": "x", "demo.plugin.settings.mode": 1},
	}
	for name, cfg := range cases {
		if err := ValidateConfig(m, cfg); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestValidateConfigJSONNumbers(t *testing.T) {
	m := configManifest()
	cfg := map[string]any{
		"demo.plugin.settings.name":  "demo",
		"demo.plugin.settings.level": json.Number("4"),
	}
	if err := ValidateConfig(m, cfg); err != nil {
		t.Fatalf("json.Number rejected: %v", err)
	}
	if err := ValidateConfig(nil, nil); err == nil {
		t.Fatal("nil manifest accepted")
	}
	if ConfigFields(nil) != nil {
		t.Fatal("nil manifest returned fields")
	}
}
