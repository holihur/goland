package files

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSecureJoin(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}

	allowed := []string{"", ".", "main.go", "nested/new.go"}
	for _, rel := range allowed {
		if _, err := SecureJoin(root, rel); err != nil {
			t.Errorf("SecureJoin(%q) unexpected error: %v", rel, err)
		}
	}

	rejected := []string{
		"../../etc/passwd",
		"/etc/passwd",
		"a/../../b",
		"..",
		".git/config",
		"a\\b",
		"link/secret",
	}
	for _, rel := range rejected {
		if _, err := SecureJoin(root, rel); err == nil {
			t.Errorf("SecureJoin(%q) should fail", rel)
		}
	}
}

func TestBinaryDetection(t *testing.T) {
	if isBinary([]byte("package main\n")) {
		t.Fatal("text detected as binary")
	}
	if !isBinary([]byte{'a', 0, 'b'}) {
		t.Fatal("NUL bytes should be binary")
	}
	if !isBinary([]byte{0xff, 0xfe, 0xfd}) {
		t.Fatal("invalid UTF-8 should be binary")
	}
}
