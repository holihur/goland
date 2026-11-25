import type { TaskInfo, User, Workspace } from "@/lib/types";
import {
  ArrowLeft,
  Bug,
  ChevronDown,
  Command as CommandIcon,
  GitBranch,
  KeyRound,
  Play,
  Search,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function IdeHeader({
  workspace,
  user,
  tasks,
  onExit,
  onOpenPalette,
  onRunTask,
  onOpenTerminal,
  onShowDebug,
  onShowSettings,
  onOpenSettings,
  onOpenTokens,
}: {
  workspace: Workspace;
  user: User;
  tasks: TaskInfo[];
  onExit: () => void;
  onOpenPalette: () => void;
  onRunTask: (task: TaskInfo) => void;
  onOpenTerminal: () => void;
  onShowDebug: () => void;
  onShowSettings: () => void;
  onOpenSettings: () => void;
  onOpenTokens: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onExit}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("ide.back")}</TooltipContent>
      </Tooltip>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs font-medium">{workspace.name}</span>
        {workspace.source === "git" && workspace.branch && (
          <span className="flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-code text-[9px] text-muted-foreground">
            <GitBranch className="h-2.5 w-2.5" />
            {workspace.branch}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          className="hidden h-7 min-w-[180px] items-center gap-2 rounded-md border bg-background/40 px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent md:flex"
          onClick={() => onOpenPalette()}
        >
          <Search className="h-3 w-3" />
          <span>Search files…</span>
          <kbd className="ml-auto flex items-center gap-0.5 font-code text-[9px]">
            <CommandIcon className="h-2.5 w-2.5" />K
          </kbd>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-[11px]">
              <Play className="h-3.5 w-3.5 text-emerald-400" /> Run
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Run &amp; test</DropdownMenuLabel>
            {tasks.length === 0 && (
              <DropdownMenuItem disabled>
                <Play className="h-4 w-4" /> No Go or pnpm tasks found
              </DropdownMenuItem>
            )}
            {tasks.map((task) => (
              <DropdownMenuItem key={task.id} onSelect={() => onRunTask(task)}>
                {task.kind === "go" ? (
                  <Play className="h-4 w-4 text-sky-400" />
                ) : (
                  <TerminalSquare className="h-4 w-4 text-amber-300" />
                )}
                <span className="truncate font-code text-[11px]">{task.label}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onOpenTerminal();
              }}
            >
              <TerminalSquare className="h-4 w-4" /> Open terminal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onShowDebug}>
              <Bug className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Debug</TooltipContent>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-border" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="grid h-6 w-6 place-items-center rounded-full bg-sky-500 text-[10px] font-semibold text-white">
              {user.name.slice(0, 1).toUpperCase()}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div className="text-xs text-foreground">{user.name}</div>
              <div className="mt-0.5 truncate text-[10px] font-normal">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onShowSettings}>
              <Settings2 className="h-4 w-4" /> Workspace info
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Settings2 className="h-4 w-4" /> {t("settings.open")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenTokens}>
              <KeyRound className="h-4 w-4" /> API tokens
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExit}>
              <ArrowLeft className="h-4 w-4" /> All workspaces
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
