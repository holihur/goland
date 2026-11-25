package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestAPITokenLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	user := &User{Email: "tokens@example.com", Name: "Tokens", Role: "member"}
	if err := st.CreateUser(ctx, user); err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(time.Hour).UTC()
	token := &APIToken{UserID: user.ID, Name: "ci", TokenHash: "hash-1", Scopes: []string{"read"}, ExpiresAt: &expires}
	if err := st.CreateAPIToken(ctx, token); err != nil {
		t.Fatal(err)
	}
	if token.ID.IsZero() || token.CreatedAt.IsZero() {
		t.Fatalf("token fields: %#v", token)
	}
	list, err := st.ListAPITokens(ctx, user.ID)
	if err != nil || len(list) != 1 || list[0].Name != "ci" {
		t.Fatalf("list: %#v %v", list, err)
	}
	found, err := st.FindAPITokenByHash(ctx, "hash-1")
	if err != nil || found.UserID != user.ID {
		t.Fatalf("find: %#v %v", found, err)
	}
	if _, err := st.FindAPITokenByHash(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing token: %v", err)
	}
	st.TouchAPIToken(ctx, token.ID)
	updated, _ := st.FindAPITokenByHash(ctx, "hash-1")
	if updated.LastUsedAt == nil {
		t.Fatal("last used not updated")
	}
	if err := st.DeleteAPIToken(ctx, user.ID, token.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteAPIToken(ctx, user.ID, token.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing: %v", err)
	}
}

func TestBYOKLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	user := &User{Email: "byok@example.com", Name: "BYOK", Role: "member"}
	if err := st.CreateUser(ctx, user); err != nil {
		t.Fatal(err)
	}
	key := &BYOKKey{
		UserID: user.ID, Provider: "openai", Label: "Main",
		BaseURL: "https://api.openai.com/v1", Model: "test-model", EncryptedKey: "ciphertext",
	}
	if err := st.CreateBYOKKey(ctx, key); err != nil {
		t.Fatal(err)
	}
	list, err := st.ListBYOKKeys(ctx, user.ID)
	if err != nil || len(list) != 1 || list[0].EncryptedKey != "ciphertext" {
		t.Fatalf("list byok: %#v %v", list, err)
	}
	found, err := st.FindBYOKKey(ctx, user.ID, key.ID)
	if err != nil || found.Model != "test-model" {
		t.Fatalf("find byok: %#v %v", found, err)
	}
	if _, err := st.FindBYOKKey(ctx, user.ID, primitive.NewObjectID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing byok: %v", err)
	}
	st.TouchBYOKKey(ctx, key.ID)
	updated, _ := st.FindBYOKKey(ctx, user.ID, key.ID)
	if updated.LastUsedAt == nil {
		t.Fatal("last used not updated")
	}
	if err := st.DeleteBYOKKey(ctx, user.ID, key.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteBYOKKey(ctx, user.ID, key.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing byok: %v", err)
	}
}
