package server

import (
	"bufio"
	"compress/gzip"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

var gzipPool = sync.Pool{New: func() any {
	writer, _ := gzip.NewWriterLevel(io.Discard, 5)
	return writer
}}

// compression gzips text APIs and static assets. WebSocket upgrades and
// streaming responses are passed through untouched so terminal/debug/plugin
// sockets keep working.
func compression(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") != "" ||
			strings.HasPrefix(r.URL.Path, "/api/ws/") ||
			r.Header.Get("Range") != "" ||
			!strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		cw := &compressWriter{ResponseWriter: w, status: http.StatusOK}
		defer cw.Close()
		next.ServeHTTP(cw, r)
	})
}

type compressWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	compress    bool
	gz          *gzip.Writer
}

func (w *compressWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
}

func (w *compressWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.start(p)
	}
	if w.compress {
		return w.gz.Write(p)
	}
	return w.ResponseWriter.Write(p)
}

func (w *compressWriter) start(sample []byte) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	header := w.Header()
	header.Add("Vary", "Accept-Encoding")
	if w.status == http.StatusNoContent || w.status == http.StatusNotModified || w.status < 200 {
		w.ResponseWriter.WriteHeader(w.status)
		return
	}
	contentType := header.Get("Content-Type")
	if contentType == "" && len(sample) > 0 {
		contentType = http.DetectContentType(sample)
	}
	w.compress = compressible(contentType)
	if !w.compress {
		w.ResponseWriter.WriteHeader(w.status)
		return
	}
	header.Del("Content-Length")
	header.Set("Content-Encoding", "gzip")
	w.ResponseWriter.WriteHeader(w.status)
	w.gz = gzipPool.Get().(*gzip.Writer)
	w.gz.Reset(w.ResponseWriter)
}

func (w *compressWriter) Close() error {
	if !w.wroteHeader {
		w.start(nil)
	}
	if w.gz == nil {
		return nil
	}
	err := w.gz.Close()
	gzipPool.Put(w.gz)
	w.gz = nil
	return err
}

func (w *compressWriter) Flush() {
	if !w.wroteHeader {
		w.start(nil)
	}
	if w.gz != nil {
		_ = w.gz.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *compressWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijack not supported")
	}
	return hijacker.Hijack()
}

func (w *compressWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func compressible(contentType string) bool {
	contentType = strings.ToLower(contentType)
	switch {
	case strings.HasPrefix(contentType, "text/"):
		return true
	case strings.Contains(contentType, "json"):
		return true
	case strings.Contains(contentType, "javascript"):
		return true
	case strings.Contains(contentType, "xml"):
		return true
	case strings.Contains(contentType, "svg"):
		return true
	case strings.Contains(contentType, "wasm"):
		return true
	default:
		return false
	}
}
