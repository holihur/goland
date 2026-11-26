import { useMemo, useState } from "react";
import { Play, Search, Terminal } from "lucide-react";
import { commandSearchText, formatKeybinding, type CommandDescriptor } from "@/lib/commands";
import { cn } from "@/lib/utils";

export function CommandManager({
  commands,
  bindings,
  onRun,
}: {
  commands: CommandDescriptor[];
  bindings: Record<string, string>;
  onRun: (commandId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return commands
      .filter((command) => !needle || commandSearchText(command).includes(needle))
      .sort((a, b) => `${a.category ?? ""}\u0000${a.title}`.localeCompare(`${b.category ?? ""}\u0000${b.title}`));
  }, [commands, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-4">
        <div className="flex items-center gap-2 rounded-lg border bg-background/60 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands by title, id, source or category…"
            className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <span className="shrink-0 font-code text-[10px] text-muted-foreground">{filtered.length} commands</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {filtered.length === 0 ? (
          <div className="grid h-full place-items-center p-8 text-center text-xs text-muted-foreground">
            No commands match “{query}”.
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-panel/20">
            {filtered.map((command) => (
              <div key={command.id} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-accent/35">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border/70 bg-background/50 text-muted-foreground">
                  {command.icon ?? <Terminal className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-foreground">{command.title}</span>
                    <span className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[8px] text-muted-foreground">
                      {command.source ?? "Goland"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[9px] text-muted-foreground">
                    <span className="truncate font-code">{command.id}</span>
                    {command.category && <span className="shrink-0">· {command.category}</span>}
                  </div>
                  {command.description && (
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">{command.description}</div>
                  )}
                </div>
                {bindings[command.id] && (
                  <kbd className="hidden shrink-0 rounded border bg-muted/50 px-1.5 py-0.5 font-code text-[9px] text-muted-foreground sm:block">
                    {formatKeybinding(bindings[command.id])}
                  </kbd>
                )}
                <button
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-medium",
                    "hover:bg-accent disabled:opacity-40",
                  )}
                  onClick={() => onRun(command.id)}
                >
                  <Play className="h-3 w-3" /> Run
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
