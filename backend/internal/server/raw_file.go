package server

import (
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"goland/internal/files"
)

const maxRawFileSize = 100 << 20

// rawFile streams a workspace file for in-browser viewers (images and PDF).
// It keeps authentication and workspace path isolation in the normal API
// middleware, while ServeContent provides range requests for PDF viewers.
func (s *Server) rawFile(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	rel := cleanQueryPath(r)
	if rel == "" {
		writeError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	full, err := s.files.Resolve(ws, rel)
	if err != nil {
		mapFileError(w, err)
		return
	}
	info, err := os.Stat(full)
	if err != nil {
		mapFileError(w, err)
		return
	}
	if info.IsDir() {
		mapFileError(w, files.ErrIsDirectory)
		return
	}
	if info.Size() > maxRawFileSize {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "file is too large to preview")
		return
	}
	file, err := os.Open(full)
	if err != nil {
		mapFileError(w, err)
		return
	}
	defer file.Close()

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(info.Name())))
	if contentType == "" {
		var sample [512]byte
		n, _ := io.ReadFull(file, sample[:])
		contentType = http.DetectContentType(sample[:n])
		_, _ = file.Seek(0, io.SeekStart)
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": info.Name()}))
	w.Header().Set("Cache-Control", "private, no-cache")
	if strings.Contains(contentType, "pdf") {
		// The PDF viewer embeds this same-origin response; the global security
		// middleware denies framing by default.
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'self'")
	}
	if strings.Contains(contentType, "svg") {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
