import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type { DocumentSymbol, LSPClient, SourceLocation } from "@/lib/lsp";
import { cn } from "@/lib/utils";

interface Row {
  symbol: DocumentSymbol;
  depth: number;
}

const KIND_LABEL: Record<number, string> = {
  1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method", 7: "property",
  8: "field", 9: "constructor", 10: "enum", 11: "interface", 12: "function", 13: "variable",
  14: "constant", 15: "string", 16: "number", 17: "boolean", 18: "array", 19: "object",
  20: "key", 21: "null", 22: "enum member", 23: "struct", 24: "event", 25: "operator", 26: "type parameter",
};

function flatten(symbols: DocumentSymbol[], depth = 0): Row[] {
  return symbols.flatMap((symbol) => [
    { symbol, depth },
    ...flatten(symbol.children ?? [], depth + 1),
  ]);
}

export function OutlinePanel({
  path,
  lsp,
  onOpenLocation,
}: {
  path: string;
  lsp: LSPClient | null;
  onOpenLocation: (location: SourceLocation) => void;
}) {
  const [symbols, setSymbols] = useState<DocumentSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!path || !lsp) {
      setSymbols([]);
      return;
    }
    setLoading(true);
    try {
      setSymbols(await lsp.documentSymbols(path));
      setError("");
    } catch (err) {
      setSymbols([]);
      setError(err instanceof Error ? err.message : "Could not load symbols");
    } finally {
      setLoading(false);
    }
  }, [path, lsp]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = flatten(symbols);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span>Outline</span>
        <button className="rounded p-0.5 hover:bg-accent" title="Refresh outline" onClick={() => void load()}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {!path && <div className="p-2 text-xs text-muted-foreground">Open a file to see its outline.</div>}
        {path && !lsp && <div className="p-2 text-xs text-muted-foreground">No language server for this file.</div>}
        {error && <div className="p-2 text-xs text-red-400">{error}</div>}
        {!loading && path && lsp && rows.length === 0 && !error && (
          <div className="p-2 text-xs text-muted-foreground">No symbols reported.</div>
        )}
        {rows.map(({ symbol, depth }, index) => (
          <button
            key={`${symbol.name}:${symbol.selectionRange.start.line}:${index}`}
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-accent"
            style={{ paddingLeft: 4 + depth * 12 }}
            title={`${KIND_LABEL[symbol.kind] ?? "symbol"} · line ${symbol.selectionRange.start.line + 1}`}
            onClick={() =>
              onOpenLocation({
                path,
                line: symbol.selectionRange.start.line + 1,
                column: symbol.selectionRange.start.character + 1,
                endLine: symbol.selectionRange.end.line + 1,
                endColumn: symbol.selectionRange.end.character + 1,
              })
            }
          >
            <ChevronRight className={cn("h-2.5 w-2.5 shrink-0 text-muted-foreground", depth > 0 && "opacity-60")} />
            <span className="truncate">{symbol.name}</span>
            {symbol.detail && <span className="ml-1 truncate font-code text-[9px] text-muted-foreground">{symbol.detail}</span>}
            <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">{KIND_LABEL[symbol.kind] ?? ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
