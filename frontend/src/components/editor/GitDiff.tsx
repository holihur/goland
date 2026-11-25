import { useMemo, useState } from "react";
import { Columns2, Loader2, Rows2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Hunk {
  header: string;
  lines: string[];
}

interface DiffData {
  header: string[];
  hunks: Hunk[];
}

interface SplitRow {
  old: string;
  next: string;
  kind: "context" | "change" | "delete" | "add";
}

function parseDiff(diff: string): DiffData {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
    } else if (current) {
      if (line !== "" || current.lines.length > 0) current.lines.push(line);
    } else {
      header.push(line);
    }
  }
  for (const hunk of hunks) {
    while (hunk.lines.length > 0 && hunk.lines[hunk.lines.length - 1] === "") hunk.lines.pop();
  }
  return { header, hunks };
}

function splitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (line.startsWith("-") && !line.startsWith("---")) {
      const dels: string[] = [];
      while (index < hunk.lines.length && hunk.lines[index].startsWith("-") && !hunk.lines[index].startsWith("---")) {
        dels.push(hunk.lines[index].slice(1));
        index++;
      }
      const adds: string[] = [];
      while (index < hunk.lines.length && hunk.lines[index].startsWith("+") && !hunk.lines[index].startsWith("+++")) {
        adds.push(hunk.lines[index].slice(1));
        index++;
      }
      const count = Math.max(dels.length, adds.length);
      for (let i = 0; i < count; i++) {
        rows.push({
          old: dels[i] ?? "",
          next: adds[i] ?? "",
          kind: dels[i] !== undefined && adds[i] !== undefined ? "change" : adds[i] !== undefined ? "add" : "delete",
        });
      }
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      rows.push({ old: "", next: line.slice(1), kind: "add" });
    } else if (line.startsWith(" ")) {
      rows.push({ old: line.slice(1), next: line.slice(1), kind: "context" });
    }
    index++;
  }
  return rows;
}

function hunkPatch(data: DiffData, hunk: Hunk) {
  return [...data.header, hunk.header, ...hunk.lines].join("\n") + "\n";
}

export function GitDiff({
  diff,
  cached,
  onApplyPatch,
}: {
  diff: string;
  cached: boolean;
  onApplyPatch: (patch: string, reverse: boolean) => Promise<void>;
}) {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [busy, setBusy] = useState("");
  const data = useMemo(() => parseDiff(diff), [diff]);

  if (!diff.trim()) return null;

  const apply = async (hunk: Hunk) => {
    setBusy(hunk.header);
    try {
      await onApplyPatch(hunkPatch(data, hunk), cached);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="border-t">
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>Diff</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant={mode === "unified" ? "secondary" : "ghost"}
            size="icon-sm"
            title="Unified diff"
            onClick={() => setMode("unified")}
          >
            <Rows2 className="h-3 w-3" />
          </Button>
          <Button
            variant={mode === "split" ? "secondary" : "ghost"}
            size="icon-sm"
            title="Side-by-side diff"
            onClick={() => setMode("split")}
          >
            <Columns2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="max-h-80 overflow-auto border-t bg-background/60 font-code text-[10px] leading-4">
        {data.hunks.map((hunk) => (
          <div key={hunk.header}>
            <div className="flex items-center gap-2 border-y bg-muted/40 px-2 py-0.5 text-muted-foreground">
              <span className="truncate">{hunk.header}</span>
              <button
                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider hover:bg-accent"
                disabled={!!busy}
                onClick={() => void apply(hunk)}
              >
                {busy === hunk.header ? <Loader2 className="h-3 w-3 animate-spin" /> : cached ? "Unstage hunk" : "Stage hunk"}
              </button>
            </div>
            {mode === "unified" ? (
              <div>
                {hunk.lines.map((line, index) => (
                  <div
                    key={`${hunk.header}:${index}`}
                    className={cn(
                      "whitespace-pre-wrap break-all px-2",
                      line.startsWith("+") && "bg-emerald-500/10 text-emerald-400",
                      line.startsWith("-") && "bg-red-500/10 text-red-400",
                    )}
                  >
                    {line || " "}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 divide-x">
                <div className="min-w-0">
                  {splitRows(hunk).map((row, index) => (
                    <div
                      key={`old-${index}`}
                      className={cn(
                        "min-h-4 whitespace-pre-wrap break-all px-2",
                        (row.kind === "delete" || row.kind === "change") && "bg-red-500/10 text-red-400",
                      )}
                    >
                      {row.old || " "}
                    </div>
                  ))}
                </div>
                <div className="min-w-0">
                  {splitRows(hunk).map((row, index) => (
                    <div
                      key={`new-${index}`}
                      className={cn(
                        "min-h-4 whitespace-pre-wrap break-all px-2",
                        (row.kind === "add" || row.kind === "change") && "bg-emerald-500/10 text-emerald-400",
                      )}
                    >
                      {row.next || " "}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
