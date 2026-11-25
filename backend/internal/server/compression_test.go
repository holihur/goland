package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompressionJSON(t *testing.T) {
	handler := compression(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"hello hello hello"}`))
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("content encoding = %q", rec.Header().Get("Content-Encoding"))
	}
	reader, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(reader)
	if string(body) != `{"message":"hello hello hello"}` {
		t.Fatalf("body = %q", body)
	}
}

func TestCompressionPassthrough(t *testing.T) {
	handler := compression(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`plain`))
	}))
	for _, header := range []string{"", "gzip, br"} {
		req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
		if header != "" {
			req.Header.Set("Accept-Encoding", header)
		}
		req.Header.Set("Upgrade", "websocket")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Header().Get("Content-Encoding") != "" || rec.Body.String() != "plain" {
			t.Fatalf("upgrade should pass through: %q %q", rec.Header().Get("Content-Encoding"), rec.Body.String())
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Body.String() != "plain" {
		t.Fatalf("plain body = %q", rec.Body.String())
	}
}

func TestCompressible(t *testing.T) {
	for _, value := range []string{"text/html", "application/json; charset=utf-8", "application/javascript", "image/svg+xml", "application/wasm"} {
		if !compressible(value) {
			t.Fatalf("%q should compress", value)
		}
	}
	for _, value := range []string{"image/png", "application/octet-stream", ""} {
		if compressible(value) {
			t.Fatalf("%q should not compress", value)
		}
	}
}
