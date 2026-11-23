import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { GitBranch as Branch, GitStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PromptDialog, type PromptState } from "@/components/PromptDialog";

function statusLabel(index: string, worktree: string) {
  if (index === "A" || worktree === "A") return { text: "A", color: "text-emerald-400" };
  if (index === "D" || worktree === "D") return { text: "D", color: "text-red-400" };
  if (index === "R" || worktree === "R") return { text: "R", color: "text-amber-300" };
  if (index === "?" && worktree === "?") return { text: "U", color: "text-sky-400" };
  return { text: "M", color: "text-amber-300" };
}

export function GitPanel({
  workspaceId,
  refreshKey,
  onOpenFile,
  onWorkspaceChanged,
}: {
  workspaceId: string;
  refreshKey: number;
  onOpenFile: (path: string) => void;
  onWorkspaceChanged: () => void;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextBranches] = await Promise.all([
        api.gitStatus(workspaceId),
        api.gitBranches(workspaceId),
      ]);
      setStatus(nextStatus);
      setBranches(nextBranches.branches);
      setError("");
    } catch (err) {
      setStatus(null);
      setBranches([]);
      setError(err instanceof ApiError ? err.message : "Could not read Git status");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const openDiff = async (path: string, cached = false) => {
    setSelected(path);
    setDiffLoading(true);
    try {
      const result = await api.gitDiff(workspaceId, path, cached);
      setDiff(result.diff || (cached ? "No staged changes for this file." : "No text diff for this file."));
    } catch (err) {
      setDiff(err instanceof ApiError ? err.message : "Could not load diff");
    } finally {
      setDiffLoading(false);
    }
  };

  const action = async (label: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(label);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
      onWorkspaceChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Git operation failed");
    } finally {
      setBusy("");
    }
  };

  const commit = async () => {
    if (!commitMessage.trim()) return;
    await action(
      "commit",
      async () => {
        await api.gitCommit(workspaceId, commitMessage.trim());
        setCommitMessage("");
      },
      "Commit created",
    );
  };

  const createBranch = () => {
    setPrompt({
      title: "Create branch",
      description: "The branch is created from the current HEAD and checked out.",
      label: "Branch name",
      placeholder: "feature/my-change",
      confirmLabel: "Create & switch",
      onSubmit: async (name) => {
        await api.gitCreateBranch(workspaceId, name);
        await load();
        onWorkspaceChanged();
        toast.success(`Switched to ${name}`);
      },
    });
  };

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b p-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Source control
        </div>
        <div className="p-4 text-xs leading-5 text-muted-foreground">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <GitBranch className="h-3 w-3" /> Source control
        </div>
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" title="Create branch" onClick={createBranch}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Refresh" onClick={() => void load()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <select
          value={status?.branch ?? ""}
          onChange={(event) => {
            if (event.target.value && event.target.value !== status?.branch) {
              void action("checkout", () => api.gitCheckout(workspaceId, event.target.value), "Branch switched");
            }
          }}
          className="h-7 min-w-0 flex-1 rounded border border-input bg-background/50 px-1.5 font-code text-[10px]"
        >
          {!status?.branch && <option value="">no branch</option>}
          {branches.map((branch) => (
            <option key={branch.name} value={branch.name}>
              {branch.name}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Fast-forward pull"
          disabled={!!busy}
          onClick={() => void action("pull", () => api.gitPull(workspaceId), "Pulled")}
        >
          {busy === "pull" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownToLine className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Push"
          disabled={!!busy}
          onClick={() => void action("push", () => api.gitPush(workspaceId), "Pushed")}
        >
          {busy === "push" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="History"
          onClick={() => {
            setShowLog((value) => !value);
            if (!log) void api.gitLog(workspaceId).then((result) => setLog(result.log)).catch(() => setLog(""));
          }}
        >
          <History className="h-3.5 w-3.5" />
        </Button>
      </div>

      {status && (status.ahead > 0 || status.behind > 0) && (
        <div className="border-b px-3 py-1 text-[10px] text-muted-foreground">
          {status.ahead > 0 && <span>{status.ahead} ahead</span>}
          {status.ahead > 0 && status.behind > 0 && " · "}
          {status.behind > 0 && <span>{status.behind} behind</span>}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {status?.files.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-emerald-400" /> Working tree clean
            </div>
          )}
          {status?.files.map((file) => {
            const label = statusLabel(file.index, file.worktree);
            return (
              <div
                key={file.path}
                className={cn(
                  "group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-accent",
                  selected === file.path && "bg-accent/70",
                )}
                onClick={() => void openDiff(file.path, file.index !== " " && file.index !== "?")}
                onDoubleClick={() => onOpenFile(file.path)}
              >
                <span className={cn("w-3 font-code text-[10px] font-bold", label.color)}>{label.text}</span>
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                <button
                  className="hidden h-5 w-5 items-center justify-center rounded hover:bg-background group-hover:flex"
                  title="Stage"
                  onClick={(event) => {
                    event.stopPropagation();
                    void action("stage", () => api.gitStage(workspaceId, file.path));
                  }}
                >
                  <Plus className="h-3 w-3" />
                </button>
                <button
                  className="hidden h-5 w-5 items-center justify-center rounded hover:bg-background group-hover:flex"
                  title="Unstage"
                  onClick={(event) => {
                    event.stopPropagation();
                    void action("unstage", () => api.gitUnstage(workspaceId, file.path));
                  }}
                >
                  <Undo2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        {selected && (
          <div className="border-t">
            <div className="flex items-center justify-between px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">
              <span>Diff · {selected}</span>
              <div className="flex">
                <button className="rounded px-1 hover:bg-accent" onClick={() => void openDiff(selected, false)}>
                  working
                </button>
                <button className="rounded px-1 hover:bg-accent" onClick={() => void openDiff(selected, true)}>
                  staged
                </button>
              </div>
            </div>
            <pre className="max-h-64 overflow-auto border-t bg-black/25 p-2 font-code text-[10px] leading-4 text-slate-300">
              {diffLoading ? "Loading diff…" : diff}
            </pre>
          </div>
        )}

        {showLog && (
          <div className="border-t">
            <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">Recent commits</div>
            <pre className="max-h-40 overflow-auto bg-black/25 p-2 font-code text-[10px] leading-4 text-slate-300">
              {log || "No commits yet."}
            </pre>
          </div>
        )}
      </ScrollArea>

      <div className="space-y-2 border-t p-2">
        <Textarea
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
          className="min-h-[58px] resize-none text-xs"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void commit();
          }}
        />
        <div className="flex gap-1.5">
          <Button className="h-7 flex-1 text-xs" disabled={!commitMessage.trim() || !!busy} onClick={() => void commit()}>
            {busy === "commit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />}
            Commit
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            title="Stage all"
            disabled={!!busy}
            onClick={() => void action("stage-all", () => api.gitStage(workspaceId))}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            title="Unstage all"
            disabled={!!busy}
            onClick={() => void action("unstage-all", () => api.gitUnstage(workspaceId))}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <PromptDialog state={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}
