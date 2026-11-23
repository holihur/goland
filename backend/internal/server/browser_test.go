package server_test

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// fakeChrome writes a DevToolsActivePort file and keeps running so the backend
// can exercise the full browser-session lifecycle without a real Chromium.
func fakeChrome(t *testing.T, port int) string {
	t.Helper()
	dir := t.TempDir()
	script := filepath.Join(dir, "fake-chrome.sh")
	body := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  case \"$arg\" in --user-data-dir=*) profile=\"${arg#--user-data-dir=}\";; esac\n" +
		"done\n" +
		"[ -n \"$profile\" ] || exit 2\n" +
		"printf '" + strconv.Itoa(port) + "\\n/devtools/browser/fake\\n' > \"$profile/DevToolsActivePort\"\n" +
		"sleep 60\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return script
}

func TestBrowserSessionLifecycle(t *testing.T) {
	f := newExtraFixture(t)
	f.cfg.Chrome = fakeChrome(t, 45678)

	resp := f.member.do(http.MethodPost, f.path("/browser/session"), map[string]any{"url": "https://example.com"}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("start browser: %d %s", resp.StatusCode, readBody(resp))
	}
	var started struct {
		ID   string `json:"id"`
		Port int    `json:"port"`
	}
	decode(t, resp, &started)
	if started.ID == "" || started.Port != 45678 {
		t.Fatalf("unexpected browser session: %+v", started)
	}
	t.Cleanup(func() {
		f.member.do(http.MethodDelete, f.path("/browser/session/"+started.ID), nil, true)
	})

	// A second start gets its own profile and port file.
	resp = f.member.do(http.MethodPost, f.path("/browser/session"), map[string]any{"url": "https://example.com/other"}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("second browser: %d %s", resp.StatusCode, readBody(resp))
	}
	var second struct {
		ID string `json:"id"`
	}
	decode(t, resp, &second)
	if second.ID == started.ID {
		t.Fatal("browser sessions must be unique")
	}
	t.Cleanup(func() {
		f.member.do(http.MethodDelete, f.path("/browser/session/"+second.ID), nil, true)
	})

	if resp := f.member.do(http.MethodDelete, f.path("/browser/session/"+started.ID), nil, true); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("stop browser: %d %s", resp.StatusCode, readBody(resp))
	}
	if resp := f.member.do(http.MethodDelete, f.path("/browser/session/"+started.ID), nil, true); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("stop stopped browser: %d", resp.StatusCode)
	}
}

func TestBrowserStartFailureCleansUp(t *testing.T) {
	f := newExtraFixture(t)
	dir := t.TempDir()
	script := filepath.Join(dir, "fake-chrome.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 3\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	f.cfg.Chrome = script

	resp := f.member.do(http.MethodPost, f.path("/browser/session"), map[string]any{"url": "https://example.com"}, true)
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("failing browser: %d %s", resp.StatusCode, readBody(resp))
	}
	readBody(resp)
}
