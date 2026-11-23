import { useEffect, useState } from "react";
import { FileCode2, Loader2, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Entry } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SearchPanel({
  workspaceId,
  onOpenFile,
}: {
  workspaceId: string;
  onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError("");
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .search(workspaceId, query.trim())
        .then((result) => {
          setResults(result.results);
          setError("");
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Search failed"))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, workspaceId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Search files
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filename or path…"
            className="h-8 pl-8 text-xs"
          />
          {loading && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {error && <div className="p-2 text-xs text-red-300">{error}</div>}
          {!error && query && !loading && results.length === 0 && (
            <div className="p-2 text-xs text-muted-foreground">No matching files.</div>
          )}
          {!query && <div className="p-2 text-xs leading-5 text-muted-foreground">Type to search every file in the workspace.</div>}
          {results.map((entry) => (
            <button
              key={entry.path}
              onClick={() => onOpenFile(entry.path)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span className="min-w-0 flex-1 truncate">{entry.path}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
