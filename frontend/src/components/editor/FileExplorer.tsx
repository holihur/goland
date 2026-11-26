import { useEffect, useState } from "react";
import {
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Entry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptDialog, type PromptState } from "@/components/PromptDialog";

function FileIcon({ name, className }: { name: string; className?: string }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".go")) return <FileCode2 className={cn("text-sky-400", className)} />;
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return <FileCode2 className={cn("text-blue-400", className)} />;
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return <FileCode2 className={cn("text-yellow-300", className)} />;
  if (lower.endsWith(".json")) return <FileJson className={cn("text-amber-300", className)} />;
  if (lower.endsWith(".md")) return <FileText className={cn("text-muted-foreground", className)} />;
  if (/\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|tiff?)$/.test(lower)) return <FileImage className={cn("text-emerald-400", className)} />;
  if (lower.endsWith(".pdf")) return <FileText className={cn("text-red-400", className)} />;
  return <File className={cn("text-muted-foreground", className)} />;
}

function joinPath(base: string, name: string) {
  return base ? `${base}/${name}` : name;
}

export function FileExplorer({
  workspaceId,
  refreshKey,
  onOpenFile,
  onChanged,
}: {
  workspaceId: string;
  refreshKey: number;
  onOpenFile: (path: string) => void;
  onChanged: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [localRefresh, setLocalRefresh] = useState(0);
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .tree(workspaceId)
      .then((result) => {
        if (!alive) return;
        setEntries(result.entries);
        setError("");
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Could not load files"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [workspaceId, refreshKey, localRefresh]);

  const refresh = () => {
    setLocalRefresh((value) => value + 1);
    onChanged();
  };

  const promptCreate = (base: string, kind: "file" | "dir") => {
    setPrompt({
      title: kind === "file" ? "New file" : "New folder",
      description: base ? `Create inside ${base}` : "Create at the workspace root",
      label: kind === "file" ? "File path" : "Folder path",
      placeholder: kind === "file" ? "internal/server.go" : "internal",
      confirmLabel: "Create",
      onSubmit: async (value) => {
        const target = joinPath(base, value);
        await api.createEntry(workspaceId, target, kind);
        refresh();
        if (kind === "file") onOpenFile(target);
      },
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Explorer</span>
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" title="New file" onClick={() => promptCreate("", "file")}>
            <FilePlus2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="New folder" onClick={() => promptCreate("", "dir")}>
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Refresh" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading files…</div>}
        {error && <div className="px-3 py-2 text-xs text-red-300">{error}</div>}
        {!loading &&
          entries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              workspaceId={workspaceId}
              refreshKey={refreshKey + localRefresh}
              onOpenFile={onOpenFile}
              onRefresh={refresh}
              onPrompt={setPrompt}
            />
          ))}
        {!loading && !error && entries.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground">This workspace is empty.</div>
        )}
      </div>

      <PromptDialog state={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

function TreeNode({
  entry,
  depth,
  workspaceId,
  refreshKey,
  onOpenFile,
  onRefresh,
  onPrompt,
}: {
  entry: Entry;
  depth: number;
  workspaceId: string;
  refreshKey: number;
  onOpenFile: (path: string) => void;
  onRefresh: () => void;
  onPrompt: (state: PromptState) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    setLoading(true);
    api
      .tree(workspaceId, entry.path)
      .then((result) => {
        if (!alive) return;
        setChildren(result.entries);
        setError("");
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Could not load folder"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [expanded, workspaceId, entry.path, refreshKey]);

  const create = (kind: "file" | "dir") => {
    onPrompt({
      title: kind === "file" ? "New file" : "New folder",
      description: `Create inside ${entry.path}`,
      label: kind === "file" ? "File path" : "Folder path",
      placeholder: kind === "file" ? "handler.go" : "handlers",
      confirmLabel: "Create",
      onSubmit: async (value) => {
        const target = joinPath(entry.path, value);
        await api.createEntry(workspaceId, target, kind);
        setExpanded(true);
        onRefresh();
        if (kind === "file") onOpenFile(target);
      },
    });
  };

  const rename = () => {
    const name = entry.name;
    onPrompt({
      title: "Rename",
      description: entry.path,
      label: "New name or path",
      initial: name,
      confirmLabel: "Rename",
      onSubmit: async (value) => {
        const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
        await api.renameEntry(workspaceId, entry.path, joinPath(parent, value));
        onRefresh();
      },
    });
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${entry.path}?${entry.type === "dir" ? " The entire folder will be removed." : ""}`)) {
      return;
    }
    await api.deleteEntry(workspaceId, entry.path, entry.type === "dir");
    onRefresh();
  };

  const isDir = entry.type === "dir";
  return (
    <div>
      <div
        className="group flex h-6 cursor-pointer items-center gap-1 pr-1 text-[12px] text-muted-foreground hover:bg-accent/60"
        style={{ paddingLeft: depth * 12 + 6 }}
        onClick={() => (isDir ? setExpanded((value) => !value) : onOpenFile(entry.path))}
      >
        {isDir ? (
          <>
            <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
            {expanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileIcon name={entry.name} className="h-3.5 w-3.5 shrink-0" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background group-hover:flex"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
            {isDir && (
              <>
                <DropdownMenuItem onSelect={() => create("file")}>
                  <FilePlus2 className="h-4 w-4" /> New file
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => create("dir")}>
                  <FolderPlus className="h-4 w-4" /> New folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={rename}>Rename…</DropdownMenuItem>
            <DropdownMenuItem className="text-red-400" onSelect={() => void remove()}>
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isDir && expanded && (
        <div>
          {loading && (
            <div className="py-1 text-[11px] text-muted-foreground" style={{ paddingLeft: depth * 12 + 27 }}>
              Loading…
            </div>
          )}
          {error && (
            <div className="py-1 text-[11px] text-red-300" style={{ paddingLeft: depth * 12 + 27 }}>
              {error}
            </div>
          )}
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              refreshKey={refreshKey}
              onOpenFile={onOpenFile}
              onRefresh={onRefresh}
              onPrompt={onPrompt}
            />
          ))}
          {!loading && !error && children.length === 0 && (
            <div className="py-1 text-[11px] text-muted-foreground" style={{ paddingLeft: depth * 12 + 27 }}>
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}
