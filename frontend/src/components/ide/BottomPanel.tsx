import { lazy, Suspense, type RefObject } from "react";
import { Circle, FlaskConical, Maximize2, Minimize2, PanelBottom, TerminalSquare, X } from "lucide-react";
import type { TaskInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BottomView } from "@/lib/layout";
import { TestsPanel } from "@/components/editor/TestsPanel";

const TerminalPanel = lazy(() =>
  import("@/components/editor/TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
);

export function BottomPanel({
  workspaceId,
  view,
  maximized,
  visible,
  output,
  problems,
  runningTask,
  outputRef,
  onSelectView,
  onShowProblems,
  onClose,
  onToggleMaximize,
  onStopTask,
  onOpenFile,
}: {
  workspaceId: string;
  view: BottomView;
  maximized: boolean;
  /** Terminal stays mounted while the bottom dock is visible. */
  visible: boolean;
  output: string;
  problems: number;
  runningTask: TaskInfo | null;
  outputRef: RefObject<HTMLPreElement | null>;
  onSelectView: (view: BottomView) => void;
  onShowProblems: () => void;
  onClose: () => void;
  onToggleMaximize: () => void;
  onStopTask: () => void;
  onOpenFile: (path: string, line: number) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bottom-panel">
      <div className="flex h-8 shrink-0 items-center border-b bg-panel/70 px-2">
        <button
          className={cn(
            "flex h-full items-center gap-1.5 border-b px-2 text-[10px] uppercase tracking-wider",
            view === "terminal" ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
          )}
          aria-pressed={view === "terminal"}
          onClick={() => onSelectView("terminal")}
        >
          <TerminalSquare className="h-3 w-3" /> Terminal
        </button>
        <button
          className={cn(
            "flex h-full items-center gap-1.5 border-b px-2 text-[10px] uppercase tracking-wider",
            view === "output" ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
          )}
          aria-pressed={view === "output"}
          onClick={() => onSelectView("output")}
        >
          <PanelBottom className="h-3 w-3" /> Output
        </button>
        <button
          className={cn(
            "flex h-full items-center gap-1.5 border-b px-2 text-[10px] uppercase tracking-wider",
            view === "tests" ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
          )}
          aria-pressed={view === "tests"}
          onClick={() => onSelectView("tests")}
        >
          <FlaskConical className="h-3 w-3" /> Tests
        </button>
        <button
          className={cn(
            "flex h-full items-center gap-1.5 border-b px-2 text-[10px] uppercase tracking-wider",
            problems > 0 ? "text-amber-300" : "text-muted-foreground",
          )}
          aria-label="Show problems"
          onClick={onShowProblems}
        >
          <Circle className="h-2 w-2" /> Problems {problems > 0 ? problems : ""}
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            aria-label={maximized ? "Restore panel size" : "Maximize panel"}
            title={maximized ? "Restore panel size" : "Maximize panel"}
            className="grid h-6 w-6 place-items-center rounded hover:bg-accent"
            onClick={onToggleMaximize}
          >
            {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            aria-label="Close panel"
            title="Close panel"
            className="grid h-6 w-6 place-items-center rounded hover:bg-accent"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className={cn("min-h-0 flex-1", view !== "terminal" && "hidden")}>
        {visible && (
          <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">Loading terminal…</div>}>
            <TerminalPanel workspaceId={workspaceId} visible={visible && view === "terminal"} />
          </Suspense>
        )}
      </div>
      {view === "tests" && (
        <div className="min-h-0 flex-1">
          <TestsPanel workspaceId={workspaceId} onOpenFile={onOpenFile} />
        </div>
      )}
      {view === "output" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-7 shrink-0 items-center justify-between border-b px-2 text-[10px] text-muted-foreground">
            <span className="truncate font-code">{runningTask ? `running: ${runningTask.label}` : "output"}</span>
            {runningTask && (
              <button className="rounded px-1.5 py-0.5 text-red-300 hover:bg-red-500/10" onClick={onStopTask}>
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
  );
}
