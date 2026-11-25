import { useEffect, useMemo, useState } from "react";
import { CaseSensitive, FileCode2, Loader2, Regex, Replace, Search } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { ContentMatch, ContentSearchResult, Entry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type Mode = "files" | "content";

export function SearchPanel({
  workspaceId,
  onOpenFile,
  onReplaced,
}: {
  workspaceId: string;
  onOpenFile: (path: string, line?: number, column?: number) => void;
  onReplaced?: (paths: string[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("files");
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fileResults, setFileResults] = useState<Entry[]>([]);
  const [content, setContent] = useState<ContentSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (mode !== "files" || !query.trim()) {
      setFileResults([]);
      if (mode === "files") setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .search(workspaceId, query.trim())
        .then((result) => {
          if (cancelled) return;
          setFileResults(result.results);
          setError("");
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Search failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, workspaceId, mode]);

  useEffect(() => {
    if (mode !== "content" || !query.trim()) {
      setContent(null);
      if (mode === "content") setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .searchContent(workspaceId, { query: query.trim(), regex, caseSensitive, limit: 500 })
        .then((result) => {
          if (cancelled) return;
          setContent(result);
          setError("");
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Search failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, workspaceId, mode, regex, caseSensitive, refreshKey]);

  const groups = useMemo(() => {
    const map = new Map<string, ContentMatch[]>();
    for (const match of content?.matches ?? []) {
      const list = map.get(match.path) ?? [];
      list.push(match);
      map.set(match.path, list);
    }
    return [...map.entries()];
  }, [content]);

  const replaceAll = async () => {
    if (!query.trim() || !content?.matches.length || replacing) return;
    const count = content.matches.length;
    if (!window.confirm(`Replace ${count} match${count === 1 ? "" : "es"} in ${content.files} file${content.files === 1 ? "" : "s"}?`)) {
      return;
    }
    setReplacing(true);
    try {
      const result = await api.replaceContent(workspaceId, {
        query: query.trim(),
        replacement,
        regex,
        caseSensitive,
      });
      toast.success(
        `Replaced ${result.replacements} match${result.replacements === 1 ? "" : "es"} in ${
          result.changedFiles.length
        } file${result.changedFiles.length === 1 ? "" : "s"}`,
      );
      onReplaced?.(result.changedFiles);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Replace failed");
    } finally {
      setReplacing(false);
    }
  };

  const searching = mode === "content" ? content : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="mb-2 flex items-center gap-1">
          <button
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
              mode === "files" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => setMode("files")}
          >
            Files
          </button>
          <button
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
              mode === "content" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
            onClick={() => setMode("content")}
          >
            Contents
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "files" ? "Filename or path…" : "Search file contents…"}
            className="h-8 pl-8 pr-16 text-xs"
          />
          {mode === "content" && (
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
              <Button
                variant={caseSensitive ? "secondary" : "ghost"}
                size="icon-sm"
                title="Match case"
                aria-pressed={caseSensitive}
                onClick={() => setCaseSensitive((value) => !value)}
              >
                <CaseSensitive className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={regex ? "secondary" : "ghost"}
                size="icon-sm"
                title="Use regular expression"
                aria-pressed={regex}
                onClick={() => setRegex((value) => !value)}
              >
                <Regex className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {loading && mode === "files" && (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        {mode === "content" && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder="Replace with…"
              className="h-7 flex-1 text-[11px]"
            />
            <Button
              size="sm"
              className="h-7 shrink-0 text-[11px]"
              disabled={!searching?.matches.length || replacing}
              onClick={() => void replaceAll()}
            >
              {replacing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Replace className="h-3 w-3" />}
              All
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {error && <div className="p-2 text-xs text-red-300">{error}</div>}
          {mode === "files" && (
            <>
              {!error && query && !loading && fileResults.length === 0 && (
                <div className="p-2 text-xs text-muted-foreground">No matching files.</div>
              )}
              {!query && !error && (
                <div className="p-2 text-xs leading-5 text-muted-foreground">Type to search every file in the workspace.</div>
              )}
              {fileResults.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => onOpenFile(entry.path)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                </button>
              ))}
            </>
          )}

          {mode === "content" && (
            <>
              {!error && content && content.matches.length > 0 && (
                <div className="px-2 py-1 text-[10px] text-muted-foreground">
                  {content.matches.length}
                  {content.truncated ? "+" : ""} match{content.matches.length === 1 ? "" : "es"} in {content.files} file
                  {content.files === 1 ? "" : "s"}
                </div>
              )}
              {!error && query && !loading && content && content.matches.length === 0 && (
                <div className="p-2 text-xs text-muted-foreground">No matching content.</div>
              )}
              {!query && !error && (
                <div className="p-2 text-xs leading-5 text-muted-foreground">
                  Search across file contents. Use the Aa and .* buttons for case and regex.
                </div>
              )}
              {groups.map(([path, matches]) => (
                <div key={path} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                    <FileCode2 className="h-3 w-3 shrink-0 text-sky-400" />
                    <span className="truncate">{path}</span>
                    <span className="ml-auto shrink-0">{matches.length}</span>
                  </div>
                  {matches.map((match) => (
                    <button
                      key={`${match.path}:${match.line}:${match.column}`}
                      className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-accent"
                      onClick={() => onOpenFile(match.path, match.line, match.column)}
                      title={`${match.path}:${match.line}:${match.column}`}
                    >
                      <span className="w-8 shrink-0 text-right font-code text-[10px] text-muted-foreground">{match.line}</span>
                      <span className="min-w-0 flex-1 truncate font-code">{match.text.trim() || " "}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
