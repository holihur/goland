package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"goland/internal/store"
)

func testStore(t *testing.T) *store.Store {
	t.Helper()
	uri := os.Getenv("GOLAND_TEST_MONGO_URI")
	if uri == "" {
		uri = "mongodb://127.0.0.1:27019"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := store.Connect(ctx, uri, "goland_auth_test_"+time.Now().Format("150405000000000"))
	if err != nil {
		t.Skipf("MongoDB unavailable: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DropDatabase(context.Background())
		_ = st.Disconnect(context.Background())
	})
	return st
}

func TestPasswordHashAndVerify(t *testing.T) {
	st := testStore(t)
	m := NewManager(st, time.Hour, false)
	hash, err := m.HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Fatalf("hash format: %q", hash)
	}
	if !VerifyPassword(hash, "correct horse") {
		t.Fatal("valid password rejected")
	}
	for _, bad := range []string{"", "wrong", "correct horse "} {
		if VerifyPassword(hash, bad) {
			t.Fatalf("bad password %q accepted", bad)
		}
	}
	for _, malformed := range []string{"", "x", "$argon2id$v=19$m=1$bad", "$bad$v=19$m=1,t=1,p=1$c2FsdA$a2V5", "$argon2id$v=20$m=1,t=1,p=1$c2FsdA$a2V5", "$argon2id$v=19$bad$c2FsdA$a2V5", "$argon2id$v=19$m=1,t=1,p=1$!!!$!!!"} {
		if VerifyPassword(malformed, "x") {
			t.Fatalf("malformed hash accepted: %q", malformed)
		}
	}
}

func TestRandomTokenAndHash(t *testing.T) {
	a, err := RandomToken(32)
	if err != nil || len(a) < 40 {
		t.Fatalf("token: %q %v", a, err)
	}
	b, _ := RandomToken(32)
	if a == b {
		t.Fatal("tokens should differ")
	}
	if TokenHash(a) == a || TokenHash(a) != TokenHash(a) || len(TokenHash(a)) != 64 {
		t.Fatal("unexpected token hash")
	}
}

func TestLoginAuthenticateLogout(t *testing.T) {
	st := testStore(t)
	m := NewManager(st, time.Hour, true)
	hash, _ := m.HashPassword("password-123")
	user := &store.User{Email: "user@example.com", Name: "User", Role: "admin", PasswordHash: hash}
	if err := st.CreateUser(context.Background(), user); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	req.Header.Set("User-Agent", "test-agent")
	session, csrf, err := m.Login(context.Background(), user, req)
	if err != nil || session == "" || csrf == "" {
		t.Fatalf("Login: %q %q %v", session, csrf, err)
	}
	sess, err := st.FindSessionByHash(context.Background(), TokenHash(session))
	if err != nil || sess.UserID != user.ID || sess.UserAgent != "test-agent" {
		t.Fatalf("session: %#v %v", sess, err)
	}

	rr := httptest.NewRecorder()
	m.SetCookies(rr, session, csrf)
	cookies := rr.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != SessionCookie || !cookies[0].HttpOnly || cookies[0].Secure != true {
		t.Fatalf("cookies: %#v", cookies)
	}
	if cookies[1].Name != CSRFCookie || cookies[1].HttpOnly {
		t.Fatalf("csrf cookie: %#v", cookies[1])
	}
	rr = httptest.NewRecorder()
	m.ClearCookies(rr)
	if len(rr.Result().Cookies()) != 2 || rr.Result().Cookies()[0].MaxAge != -1 {
		t.Fatalf("clear cookies: %#v", rr.Result().Cookies())
	}

	var got *store.User
	handler := m.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = UserFrom(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: session})
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent || got == nil || got.ID != user.ID || !IsAdmin(got) {
		t.Fatalf("authenticate: %d %#v", rr.Code, got)
	}
	if IsAdmin(nil) || IsAdmin(&store.User{Role: "member"}) {
		t.Fatal("IsAdmin mismatch")
	}
	if UserFrom(context.Background()) != nil {
		t.Fatal("UserFrom on empty context should be nil")
	}

	for _, c := range []*http.Cookie{nil, {Name: SessionCookie, Value: ""}, {Name: SessionCookie, Value: "missing"}} {
		req = httptest.NewRequest(http.MethodGet, "/", nil)
		if c != nil {
			req.AddCookie(c)
		}
		rr = httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("cookie %#v: %d", c, rr.Code)
		}
	}

	req = httptest.NewRequest(http.MethodPost, "/", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: session})
	m.Logout(context.Background(), req)
	if _, err := st.FindSessionByHash(context.Background(), TokenHash(session)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("logout session: %v", err)
	}
	// Logout without a session is a no-op.
	m.Logout(context.Background(), httptest.NewRequest(http.MethodPost, "/", nil))
}

func TestCSRF(t *testing.T) {
	m := NewManager(nil, time.Hour, false)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	handler := m.CSRF(next)
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, httptest.NewRequest(method, "/", nil))
		if rr.Code != http.StatusNoContent {
			t.Errorf("%s: %d", method, rr.Code)
		}
	}
	for _, tc := range []struct {
		name   string
		cookie string
		header string
	}{
		{"missing both", "", ""},
		{"missing cookie", "", "x"},
		{"missing header", "x", ""},
		{"mismatch", "x", "y"},
	} {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		if tc.cookie != "" {
			req.AddCookie(&http.Cookie{Name: CSRFCookie, Value: tc.cookie})
		}
		if tc.header != "" {
			req.Header.Set(CSRFHeader, tc.header)
		}
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Errorf("%s: %d", tc.name, rr.Code)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.AddCookie(&http.Cookie{Name: CSRFCookie, Value: "token"})
	req.Header.Set(CSRFHeader, "token")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("valid csrf: %d", rr.Code)
	}
}

func TestCreateSessionStub(t *testing.T) {
	m := NewManager(nil, time.Hour, false)
	if _, _, _, err := m.CreateSession(context.Background(), primitive.NilObjectID, nil); err == nil {
		t.Fatal("stub should return an error")
	}
}

func TestRequireMFASetupAndVerification(t *testing.T) {
	st := testStore(t)
	m := NewManager(st, time.Hour, false)
	hash, _ := m.HashPassword("password-123")
	user := &store.User{Email: "mfa@example.com", Name: "MFA", Role: "member", PasswordHash: hash}
	if err := st.CreateUser(context.Background(), user); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	session, _, err := m.CreateSessionForUser(context.Background(), user, req, false, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	handler := m.Authenticate(m.RequireMFA(true)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
		req.AddCookie(&http.Cookie{Name: SessionCookie, Value: session})
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}
	if code := call(); code != http.StatusForbidden {
		t.Fatalf("forced setup code: %d", code)
	}

	// MFA setup endpoints stay reachable for the unverified session.
	req = httptest.NewRequest(http.MethodPost, "/api/auth/mfa/setup", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: session})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("mfa setup path blocked: %d", rr.Code)
	}

	if err := st.UpdateUserMFA(context.Background(), user.ID, true, "secret", nil, nil); err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: session})
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("unverified MFA code: %d", rr.Code)
	}
	if err := st.UpdateSessionMFA(context.Background(), func() primitive.ObjectID {
		sess, _ := st.FindSessionByHash(context.Background(), TokenHash(session))
		return sess.ID
	}(), true, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	m.InvalidateUser(user.ID)
	if code := call(); code != http.StatusNoContent {
		t.Fatalf("verified MFA code: %d", code)
	}
}
