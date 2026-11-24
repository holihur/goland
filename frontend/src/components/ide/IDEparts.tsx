import type { ReactNode } from "react";
import { Bug, FileCode2, Files, GitBranch, Keyboard, Puzzle, RotateCw, Search, Settings2, TerminalSquare } from "lucide-react";
import type { Workspace } from "@/lib/types";
import type { SourceLocation } from "@/lib/lsp";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PluginSettingsSection } from "@/components/plugins/PluginSettingsSection";
import type { SideView } from "@/lib/layout";

export type { SideView };

export interface PluginPanelEntry {
  view: SideView;
  title: string;
}

export function ActivityBar({
  view,
  sidebarOpen,
  onSelect,
  onPalette,
  pluginPanels = [],
}: {
  view: SideView;
  sidebarOpen: boolean;
  onSelect: (view: SideView) => void;
  onPalette: () => void;
  pluginPanels?: PluginPanelEntry[];
}) {
  const items: Array<{ id: SideView; icon: ReactNode; label: string }> = [
    { id: "explorer", icon: <Files className="h-[18px] w-[18px]" />, label: "Explorer (⌘B)" },
    { id: "search", icon: <Search className="h-[18px] w-[18px]" />, label: "Search" },
    { id: "git", icon: <GitBranch className="h-[18px] w-[18px]" />, label: "Source control" },
    { id: "debug", icon: <Bug className="h-[18px] w-[18px]" />, label: "Run & debug (F5)" },
    ...pluginPanels.map((panel) => ({
      id: panel.view,
      icon: <Puzzle className="h-[18px] w-[18px]" />,
      label: panel.title,
    })),
  ];
  return (
    <div className="flex w-11 shrink-0 flex-col items-center border-r bg-panel py-1">
      {items.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>
            <button
              aria-label={item.label}
              className={cn(
                "relative grid h-10 w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
                view === item.id && sidebarOpen && "text-foreground",
              )}
              onClick={() => onSelect(item.id)}
            >
              {view === item.id && sidebarOpen && <span className="absolute left-0 h-5 w-0.5 rounded-r bg-primary" />}
              {item.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Workspace settings"
              className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              onClick={() => onSelect("settings")}
            >
              <Settings2 className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Workspace settings</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Command palette"
              className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              onClick={onPalette}
            >
              <Keyboard className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Command palette (⌘K)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function WelcomePane({
  workspace,
  onOpen,
  onTerminal,
}: {
  workspace: Workspace;
  onOpen: () => void;
  onTerminal: () => void;
}) {
  const shortcuts = [
    ["⌘ K", "Command palette"],
    ["⌘ S", "Save file"],
    ["⌘ B", "Toggle sidebar"],
    ["⌘ `", "Toggle terminal"],
    ["F5", "Start debugging"],
  ];
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-2xl animate-fade-in">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{workspace.name}</h1>
            <p className="font-code text-[10px] text-muted-foreground">{workspace.rootPath}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            onClick={onOpen}
            className="group rounded-lg border bg-card/50 p-4 text-left transition-colors hover:border-primary/30 hover:bg-card"
          >
            <Files className="h-4 w-4 text-sky-400" />
            <div className="mt-3 text-sm font-medium">Open a file</div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Browse the explorer and start editing Go or TypeScript.</p>
          </button>
          <button
            onClick={onTerminal}
            className="group rounded-lg border bg-card/50 p-4 text-left transition-colors hover:border-primary/30 hover:bg-card"
          >
            <TerminalSquare className="h-4 w-4 text-emerald-400" />
            <div className="mt-3 text-sm font-medium">Open terminal</div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Run tests, builds, and package scripts inside the workspace.</p>
          </button>
        </div>

        <div className="mt-8 rounded-lg border bg-card/30">
          <div className="border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Shortcuts
          </div>
          <div className="grid gap-x-8 gap-y-2 p-4 sm:grid-cols-2">
            {shortcuts.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">{label}</span>
                <kbd className="rounded border bg-background px-1.5 py-0.5 font-code text-[10px]">{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceSettings({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center border-b px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Workspace
      </div>
      <div className="space-y-4 p-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</div>
          <div className="mt-1">{workspace.name}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</div>
          <div className="mt-1 capitalize">{workspace.source}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Path</div>
          <div className="mt-1 break-all font-code text-[10px] leading-4 text-muted-foreground">{workspace.rootPath}</div>
        </div>
        {workspace.repoUrl && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Repository</div>
            <div className="mt-1 break-all font-code text-[10px] leading-4 text-muted-foreground">{workspace.repoUrl}</div>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-md border bg-background/40 p-2 text-[10px] text-muted-foreground">
          <RotateCw className="h-3 w-3" /> Files are stored on the server filesystem.
        </div>
        <PluginSettingsSection workspaceId={workspace.id} />
      </div>
    </div>
  );
}

export function ReferencesDialog({
  locations,
  onClose,
  onOpen,
}: {
  locations: SourceLocation[] | null;
  onClose: () => void;
  onOpen: (location: SourceLocation) => void;
}) {
  return (
    <Dialog open={!!locations} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>References</DialogTitle>
          <DialogDescription>
            {locations?.length ?? 0} reference{(locations?.length ?? 0) === 1 ? "" : "s"} found across the workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[360px] divide-y overflow-auto rounded-md border">
          {locations?.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">No references found.</div>
          )}
          {locations?.map((location, index) => (
            <button
              key={`${location.path}:${location.line}:${location.column}:${index}`}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
              onClick={() => onOpen(location)}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span className="min-w-0 flex-1 truncate text-xs">{location.path}</span>
              <span className="font-code text-[10px] text-muted-foreground">
                {location.line}:{location.column}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CheckDot() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/80" />;
}
