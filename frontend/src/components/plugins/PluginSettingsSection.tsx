import { useCallback, useEffect, useState } from "react";
import { Loader2, Puzzle, Save } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { pluginApi } from "@/lib/plugin-api";
import {
  pluginConfigDefaults,
  type PluginConfigValues,
  type PluginField,
  type WorkspacePlugin,
} from "@/lib/plugin-types";
import { PluginFieldInput } from "./PluginFieldInput";

function settingsFields(plugin: WorkspacePlugin): Array<PluginField & { configKey: string }> {
  const fields: Array<PluginField & { configKey: string }> = [];
  for (const view of plugin.manifest?.contributes.settings ?? []) {
    for (const field of view.fields) {
      fields.push({ ...field, configKey: `${view.id}.${field.key}` });
    }
  }
  return fields;
}

export function PluginSettingsSection({ workspaceId }: { workspaceId: string }) {
  const [plugins, setPlugins] = useState<WorkspacePlugin[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PluginConfigValues>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await pluginApi.listWorkspace(workspaceId);
      setPlugins(result.plugins);
      const next: Record<string, PluginConfigValues> = {};
      for (const plugin of result.plugins) next[plugin.id] = pluginConfigDefaults(plugin);
      setDrafts(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load plugins");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (plugin: WorkspacePlugin, enabled: boolean) => {
    setSaving(plugin.id);
    try {
      const result = await pluginApi.updateWorkspace(workspaceId, plugin.id, {
        enabled,
        config: drafts[plugin.id] ?? {},
      });
      setPlugins((current) => current.map((item) => (item.id === plugin.id ? result.plugin : item)));
      setDrafts((current) => ({ ...current, [plugin.id]: pluginConfigDefaults(result.plugin) }));
      window.dispatchEvent(new Event("goland:plugins-changed"));
      toast.success(`${plugin.name} ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save plugin settings");
    } finally {
      setSaving("");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading plugins…
      </div>
    );
  }
  if (plugins.length === 0) {
    return <div className="text-[10px] text-muted-foreground">No plugins installed by an administrator.</div>;
  }

  return (
    <div className="space-y-3" data-testid="plugin-settings">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <Puzzle className="h-3 w-3" /> Plugins
      </div>
      {plugins.map((plugin) => {
        const fields = settingsFields(plugin);
        const draft = drafts[plugin.id] ?? {};
        return (
          <div key={plugin.id} className="space-y-2 rounded-md border bg-background/40 p-2" data-plugin-id={plugin.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{plugin.name}</div>
                <div className="truncate font-code text-[10px] text-muted-foreground">
                  {plugin.id} · v{plugin.version}
                </div>
              </div>
              <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label={`Enable ${plugin.name}`}
                  className="h-3.5 w-3.5 accent-sky-500"
                  checked={plugin.enabled}
                  disabled={saving === plugin.id}
                  onChange={(event) => void save(plugin, event.target.checked)}
                />
                On
              </label>
            </div>
            {fields.length > 0 && (
              <div className="space-y-2">
                {fields.map((field) => (
                  <PluginFieldInput
                    key={field.configKey}
                    field={field}
                    value={draft[field.configKey]}
                    disabled={saving === plugin.id}
                    onChange={(value) =>
                      setDrafts((current) => ({
                        ...current,
                        [plugin.id]: { ...(current[plugin.id] ?? {}), [field.configKey]: value },
                      }))
                    }
                  />
                ))}
                <button
                  type="button"
                  className="flex h-7 items-center gap-1.5 rounded border px-2 text-[10px] hover:bg-accent disabled:opacity-50"
                  disabled={saving === plugin.id}
                  onClick={() => void save(plugin, plugin.enabled)}
                >
                  {saving === plugin.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save settings
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
