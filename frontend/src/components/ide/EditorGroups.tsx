import { useRef, useState, type ReactNode } from "react";
import { Columns2, FileCode2, Lightbulb, Loader2, Puzzle, Rows2, Save, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  activeGroupIdOf,
  displayActivePath,
  groupOfPath,
  groupState,
  visiblePaths,
  type LayoutState,
  type SplitDirection,
} from "@/lib/layout";

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  etag?: string;
  binary: boolean;
  dirty: boolean;
}

const DRAG_THRESHOLD = 6;

export function EditorGroups({
  layout,
  compact,
  tabs,
  savingPath,
  renderEditor,
  onSelectTab,
  onCloseTab,
  onSave,
  onActivateGroup,
  onSplit,
  onCloseGroup,
  onMoveTab,
  editorActions = [],
  onLoadCodeActions,
}: {
  layout: LayoutState;
  compact: boolean;
  tabs: EditorTab[];
  savingPath: string;
  renderEditor: (path: string) => ReactNode;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: (path: string) => void;
  onActivateGroup: (groupId: string) => void;
  onSplit: (direction: SplitDirection) => void;
  onCloseGroup: (groupId: string) => void;
  onMoveTab: (path: string, groupId: string) => void;
  editorActions?: Array<{ id: string; title: string; onSelect: () => void }>;
  onLoadCodeActions?: () => Promise<Array<{ id: string; title: string; run: () => void }>>;
}) {
  const [dragPath, setDragPath] = useState("");
  const dragPathRef = useRef("");
  const [dropTarget, setDropTarget] = useState("");
  const [codeActions, setCodeActions] = useState<Array<{ id: string; title: string; run: () => void }>>([]);
  const [codeActionsLoading, setCodeActionsLoading] = useState(false);
  const hoverGroup = useRef("");

  const loadCodeActions = () => {
    if (!onLoadCodeActions) return;
    setCodeActionsLoading(true);
    void onLoadCodeActions()
      .then(setCodeActions)
      .catch(() => setCodeActions([]))
      .finally(() => setCodeActionsLoading(false));
  };
  const openPaths = tabs.map((tab) => tab.path);
  const activeGroupId = activeGroupIdOf(layout);
  const rows = compact ? [[activeGroupId]] : layout.rows;

  const endDrag = (path: string, moved: boolean) => {
    const target = hoverGroup.current;
    if (moved && target && groupOfPath(layout, path) !== target) onMoveTab(path, target);
    hoverGroup.current = "";
    dragPathRef.current = "";
    setDropTarget("");
    setDragPath("");
  };

  const beginDrag = (event: React.PointerEvent, path: string) => {
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    const onMove = (moveEvent: PointerEvent) => {
      if (!moved && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD) return;
      moved = true;
      dragPathRef.current = path;
      setDragPath(path);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      endDrag(path, moved);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="editor-groups">
      {rows.map((row, rowIndex) => (
        <div key={`row-${rowIndex}`} className="flex min-h-0 flex-1">
          {row.map((groupId) => {
            const group = groupState(layout, groupId);
            const paths = visiblePaths(layout, groupId, openPaths);
            const displayPath = displayActivePath(layout, groupId, openPaths);
            const activeTab = tabs.find((tab) => tab.path === displayPath) ?? null;
            const isActive = groupId === activeGroupId;
            const isDropTarget = dropTarget === groupId && dragPath !== "";
            return (
              <section
                key={groupId}
                data-editor-group={groupId}
                data-active={isActive ? "true" : "false"}
                data-drop-target={isDropTarget ? "true" : "false"}
                aria-label={`Editor group ${groupId}`}
                className={cn(
                  "flex min-w-0 flex-1 flex-col border-r last:border-r-0",
                  isDropTarget && "bg-primary/10",
                  isActive && layout.rows.flat().length > 1 && !compact && "ring-1 ring-inset ring-primary/40",
                )}
                onPointerDown={() => onActivateGroup(groupId)}
                onPointerEnter={() => {
                  if (!dragPathRef.current) return;
                  hoverGroup.current = groupId;
                  setDropTarget(groupId);
                }}
                onPointerLeave={() => {
                  if (hoverGroup.current !== groupId) return;
                  hoverGroup.current = "";
                  setDropTarget("");
                }}
              >
                <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-panel/60 [scrollbar-width:none]">
                  {paths.map((path) => {
                    const tab = tabs.find((item) => item.path === path);
                    if (!tab) return null;
                    const selected = path === group.activePath || (!group.activePath && path === paths[0]);
                    return (
                      <div
                        key={path}
                        role="tab"
                        aria-selected={selected}
                        data-tab-path={path}
                        data-dragging={dragPath === path ? "true" : "false"}
                        title={path}
                        className={cn(
                          "group flex min-w-[110px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 text-[11px]",
                          selected
                            ? "border-t border-t-primary bg-editor text-foreground"
                            : "text-muted-foreground hover:bg-accent/40",
                          dragPath === path && "opacity-50",
                        )}
                        onPointerDown={(event) => {
                          onSelectTab(path);
                          beginDrag(event, path);
                        }}
                        onClick={() => onSelectTab(path)}
                        onAuxClick={(event) => event.button === 1 && onCloseTab(path)}
                      >
                        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                        <span className="truncate">{tab.name}</span>
                        {tab.dirty ? (
                          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-label="Unsaved changes" />
                        ) : null}
                        <button
                          aria-label={`Close ${tab.name}`}
                          className={cn(
                            "ml-auto grid h-4 w-4 shrink-0 place-items-center rounded hover:bg-background/70",
                            !tab.dirty && "opacity-0 group-hover:opacity-100",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            onCloseTab(path);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                  <div className="ml-auto flex shrink-0 items-center px-1">
                    {activeTab && onLoadCodeActions && (
                      <DropdownMenu onOpenChange={(open) => open && loadCodeActions()}>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label="Code actions"
                            title="Code actions"
                            className="grid h-6 w-6 place-items-center rounded hover:bg-accent"
                          >
                            <Lightbulb className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {codeActionsLoading ? (
                            <DropdownMenuItem disabled>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                            </DropdownMenuItem>
                          ) : codeActions.length === 0 ? (
                            <DropdownMenuItem disabled>No code actions</DropdownMenuItem>
                          ) : (
                            codeActions.map((action) => (
                              <DropdownMenuItem key={action.id} onSelect={action.run}>
                                {action.title}
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {activeTab && editorActions.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label="Editor actions"
                            title="Editor actions"
                            className="grid h-6 w-6 place-items-center rounded hover:bg-accent"
                          >
                            <Puzzle className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {editorActions.map((action) => (
                            <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
                              {action.title}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <button
                      aria-label="Save file"
                      title="Save"
                      disabled={!activeTab?.dirty}
                      className="grid h-6 w-6 place-items-center rounded hover:bg-accent disabled:opacity-40"
                      onClick={() => displayPath && onSave(displayPath)}
                    >
                      {savingPath === displayPath ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {!compact && (
                      <>
                        <button
                          aria-label="Split editor right"
                          title="Split editor right (⌘\)"
                          className="grid h-6 w-6 place-items-center rounded hover:bg-accent disabled:opacity-40"
                          onClick={() => onSplit("right")}
                        >
                          <Columns2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label="Split editor down"
                          title="Split editor down (⌘⇧\)"
                          className="grid h-6 w-6 place-items-center rounded hover:bg-accent disabled:opacity-40"
                          onClick={() => onSplit("down")}
                        >
                          <Rows2 className="h-3.5 w-3.5" />
                        </button>
                        {layout.rows.flat().length > 1 && (
                          <button
                            aria-label="Close editor group"
                            title="Close editor group (⌘⌥\)"
                            className="grid h-6 w-6 place-items-center rounded hover:bg-accent"
                            onClick={() => onCloseGroup(groupId)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden bg-editor">
                  {activeTab ? (
                    <div className="h-full" data-editor-path={activeTab.path}>
                      {renderEditor(activeTab.path)}
                    </div>
                  ) : (
                    <div className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground">
                      No open editors in this group. Drag a tab here or split the editor.
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ))}
    </div>
  );
}
