package plugins

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ConfigField couples a settings field with its fully qualified config key.
type ConfigField struct {
	Key   string
	View  string
	Field Field
}

// ConfigFields returns every configurable field, keyed as "<viewID>.<fieldKey>".
func ConfigFields(m *Manifest) []ConfigField {
	if m == nil {
		return nil
	}
	var out []ConfigField
	for _, view := range m.Contributes.Settings {
		for _, field := range view.Fields {
			out = append(out, ConfigField{Key: view.ID + "." + field.Key, View: view.ID, Field: field})
		}
	}
	return out
}

// ConfigWithDefaults merges persisted values over manifest defaults.
func ConfigWithDefaults(m *Manifest, cfg map[string]any) map[string]any {
	out := make(map[string]any)
	for _, field := range ConfigFields(m) {
		if field.Field.Default != nil {
			out[field.Key] = field.Field.Default
		}
	}
	for key, value := range cfg {
		out[key] = value
	}
	return out
}

// ValidateConfig checks types, options and ranges, rejects unknown keys and
// requires a value for fields marked required (defaults count).
func ValidateConfig(m *Manifest, cfg map[string]any) error {
	if m == nil {
		return fmt.Errorf("manifest is nil")
	}
	known := make(map[string]Field)
	for _, field := range ConfigFields(m) {
		known[field.Key] = field.Field
	}
	for key, value := range cfg {
		field, ok := known[key]
		if !ok {
			return fmt.Errorf("unknown config key %q", key)
		}
		if err := validateConfigValue(key, field, value); err != nil {
			return err
		}
	}
	merged := ConfigWithDefaults(m, cfg)
	for key, field := range known {
		if !field.Required {
			continue
		}
		value, ok := merged[key]
		if !ok || emptyConfigValue(value) {
			return fmt.Errorf("config key %q is required", key)
		}
	}
	return nil
}

func validateConfigValue(key string, field Field, value any) error {
	switch field.Type {
	case "text", "textarea":
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("config key %q must be a string", key)
		}
		max := 2000
		if field.Type == "textarea" {
			max = 20000
		}
		if len(text) > max {
			return fmt.Errorf("config key %q exceeds %d characters", key, max)
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("config key %q must be a boolean", key)
		}
	case "number":
		number, ok := configNumber(value)
		if !ok {
			return fmt.Errorf("config key %q must be a number", key)
		}
		if field.Min != nil && number < *field.Min || field.Max != nil && number > *field.Max {
			return fmt.Errorf("config key %q is out of range", key)
		}
	case "select":
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("config key %q must be a string", key)
		}
		valid := false
		for _, option := range field.Options {
			if option.Value == text {
				valid = true
				break
			}
		}
		if !valid {
			return fmt.Errorf("config key %q is not one of the allowed options", key)
		}
	default:
		return fmt.Errorf("config key %q has unsupported type %q", key, field.Type)
	}
	return nil
}

func emptyConfigValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(typed) == ""
	default:
		return false
	}
}

func configNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case float32:
		return float64(number), true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case json.Number:
		parsed, err := number.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}
