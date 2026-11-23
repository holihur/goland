package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"goland/internal/store"
)

type browserSession struct {
	id        string
	owner     string
	workspace string
	port      int
	cmd       *exec.Cmd
	dir       string
	tmp       string
	exit      <-chan struct{}
}

func (s *Server) startBrowser(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	var body struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &body, 64<<10) {
		return
	}
	target, err := url.Parse(strings.TrimSpace(body.URL))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
		writeError(w, http.StatusBadRequest, "invalid_url", "a valid http(s) URL is required")
		return
	}
	if s.cfg.Chrome == "" {
		writeError(w, http.StatusServiceUnavailable, "chrome_unavailable", "Chromium is not configured")
		return
	}
	root, err := s.workspaces.Resolve(ws)
	if err != nil {
		writeError(w, http.StatusBadRequest, "workspace_unavailable", err.Error())
		return
	}
	identity, err := s.workspaces.Identity(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "isolation_failed", err.Error())
		return
	}
	id := randomID()
	// Chromium's process-singleton Unix socket lives inside the profile dir; long
	// workspace home paths (CI) exceed the socket path limit, so use /tmp.
	base := filepath.Join(os.TempDir(), "goland-browser")
	if err := os.MkdirAll(base, 0o711); err != nil {
		writeError(w, http.StatusInternalServerError, "chrome_failed", err.Error())
		return
	}
	_ = os.Chmod(base, 0o711)
	dir := filepath.Join(base, "chrome-"+id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeError(w, http.StatusInternalServerError, "chrome_failed", err.Error())
		return
	}
	_ = os.Chown(dir, int(identity.UID), int(identity.GID))
	// Chromium creates the process-singleton socket under TMPDIR; keep that
	// short too, otherwise long workspace home paths exceed the socket limit.
	tmpDir := filepath.Join(base, "tmp-"+id)
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		writeError(w, http.StatusInternalServerError, "chrome_failed", err.Error())
		return
	}
	_ = os.Chown(tmpDir, int(identity.UID), int(identity.GID))
	args := []string{
		"--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
		"--disable-extensions", "--no-first-run", "--remote-debugging-port=0",
		"--user-data-dir=" + dir, target.String(),
	}
	cmd := exec.Command(s.cfg.Chrome, args...)
	cmd.Dir = root
	cmd.Env = append(identity.Env(root), "TMPDIR="+tmpDir, "TMP="+tmpDir, "TEMP="+tmpDir)
	identity.Apply(cmd)
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusBadGateway, "chrome_failed", "could not start Chromium: "+err.Error())
		return
	}
	exitCh := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(exitCh)
	}()
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			s.log.Info("chromium", "line", scanner.Text())
		}
	}()
	port, err := waitChromePort(dir, 60*time.Second, exitCh)
	if err != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		<-exitCh
		_ = os.RemoveAll(tmpDir)
		_ = os.RemoveAll(dir)
		writeError(w, http.StatusBadGateway, "chrome_failed", err.Error())
		return
	}
	sess := &browserSession{id: id, owner: ws.OwnerID.Hex(), workspace: ws.ID.Hex(), port: port, cmd: cmd, dir: dir, tmp: tmpDir, exit: exitCh}
	s.debugMu.Lock()
	if s.browsers == nil {
		s.browsers = make(map[string]*browserSession)
	}
	s.browsers[id] = sess
	s.debugMu.Unlock()
	s.audit(r, "browser.start", ws.ID.Hex(), target.String())
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "port": port})
}

func (s *Server) stopBrowser(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "browserID")
	s.debugMu.Lock()
	sess := s.browsers[id]
	if sess != nil && (sess.owner != ws.OwnerID.Hex() || sess.workspace != ws.ID.Hex()) {
		sess = nil
	}
	if sess != nil {
		delete(s.browsers, id)
	}
	s.debugMu.Unlock()
	if sess == nil {
		writeError(w, http.StatusNotFound, "not_found", "browser session not found")
		return
	}
	_ = syscall.Kill(-sess.cmd.Process.Pid, syscall.SIGKILL)
	<-sess.exit
	_ = os.RemoveAll(sess.dir)
	if sess.tmp != "" {
		_ = os.RemoveAll(sess.tmp)
	}
	s.audit(r, "browser.stop", ws.ID.Hex(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reloadBrowser(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "browserID")
	s.debugMu.Lock()
	sess := s.browsers[id]
	if sess != nil && (sess.owner != ws.OwnerID.Hex() || sess.workspace != ws.ID.Hex()) {
		sess = nil
	}
	s.debugMu.Unlock()
	if sess == nil {
		writeError(w, http.StatusNotFound, "not_found", "browser session not found")
		return
	}
	if err := reloadChrome(sess.port); err != nil {
		writeError(w, http.StatusBadGateway, "reload_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func reloadChrome(port int) error {
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/json/list", port))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var targets []struct {
		Type string `json:"type"`
		WS   string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&targets); err != nil {
		return err
	}
	for _, target := range targets {
		if target.Type != "page" || target.WS == "" {
			continue
		}
		conn, _, err := websocket.DefaultDialer.Dial(target.WS, nil)
		if err != nil {
			return err
		}
		_ = conn.WriteJSON(map[string]any{"id": 1, "method": "Page.reload", "params": map[string]any{"ignoreCache": true}})
		time.Sleep(150 * time.Millisecond)
		_ = conn.Close()
		return nil
	}
	return errors.New("no page target to reload")
}

func waitChromePort(dir string, timeout time.Duration, exited ...<-chan struct{}) (int, error) {
	deadline := time.Now().Add(timeout)
	path := filepath.Join(dir, "DevToolsActivePort")
	for time.Now().Before(deadline) {
		if len(exited) > 0 && exited[0] != nil {
			select {
			case <-exited[0]:
				return 0, fmt.Errorf("Chromium exited before exposing a DevTools port")
			default:
			}
		}
		data, err := os.ReadFile(path)
		if err == nil {
			line := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)[0]
			port, err := strconv.Atoi(strings.TrimSpace(line))
			if err == nil && port > 0 {
				return port, nil
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	return 0, errors.New("Chromium did not expose a DevTools port")
}

var (
	_ = context.Background
	_ = fmt.Sprint
	_ = store.ErrNotFound
	_ = sync.Mutex{}
)
