import { Puzzle } from "lucide-react";
import type { WorkspacePlugin } from "@/lib/plugin-types";
import type { PluginStatusState } from "@/lib/usePlugins";

export function PluginStatusBar({
  plugins,
  status,
  onRun,
}: {
  plugins: WorkspacePlugin[];
  status: Record<string, PluginStatusState>;
  onRun: (plugin: WorkspacePlugin, command: string) => void;
}) {
  return (
    <>
      {plugins.flatMap((plugin) =>
        (plugin.manifest?.contributes.status ?? []).map((item) => {
          const state = status[`${plugin.id}:${item.id}`];
          return (
            <button
              key={`${plugin.id}:${item.id}`}
              type="button"
              title={state?.tooltip ?? item.tooltip}
              className="hidden items-center gap-1 hover:text-foreground sm:flex"
              onClick={() => (item.command ? onRun(plugin, item.command) : undefined)}
            >
              <Puzzle className="h-3 w-3" /> {state?.text ?? item.text}
            </button>
          );
        }),
      )}
    </>
  );
}
