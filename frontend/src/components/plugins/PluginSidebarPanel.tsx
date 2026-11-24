import type { SideView } from "@/lib/layout";
import type { WorkspacePlugin } from "@/lib/plugin-types";
import type { PluginPanelState } from "@/lib/usePlugins";
import { PluginPanel } from "./PluginPanel";

export function PluginSidebarPanel({
  view,
  plugins,
  panels,
  outputs,
  execute,
  cancel,
}: {
  view: SideView;
  plugins: WorkspacePlugin[];
  panels: Record<string, PluginPanelState>;
  outputs: Record<string, string>;
  execute: (
    pluginId: string,
    commandId: string,
    input?: { inputs?: Record<string, unknown>; path?: string; requestId?: string },
  ) => Promise<{ requestId: string; output: string }>;
  cancel: (pluginId: string, requestId: string) => Promise<void>;
}) {
  if (!view.startsWith("plugin:")) return null;
  const value = view.slice("plugin:".length);
  const separator = value.indexOf(":");
  const plugin = separator > 0 ? plugins.find((item) => item.id === value.slice(0, separator)) : undefined;
  const panel = plugin?.manifest?.contributes.panels?.find((item) => item.id === value.slice(separator + 1));
  if (!plugin || !panel) {
    return <div className="p-3 text-[10px] text-muted-foreground">This plugin panel is not available.</div>;
  }
  return (
    <PluginPanel
      plugin={plugin}
      panel={panel}
      runtime={panels[`${plugin.id}:${panel.id}`]}
      outputs={outputs}
      execute={execute}
      cancel={cancel}
    />
  );
}
