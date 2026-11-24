import { useCallback, useEffect, useState } from "react";
import { Loader2, Puzzle, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { pluginApi } from "@/lib/plugin-api";
import type { InstalledPlugin } from "@/lib/plugin-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AdminPluginsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await pluginApi.listAdmin();
      setPlugins(result.plugins);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load plugins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const installPath = async () => {
    if (!path.trim()) return;
    setBusy(true);
    try {
      await pluginApi.installFromPath(path.trim());
      setPath("");
      await load();
      toast.success("Plugin installed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Install failed");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await pluginApi.upload(file);
      await load();
      toast.success("Plugin installed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (plugin: InstalledPlugin) => {
    if (!window.confirm(`Uninstall ${plugin.name}? Workspace enablement and configuration will be removed.`)) return;
    setBusy(true);
    try {
      await pluginApi.uninstall(plugin.id);
      await load();
      toast.success("Plugin uninstalled");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Uninstall failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="h-4 w-4" /> Plugins
          </DialogTitle>
          <DialogDescription>
            Install signed-off plugin packages from a server directory or a zip upload. Plugins run as the workspace Unix
            user when enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              aria-label="Plugin server directory"
              placeholder="/srv/goland-plugins/demo"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              disabled={busy}
            />
            <Button size="sm" onClick={() => void installPath()} disabled={busy || !path.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Install path"}
            </Button>
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> Zip
              <input
                aria-label="Upload plugin zip"
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                disabled={busy}
                onChange={(event) => void upload(event.target.files?.[0])}
              />
            </label>
          </div>

          <div className="max-h-[340px] divide-y overflow-auto rounded-md border">
            {loading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
            {!loading && plugins.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">No plugins installed.</div>
            )}
            {plugins.map((plugin) => (
              <div key={plugin.id} className="flex items-center gap-3 p-3" data-plugin-id={plugin.id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{plugin.name}</div>
                  <div className="truncate font-code text-[10px] text-muted-foreground">
                    {plugin.id} · v{plugin.version} · api v{plugin.apiVersion}
                  </div>
                  {plugin.description ? (
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{plugin.description}</div>
                  ) : null}
                </div>
                <button
                  aria-label={`Uninstall ${plugin.name}`}
                  className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-300"
                  disabled={busy}
                  onClick={() => void uninstall(plugin)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
