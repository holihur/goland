import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Keyboard, RotateCcw, Search, X } from "lucide-react";
import {
  commandSearchText,
  eventToKeybinding,
  formatKeybinding,
  type CommandDescriptor,
} from "@/lib/commands";
import { cn } from "@/lib/utils";

export function KeybindingManager({
  commands,
  bindings,
  defaults,
  overrides,
  conflicts,
  onSetBinding,
  onResetBinding,
  onResetAll,
}: {
  commands: CommandDescriptor[];
  bindings: Record<string, string>;
  defaults: Record<string, string>;
  overrides: Record<string, string>;
  conflicts: Record<string, string[]>;
  onSetBinding: (commandId: string, value: string) => void;
  onResetBinding: (commandId: string) => void;
  onResetAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const commandMap = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return commands
      .filter((command) => !needle || commandSearchText(command).includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [commands, query]);
  const overrideCount = Object.keys(overrides).length;

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        onSetBinding(recording, "");
        setRecording(null);
        return;
      }
      const value = eventToKeybinding(event);
      if (!value) return;
      onSetBinding(recording, value);
      setRecording(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onSetBinding]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background/60 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands to rebind…"
            className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          disabled={overrideCount === 0}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[10px] hover:bg-accent disabled:opacity-40"
          onClick={onResetAll}
        >
          <RotateCcw className="h-3 w-3" /> Reset all
        </button>
      </div>
      <div className="border-b bg-muted/20 px-4 py-2 text-[9px] text-muted-foreground">
        Click a shortcut, then press the new key combination. Press Esc to cancel, or Backspace/Delete to unbind.
        {overrideCount > 0 && <span className="ml-1 text-primary">{overrideCount} user override{overrideCount === 1 ? "" : "s"}.</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="divide-y rounded-lg border bg-panel/20">
          {filtered.map((command) => {
            const value = bindings[command.id];
            const conflictIds = conflicts[command.id] ?? [];
            const overridden = Object.prototype.hasOwnProperty.call(overrides, command.id);
            const isRecording = recording === command.id;
            return (
              <div key={command.id} data-command-id={command.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/25">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium">{command.title}</span>
                    {overridden && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="Customized" />}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[9px] text-muted-foreground">
                    <span className="truncate font-code">{command.id}</span>
                    <span className="shrink-0">· {command.source ?? "Goland"}</span>
                  </div>
                  {conflictIds.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-[9px] text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      Also assigned to {conflictIds.map((id) => commandMap.get(id)?.title ?? id).join(", ")}
                    </div>
                  )}
                </div>
                {defaults[command.id] && overridden && (
                  <span className="hidden text-[9px] text-muted-foreground md:block">
                    default {formatKeybinding(defaults[command.id])}
                  </span>
                )}
                <button
                  className={cn(
                    "flex h-7 min-w-[82px] items-center justify-center gap-1.5 rounded-md border px-2 font-code text-[10px]",
                    isRecording ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent",
                    !value && !isRecording && "text-muted-foreground",
                  )}
                  onClick={() => setRecording(isRecording ? null : command.id)}
                  title={isRecording ? "Press a key combination" : "Change shortcut"}
                >
                  {isRecording ? "Press keys…" : value ? formatKeybinding(value) : "Unbound"}
                </button>
                {overridden && (
                  <button
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Reset to default"
                    onClick={() => onResetBinding(command.id)}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
                {!value && !isRecording && <span className="w-7" />}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-xs text-muted-foreground">No matching commands.</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t px-4 py-2 text-[9px] text-muted-foreground">
        <Keyboard className="h-3 w-3" />
        Shortcuts are stored per user and applied in the editor, palette and menu bar.
        {recording && (
          <button className="ml-auto flex items-center gap-1 text-foreground hover:text-primary" onClick={() => setRecording(null)}>
            <X className="h-3 w-3" /> Stop recording
          </button>
        )}
      </div>
    </div>
  );
}
