package server_test

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestRawFilePreview(t *testing.T) {
	f := newExtraFixture(t)
	// Small transparent PNG.
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.wsDir, "pixel.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.wsDir, "doc.pdf"), []byte("%PDF-1.4\n%%EOF\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resp := f.member.do(http.MethodGet, f.path("/raw?path=pixel.png"), nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("png: %d %s", resp.StatusCode, readBody(resp))
	}
	if got := resp.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("png content type: %q", got)
	}
	if got := readBody(resp); got != string(png) {
		t.Fatalf("png body mismatch: %d bytes", len(got))
	}
	resp = f.member.do(http.MethodGet, f.path("/raw?path=doc.pdf"), nil, false)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "application/pdf" {
		t.Fatalf("pdf: %d %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	readBody(resp)
	resp = f.member.do(http.MethodGet, f.path("/raw?path=..%2F..%2Fetc%2Fpasswd"), nil, false)
	if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("escape status: %d", resp.StatusCode)
	}
	readBody(resp)
}
