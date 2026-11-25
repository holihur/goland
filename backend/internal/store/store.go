package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type User struct {
	ID               primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Email            string             `bson:"email" json:"email"`
	Name             string             `bson:"name" json:"name"`
	Role             string             `bson:"role" json:"role"`
	PasswordHash     string             `bson:"passwordHash" json:"-"`
	MFAEnabled       bool               `bson:"mfaEnabled,omitempty" json:"mfaEnabled"`
	MFASecret        string             `bson:"mfaSecret,omitempty" json:"-"`
	MFARecoveryCodes []string           `bson:"mfaRecoveryCodes,omitempty" json:"-"`
	MFAEnrolledAt    *time.Time         `bson:"mfaEnrolledAt,omitempty" json:"mfaEnrolledAt,omitempty"`
	CreatedAt        time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt        time.Time          `bson:"updatedAt" json:"updatedAt"`
}

type Session struct {
	ID          primitive.ObjectID `bson:"_id,omitempty"`
	UserID      primitive.ObjectID `bson:"userId"`
	TokenHash   string             `bson:"tokenHash"`
	ExpiresAt   time.Time          `bson:"expiresAt"`
	CreatedAt   time.Time          `bson:"createdAt"`
	UserAgent   string             `bson:"userAgent,omitempty"`
	MFAVerified bool               `bson:"mfaVerified,omitempty"`
}

type APIToken struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID     primitive.ObjectID `bson:"userId" json:"userId"`
	Name       string             `bson:"name" json:"name"`
	TokenHash  string             `bson:"tokenHash" json:"-"`
	Scopes     []string           `bson:"scopes" json:"scopes"`
	ExpiresAt  *time.Time         `bson:"expiresAt,omitempty" json:"expiresAt,omitempty"`
	LastUsedAt *time.Time         `bson:"lastUsedAt,omitempty" json:"lastUsedAt,omitempty"`
	CreatedAt  time.Time          `bson:"createdAt" json:"createdAt"`
}

type BYOKKey struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID       primitive.ObjectID `bson:"userId" json:"userId"`
	Provider     string             `bson:"provider" json:"provider"`
	Label        string             `bson:"label" json:"label"`
	API          string             `bson:"api" json:"api"`
	BaseURL      string             `bson:"baseUrl" json:"baseUrl"`
	Model        string             `bson:"model" json:"model"`
	EncryptedKey string             `bson:"encryptedKey" json:"-"`
	LastUsedAt   *time.Time         `bson:"lastUsedAt,omitempty" json:"lastUsedAt,omitempty"`
	CreatedAt    time.Time          `bson:"createdAt" json:"createdAt"`
}

type Workspace struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	OwnerID        primitive.ObjectID `bson:"ownerId" json:"ownerId"`
	Name           string             `bson:"name" json:"name"`
	RootPath       string             `bson:"rootPath" json:"rootPath"`
	Source         string             `bson:"source" json:"source"`
	RepoURL        string             `bson:"repoUrl,omitempty" json:"repoUrl,omitempty"`
	Branch         string             `bson:"branch,omitempty" json:"branch,omitempty"`
	Managed        bool               `bson:"managed" json:"managed"`
	EncryptedToken string             `bson:"encryptedToken,omitempty" json:"-"`
	UnixUser       string             `bson:"unixUser,omitempty" json:"-"`
	UnixUID        int                `bson:"unixUid,omitempty" json:"-"`
	UnixGID        int                `bson:"unixGid,omitempty" json:"-"`
	Prepared       bool               `bson:"prepared" json:"-"`
	CreatedAt      time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt      time.Time          `bson:"updatedAt" json:"updatedAt"`
}

type TaskRun struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	WorkspaceID primitive.ObjectID `bson:"workspaceId" json:"workspaceId"`
	OwnerID     primitive.ObjectID `bson:"ownerId" json:"ownerId"`
	Kind        string             `bson:"kind" json:"kind"`
	Command     string             `bson:"command" json:"command"`
	Status      string             `bson:"status" json:"status"`
	ExitCode    int                `bson:"exitCode" json:"exitCode"`
	Output      string             `bson:"output" json:"output"`
	CreatedAt   time.Time          `bson:"createdAt" json:"createdAt"`
	FinishedAt  *time.Time         `bson:"finishedAt,omitempty" json:"finishedAt,omitempty"`
}

type AuditEvent struct {
	ID        primitive.ObjectID  `bson:"_id,omitempty"`
	UserID    *primitive.ObjectID `bson:"userId,omitempty"`
	Action    string              `bson:"action"`
	Resource  string              `bson:"resource,omitempty"`
	IP        string              `bson:"ip,omitempty"`
	Detail    string              `bson:"detail,omitempty"`
	CreatedAt time.Time           `bson:"createdAt"`
}

type Store struct {
	client           *mongo.Client
	db               *mongo.Database
	Users            *mongo.Collection
	Sessions         *mongo.Collection
	Workspaces       *mongo.Collection
	TaskRuns         *mongo.Collection
	Audit            *mongo.Collection
	Plugins          *mongo.Collection
	WorkspacePlugins *mongo.Collection
	APITokens        *mongo.Collection
	BYOKKeys         *mongo.Collection
}

func Connect(ctx context.Context, uri, dbName string) (*Store, error) {
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri).SetServerSelectionTimeout(10*time.Second))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("mongo ping: %w", err)
	}
	db := client.Database(dbName)
	s := &Store{
		client:           client,
		db:               db,
		Users:            db.Collection("users"),
		Sessions:         db.Collection("sessions"),
		Workspaces:       db.Collection("workspaces"),
		TaskRuns:         db.Collection("taskRuns"),
		Audit:            db.Collection("auditEvents"),
		Plugins:          db.Collection("plugins"),
		WorkspacePlugins: db.Collection("workspacePlugins"),
		APITokens:        db.Collection("apiTokens"),
		BYOKKeys:         db.Collection("byokKeys"),
	}
	if err := s.ensureIndexes(ctx); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, err
	}
	return s, nil
}

func (s *Store) ensureIndexes(ctx context.Context) error {
	_, err := s.Users.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "email", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("email_unique"),
	})
	if err != nil {
		return fmt.Errorf("users index: %w", err)
	}
	_, err = s.Sessions.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "tokenHash", Value: 1}}, Options: options.Index().SetUnique(true).SetName("token_unique")},
		{Keys: bson.D{{Key: "expiresAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0).SetName("session_ttl")},
		{Keys: bson.D{{Key: "userId", Value: 1}}, Options: options.Index().SetName("session_user")},
	})
	if err != nil {
		return fmt.Errorf("sessions index: %w", err)
	}
	_, err = s.Workspaces.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "ownerId", Value: 1}, {Key: "updatedAt", Value: -1}},
		Options: options.Index().SetName("workspace_owner"),
	})
	if err != nil {
		return fmt.Errorf("workspaces index: %w", err)
	}
	_, err = s.TaskRuns.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "ownerId", Value: 1}, {Key: "workspaceId", Value: 1}, {Key: "createdAt", Value: -1}},
		Options: options.Index().SetName("task_owner_workspace"),
	})
	if err != nil {
		return fmt.Errorf("taskRuns index: %w", err)
	}
	_, err = s.Audit.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "createdAt", Value: -1}},
		Options: options.Index().SetName("audit_created"),
	})
	if err != nil {
		return fmt.Errorf("audit index: %w", err)
	}
	_, err = s.Plugins.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "installedAt", Value: 1}},
		Options: options.Index().SetName("plugin_installed"),
	})
	if err != nil {
		return fmt.Errorf("plugins index: %w", err)
	}
	_, err = s.WorkspacePlugins.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "workspaceId", Value: 1}, {Key: "pluginId", Value: 1}}, Options: options.Index().SetUnique(true).SetName("workspace_plugin_unique")},
		{Keys: bson.D{{Key: "ownerId", Value: 1}, {Key: "workspaceId", Value: 1}}, Options: options.Index().SetName("workspace_plugin_owner")},
		{Keys: bson.D{{Key: "pluginId", Value: 1}}, Options: options.Index().SetName("workspace_plugin_plugin")},
	})
	if err != nil {
		return fmt.Errorf("workspace plugins index: %w", err)
	}
	_, err = s.APITokens.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "tokenHash", Value: 1}}, Options: options.Index().SetUnique(true).SetName("api_token_unique")},
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}}, Options: options.Index().SetName("api_token_user")},
	})
	if err != nil {
		return fmt.Errorf("api tokens index: %w", err)
	}
	_, err = s.BYOKKeys.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}}, Options: options.Index().SetName("byok_user"),
	})
	if err != nil {
		return fmt.Errorf("byok index: %w", err)
	}
	return nil
}

func (s *Store) Disconnect(ctx context.Context) error { return s.client.Disconnect(ctx) }

func (s *Store) DropDatabase(ctx context.Context) error { return s.db.Drop(ctx) }

func (s *Store) Ping(ctx context.Context) error { return s.client.Ping(ctx, nil) }

func (s *Store) CountUsers(ctx context.Context) (int64, error) {
	return s.Users.CountDocuments(ctx, bson.D{})
}

func (s *Store) CreateUser(ctx context.Context, u *User) error {
	now := time.Now().UTC()
	if u.ID.IsZero() {
		u.ID = primitive.NewObjectID()
	}
	u.CreatedAt, u.UpdatedAt = now, now
	_, err := s.Users.InsertOne(ctx, u)
	if mongo.IsDuplicateKeyError(err) {
		return ErrConflict
	}
	return err
}

func (s *Store) FindUserByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := s.Users.FindOne(ctx, bson.M{"email": email}).Decode(&u)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &u, err
}

func (s *Store) FindUserByID(ctx context.Context, id primitive.ObjectID) (*User, error) {
	var u User
	err := s.Users.FindOne(ctx, bson.M{"_id": id}).Decode(&u)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &u, err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	cur, err := s.Users.Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var users []User
	if err := cur.All(ctx, &users); err != nil {
		return nil, err
	}
	return users, nil
}

func (s *Store) CreateSession(ctx context.Context, sess *Session) error {
	_, err := s.Sessions.InsertOne(ctx, sess)
	return err
}

func (s *Store) FindSessionByHash(ctx context.Context, hash string) (*Session, error) {
	var sess Session
	err := s.Sessions.FindOne(ctx, bson.M{"tokenHash": hash, "expiresAt": bson.M{"$gt": time.Now().UTC()}}).Decode(&sess)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &sess, err
}

func (s *Store) DeleteSessionByHash(ctx context.Context, hash string) error {
	_, err := s.Sessions.DeleteOne(ctx, bson.M{"tokenHash": hash})
	return err
}

func (s *Store) DeleteSessionsForUser(ctx context.Context, userID primitive.ObjectID) error {
	_, err := s.Sessions.DeleteMany(ctx, bson.M{"userId": userID})
	return err
}

func (s *Store) UpdateUserMFA(ctx context.Context, userID primitive.ObjectID, enabled bool, secret string, recoveryCodes []string, enrolledAt *time.Time) error {
	update := bson.M{"$set": bson.M{
		"mfaEnabled": enabled, "mfaSecret": secret, "mfaRecoveryCodes": recoveryCodes,
		"mfaEnrolledAt": enrolledAt, "updatedAt": time.Now().UTC(),
	}}
	_, err := s.Users.UpdateOne(ctx, bson.M{"_id": userID}, update)
	return err
}

func (s *Store) UpdateSessionMFA(ctx context.Context, sessionID primitive.ObjectID, verified bool, expiresAt time.Time) error {
	_, err := s.Sessions.UpdateOne(ctx, bson.M{"_id": sessionID}, bson.M{"$set": bson.M{
		"mfaVerified": verified, "expiresAt": expiresAt,
	}})
	return err
}

func (s *Store) CreateAPIToken(ctx context.Context, token *APIToken) error {
	if token.ID.IsZero() {
		token.ID = primitive.NewObjectID()
	}
	token.CreatedAt = time.Now().UTC()
	_, err := s.APITokens.InsertOne(ctx, token)
	return err
}

func (s *Store) ListAPITokens(ctx context.Context, userID primitive.ObjectID) ([]APIToken, error) {
	cur, err := s.APITokens.Find(ctx, bson.M{"userId": userID}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []APIToken
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) FindAPITokenByHash(ctx context.Context, hash string) (*APIToken, error) {
	var token APIToken
	err := s.APITokens.FindOne(ctx, bson.M{"tokenHash": hash}).Decode(&token)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &token, err
}

func (s *Store) DeleteAPIToken(ctx context.Context, userID, id primitive.ObjectID) error {
	result, err := s.APITokens.DeleteOne(ctx, bson.M{"_id": id, "userId": userID})
	if err != nil {
		return err
	}
	if result.DeletedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) TouchAPIToken(ctx context.Context, id primitive.ObjectID) {
	now := time.Now().UTC()
	_, _ = s.APITokens.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"lastUsedAt": now}})
}

func (s *Store) CreateBYOKKey(ctx context.Context, key *BYOKKey) error {
	if key.ID.IsZero() {
		key.ID = primitive.NewObjectID()
	}
	key.CreatedAt = time.Now().UTC()
	_, err := s.BYOKKeys.InsertOne(ctx, key)
	return err
}

func (s *Store) ListBYOKKeys(ctx context.Context, userID primitive.ObjectID) ([]BYOKKey, error) {
	cur, err := s.BYOKKeys.Find(ctx, bson.M{"userId": userID}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []BYOKKey
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) FindBYOKKey(ctx context.Context, userID, id primitive.ObjectID) (*BYOKKey, error) {
	var key BYOKKey
	err := s.BYOKKeys.FindOne(ctx, bson.M{"_id": id, "userId": userID}).Decode(&key)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &key, err
}

func (s *Store) DeleteBYOKKey(ctx context.Context, userID, id primitive.ObjectID) error {
	result, err := s.BYOKKeys.DeleteOne(ctx, bson.M{"_id": id, "userId": userID})
	if err != nil {
		return err
	}
	if result.DeletedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) TouchBYOKKey(ctx context.Context, id primitive.ObjectID) {
	now := time.Now().UTC()
	_, _ = s.BYOKKeys.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"lastUsedAt": now}})
}

func (s *Store) CreateWorkspace(ctx context.Context, w *Workspace) error {
	now := time.Now().UTC()
	if w.ID.IsZero() {
		w.ID = primitive.NewObjectID()
	}
	w.CreatedAt, w.UpdatedAt = now, now
	_, err := s.Workspaces.InsertOne(ctx, w)
	return err
}

func (s *Store) ListWorkspaces(ctx context.Context, ownerID primitive.ObjectID) ([]Workspace, error) {
	cur, err := s.Workspaces.Find(ctx, bson.M{"ownerId": ownerID}, options.Find().SetSort(bson.D{{Key: "updatedAt", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []Workspace
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) FindWorkspace(ctx context.Context, ownerID, id primitive.ObjectID) (*Workspace, error) {
	var w Workspace
	err := s.Workspaces.FindOne(ctx, bson.M{"_id": id, "ownerId": ownerID}).Decode(&w)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &w, err
}

func (s *Store) UpdateWorkspace(ctx context.Context, w *Workspace) error {
	w.UpdatedAt = time.Now().UTC()
	_, err := s.Workspaces.UpdateOne(ctx, bson.M{"_id": w.ID, "ownerId": w.OwnerID}, bson.M{"$set": bson.M{
		"name": w.Name, "branch": w.Branch, "encryptedToken": w.EncryptedToken,
		"unixUser": w.UnixUser, "unixUid": w.UnixUID, "unixGid": w.UnixGID,
		"prepared": w.Prepared, "updatedAt": w.UpdatedAt,
	}})
	return err
}

func (s *Store) DeleteWorkspace(ctx context.Context, ownerID, id primitive.ObjectID) error {
	res, err := s.Workspaces.DeleteOne(ctx, bson.M{"_id": id, "ownerId": ownerID})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CreateTaskRun(ctx context.Context, t *TaskRun) error {
	if t.ID.IsZero() {
		t.ID = primitive.NewObjectID()
	}
	t.CreatedAt = time.Now().UTC()
	_, err := s.TaskRuns.InsertOne(ctx, t)
	return err
}

func (s *Store) UpdateTaskRun(ctx context.Context, t *TaskRun) error {
	_, err := s.TaskRuns.UpdateOne(ctx, bson.M{"_id": t.ID}, bson.M{"$set": bson.M{
		"status": t.Status, "exitCode": t.ExitCode, "output": t.Output, "finishedAt": t.FinishedAt,
	}})
	return err
}

func (s *Store) ListAllWorkspaces(ctx context.Context) ([]Workspace, error) {
	cur, err := s.Workspaces.Find(ctx, bson.D{})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []Workspace
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) ListTaskRuns(ctx context.Context, ownerID, workspaceID primitive.ObjectID) ([]TaskRun, error) {
	cur, err := s.TaskRuns.Find(ctx, bson.M{"ownerId": ownerID, "workspaceId": workspaceID},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(20))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []TaskRun
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) RecordAudit(ctx context.Context, e *AuditEvent) {
	if e.ID.IsZero() {
		e.ID = primitive.NewObjectID()
	}
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now().UTC()
	}
	_, _ = s.Audit.InsertOne(ctx, e)
}
