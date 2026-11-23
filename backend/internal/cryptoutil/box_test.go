package cryptoutil

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func TestNewRejectsInvalidKey(t *testing.T) {
	for _, key := range [][]byte{nil, []byte("short"), bytes.Repeat([]byte{1}, 31), bytes.Repeat([]byte{1}, 33)} {
		if _, err := New(key); err == nil {
			t.Fatalf("New(%d bytes) should fail", len(key))
		}
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	box, err := New(bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"", "token", "多字节 secret", strings.Repeat("x", 4096)} {
		encoded, err := box.Encrypt(value)
		if err != nil {
			t.Fatalf("Encrypt(%q): %v", value, err)
		}
		if value == "" && encoded != "" {
			t.Fatalf("empty plaintext should produce empty ciphertext")
		}
		decoded, err := box.Decrypt(encoded)
		if err != nil {
			t.Fatalf("Decrypt: %v", err)
		}
		if decoded != value {
			t.Fatalf("round trip: got %q want %q", decoded, value)
		}
	}
}

func TestEncryptUsesFreshNonce(t *testing.T) {
	box, _ := New(bytes.Repeat([]byte{4}, 32))
	a, _ := box.Encrypt("same")
	b, _ := box.Encrypt("same")
	if a == b {
		t.Fatal("ciphertexts should differ")
	}
}

func TestDecryptRejectsMalformedInput(t *testing.T) {
	box, _ := New(bytes.Repeat([]byte{7}, 32))
	cases := []string{"!!!", base64.RawStdEncoding.EncodeToString([]byte("short")), base64.RawStdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 40))}
	for _, input := range cases {
		if _, err := box.Decrypt(input); err == nil {
			t.Fatalf("Decrypt(%q) should fail", input)
		}
	}
	if got, err := box.Decrypt(""); err != nil || got != "" {
		t.Fatalf("empty ciphertext: %q %v", got, err)
	}
}

func TestDecryptRejectsTamperedCiphertext(t *testing.T) {
	box, _ := New(bytes.Repeat([]byte{3}, 32))
	encoded, _ := box.Encrypt("secret")
	raw, _ := base64.RawStdEncoding.DecodeString(encoded)
	raw[len(raw)-1] ^= 0xff
	if _, err := box.Decrypt(base64.RawStdEncoding.EncodeToString(raw)); err == nil {
		t.Fatal("tampered ciphertext should fail")
	}
}
