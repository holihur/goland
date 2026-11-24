package store

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// PluginRecord is an installed plugin package. PluginID is the stable manifest
// id and is used as the Mongo _id.
type PluginRecord struct {
	PluginID    string             `bson:"_id" json:"id"`
	Name        string             `bson:"name" json:"name"`
	Version     string             `bson:"version" json:"version"`
	APIVersion  int                `bson:"apiVersion" json:"apiVersion"`
	Description string             `bson:"description,omitempty" json:"description,omitempty"`
	Manifest    []byte             `bson:"manifest" json:"-"`
	PackageDir  string             `bson:"packageDir" json:"-"`
	InstalledBy primitive.ObjectID `bson:"installedBy" json:"installedBy"`
	InstalledAt time.Time          `bson:"installedAt" json:"installedAt"`
	UpdatedAt   time.Time          `bson:"updatedAt" json:"updatedAt"`
}

// WorkspacePluginRecord stores per-workspace enablement and configuration.
type WorkspacePluginRecord struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	WorkspaceID primitive.ObjectID `bson:"workspaceId" json:"workspaceId"`
	OwnerID     primitive.ObjectID `bson:"ownerId" json:"ownerId"`
	PluginID    string             `bson:"pluginId" json:"pluginId"`
	Enabled     bool               `bson:"enabled" json:"enabled"`
	Config      map[string]any     `bson:"config,omitempty" json:"config"`
	CreatedAt   time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt   time.Time          `bson:"updatedAt" json:"updatedAt"`
}

func (s *Store) UpsertPlugin(ctx context.Context, rec *PluginRecord) error {
	now := time.Now().UTC()
	if rec.InstalledAt.IsZero() {
		rec.InstalledAt = now
	}
	rec.UpdatedAt = now
	_, err := s.Plugins.ReplaceOne(ctx, bson.M{"_id": rec.PluginID}, rec, options.Replace().SetUpsert(true))
	return err
}

func (s *Store) ListPlugins(ctx context.Context) ([]PluginRecord, error) {
	cur, err := s.Plugins.Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "installedAt", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []PluginRecord
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) FindPlugin(ctx context.Context, pluginID string) (*PluginRecord, error) {
	var rec PluginRecord
	err := s.Plugins.FindOne(ctx, bson.M{"_id": pluginID}).Decode(&rec)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &rec, err
}

func (s *Store) DeletePlugin(ctx context.Context, pluginID string) error {
	_, err := s.Plugins.DeleteOne(ctx, bson.M{"_id": pluginID})
	return err
}

func (s *Store) ListWorkspacePlugins(ctx context.Context, ownerID, workspaceID primitive.ObjectID) ([]WorkspacePluginRecord, error) {
	cur, err := s.WorkspacePlugins.Find(ctx, bson.M{"ownerId": ownerID, "workspaceId": workspaceID})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []WorkspacePluginRecord
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) FindWorkspacePlugin(ctx context.Context, ownerID, workspaceID primitive.ObjectID, pluginID string) (*WorkspacePluginRecord, error) {
	var rec WorkspacePluginRecord
	err := s.WorkspacePlugins.FindOne(ctx, bson.M{"ownerId": ownerID, "workspaceId": workspaceID, "pluginId": pluginID}).Decode(&rec)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	return &rec, err
}

func (s *Store) UpsertWorkspacePlugin(ctx context.Context, rec *WorkspacePluginRecord) error {
	now := time.Now().UTC()
	if rec.Config == nil {
		rec.Config = map[string]any{}
	}
	rec.UpdatedAt = now
	filter := bson.M{"ownerId": rec.OwnerID, "workspaceId": rec.WorkspaceID, "pluginId": rec.PluginID}
	update := bson.M{"$set": bson.M{
		"enabled": rec.Enabled, "config": rec.Config, "updatedAt": now,
	}, "$setOnInsert": bson.M{
		"createdAt": now,
	}}
	_, err := s.WorkspacePlugins.UpdateOne(ctx, filter, update, options.Update().SetUpsert(true))
	return err
}

func (s *Store) DeleteWorkspacePlugin(ctx context.Context, ownerID, workspaceID primitive.ObjectID, pluginID string) error {
	_, err := s.WorkspacePlugins.DeleteOne(ctx, bson.M{"ownerId": ownerID, "workspaceId": workspaceID, "pluginId": pluginID})
	return err
}

func (s *Store) DeleteWorkspacePluginsForPlugin(ctx context.Context, pluginID string) error {
	_, err := s.WorkspacePlugins.DeleteMany(ctx, bson.M{"pluginId": pluginID})
	return err
}

func (s *Store) DeleteWorkspacePluginsForWorkspace(ctx context.Context, ownerID, workspaceID primitive.ObjectID) error {
	_, err := s.WorkspacePlugins.DeleteMany(ctx, bson.M{"ownerId": ownerID, "workspaceId": workspaceID})
	return err
}

func (s *Store) CountWorkspacePlugins(ctx context.Context, pluginID string) (int64, error) {
	return s.WorkspacePlugins.CountDocuments(ctx, bson.M{"pluginId": pluginID})
}
