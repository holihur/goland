package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	uri := os.Getenv("GOLAND_TEST_MONGO_URI")
	if uri == "" {
		uri = "mongodb://127.0.0.1:27019"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := Connect(ctx, uri, "goland_store_test_"+time.Now().Format("150405000000000"))
	if err != nil {
		t.Skipf("MongoDB unavailable: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DropDatabase(context.Background())
		_ = st.Disconnect(context.Background())
	})
	return st
}

func TestConnectionAndIndexes(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	if err := st.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	cur, err := st.Users.Indexes().List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var indexes []bson.M
	if err := cur.All(ctx, &indexes); err != nil || len(indexes) < 2 {
		t.Fatalf("indexes: %#v %v", indexes, err)
	}
}

func TestUserLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	u := &User{Email: "a@example.com", Name: "A", Role: "member", PasswordHash: "hash"}
	if err := st.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	if u.ID.IsZero() || u.CreatedAt.IsZero() || u.UpdatedAt.IsZero() {
		t.Fatalf("timestamps: %#v", u)
	}
	if n, err := st.CountUsers(ctx); err != nil || n != 1 {
		t.Fatalf("count: %d %v", n, err)
	}
	got, err := st.FindUserByEmail(ctx, "a@example.com")
	if err != nil || got.ID != u.ID || got.Email != u.Email {
		t.Fatalf("find email: %#v %v", got, err)
	}
	got, err = st.FindUserByID(ctx, u.ID)
	if err != nil || got.Name != "A" {
		t.Fatalf("find id: %#v %v", got, err)
	}
	if _, err := st.FindUserByEmail(ctx, "missing@example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing email: %v", err)
	}
	if _, err := st.FindUserByID(ctx, primitive.NewObjectID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing id: %v", err)
	}
	if err := st.CreateUser(ctx, &User{Email: "a@example.com"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate: %v", err)
	}
	if err := st.CreateUser(ctx, &User{Email: "b@example.com", Name: "B"}); err != nil {
		t.Fatal(err)
	}
	users, err := st.ListUsers(ctx)
	if err != nil || len(users) != 2 || users[0].Email != "a@example.com" {
		t.Fatalf("list users: %#v %v", users, err)
	}
}

func TestSessionLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	userID := primitive.NewObjectID()
	now := time.Now().UTC()
	sess := &Session{UserID: userID, TokenHash: "hash", ExpiresAt: now.Add(time.Hour), CreatedAt: now, UserAgent: "test"}
	if err := st.CreateSession(ctx, sess); err != nil {
		t.Fatal(err)
	}
	got, err := st.FindSessionByHash(ctx, "hash")
	if err != nil || got.UserID != userID || got.UserAgent != "test" {
		t.Fatalf("find session: %#v %v", got, err)
	}
	if _, err := st.FindSessionByHash(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing session: %v", err)
	}
	expired := &Session{UserID: userID, TokenHash: "expired", ExpiresAt: now.Add(-time.Hour), CreatedAt: now}
	if err := st.CreateSession(ctx, expired); err != nil {
		t.Fatal(err)
	}
	if _, err := st.FindSessionByHash(ctx, "expired"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session: %v", err)
	}
	if err := st.DeleteSessionByHash(ctx, "hash"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.FindSessionByHash(ctx, "hash"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted session: %v", err)
	}
	if err := st.CreateSession(ctx, &Session{UserID: userID, TokenHash: "one", ExpiresAt: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteSessionsForUser(ctx, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.FindSessionByHash(ctx, "one"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("sessions for user: %v", err)
	}
}

func TestWorkspaceLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	owner, other := primitive.NewObjectID(), primitive.NewObjectID()
	w := &Workspace{OwnerID: owner, Name: "one", RootPath: "/tmp/one", Source: "local"}
	if err := st.CreateWorkspace(ctx, w); err != nil {
		t.Fatal(err)
	}
	if w.ID.IsZero() || w.CreatedAt.IsZero() {
		t.Fatalf("workspace fields: %#v", w)
	}
	if got, err := st.FindWorkspace(ctx, owner, w.ID); err != nil || got.Name != "one" {
		t.Fatalf("find: %#v %v", got, err)
	}
	if _, err := st.FindWorkspace(ctx, other, w.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross owner: %v", err)
	}
	w.Name, w.Branch, w.EncryptedToken = "renamed", "main", "secret"
	w.UnixUser, w.UnixUID, w.UnixGID, w.Prepared = "u", 123, 456, true
	if err := st.UpdateWorkspace(ctx, w); err != nil {
		t.Fatal(err)
	}
	got, _ := st.FindWorkspace(ctx, owner, w.ID)
	if got.Name != "renamed" || got.Branch != "main" || got.UnixUID != 123 || !got.Prepared {
		t.Fatalf("update: %#v", got)
	}
	if err := st.CreateWorkspace(ctx, &Workspace{OwnerID: owner, Name: "two", RootPath: "/tmp/two"}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateWorkspace(ctx, &Workspace{OwnerID: other, Name: "other", RootPath: "/tmp/other"}); err != nil {
		t.Fatal(err)
	}
	list, err := st.ListWorkspaces(ctx, owner)
	if err != nil || len(list) != 2 || list[0].Name != "two" {
		t.Fatalf("list: %#v %v", list, err)
	}
	all, err := st.ListAllWorkspaces(ctx)
	if err != nil || len(all) != 3 {
		t.Fatalf("all: %#v %v", all, err)
	}
	if err := st.DeleteWorkspace(ctx, other, w.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross delete: %v", err)
	}
	if err := st.DeleteWorkspace(ctx, owner, w.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWorkspace(ctx, owner, w.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete twice: %v", err)
	}
}

func TestTaskRunsAndAudit(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	owner, workspace := primitive.NewObjectID(), primitive.NewObjectID()
	for i := 0; i < 3; i++ {
		run := &TaskRun{WorkspaceID: workspace, OwnerID: owner, Kind: "go", Command: "go test", Status: "running"}
		if err := st.CreateTaskRun(ctx, run); err != nil {
			t.Fatal(err)
		}
		if run.ID.IsZero() || run.CreatedAt.IsZero() {
			t.Fatalf("run fields: %#v", run)
		}
		now := time.Now().UTC()
		run.Status, run.ExitCode, run.Output, run.FinishedAt = "success", 0, "ok", &now
		if err := st.UpdateTaskRun(ctx, run); err != nil {
			t.Fatal(err)
		}
		time.Sleep(2 * time.Millisecond)
	}
	runs, err := st.ListTaskRuns(ctx, owner, workspace)
	if err != nil || len(runs) != 3 || runs[0].Status != "success" {
		t.Fatalf("runs: %#v %v", runs, err)
	}
	if other, _ := st.ListTaskRuns(ctx, primitive.NewObjectID(), workspace); len(other) != 0 {
		t.Fatalf("other owner runs: %#v", other)
	}
	if err := st.CreateTaskRun(ctx, &TaskRun{WorkspaceID: workspace, OwnerID: primitive.NewObjectID()}); err != nil {
		t.Fatal(err)
	}
	event := &AuditEvent{UserID: &owner, Action: "test", Resource: "w", Detail: "d", IP: "127.0.0.1"}
	st.RecordAudit(ctx, event)
	if event.ID.IsZero() || event.CreatedAt.IsZero() {
		t.Fatalf("audit fields: %#v", event)
	}
	event2 := &AuditEvent{Action: "test2", CreatedAt: time.Now().UTC()}
	st.RecordAudit(ctx, event2)
	count, err := st.Audit.CountDocuments(ctx, bson.D{})
	if err != nil || count != 2 {
		t.Fatalf("audit count: %d %v", count, err)
	}
}
