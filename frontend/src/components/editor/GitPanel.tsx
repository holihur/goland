import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { GitBranch as Branch, GitConflict, GitStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PromptDialog, type PromptState } from "@/components/PromptDialog";
import { GitDiff } from "@/components/editor/GitDiff";

function isConflict(index: string, worktree: string) {
  return (
    (index === "U" && worktree === "U") ||
    (index === "A" && worktree === "A") ||
    (index === "D" && worktree === "D")
  );
}

function statusLabel(index: string, worktree: string) {
  if (isConflict(index, worktree)) return { text: "!", color: "text-red-400" };
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
  const [diffCached, setDiffCached] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [conflict, setConflict] = useState<GitConflict | null>(null);
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
      setStatus({ ...nextStatus, files: nextStatus.files ?? [] });
      setBranches(nextBranches.branches ?? []);
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
    setDiffCached(cached);
    setDiffLoading(true);
    const file = status?.files.find((item) => item.path === path);
    const conflicted = !!file && isConflict(file.index, file.worktree);
    try {
      const result = await api.gitDiff(workspaceId, path, cached);
      setDiff(result.diff || "");
      if (conflicted) {
        setConflict(await api.gitConflict(workspaceId, path));
      } else {
        setConflict(null);
      }
    } catch (err) {
      setDiff(err instanceof ApiError ? err.message : "Could not load diff");
      setConflict(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const resolveConflict = async (resolution: "ours" | "theirs" | "both" | "mark") => {
    if (!selected) return;
    await action("resolve", () => api.gitResolve(workspaceId, selected, resolution), "Conflict resolved");
    setConflict(null);
    setSelected("");
    setDiff("");
  };

  const applyPatch = async (patch: string, reverse: boolean) => {
    setBusy("hunk");
    try {
      await api.gitApplyPatch(workspaceId, patch, reverse);
      toast.success(reverse ? "Hunk unstaged" : "Hunk staged");
      await load();
      onWorkspaceChanged();
      if (selected) await openDiff(selected, diffCached);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not apply hunk");
      throw err;
    } finally {
      setBusy("");
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

  const files = status?.files ?? [];

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
          {files.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-emerald-400" /> Working tree clean
            </div>
          )}
          {files.map((file) => {
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
            {conflict && (
              <>
                <div className="flex flex-wrap gap-1 border-t p-1.5">
                  <Button size="sm" className="h-6 text-[10px]" onClick={() => void resolveConflict("ours")}>
                    <GitMerge className="h-3 w-3" /> Ours
                  </Button>
                  <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => void resolveConflict("theirs")}>
                    Theirs
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => void resolveConflict("both")}>
                    Both
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => void resolveConflict("mark")}>
                    Mark resolved
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => onOpenFile(selected)}>
                    Edit
                  </Button>
                </div>
                <div className="grid max-h-40 grid-cols-2 divide-x overflow-auto border-t bg-background/60 font-code text-[10px] leading-4">
                  <div className="min-w-0 p-1.5">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-red-400">Ours</div>
                    <pre className="whitespace-pre-wrap break-all">{conflict.ours || "(empty)"}</pre>
                  </div>
                  <div className="min-w-0 p-1.5">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-emerald-400">Theirs</div>
                    <pre className="whitespace-pre-wrap break-all">{conflict.theirs || "(empty)"}</pre>
                  </div>
                </div>
              </>
            )}
            {diffLoading ? (
              <div className="border-t p-2 font-code text-[10px] leading-4 text-muted-foreground">Loading diff…</div>
            ) : diff.trim() ? (
              <GitDiff diff={diff} cached={diffCached} onApplyPatch={applyPatch} />
            ) : (
              <div className="border-t p-2 font-code text-[10px] leading-4 text-muted-foreground">
                No {diffCached ? "staged" : "working"} changes for this file.
              </div>
            )}
          </div>
        )}

        {showLog && (
          <div className="border-t">
            <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">Recent commits</div>
            <pre className="max-h-40 overflow-auto bg-background/60 p-2 font-code text-[10px] leading-4 text-muted-foreground">
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
