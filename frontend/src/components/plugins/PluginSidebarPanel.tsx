import type { SideView } from "@/lib/layout";
import type { WorkspacePlugin } from "@/lib/plugin-types";
import type { Workspace } from "@/lib/types";
import { PluginFrontendView } from "./PluginFrontendView";
import type { PluginPanelState } from "@/lib/usePlugins";
import { PluginPanel } from "./PluginPanel";

export function PluginSidebarPanel({
  view,
  workspace,
  plugins,
  panels,
  outputs,
  execute,
  cancel,
  onOpenFile,
  onConfigure,
}: {
  view: SideView;
  workspace: Workspace;
  plugins: WorkspacePlugin[];
  panels: Record<string, PluginPanelState>;
  outputs: Record<string, string>;
  execute: (
    pluginId: string,
    commandId: string,
    input?: { inputs?: Record<string, unknown>; path?: string; requestId?: string },
  ) => Promise<{ requestId: string; output: string }>;
  cancel: (pluginId: string, requestId: string) => Promise<void>;
  onOpenFile?: (path: string, line: number) => void;
  onConfigure?: () => void;
}) {
  if (!view.startsWith("plugin:")) return null;
  const value = view.slice("plugin:".length);
  const separator = value.indexOf(":");
  const plugin = separator > 0 ? plugins.find((item) => item.id === value.slice(0, separator)) : undefined;
  const contributionID = value.slice(separator + 1);
  const panel = plugin?.manifest?.contributes.panels?.find((item) => item.id === contributionID);
  const frontend = plugin?.manifest?.contributes.frontends?.find((item) => item.id === contributionID);
  if (!plugin || (!panel && !frontend)) {
    return <div className="p-3 text-[10px] text-muted-foreground">This plugin panel is not available.</div>;
  }
  if (frontend && !panel) {
    return (
      <PluginFrontendView
        plugin={plugin}
        frontend={frontend}
        workspace={workspace}
        execute={execute}
        cancel={cancel}
        outputs={outputs}
        onOpenFile={onOpenFile}
        onConfigure={onConfigure}
      />
    );
  }
  if (!panel) return null;
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
