package server

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"goland/internal/config"
	"goland/internal/files"
	"goland/internal/isolation"
)

func TestDecodeJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}
	for _, tc := range []struct {
		name string
		body string
		ok   bool
		code int
		lim  int64
	}{
		{"valid", `{"name":"ok"}`, true, 0, 0},
		{"unknown", `{"name":"ok","extra":1}`, false, http.StatusBadRequest, 0},
		{"invalid", `{`, false, http.StatusBadRequest, 0},
		{"trailing", `{"name":"a"} {}`, false, http.StatusBadRequest, 0},
		{"too large", `{"name":"` + strings.Repeat("x", 100) + `"}`, false, http.StatusRequestEntityTooLarge, 10},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			var dst payload
			ok := decodeJSON(w, r, &dst, tc.lim)
			if ok != tc.ok {
				t.Fatalf("ok=%v want %v body=%s", ok, tc.ok, w.Body.String())
			}
			if !tc.ok && w.Code != tc.code {
				t.Fatalf("code=%d want %d", w.Code, tc.code)
			}
			if tc.ok && dst.Name != "ok" {
				t.Fatalf("decoded: %#v", dst)
			}
		})
	}
}

func TestMapFileError(t *testing.T) {
	cases := []struct {
		err  error
		code int
	}{
		{files.ErrPathEscape, http.StatusBadRequest},
		{files.ErrProtected, http.StatusForbidden},
		{files.ErrIsDirectory, http.StatusBadRequest},
		{files.ErrNotDirectory, http.StatusBadRequest},
		{files.ErrConflict, http.StatusConflict},
		{files.ErrTooLarge, http.StatusRequestEntityTooLarge},
		{files.ErrBinary, http.StatusUnsupportedMediaType},
		{fs.ErrNotExist, http.StatusNotFound},
		{errors.New("other"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		mapFileError(w, tc.err)
		if w.Code != tc.code {
			t.Errorf("%v: %d want %d", tc.err, w.Code, tc.code)
		}
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	for _, key := range []string{"X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"} {
		if w.Header().Get(key) == "" {
			t.Errorf("missing %s", key)
		}
	}
	if w.Code != http.StatusTeapot {
		t.Fatalf("status: %d", w.Code)
	}
}

type fakeResponseWriter struct {
	header  http.Header
	status  int
	flushed bool
}

func (f *fakeResponseWriter) Header() http.Header         { return f.header }
func (f *fakeResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (f *fakeResponseWriter) WriteHeader(code int)        { f.status = code }
func (f *fakeResponseWriter) Flush()                      { f.flushed = true }

func TestStatusWriter(t *testing.T) {
	base := &fakeResponseWriter{header: make(http.Header)}
	w := &statusWriter{ResponseWriter: base, status: 200}
	w.WriteHeader(http.StatusCreated)
	if w.status != http.StatusCreated || base.status != http.StatusCreated {
		t.Fatal("status not forwarded")
	}
	w.Flush()
	if !base.flushed {
		t.Fatal("flush not forwarded")
	}
	if _, _, err := w.Hijack(); err == nil {
		t.Fatal("non-hijackable writer should fail")
	}
}

func TestLoginLimiter(t *testing.T) {
	l := newLoginLimiter()
	key := l.key("ip", "user")
	if blocked, wait := l.blocked(key); blocked || wait != 0 {
		t.Fatal("new limiter should not block")
	}
	for i := 0; i < 4; i++ {
		l.fail(key)
		if blocked, _ := l.blocked(key); blocked {
			t.Fatalf("blocked too early at %d", i)
		}
	}
	l.fail(key)
	if blocked, wait := l.blocked(key); !blocked || wait <= 0 {
		t.Fatalf("expected block: %v %v", blocked, wait)
	}
	l.mu.Lock()
	l.entries[key].blocked = time.Now().Add(-time.Second)
	l.mu.Unlock()
	if blocked, _ := l.blocked(key); blocked {
		t.Fatal("expired block should clear")
	}
	l.success(key)
	if _, ok := l.entries[key]; ok {
		t.Fatal("success should clear entry")
	}
	l.fail("other")
	l.success("other")
	if len(l.entries) != 0 {
		t.Fatalf("entries: %#v", l.entries)
	}
}

func TestParseIDAndNormalizeEmail(t *testing.T) {
	w := httptest.NewRecorder()
	if _, ok := parseID(w, "bad"); ok || w.Code != http.StatusNotFound {
		t.Fatalf("bad id: %v %d", ok, w.Code)
	}
	if id, ok := parseID(w, "000000000000000000000001"); !ok || id.IsZero() {
		t.Fatalf("valid id: %v %v", id, ok)
	}
	if got := normalizeEmail("  User@Example.COM "); got != "user@example.com" {
		t.Fatalf("normalize: %q", got)
	}
}

func TestLSPHelpers(t *testing.T) {
	frame := func(body string) *bufio.Reader {
		return bufio.NewReader(strings.NewReader("Content-Length: " + strconv.Itoa(len(body)) + "\r\nX-Test: 1\r\n\r\n" + body))
	}
	if body, err := readLSPFrame(frame(`{"jsonrpc":"2.0"}`)); err != nil || string(body) != `{"jsonrpc":"2.0"}` {
		t.Fatalf("frame: %q %v", body, err)
	}
	if _, err := readLSPFrame(bufio.NewReader(strings.NewReader("Content-Length: 99\r\n\r\n{}"))); err == nil {
		t.Fatal("truncated frame should fail")
	}
	if _, err := readLSPFrame(bufio.NewReader(strings.NewReader("X: 1\r\n\r\n{}"))); err == nil {
		t.Fatal("missing length should fail")
	}
	if _, err := readLSPFrame(bufio.NewReader(strings.NewReader("Content-Length: nope\r\n\r\n"))); err == nil {
		t.Fatal("bad length should fail")
	}
	if _, err := readLSPFrame(bufio.NewReader(strings.NewReader("Content-Length: 999999999\r\n\r\n"))); err == nil {
		t.Fatal("oversized frame should fail")
	}

	s := &Server{cfg: &config.Config{GoPLS: "/bin/true", TSServer: "/bin/true", Node: "node"}}
	if path, args, err := s.lspCommand("go"); err != nil || path != "/bin/true" || len(args) != 0 {
		t.Fatalf("go lsp: %q %#v %v", path, args, err)
	}
	if path, args, err := s.lspCommand("typescript"); err != nil || path != "/bin/true" || len(args) != 1 || args[0] != "--stdio" {
		t.Fatalf("ts lsp: %q %#v %v", path, args, err)
	}
	if _, _, err := s.lspCommand("rust"); err == nil {
		t.Fatal("unsupported language should fail")
	}
	s.cfg.GoPLS = "/no/such/binary"
	if _, _, err := s.lspCommand("go"); err == nil {
		t.Fatal("missing binary should fail")
	}
	s.cfg.GoPLS = "sh"
	if path, _, err := s.lspCommand("go"); err != nil || path == "" {
		t.Fatalf("PATH lookup: %q %v", path, err)
	}
	s.cfg.GoPLS = "definitely-not-installed-goland-test"
	if _, _, err := s.lspCommand("go"); err == nil {
		t.Fatal("missing PATH binary should fail")
	}

	note := lspErrorNotification("boom")
	params := note["params"].(map[string]string)
	if note["method"] != "goland/error" || params["message"] != "boom" {
		t.Fatalf("notification: %#v", note)
	}
	if data := mustJSON(map[string]string{"a": "b"}); string(data) != `{"a":"b"}` {
		t.Fatalf("mustJSON: %s", data)
	}
	id := &isolation.Identity{Home: t.TempDir(), User: "u"}
	if env := lspEnv(id, "/w"); len(env) == 0 {
		t.Fatal("empty lsp env")
	}
}

func TestTerminalHelpers(t *testing.T) {
	id := &isolation.Identity{Home: t.TempDir(), User: "u"}
	env := terminalEnv(id, "/workspace")
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "TERM=xterm-256color") || !strings.Contains(joined, "COLORTERM=truecolor") || !strings.Contains(joined, "GOLAND_WORKSPACE=/workspace") {
		t.Fatalf("terminal env: %s", joined)
	}
	if path := shellPath(); path == "" {
		t.Fatal("shell path empty")
	}
}

func TestOriginAllowed(t *testing.T) {
	s := &Server{cfg: &config.Config{AllowedOrigins: []string{"http://allowed.example"}}}
	cases := []struct {
		host, origin string
		want         bool
	}{
		{"example.com", "", false},
		{"example.com", "http://example.com", true},
		{"example.com", "http://example.com/", true},
		{"example.com", "http://allowed.example", true},
		{"example.com", "http://other.example", false},
		{"example.com", "://bad", false},
	}
	for _, tc := range cases {
		r := httptest.NewRequest(http.MethodGet, "http://"+tc.host+"/", nil)
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		if got := s.originAllowed(r); got != tc.want {
			t.Errorf("host=%q origin=%q: %v want %v", tc.host, tc.origin, got, tc.want)
		}
	}
}

func TestDebugSessionHelpers(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	sess := &debugSession{id: "id", owner: "owner", workspace: "ws", kind: "go", refs: 2}
	s := &Server{debugSess: map[string]*debugSession{"id": sess}, log: log}
	if got := s.findDebugSession("ws", "owner", "go", "id"); got != sess {
		t.Fatal("matching session not found")
	}
	for _, tc := range [][4]string{{"other", "owner", "go", "id"}, {"ws", "other", "go", "id"}, {"ws", "owner", "node", "id"}, {"ws", "owner", "go", "missing"}} {
		if got := s.findDebugSession(tc[0], tc[1], tc[2], tc[3]); got != nil {
			t.Errorf("unexpected session for %#v", tc)
		}
	}
	s.releaseDebug("id")
	if sess.refs != 1 || sess.timer != nil {
		t.Fatalf("refs: %#v", sess)
	}
	s.releaseDebug("id")
	if sess.refs != 0 || sess.timer == nil {
		t.Fatalf("refs: %#v", sess)
	}
	sess.timer.Stop()
	s.releaseDebug("missing")
	s.releaseDebug("id") // negative refs still schedules cleanup
	if sess.timer == nil {
		t.Fatal("expected cleanup timer")
	}
	sess.timer.Stop()

	if len(randomID()) != 24 {
		t.Fatal("randomID length")
	}
	addr := extractListeningAddress("Delve DAP server listening at: 127.0.0.1:12345")
	if addr != "127.0.0.1:12345" {
		t.Fatalf("addr: %q", addr)
	}
	if got := extractListeningAddress("listening at 0.0.0.0:99"); got != "127.0.0.1:99" {
		t.Fatalf("wildcard addr: %q", got)
	}
	if extractListeningAddress("nothing") != "" || extractListeningAddress("listening at bad") != "" {
		t.Fatal("invalid address should be empty")
	}
}

func TestWaitChromePort(t *testing.T) {
	dir := t.TempDir()
	if _, err := waitChromePort(dir, 20*time.Millisecond); err == nil {
		t.Fatal("missing devtools port should time out")
	}
	if err := os.WriteFile(filepath.Join(dir, "DevToolsActivePort"), []byte("4321\n/devtools\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	port, err := waitChromePort(dir, time.Second)
	if err != nil || port != 4321 {
		t.Fatalf("port: %d %v", port, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "DevToolsActivePort"), []byte("bad\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := waitChromePort(dir, 20*time.Millisecond); err == nil {
		t.Fatal("invalid port should time out")
	}
}

func TestReloadChrome(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	mux := http.NewServeMux()
	got := make(chan map[string]any, 1)
	mux.HandleFunc("/json/list", func(w http.ResponseWriter, r *http.Request) {
		port := strings.Split(r.Host, ":")[1]
		_ = json.NewEncoder(w).Encode([]map[string]string{{"type": "page", "webSocketDebuggerUrl": "ws://" + r.Host + "/devtools/page/1"}})
		_ = port
	})
	mux.HandleFunc("/devtools/page/1", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		var msg map[string]any
		_ = conn.ReadJSON(&msg)
		got <- msg
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	var p int
	p, _ = strconv.Atoi(port)
	if err := reloadChrome(p); err != nil {
		t.Fatalf("reload: %v", err)
	}
	select {
	case msg := <-got:
		if msg["method"] != "Page.reload" {
			t.Fatalf("message: %#v", msg)
		}
	case <-time.After(time.Second):
		t.Fatal("no reload message")
	}

	mux2 := http.NewServeMux()
	mux2.HandleFunc("/json/list", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("[]")) })
	srv2 := httptest.NewServer(mux2)
	defer srv2.Close()
	_, port2, _ := net.SplitHostPort(strings.TrimPrefix(srv2.URL, "http://"))
	p, _ = strconv.Atoi(port2)
	if err := reloadChrome(p); err == nil {
		t.Fatal("empty target list should fail")
	}
	if err := reloadChrome(1); err == nil {
		t.Fatal("connection failure should fail")
	}
}

func TestDebugAdapterClose(t *testing.T) {
	server, client := net.Pipe()
	adapter := &debugAdapter{conn: client}
	adapter.Close()
	buf := make([]byte, 1)
	_ = server.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := server.Read(buf); err == nil {
		t.Fatal("pipe should be closed")
	}
	_ = server.Close()
	(&debugAdapter{}).Close()
}

func TestStartDebugAdapterConfigErrors(t *testing.T) {
	s := &Server{cfg: &config.Config{}}
	id := &isolation.Identity{Home: t.TempDir()}
	if _, err := s.startDebugAdapter(t.Context(), "go", t.TempDir(), id); err == nil {
		t.Fatal("missing dlv should fail")
	}
	if _, err := s.startDebugAdapter(t.Context(), "node", t.TempDir(), id); err == nil {
		t.Fatal("missing js-debug should fail")
	}
}
