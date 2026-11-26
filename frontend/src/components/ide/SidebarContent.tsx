import { Suspense } from "react";
import type { Workspace } from "@/lib/types";
import type { LSPClient, SourceLocation } from "@/lib/lsp";
import type { SideView } from "@/lib/layout";
import type { usePluginContributions } from "@/lib/usePluginContributions";
import { FileExplorer } from "@/components/editor/FileExplorer";
import { WorkspaceSettings } from "./IDEparts";
import { PluginSidebarPanel } from "@/components/plugins/PluginSidebarPanel";
import { DebugPanel, GitPanel, OutlinePanel, SearchPanel } from "./lazyViews";
import type { EditorTab } from "./EditorGroups";

type PluginRuntime = ReturnType<typeof usePluginContributions>;

export function SidebarContent({
  view,
  workspace,
  activePath,
  activeTab,
  treeKey,
  gitKey,
  lspClients,
  lspTargetForPath,
  breakpoints,
  setBreakpoints,
  plugins,
  openFile,
  openLocation,
  reloadReplacedFiles,
  refreshTree,
  refreshGit,
  showSideView,
}: {
  view: SideView;
  workspace: Workspace;
  activePath: string;
  activeTab: EditorTab | null;
  treeKey: number;
  gitKey: number;
  lspClients: Record<string, LSPClient>;
  lspTargetForPath: (path: string) => { key: string } | null;
  breakpoints: Record<string, number[]>;
  setBreakpoints: (value: Record<string, number[]>) => void;
  plugins: PluginRuntime;
  openFile: (path: string) => Promise<void>;
  openLocation: (location: SourceLocation) => Promise<void>;
  reloadReplacedFiles: (paths: string[]) => Promise<void>;
  refreshTree: () => void;
  refreshGit: () => void;
  showSideView: (view: SideView) => void;
}) {
  return (
    <>
      {view === "explorer" && (
        <FileExplorer workspaceId={workspace.id} refreshKey={treeKey} onOpenFile={openFile} onChanged={refreshTree} />
      )}
      {view === "search" && (
        <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading search…</div>}>
          <SearchPanel
            workspaceId={workspace.id}
            onOpenFile={(path, line, column) => {
              if (line) {
                void openLocation({ path, line, column: column ?? 1, endLine: line, endColumn: column ?? 1 });
              } else {
                void openFile(path);
              }
            }}
            onReplaced={(paths) => void reloadReplacedFiles(paths)}
          />
        </Suspense>
      )}
      {view === "outline" && (
        <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading outline…</div>}>
          <OutlinePanel
            path={activePath}
            lsp={activeTab ? (lspClients[lspTargetForPath(activeTab.path)?.key ?? ""] ?? null) : null}
            onOpenLocation={(location) => void openLocation(location)}
          />
        </Suspense>
      )}
      {view === "git" && (
        <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading source control…</div>}>
          <GitPanel
            workspaceId={workspace.id}
            refreshKey={gitKey}
            onOpenFile={openFile}
            onWorkspaceChanged={refreshGit}
          />
        </Suspense>
      )}
      {view === "debug" && (
        <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading debugger…</div>}>
          <DebugPanel
            workspace={workspace}
            activePath={activeTab?.path ?? ""}
            breakpoints={breakpoints}
            onBreakpointsChange={setBreakpoints}
            onOpenLocation={(location) => void openLocation(location)}
            pluginDebuggers={plugins.enabled.flatMap((plugin) =>
              (plugin.manifest?.contributes.debuggers ?? []).map((dbg) => ({
                pluginId: plugin.id,
                pluginName: plugin.name,
                kind: dbg.kind,
                label: dbg.label,
              })),
            )}
          />
        </Suspense>
      )}
      {view === "settings" && <WorkspaceSettings workspace={workspace} />}
      <PluginSidebarPanel
        view={view}
        workspace={workspace}
        plugins={plugins.enabled}
        panels={plugins.panels}
        outputs={plugins.outputs}
        status={plugins.status}
        execute={plugins.execute}
        cancel={plugins.cancel}
        onConfigure={() => showSideView("settings")}
        onOpenFile={(path, line) => void openLocation({ path, line, column: 1, endLine: line, endColumn: 1 })}
      />
    </>
  );
}
