import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bug,
  ChevronDown,
  Circle,
  Command as CommandIcon,
  FileCode2,
  Files,
  GitBranch,
  Keyboard,
  Loader2,
  PanelBottom,
  Play,
  RotateCw,
  Save,
  Search,
  Settings2,
  TerminalSquare,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, taskSocket } from "@/lib/api";
import type { Diagnostic, TaskInfo, User, Workspace } from "@/lib/types";
import { LSPClient, languageForPath, type SourceLocation } from "@/lib/lsp";
import { cn, fileLanguage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { FileExplorer } from "@/components/editor/FileExplorer";
import { SearchPanel } from "@/components/editor/SearchPanel";
import { GitPanel } from "@/components/editor/GitPanel";
import { TerminalPanel } from "@/components/editor/TerminalPanel";
import { CommandPalette, paletteIcons, type PaletteAction } from "@/components/editor/CommandPalette";
import { DebugPanel } from "@/components/editor/DebugPanel";
import { Logo } from "@/components/Logo";
import { LanguageToggle, useI18n } from "@/lib/i18n";
import { ThemeToggle } from "@/lib/theme";

type SideView = "explorer" | "search" | "git" | "debug" | "settings";

interface Tab {
  path: string;
  name: string;
  content: string;
  etag?: string;
  binary: boolean;
  dirty: boolean;
}

function tabName(path: string) {
  return path.split("/").pop() ?? path;
}

export function IDE({
  user,
  workspace,
  onExit,
  onWorkspaceChanged,
}: {
  user: User;
  workspace: Workspace;
  onExit: () => void;
  onWorkspaceChanged: () => void;
}) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState("");
  const [view, setView] = useState<SideView>("explorer");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [bottomView, setBottomView] = useState<"terminal" | "output">("terminal");
  const [treeKey, setTreeKey] = useState(0);
  const [gitKey, setGitKey] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [saving, setSaving] = useState("");
  const [output, setOutput] = useState("No task output yet.");
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [runningTask, setRunningTask] = useState<TaskInfo | null>(null);
  const taskSocketRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, Diagnostic[]>>({});
  const [cursorLine, setCursorLine] = useState(1);
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem("goland.breakpoints") || "{}") as Record<string, number[]>;
    } catch {
      return {};
    }
  });
  const [lspClients, setLspClients] = useState<{ go: LSPClient | null; typescript: LSPClient | null }>({
    go: null,
    typescript: null,
  });
  const [lspStatus, setLspStatus] = useState<Record<string, string>>({});
  const [jumpTo, setJumpTo] = useState<(SourceLocation & { nonce: number }) | null>(null);
  const [references, setReferences] = useState<SourceLocation[] | null>(null);
  const lspRef = useRef<Partial<Record<"go" | "typescript", LSPClient>>>({});
  const lspErrorNotified = useRef<Set<string>>(new Set());

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;

  useEffect(() => {
    return () => {
      for (const client of Object.values(lspRef.current)) client?.dispose();
      lspRef.current = {};
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("goland.breakpoints", JSON.stringify(breakpoints));
  }, [breakpoints]);

  const toggleBreakpoint = useCallback(
    (path: string, line: number) => {
      setBreakpoints((current) => {
        const next = { ...current };
        const lines = new Set(next[path] ?? []);
        if (lines.has(line)) lines.delete(line);
        else lines.add(line);
        if (lines.size) next[path] = [...lines].sort((a, b) => a - b);
        else delete next[path];
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const path = activeTab?.path;
    if (!path) return;
    const language = languageForPath(path);
    if (!language || lspRef.current[language]) return;
    const client = new LSPClient(
      workspace.id,
      workspace.rootPath,
      language,
      (file, items) => setDiagnostics((current) => ({ ...current, [file]: items })),
      (status) => setLspStatus((current) => ({ ...current, [language]: status })),
      (message) => {
        if (lspErrorNotified.current.has(language)) return;
        lspErrorNotified.current.add(language);
        toast.error(message);
      },
    );
    lspRef.current[language] = client;
    setLspClients({ go: lspRef.current.go ?? null, typescript: lspRef.current.typescript ?? null });
  }, [activeTab?.path, workspace.id, workspace.rootPath]);

  useEffect(() => {
    let alive = true;
    api
      .listTasks(workspace.id)
      .then((result) => alive && setTasks(result.tasks))
      .catch(() => alive && setTasks([]));
    return () => {
      alive = false;
    };
  }, [workspace.id, gitKey]);

  useEffect(() => {
    return () => {
      taskSocketRef.current?.close();
      taskSocketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output, bottomView]);

  const stopTask = useCallback(() => {
    const socket = taskSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "cancel" }));
    }
  }, []);

  const runTask = useCallback(
    (task: TaskInfo) => {
      taskSocketRef.current?.close();
      setRunningTask(task);
      setBottomView("output");
      setTerminalOpen(true);
      setOutput(`$ ${task.command} ${task.args.join(" ")}\n`);
      const socket = new WebSocket(taskSocket(workspace.id, task.id));
      taskSocketRef.current = socket;
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            data?: string;
            status?: string;
            exitCode?: number;
            message?: string;
          };
          if (message.type === "output" && message.data) {
            setOutput((current) => (current.length > 700_000 ? current.slice(-500_000) : current) + message.data);
          } else if (message.type === "started") {
            setOutput((current) => `${current}[started]\n`);
          } else if (message.type === "exit") {
            setOutput((current) => `${current}\n[exit ${message.exitCode ?? 0} · ${message.status ?? "finished"}]\n`);
            setRunningTask(null);
            setGitKey((value) => value + 1);
          } else if (message.type === "error") {
            setOutput((current) => `${current}\n[error] ${message.message ?? "task failed"}\n`);
            setRunningTask(null);
          }
        } catch {
          setOutput((current) => current + event.data);
        }
      };
      socket.onerror = () => {
        toast.error("Task connection failed");
        setRunningTask(null);
      };
      socket.onclose = () => {
        setRunningTask((current) => (current?.id === task.id ? null : current));
      };
    },
    [workspace.id],
  );

  const refreshTree = useCallback(() => setTreeKey((value) => value + 1), []);
  const refreshGit = useCallback(() => {
    setGitKey((value) => value + 1);
    onWorkspaceChanged();
  }, [onWorkspaceChanged]);

  const openFile = useCallback(
    async (path: string, focus = true) => {
      if (!path) return;
      const existing = tabs.find((tab) => tab.path === path);
      if (existing) {
        if (focus) setActivePath(path);
        return;
      }
      try {
        const file = await api.readFile(workspace.id, path);
        setTabs((prev) => [
          ...prev,
          {
            path,
            name: tabName(path),
            content: file.content ?? "",
            etag: file.etag,
            binary: file.binary,
            dirty: false,
          },
        ]);
        if (focus) setActivePath(path);
        setDiagnostics((current) => ({ ...current, [path]: [] }));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not open file");
      }
    },
    [tabs, workspace.id],
  );

  const closeTab = (path: string) => {
    const index = tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    const tab = tabs[index];
    if (tab.dirty && !window.confirm(`Close ${tab.name} without saving?`)) return;
    const next = tabs.filter((item) => item.path !== path);
    const language = languageForPath(path);
    if (language) lspRef.current[language]?.closeDocument(path);
    setTabs(next);
    if (activePath === path) {
      setActivePath(next[Math.min(index, next.length - 1)]?.path ?? "");
    }
  };

  const updateContent = (path: string, content: string) => {
    setTabs((prev) => prev.map((tab) => (tab.path === path ? { ...tab, content, dirty: true } : tab)));
  };

  const saveTab = useCallback(
    async (path: string) => {
      const tab = tabs.find((item) => item.path === path);
      if (!tab || tab.binary || saving) return;
      setSaving(path);
      try {
        const result = await api.writeFile(workspace.id, tab.path, tab.content, tab.etag);
        setTabs((prev) =>
          prev.map((item) =>
            item.path === path ? { ...item, content: result.content ?? item.content, etag: result.etag, dirty: false } : item,
          ),
        );
        const language = languageForPath(path);
        if (language) void lspRef.current[language]?.saveDocument(path, tab.content).catch(() => undefined);
        toast.success(`Saved ${tab.name}`);
        setGitKey((value) => value + 1);
        onWorkspaceChanged();
      } catch (err) {
        if (err instanceof ApiError && err.code === "conflict") {
          if (window.confirm("This file changed on disk. Reload it and discard your local edits?")) {
            try {
              const fresh = await api.readFile(workspace.id, path);
              setTabs((prev) =>
                prev.map((item) =>
                  item.path === path
                    ? { ...item, content: fresh.content ?? "", etag: fresh.etag, dirty: false, binary: fresh.binary }
                    : item,
                ),
              );
            } catch {
              // keep local content
            }
          }
        } else {
          toast.error(err instanceof ApiError ? err.message : "Save failed");
        }
      } finally {
        setSaving("");
      }
    },
    [tabs, saving, workspace.id, onWorkspaceChanged],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activePath) void saveTab(activePath);
      } else if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (mod && event.key === "`") {
        event.preventDefault();
        setTerminalOpen((value) => !value);
        setBottomView("terminal");
      } else if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      } else if (event.key === "F5") {
        event.preventDefault();
        setView("debug");
        setSidebarOpen(true);
      } else if (event.key === "F9") {
        event.preventDefault();
        if (activePath) toggleBreakpoint(activePath, cursorLine);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath, saveTab, cursorLine, toggleBreakpoint]);

  const openLocation = useCallback(
    async (location: SourceLocation) => {
      await openFile(location.path);
      setJumpTo({ ...location, nonce: Date.now() });
    },
    [openFile],
  );

  const setSideView = (next: SideView) => {
    if (view === next && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      setView(next);
      setSidebarOpen(true);
    }
  };

  const paletteActions: PaletteAction[] = [
    {
      id: "save",
      label: "Save active file",
      hint: "⌘S",
      icon: paletteIcons.save,
      run: () => activePath && void saveTab(activePath),
    },
    {
      id: "terminal",
      label: "Toggle terminal",
      hint: "⌘`",
      icon: paletteIcons.terminal,
      run: () => {
        setTerminalOpen((value) => !value);
        setBottomView("terminal");
      },
    },
    {
      id: "explorer",
      label: "Show explorer",
      icon: paletteIcons.explorer,
      run: () => {
        setView("explorer");
        setSidebarOpen(true);
      },
    },
    {
      id: "git",
      label: "Show source control",
      icon: <GitBranch className="h-3.5 w-3.5" />,
      run: () => {
        setView("git");
        setSidebarOpen(true);
      },
    },
  ];

  const lineCount = activeTab && !activeTab.binary ? activeTab.content.split("\n").length : 0;
  const problems = Object.values(diagnostics).reduce((count, items) => count + items.length, 0);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onExit}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("ide.back")}</TooltipContent>
          </Tooltip>
          <Logo className="h-7 w-7 rounded-md" />
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
            <LanguageToggle compact />
            <ThemeToggle compact />
            <button
              className="hidden h-7 min-w-[180px] items-center gap-2 rounded-md border bg-background/40 px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent md:flex"
              onClick={() => setPaletteOpen(true)}
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
                  <DropdownMenuItem key={task.id} onSelect={() => runTask(task)}>
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
                    setTerminalOpen(true);
                    setBottomView("terminal");
                  }}
                >
                  <TerminalSquare className="h-4 w-4" /> Open terminal
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setSideView("debug")}>
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
                <DropdownMenuItem onSelect={() => setSideView("settings")}>
                  <Settings2 className="h-4 w-4" /> Workspace info
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onExit}>
                  <ArrowLeft className="h-4 w-4" /> All workspaces
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <ActivityBar view={view} sidebarOpen={sidebarOpen} onSelect={setSideView} onPalette={() => setPaletteOpen(true)} />

          {sidebarOpen && (
            <aside className="flex w-[270px] shrink-0 flex-col border-r bg-panel">
              {view === "explorer" && (
                <FileExplorer
                  workspaceId={workspace.id}
                  refreshKey={treeKey}
                  onOpenFile={openFile}
                  onChanged={refreshTree}
                />
              )}
              {view === "search" && <SearchPanel workspaceId={workspace.id} onOpenFile={openFile} />}
              {view === "git" && (
                <GitPanel
                  workspaceId={workspace.id}
                  refreshKey={gitKey}
                  onOpenFile={openFile}
                  onWorkspaceChanged={refreshGit}
                />
              )}
              {view === "debug" && (
                <DebugPanel
                  workspace={workspace}
                  activePath={activeTab?.path ?? ""}
                  breakpoints={breakpoints}
                  onBreakpointsChange={setBreakpoints}
                  onOpenLocation={(location) => void openLocation(location)}
                />
              )}
              {view === "settings" && <WorkspaceSettings workspace={workspace} />}
            </aside>
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-panel/60 [scrollbar-width:none]">
              {tabs.map((tab) => (
                <div
                  key={tab.path}
                  role="tab"
                  aria-selected={tab.path === activePath}
                  className={cn(
                    "group flex min-w-[110px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 text-[11px]",
                    tab.path === activePath
                      ? "border-t border-t-primary bg-editor text-foreground"
                      : "text-muted-foreground hover:bg-accent/40",
                  )}
                  onClick={() => setActivePath(tab.path)}
                  onAuxClick={(event) => event.button === 1 && closeTab(tab.path)}
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span className="truncate">{tab.name}</span>
                  {tab.dirty ? (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                  ) : null}
                  <button
                    className={cn(
                      "ml-auto grid h-4 w-4 shrink-0 place-items-center rounded hover:bg-background/70",
                      !tab.dirty && "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.path);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="ml-auto flex shrink-0 items-center px-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Save"
                  disabled={!activeTab?.dirty}
                  onClick={() => activePath && void saveTab(activePath)}
                >
                  {saving === activePath ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 bg-editor">
              {activeTab ? (
                activeTab.binary ? (
                  <div className="grid h-full place-items-center">
                    <div className="max-w-sm text-center">
                      <FileCode2 className="mx-auto h-9 w-9 text-muted-foreground" />
                      <h2 className="mt-3 text-sm font-medium">Binary file</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {activeTab.path} cannot be displayed in the text editor.
                      </p>
                    </div>
                  </div>
                ) : (
                  <CodeEditor
                    key={activeTab.path}
                    path={activeTab.path}
                    value={activeTab.content}
                    onChange={(value) => updateContent(activeTab.path, value)}
                    onSave={() => void saveTab(activeTab.path)}
                    diagnostics={diagnostics[activeTab.path] ?? []}
                    lsp={
                      languageForPath(activeTab.path) === "go"
                        ? lspClients.go
                        : languageForPath(activeTab.path) === "typescript"
                          ? lspClients.typescript
                          : null
                    }
                    jumpTo={jumpTo?.path === activeTab.path ? jumpTo : null}
                    onOpenLocation={(location) => void openLocation(location)}
                    onReferences={(locations) => setReferences(locations)}
                    breakpoints={breakpoints[activeTab.path] ?? []}
                    onCursorChange={setCursorLine}
                  />
                )
              ) : (
                <WelcomePane workspace={workspace} onOpen={() => setView("explorer")} onTerminal={() => setTerminalOpen(true)} />
              )}
            </div>

            {terminalOpen && (
              <div className="flex h-[230px] shrink-0 flex-col border-t">
                <div className="flex h-8 shrink-0 items-center border-b bg-panel/70 px-2">
                  <button
                    className={cn(
                      "flex h-full items-center gap-1.5 border-b px-2 text-[10px] uppercase tracking-wider",
                      bottomView === "terminal" ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
                    )}
                    onClick={() => setBottomView("terminal")}
                  >
                    <TerminalSquare className="h-3 w-3" /> Terminal
                  </button>
                  <button
                    className={cn(
                      "flex h-full items-center gap-1.5 border-b px-2 text-[10px] uppercase tracking-wider",
                      bottomView === "output" ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
                    )}
                    onClick={() => setBottomView("output")}
                  >
                    <PanelBottom className="h-3 w-3" /> Output
                  </button>
                  <button
                    className={cn(
                      "flex h-full items-center gap-1.5 border-b px-2 text-[10px] uppercase tracking-wider",
                      problems > 0 ? "text-amber-300" : "text-muted-foreground",
                    )}
                    onClick={() => {
                      setBottomView("output");
                      setOutput(problems ? `${problems} problem(s) reported by language services.` : "No problems detected.");
                    }}
                  >
                    <Circle className="h-2 w-2" /> Problems {problems > 0 ? problems : ""}
                  </button>
                  <button aria-label="Close panel" title="Close panel" className="ml-auto grid h-6 w-6 place-items-center rounded hover:bg-accent" onClick={() => setTerminalOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className={cn("min-h-0 flex-1", bottomView !== "terminal" && "hidden")}>
                  <TerminalPanel workspaceId={workspace.id} visible={terminalOpen && bottomView === "terminal"} />
                </div>
                {bottomView === "output" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex h-7 shrink-0 items-center justify-between border-b px-2 text-[10px] text-muted-foreground">
                      <span className="truncate font-code">
                        {runningTask ? `running: ${runningTask.label}` : "output"}
                      </span>
                      {runningTask && (
                        <button className="rounded px-1.5 py-0.5 text-red-300 hover:bg-red-500/10" onClick={stopTask}>
                          Stop
                        </button>
                      )}
                    </div>
                    <pre
                      ref={outputRef}
                      className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-muted/50 p-3 font-code text-[11px] leading-5 text-muted-foreground"
                    >
                      {output}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

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
            {(["go", "typescript"] as const).map((language) => {
              const status = lspStatus[language];
              if (!status) return null;
              return (
                <span key={language} className="hidden items-center gap-1 md:flex" title={`${language} language server: ${status}`}>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      status === "ready" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-red-400",
                    )}
                  />
                  {language === "go" ? "Go" : "TS"}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline">{workspace.rootPath}</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Connected
            </span>
          </div>
        </footer>
      </div>

      <ReferencesDialog
        locations={references}
        onClose={() => setReferences(null)}
        onOpen={(location) => {
          setReferences(null);
          void openLocation(location);
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        workspaceId={workspace.id}
        onOpenFile={openFile}
        actions={paletteActions}
      />
    </TooltipProvider>
  );
}

function ActivityBar({
  view,
  sidebarOpen,
  onSelect,
  onPalette,
}: {
  view: SideView;
  sidebarOpen: boolean;
  onSelect: (view: SideView) => void;
  onPalette: () => void;
}) {
  const items: Array<{ id: SideView; icon: ReactNode; label: string }> = [
    { id: "explorer", icon: <Files className="h-[18px] w-[18px]" />, label: "Explorer (⌘B)" },
    { id: "search", icon: <Search className="h-[18px] w-[18px]" />, label: "Search" },
    { id: "git", icon: <GitBranch className="h-[18px] w-[18px]" />, label: "Source control" },
    { id: "debug", icon: <Bug className="h-[18px] w-[18px]" />, label: "Run & debug (F5)" },
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

function WelcomePane({
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
          <Logo className="h-11 w-11 rounded-xl" />
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

function WorkspaceSettings({ workspace }: { workspace: Workspace }) {
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
      </div>
    </div>
  );
}

function ReferencesDialog({
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

function CheckDot() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/80" />;
}
