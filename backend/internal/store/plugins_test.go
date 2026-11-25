package store

import (
	"context"
	"errors"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestPluginRecordsLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	owner := primitive.NewObjectID()
	workspace := primitive.NewObjectID()
	plugin := &PluginRecord{
		PluginID: "demo", Name: "Demo", Version: "1.0.0", APIVersion: 1,
		Manifest: []byte(`{"id":"demo"}`), PackageDir: "/tmp/demo", InstalledBy: owner,
	}
	if err := st.UpsertPlugin(ctx, plugin); err != nil {
		t.Fatal(err)
	}
	if plugin.InstalledAt.IsZero() || plugin.UpdatedAt.IsZero() {
		t.Fatalf("timestamps not set: %#v", plugin)
	}
	plugin.Version = "1.0.1"
	if err := st.UpsertPlugin(ctx, plugin); err != nil {
		t.Fatal(err)
	}
	plugins, err := st.ListPlugins(ctx)
	if err != nil || len(plugins) != 1 || plugins[0].Version != "1.0.1" {
		t.Fatalf("list plugins: %#v %v", plugins, err)
	}
	found, err := st.FindPlugin(ctx, "demo")
	if err != nil || found.Name != "Demo" || string(found.Manifest) != `{"id":"demo"}` {
		t.Fatalf("find plugin: %#v %v", found, err)
	}
	if _, err := st.FindPlugin(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing plugin: %v", err)
	}

	rec := &WorkspacePluginRecord{
		WorkspaceID: workspace, OwnerID: owner, PluginID: "demo", Enabled: true,
		Config: map[string]any{"token": "secret"},
	}
	if err := st.UpsertWorkspacePlugin(ctx, rec); err != nil {
		t.Fatal(err)
	}
	if rec.UpdatedAt.IsZero() {
		t.Fatalf("workspace updated timestamp not set: %#v", rec)
	}
	rec.Enabled = false
	rec.Config = map[string]any{"token": "updated"}
	if err := st.UpsertWorkspacePlugin(ctx, rec); err != nil {
		t.Fatal(err)
	}
	items, err := st.ListWorkspacePlugins(ctx, owner, workspace)
	if err != nil || len(items) != 1 || items[0].Enabled || items[0].Config["token"] != "updated" {
		t.Fatalf("list workspace plugins: %#v %v", items, err)
	}
	item, err := st.FindWorkspacePlugin(ctx, owner, workspace, "demo")
	if err != nil || item.PluginID != "demo" || item.CreatedAt.IsZero() {
		t.Fatalf("find workspace plugin: %#v %v", item, err)
	}
	if _, err := st.FindWorkspacePlugin(ctx, owner, workspace, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing workspace plugin: %v", err)
	}
	count, err := st.CountWorkspacePlugins(ctx, "demo")
	if err != nil || count != 1 {
		t.Fatalf("count: %d %v", count, err)
	}
	if err := st.DeleteWorkspacePlugin(ctx, owner, workspace, "demo"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.FindWorkspacePlugin(ctx, owner, workspace, "demo"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("workspace plugin still present: %v", err)
	}

	if err := st.UpsertWorkspacePlugin(ctx, rec); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWorkspacePluginsForPlugin(ctx, "demo"); err != nil {
		t.Fatal(err)
	}
	if count, _ := st.CountWorkspacePlugins(ctx, "demo"); count != 0 {
		t.Fatalf("plugin cascade count = %d", count)
	}
	if err := st.UpsertWorkspacePlugin(ctx, rec); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWorkspacePluginsForWorkspace(ctx, owner, workspace); err != nil {
		t.Fatal(err)
	}
	if count, _ := st.CountWorkspacePlugins(ctx, "demo"); count != 0 {
		t.Fatalf("workspace cascade count = %d", count)
	}
	if err := st.DeletePlugin(ctx, "demo"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.FindPlugin(ctx, "demo"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("plugin still present: %v", err)
	}
}
