import { GitBranch } from "lucide-react";
import type { Workspace } from "@/lib/types";
import type { WorkspacePlugin } from "@/lib/plugin-types";
import type { PluginStatusState } from "@/lib/usePlugins";
import type { EditorTab } from "./EditorGroups";
import { CheckDot } from "./IDEparts";
import { PluginStatusBar } from "@/components/plugins/PluginStatusBar";
import { cn, fileLanguage } from "@/lib/utils";

export function IdeFooter({
  workspace,
  activeTab,
  lineCount,
  lspStatus,
  plugins,
  status,
  pluginErrors,
  onRun,
}: {
  workspace: Workspace;
  activeTab: EditorTab | null;
  lineCount: number;
  lspStatus: Record<string, string>;
  plugins: WorkspacePlugin[];
  status: Record<string, PluginStatusState>;
  pluginErrors?: Record<string, string>;
  onRun: (plugin: WorkspacePlugin, command: string) => void;
}) {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-panel px-2 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {workspace.branch || "local"}
        </span>
        {activeTab && (
          <span>
            {fileLanguage(activeTab.path)} · Ln {lineCount}
            {activeTab.dirty ? " · modified" : ""}
          </span>
        )}
        <span className="hidden items-center gap-1 sm:flex">
          <CheckDot /> UTF-8
        </span>
        <span className="hidden sm:inline">Spaces: 2</span>
        {Object.entries(lspStatus).map(([language, state]) => (
          <span key={language} className="hidden items-center gap-1 md:flex" title={`${language} language server: ${state}`}>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                state === "ready" ? "bg-emerald-400" : state === "connecting" ? "bg-amber-400" : "bg-red-400",
              )}
            />
            {language === "go" ? "Go" : language === "typescript" ? "TS" : language.split(":").pop()}
          </span>
        ))}
        <PluginStatusBar plugins={plugins} status={status} errors={pluginErrors} onRun={onRun} />
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">{workspace.rootPath}</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Connected
        </span>
      </div>
    </footer>
  );
}
