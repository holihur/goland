import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { Diagnostic, User, Workspace } from "@/lib/types";
import { LSPClient, languageForPath, type SourceLocation } from "@/lib/lsp";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FileExplorer } from "@/components/editor/FileExplorer";
import { ActivityBar, ReferencesDialog, WelcomePane, WorkspaceSettings, type SideView } from "./IDEparts";
import { BottomPanel } from "./BottomPanel";
import { EditorGroups, type EditorTab as Tab } from "./EditorGroups";
import { IdeHeader } from "./IdeHeader";
import { ResizeDivider } from "./ResizeDivider";
import { useIdeLayout } from "@/lib/useIdeLayout";
import { clearDraft } from "@/lib/drafts";
import { applyTextEdits } from "@/lib/workspaceEdit";
import { readEditorSettings } from "@/lib/editorSettings";
import { useDrafts } from "@/lib/useDrafts";
import { useLSPActions } from "@/lib/useLSPActions";
import { useTaskRunner } from "@/lib/useTaskRunner";
import { useEditorViewState } from "@/lib/useEditorViewState";
import { useBreakpoints } from "@/lib/useBreakpoints";
import { usePluginContributions } from "@/lib/usePluginContributions";
import { pluginLspSocket } from "@/lib/plugin-api";
import { cn } from "@/lib/utils";
import { PluginSidebarPanel } from "@/components/plugins/PluginSidebarPanel";
import { IdeFooter } from "./IdeFooter";
import { buildPaletteActions } from "./paletteActions";
import { EditorPane } from "./EditorPane";
import { ByokDialog, CommandPalette, DebugPanel, GitPanel, ManagerDialog, OutlinePanel, SearchPanel, SettingsDialog, TokenDialog } from "./lazyViews";
import { useCommandSystem } from "@/lib/useCommandSystem";
import {
  DEFAULT_BOTTOM_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  groupOfPath,
  type SplitDirection,
} from "@/lib/layout";

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
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const {
    layout,
    compact,
    sidebarRight,
    sidebarMax,
    maxBottomHeight,
    restoredPaths,
    activePath,
    setSidebarWidth,
    setSidebarOpen,
    toggleSidebar,
    toggleSidebarPosition,
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
  const [treeKey, setTreeKey] = useState(0);
  const [gitKey, setGitKey] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [byokOpen, setByokOpen] = useState(false);
  const [managersOpen, setManagersOpen] = useState(false);
  const [saving, setSaving] = useState("");
  const [diagnostics, setDiagnostics] = useState<Record<string, Diagnostic[]>>({});
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const { viewStateRef, rememberCursor, rememberScroll } = useEditorViewState(activePath, setCursorLine, setCursorColumn);
  const plugins = usePluginContributions(workspace.id, activePath, cursorLine);
  const { breakpoints, setBreakpoints, toggleBreakpoint } = useBreakpoints();
  const [lspClients, setLspClients] = useState<Record<string, LSPClient>>({});
  const [lspStatus, setLspStatus] = useState<Record<string, string>>({});
  const [jumpTo, setJumpTo] = useState<(SourceLocation & { nonce: number }) | null>(null);
  const [locationsDialog, setLocationsDialog] = useState<{ title: string; locations: SourceLocation[] } | null>(null);
  const lspRef = useRef<Record<string, LSPClient>>({});
  const lspErrorNotified = useRef<Set<string>>(new Set());

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const draftForFile = useDrafts(user.id, workspace.id, tabs, tabsRef);

  useEffect(() => {
    return () => {
      for (const client of Object.values(lspRef.current)) client?.dispose();
      lspRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!restoredPaths.length) return;
    let cancelled = false;
    const restore = async () => {
      for (const path of restoredPaths) {
        try {
          const file = await api.readFile(workspace.id, path);
          if (cancelled) return;
          const draft = draftForFile(path, file);
          setTabs((prev) =>
            prev.some((tab) => tab.path === path)
              ? prev
              : [
                  ...prev,
                  {
                    path,
                    name: path.split("/").pop() ?? path,
                    content: draft.content,
                    etag: draft.etag,
                    binary: file.binary,
                    dirty: draft.dirty,
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
  }, [workspace.id, restoredPaths, unassignTab, selectTab, draftForFile]);

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

  const refreshTree = useCallback(() => setTreeKey((value) => value + 1), []);
  const refreshGit = useCallback(() => {
    setGitKey((value) => value + 1);
    onWorkspaceChanged();
  }, [onWorkspaceChanged]);

  const { tasks, output, setOutput, runningTask, outputRef, runTask, stopTask } = useTaskRunner({
    workspaceId: workspace.id,
    refreshKey: gitKey,
    bottomView,
    openOutput: () => openBottom("output"),
    onFinished: () => setGitKey((value) => value + 1),
  });

  const reloadReplacedFiles = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      const dirty = new Set(tabsRef.current.filter((tab) => tab.dirty).map((tab) => tab.path));
      let skippedDirty = false;
      for (const path of paths) {
        if (dirty.has(path)) {
          skippedDirty = true;
          continue;
        }
        try {
          const fresh = await api.readFile(workspace.id, path);
          setTabs((prev) =>
            prev.map((tab) =>
              tab.path === path
                ? { ...tab, content: fresh.content ?? "", etag: fresh.etag, binary: fresh.binary }
                : tab,
            ),
          );
        } catch {
          // The file may have been removed while replacing; refresh the tree anyway.
        }
      }
      if (skippedDirty) toast.warning("Some replaced files have unsaved changes and were not reloaded");
      refreshTree();
      refreshGit();
    },
    [workspace.id, refreshTree, refreshGit],
  );

  const openFile = useCallback(
    async (path: string, focus = true) => {
      if (!path) return;
      if (compact) setSidebarOpen(false);
      const existing = tabs.find((tab) => tab.path === path);
      if (existing) {
        const group = groupOfPath(layout, path);
        if (focus && group) selectTab(group, path);
        return;
      }
      try {
        const file = await api.readFile(workspace.id, path);
        const draft = draftForFile(path, file);
        setTabs((prev) => [
          ...prev,
          {
            path,
            name: path.split("/").pop() ?? path,
            content: draft.content,
            etag: draft.etag,
            binary: file.binary,
            dirty: draft.dirty,
          },
        ]);
        assignTab(path);
        setDiagnostics((current) => ({ ...current, [path]: [] }));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not open file");
      }
    },
    [tabs, workspace.id, layout, selectTab, assignTab, draftForFile, compact, setSidebarOpen],
  );

  const closeTab = (path: string) => {
    const index = tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    const tab = tabs[index];
    if (tab.dirty && !window.confirm(`Close ${tab.name} without saving?`)) return;
    clearDraft(user.id, workspace.id, path);
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
        let content = tab.content;
        if (readEditorSettings().formatOnSave) {
          const formatter = lspClientForPath(path);
          if (formatter) {
            try {
              const edits = await formatter.formatting(path);
              if (edits.length) {
                const formatted = applyTextEdits(content, edits);
                if (formatted !== content) {
                  content = formatted;
                  setTabs((prev) => prev.map((item) => (item.path === path ? { ...item, content: formatted } : item)));
                }
              }
            } catch {
              // Saving still proceeds with the user's content when formatting fails.
            }
          }
        }
        const result = await api.writeFile(workspace.id, tab.path, content, tab.etag);
        setTabs((prev) =>
          prev.map((item) =>
            item.path === path ? { ...item, content: result.content ?? item.content, etag: result.etag, dirty: false } : item,
          ),
        );
        clearDraft(user.id, workspace.id, path);
        void lspClientForPath(path)?.saveDocument(path, content).catch(() => undefined);
        toast.success(`Saved ${tab.name}`);
        setGitKey((value) => value + 1);
        onWorkspaceChanged();
      } catch (err) {
        if (err instanceof ApiError && err.code === "conflict") {
          if (window.confirm("This file changed on disk. Reload it and discard your local edits?")) {
            try {
              const fresh = await api.readFile(workspace.id, path);
              clearDraft(user.id, workspace.id, path);
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
    [tabs, saving, workspace.id, onWorkspaceChanged, user.id],
  );

  const openLocation = useCallback(
    async (location: SourceLocation) => {
      await openFile(location.path);
      setJumpTo({ ...location, nonce: Date.now() });
    },
    [openFile],
  );

  const { goToDefinition, goToImplementation, findReferences, renameSymbol, requestCodeActions } = useLSPActions({
    workspaceId: workspace.id,
    userId: user.id,
    activeTab,
    cursorLine,
    cursorColumn,
    diagnostics,
    tabsRef,
    setTabs,
    refreshTree,
    refreshGit,
    lspClientForPath,
    onOpenLocation: (location) => void openLocation(location),
    onShowLocations: (title, locations) => setLocationsDialog({ title, locations }),
  });

  const goToWorkspaceSymbol = useCallback(async () => {
    if (!activeTab) return;
    const lsp = lspClientForPath(activeTab.path);
    if (!lsp) {
      toast.error("No language server is available for this file");
      return;
    }
    const query = window.prompt("Go to symbol in workspace:");
    if (!query?.trim()) return;
    try {
      const locations = await lsp.workspaceSymbols(query.trim());
      if (!locations.length) {
        toast.info("No matching symbols");
        return;
      }
      await openLocation(locations[0]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Symbol search failed");
    }
  }, [activeTab, openLocation]);

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

  const paletteActions = buildPaletteActions({
    activePath,
    cursorLine,
    layout,
    tabs,
    compact,
    saveTab: (path) => void saveTab(path),
    closeTab,
    toggleSidebar,
    toggleSidebarPosition,
    toggleBottom,
    openBottom,
    showSideView,
    openPalette: () => setPaletteOpen(true),
    openManagers: () => setManagersOpen(true),
    openSettings: () => setSettingsOpen(true),
    openTokens: () => setTokensOpen(true),
    openByok: () => setByokOpen(true),
    goToWorkspaceSymbol: () => void goToWorkspaceSymbol(),
    goToDefinition: () => void goToDefinition(),
    findReferences: () => void findReferences(),
    goToImplementation: () => void goToImplementation(),
    renameSymbol: () => void renameSymbol(),
    toggleBreakpoint,
    split,
    closeEditorGroup,
    setBottomMaximized,
    reset,
    pluginActions: plugins.pluginPaletteActions,
  });

  const commandSystem = useCommandSystem({
    userId: user.id,
    actions: paletteActions,
    pluginKeybindings: plugins.pluginKeybindings,
    pluginMenus: plugins.pluginMenus,
    disabled: managersOpen,
  });
  const { commands, keybindings, shortcuts, runCommand, fullMenus, menus, menuPreferences } = commandSystem;

  const renderEditor = (path: string) => (
    <EditorPane
      path={path}
      tabs={tabs}
      diagnostics={diagnostics}
      lspClients={lspClients}
      lspTargetForPath={lspTargetForPath}
      jumpTo={jumpTo}
      breakpoints={breakpoints}
      toggleBreakpoint={toggleBreakpoint}
      updateContent={updateContent}
      saveTab={saveTab}
      rememberCursor={rememberCursor}
      rememberScroll={rememberScroll}
      viewStateRef={viewStateRef}
    />
  );

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
          onOpenTokens={() => setTokensOpen(true)}
          onOpenByok={() => setByokOpen(true)}
          menus={menus}
          commands={commands}
          shortcuts={shortcuts}
          onRunCommand={runCommand}
          onOpenManagers={() => setManagersOpen(true)}
        />

        <div className="relative flex min-h-0 flex-1">
          <ActivityBar
            view={view}
            sidebarOpen={sidebarOpen}
            onSelect={selectSideView}
            onPalette={() => setPaletteOpen(true)}
            pluginPanels={plugins.pluginPanels}
            position={layout.sidebarPosition}
          />

          {sidebarOpen && (
            <>
            {compact && (
              <button
                aria-label="Close sidebar"
                className={cn(
                  "absolute inset-y-0 z-20 bg-black/30",
                  sidebarRight ? "left-0 right-11" : "left-11 right-0",
                )}
                onClick={() => setSidebarOpen(false)}
              />
            )}
            {!compact && sidebarRight && (
              <ResizeDivider
                axis="x"
                value={layout.sidebarWidth}
                min={180}
                max={sidebarMax}
                label="Resize sidebar"
                invert
                className="order-2"
                onChange={setSidebarWidth}
                onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
              />
            )}
            <aside
              data-testid="sidebar"
              className={cn(
                compact
                  ? sidebarRight
                    ? "absolute inset-y-0 right-11 z-30 flex w-[82vw] max-w-[320px] flex-col overflow-hidden border-l bg-panel shadow-2xl"
                    : "absolute inset-y-0 left-11 z-30 flex w-[82vw] max-w-[320px] flex-col overflow-hidden border-r bg-panel shadow-2xl"
                  : cn("flex min-w-0 shrink-0 flex-col overflow-hidden bg-panel", sidebarRight ? "order-2 border-l" : "border-r"),
              )}
              style={compact ? undefined : { width: layout.sidebarWidth }}
            >
              {view === "explorer" && (
                <FileExplorer
                  workspaceId={workspace.id}
                  refreshKey={treeKey}
                  onOpenFile={openFile}
                  onChanged={refreshTree}
                />
              )}
              {view === "search" && (
                <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading search…</div>}>
                  <SearchPanel
                    workspaceId={workspace.id}
                    onOpenFile={(path, line, column) => {
                      if (line) void openLocation({ path, line, column: column ?? 1, endLine: line, endColumn: column ?? 1 });
                      else void openFile(path);
                    }}
                    onReplaced={(paths) => void reloadReplacedFiles(paths)}
                  />
                </Suspense>
              )}
              {view === "outline" && (
                <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading outline…</div>}>
                  <OutlinePanel
                    path={activePath}
                    lsp={activeTab ? lspClients[lspTargetForPath(activeTab.path)?.key ?? ""] ?? null : null}
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
                onOpenFile={(path, line) =>
                  void openLocation({ path, line, column: 1, endLine: line, endColumn: 1 })
                }
              />
            </aside>
            {!compact && !sidebarRight && (
              <ResizeDivider
                axis="x"
                value={layout.sidebarWidth}
                min={180}
                max={sidebarMax}
                label="Resize sidebar"
                onChange={setSidebarWidth}
                onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
              />
            )}
            </>
          )}

          <main className={cn("relative flex min-w-0 flex-1 flex-col", sidebarRight && "order-1")}>
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
                  onLoadCodeActions={requestCodeActions}
                />
              )}
            </div>

            {terminalOpen && (
              <>
                {!layout.bottomMaximized && !compact && (
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
                      : compact
                        ? "absolute inset-x-0 bottom-0 z-20 flex flex-col border-t bg-background shadow-2xl"
                        : "flex shrink-0 flex-col border-t"
                  }
                  style={
                    layout.bottomMaximized
                      ? undefined
                      : compact
                        ? { height: "min(50vh, 380px)" }
                        : { height: layout.bottomHeight }
                  }
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
                    onOpenFile={(path, line) =>
                      void openLocation({ path, line, column: 1, endLine: line, endColumn: 1 })
                    }
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
        locations={locationsDialog?.locations ?? null}
        title={locationsDialog?.title}
        onClose={() => setLocationsDialog(null)}
        onOpen={(location) => {
          setLocationsDialog(null);
          void openLocation(location);
        }}
      />
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open onOpenChange={setSettingsOpen} />
        </Suspense>
      )}
      {tokensOpen && (
        <Suspense fallback={null}>
          <TokenDialog open onOpenChange={setTokensOpen} />
        </Suspense>
      )}
      {byokOpen && (
        <Suspense fallback={null}>
          <ByokDialog open onOpenChange={setByokOpen} />
        </Suspense>
      )}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open
            onOpenChange={setPaletteOpen}
            workspaceId={workspace.id}
            onOpenFile={openFile}
            actions={paletteActions}
            shortcuts={shortcuts}
          />
        </Suspense>
      )}
      {managersOpen && (
        <Suspense fallback={null}>
          <ManagerDialog
            open
            onOpenChange={setManagersOpen}
            commands={commands}
            bindings={keybindings.bindings}
            defaults={keybindings.defaults}
            overrides={keybindings.overrides}
            conflicts={keybindings.conflicts}
            menus={fullMenus}
            menuPreferences={menuPreferences}
            onRunCommand={runCommand}
            onSetBinding={keybindings.setBinding}
            onResetBinding={keybindings.resetBinding}
            onResetAllBindings={keybindings.resetAll}
            onToggleMenuItem={commandSystem.toggleMenuItem}
            onMoveMenuItem={(menu, itemId, direction) => commandSystem.moveMenuItem(menu.id, itemId, direction)}
            onResetMenus={commandSystem.resetMenus}
          />
        </Suspense>
      )}
    </TooltipProvider>
  );
}
