import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Columns2, FileCode2, GitBranch, Maximize2, RotateCcw, Rows2, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, taskSocket } from "@/lib/api";
import type { Diagnostic, TaskInfo, User, Workspace } from "@/lib/types";
import { LSPClient, languageForPath, type SourceLocation } from "@/lib/lsp";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileExplorer } from "@/components/editor/FileExplorer";
import { SearchPanel } from "@/components/editor/SearchPanel";
import { GitPanel } from "@/components/editor/GitPanel";
import { CommandPalette, paletteIcons, type PaletteAction } from "@/components/editor/CommandPalette";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ActivityBar, ReferencesDialog, WelcomePane, WorkspaceSettings, type SideView } from "./IDEparts";
import { BottomPanel } from "./BottomPanel";
import { EditorGroups, type EditorTab as Tab } from "./EditorGroups";
import { IdeHeader } from "./IdeHeader";
import { ResizeDivider } from "./ResizeDivider";
import { useIdeLayout } from "@/lib/useIdeLayout";
import { usePluginContributions } from "@/lib/usePluginContributions";
import { pluginLspSocket } from "@/lib/plugin-api";
import { PluginSidebarPanel } from "@/components/plugins/PluginSidebarPanel";
import { IdeFooter } from "./IdeFooter";
import {
  DEFAULT_BOTTOM_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  activeGroupIdOf,
  groupOfPath,
  type SplitDirection,
} from "@/lib/layout";

const CodeEditor = lazy(() => import("@/components/editor/CodeEditor").then((module) => ({ default: module.CodeEditor })));
const DebugPanel = lazy(() => import("@/components/editor/DebugPanel").then((module) => ({ default: module.DebugPanel })));

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
  const [tabs, setTabs] = useState<Tab[]>([]);
  const {
    layout,
    compact,
    sidebarMax,
    maxBottomHeight,
    restoredPaths,
    activePath,
    setSidebarWidth,
    setSidebarOpen,
    toggleSidebar,
    setSideView: showSideView,
    setBottomView,
    setBottomOpen,
    setBottomMaximized,
    setBottomHeight,
    openBottom,
    toggleBottom,
    assignTab,
    unassignTab,
    selectTab,
    focusGroup,
    moveTabToGroup,
    split,
    closeEditorGroup,
    reset,
  } = useIdeLayout(user.id, workspace.id);
  const view = layout.sideView;
  const sidebarOpen = layout.sidebarOpen;
  const terminalOpen = layout.bottomOpen;
  const bottomView = layout.bottomView;
  const initialLayoutRef = useRef(layout);
  const viewStateRef = useRef<Record<string, { line: number; scrollTop: number }>>({});
  const [treeKey, setTreeKey] = useState(0);
  const [gitKey, setGitKey] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState("");
  const [output, setOutput] = useState("No task output yet.");
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [runningTask, setRunningTask] = useState<TaskInfo | null>(null);
  const taskSocketRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, Diagnostic[]>>({});
  const [cursorLine, setCursorLine] = useState(1);
  const plugins = usePluginContributions(workspace.id, activePath, cursorLine);
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem("goland.breakpoints") || "{}") as Record<string, number[]>;
    } catch {
      return {};
    }
  });
  const [lspClients, setLspClients] = useState<Record<string, LSPClient>>({});
  const [lspStatus, setLspStatus] = useState<Record<string, string>>({});
  const [jumpTo, setJumpTo] = useState<(SourceLocation & { nonce: number }) | null>(null);
  const [references, setReferences] = useState<SourceLocation[] | null>(null);
  const lspRef = useRef<Record<string, LSPClient>>({});
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

  useEffect(() => {
    if (!restoredPaths.length) return;
    let cancelled = false;
    const restore = async () => {
      for (const path of restoredPaths) {
        try {
          const file = await api.readFile(workspace.id, path);
          if (cancelled) return;
          setTabs((prev) =>
            prev.some((tab) => tab.path === path)
              ? prev
              : [
                  ...prev,
                  {
                    path,
                    name: tabName(path),
                    content: file.content ?? "",
                    etag: file.etag,
                    binary: file.binary,
                    dirty: false,
                  },
                ],
          );
          setDiagnostics((current) => ({ ...current, [path]: current[path] ?? [] }));
        } catch {
          if (!cancelled) unassignTab(path);
        }
      }
      const initial = initialLayoutRef.current;
      const target = initial.groups[initial.activeGroupId]?.activePath;
      const group = target ? groupOfPath(initial, target) : null;
      if (!cancelled && group && target) selectTab(group, target);
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [workspace.id, restoredPaths, unassignTab, selectTab]);

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

  const pluginLanguageForPath = (path: string) => {
    const lower = path.toLowerCase();
    for (const plugin of plugins.enabled) {
      for (const language of plugin.manifest?.contributes.languages ?? []) {
        if (language.extensions.some((extension) => lower.endsWith(extension))) {
          return { plugin, language };
        }
      }
    }
    return null;
  };

  const lspTargetForPath = (path: string): { key: string; language: string; socketUrl?: string } | null => {
    const builtin = languageForPath(path);
    if (builtin) return { key: builtin, language: builtin };
    const pluginLanguage = pluginLanguageForPath(path);
    if (!pluginLanguage) return null;
    return {
      key: `plugin:${pluginLanguage.plugin.id}:${pluginLanguage.language.id}`,
      language: pluginLanguage.language.languageId,
      socketUrl: pluginLspSocket(workspace.id, pluginLanguage.plugin.id, pluginLanguage.language.id),
    };
  };

  const lspClientForPath = (path: string): LSPClient | null => {
    const target = lspTargetForPath(path);
    return target ? (lspRef.current[target.key] ?? null) : null;
  };

  useEffect(() => {
    const path = activeTab?.path;
    if (!path) return;
    const target = lspTargetForPath(path);
    if (!target || lspRef.current[target.key]) return;
    const client = new LSPClient(
      workspace.id,
      workspace.rootPath,
      target.language,
      (file, items) => setDiagnostics((current) => ({ ...current, [file]: items })),
      (status) => setLspStatus((current) => ({ ...current, [target.key]: status })),
      (message) => {
        if (lspErrorNotified.current.has(target.key)) return;
        lspErrorNotified.current.add(target.key);
        toast.error(message);
      },
      target.socketUrl,
    );
    lspRef.current[target.key] = client;
    setLspClients({ ...lspRef.current });
  }, [activeTab?.path, workspace.id, workspace.rootPath, plugins.plugins]);

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
      openBottom("output");
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
        const group = groupOfPath(layout, path);
        if (focus && group) selectTab(group, path);
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
        assignTab(path);
        setDiagnostics((current) => ({ ...current, [path]: [] }));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not open file");
      }
    },
    [tabs, workspace.id, layout, selectTab, assignTab],
  );

  const closeTab = (path: string) => {
    const index = tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    const tab = tabs[index];
    if (tab.dirty && !window.confirm(`Close ${tab.name} without saving?`)) return;
    const next = tabs.filter((item) => item.path !== path);
    lspClientForPath(path)?.closeDocument(path);
    setTabs(next);
    unassignTab(path);
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
        void lspClientForPath(path)?.saveDocument(path, tab.content).catch(() => undefined);
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
        toggleBottom();
      } else if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      } else if (mod && event.altKey && event.code === "Backslash") {
        event.preventDefault();
        if (layout.rows.flat().length > 1) closeEditorGroup(activeGroupIdOf(layout));
      } else if (mod && event.altKey && event.key === "0") {
        event.preventDefault();
        reset(tabs.map((tab) => tab.path), activePath);
      } else if (mod && event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        if (!compact) split("down");
      } else if (mod && event.code === "Backslash") {
        event.preventDefault();
        if (!compact) split("right");
      } else if (event.key === "F5") {
        event.preventDefault();
        showSideView("debug");
      } else if (event.key === "F9") {
        event.preventDefault();
        if (activePath) toggleBreakpoint(activePath, cursorLine);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activePath,
    saveTab,
    cursorLine,
    toggleBreakpoint,
    layout,
    tabs,
    compact,
    toggleBottom,
    toggleSidebar,
    closeEditorGroup,
    reset,
    split,
    showSideView,
  ]);

  const openLocation = useCallback(
    async (location: SourceLocation) => {
      await openFile(location.path);
      setJumpTo({ ...location, nonce: Date.now() });
    },
    [openFile],
  );

  const selectSideView = (next: SideView) => {
    if (view === next && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      showSideView(next);
    }
  };

  const selectTabByPath = (path: string) => {
    const group = groupOfPath(layout, path);
    if (group) selectTab(group, path);
  };

  const rememberCursor = (path: string, line: number) => {
    const current = viewStateRef.current[path] ?? { line: 1, scrollTop: 0 };
    viewStateRef.current[path] = { ...current, line };
    if (path === activePath) setCursorLine(line);
  };

  const rememberScroll = (path: string, scrollTop: number) => {
    const current = viewStateRef.current[path] ?? { line: 1, scrollTop: 0 };
    viewStateRef.current[path] = { ...current, scrollTop };
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
      run: () => toggleBottom(),
    },
    {
      id: "explorer",
      label: "Show explorer",
      icon: paletteIcons.explorer,
      run: () => showSideView("explorer"),
    },
    {
      id: "git",
      label: "Show source control",
      icon: <GitBranch className="h-3.5 w-3.5" />,
      run: () => showSideView("git"),
    },
    {
      id: "split-right",
      label: "Split editor right",
      hint: "⌘\\",
      icon: <Columns2 className="h-3.5 w-3.5" />,
      run: () => {
        if (!compact) split("right");
      },
    },
    {
      id: "split-down",
      label: "Split editor down",
      hint: "⌘⇧\\",
      icon: <Rows2 className="h-3.5 w-3.5" />,
      run: () => {
        if (!compact) split("down");
      },
    },
    {
      id: "close-group",
      label: "Close editor group",
      hint: "⌘⌥\\",
      icon: <X className="h-3.5 w-3.5" />,
      run: () => {
        if (layout.rows.flat().length > 1) closeEditorGroup(activeGroupIdOf(layout));
      },
    },
    {
      id: "maximize-panel",
      label: layout.bottomMaximized ? "Restore panel size" : "Maximize panel",
      icon: <Maximize2 className="h-3.5 w-3.5" />,
      run: () => setBottomMaximized(!layout.bottomMaximized),
    },
    {
      id: "reset-layout",
      label: "Reset layout",
      hint: "⌘⌥0",
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      run: () => reset(tabs.map((tab) => tab.path), activePath),
    },
    ...plugins.pluginPaletteActions,
  ];

  const renderEditor = (path: string) => {
    const tab = tabs.find((item) => item.path === path);
    if (!tab) return null;
    if (tab.binary) {
      return (
        <div className="grid h-full place-items-center">
          <div className="max-w-sm text-center">
            <FileCode2 className="mx-auto h-9 w-9 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-medium">Binary file</h2>
            <p className="mt-1 text-xs text-muted-foreground">{path} cannot be displayed in the text editor.</p>
          </div>
        </div>
      );
    }
    const state = viewStateRef.current[path];
    return (
      <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">Loading editor…</div>}>
        <CodeEditor
          key={path}
          path={path}
          value={tab.content}
          onChange={(value) => updateContent(path, value)}
          onSave={() => void saveTab(path)}
          diagnostics={diagnostics[path] ?? []}
          lsp={lspClients[lspTargetForPath(path)?.key ?? ""] ?? null}
          jumpTo={jumpTo?.path === path ? jumpTo : null}
          onOpenLocation={(location) => void openLocation(location)}
          onReferences={(locations) => setReferences(locations)}
          breakpoints={breakpoints[path] ?? []}
          initialCursorLine={state?.line ?? 0}
          initialScrollTop={state?.scrollTop ?? 0}
          onCursorChange={(line) => rememberCursor(path, line)}
          onScrollChange={(scrollTop) => rememberScroll(path, scrollTop)}
        />
      </Suspense>
    );
  };

  const lineCount = activeTab && !activeTab.binary ? activeTab.content.split("\n").length : 0;
  const problems = Object.values(diagnostics).reduce((count, items) => count + items.length, 0);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <IdeHeader
          workspace={workspace}
          user={user}
          tasks={tasks}
          onExit={onExit}
          onOpenPalette={() => setPaletteOpen(true)}
          onRunTask={runTask}
          onOpenTerminal={() => openBottom("terminal")}
          onShowDebug={() => showSideView("debug")}
          onShowSettings={() => showSideView("settings")}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          <ActivityBar
            view={view}
            sidebarOpen={sidebarOpen}
            onSelect={selectSideView}
            onPalette={() => setPaletteOpen(true)}
            pluginPanels={plugins.pluginPanels}
          />

          {sidebarOpen && (
            <>
            <aside
              data-testid="sidebar"
              className="flex shrink-0 flex-col border-r bg-panel"
              style={{ width: layout.sidebarWidth }}
            >
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
                plugins={plugins.enabled}
                panels={plugins.panels}
                outputs={plugins.outputs}
                execute={plugins.execute}
                cancel={plugins.cancel}
              />
            </aside>
            <ResizeDivider
              axis="x"
              value={layout.sidebarWidth}
              min={180}
              max={sidebarMax}
              label="Resize sidebar"
              onChange={setSidebarWidth}
              onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            />
            </>
          )}

          <main className="relative flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              {tabs.length === 0 ? (
                <WelcomePane
                  workspace={workspace}
                  onOpen={() => showSideView("explorer")}
                  onTerminal={() => openBottom("terminal")}
                />
              ) : (
                <EditorGroups
                  layout={layout}
                  compact={compact}
                  tabs={tabs}
                  savingPath={saving}
                  renderEditor={renderEditor}
                  onSelectTab={selectTabByPath}
                  onCloseTab={closeTab}
                  onSave={(path) => void saveTab(path)}
                  onActivateGroup={focusGroup}
                  onSplit={(direction: SplitDirection) => split(direction)}
                  onCloseGroup={closeEditorGroup}
                  onMoveTab={moveTabToGroup}
                  editorActions={plugins.pluginEditorActions}
                />
              )}
            </div>

            {terminalOpen && (
              <>
                {!layout.bottomMaximized && (
                  <ResizeDivider
                    axis="y"
                    value={layout.bottomHeight}
                    min={120}
                    max={maxBottomHeight}
                    label="Resize bottom panel"
                    onChange={setBottomHeight}
                    onReset={() => setBottomHeight(DEFAULT_BOTTOM_HEIGHT)}
                  />
                )}
                <div
                  className={
                    layout.bottomMaximized
                      ? "absolute inset-0 z-20 flex flex-col border-t bg-background"
                      : "flex shrink-0 flex-col border-t"
                  }
                  style={layout.bottomMaximized ? undefined : { height: layout.bottomHeight }}
                >
                  <BottomPanel
                    workspaceId={workspace.id}
                    view={bottomView}
                    maximized={layout.bottomMaximized}
                    visible={terminalOpen}
                    output={output}
                    problems={problems}
                    runningTask={runningTask}
                    outputRef={outputRef}
                    onSelectView={(next) => {
                      setBottomView(next);
                      setBottomOpen(true);
                    }}
                    onShowProblems={() => {
                      setBottomView("output");
                      setBottomOpen(true);
                      setOutput(problems ? `${problems} problem(s) reported by language services.` : "No problems detected.");
                    }}
                    onClose={() => {
                      setBottomOpen(false);
                      setBottomMaximized(false);
                    }}
                    onToggleMaximize={() => setBottomMaximized(!layout.bottomMaximized)}
                    onStopTask={stopTask}
                  />
                </div>
              </>
            )}
          </main>
        </div>

        <IdeFooter
          workspace={workspace}
          activeTab={activeTab}
          lineCount={lineCount}
          lspStatus={lspStatus}
          plugins={plugins.enabled}
          status={plugins.status}
          pluginErrors={plugins.pluginErrors}
          onRun={(plugin, command) => plugins.runPluginCommand(plugin, command)}
        />
      </div>

      <ReferencesDialog
        locations={references}
        onClose={() => setReferences(null)}
        onOpen={(location) => {
          setReferences(null);
          void openLocation(location);
        }}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

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
