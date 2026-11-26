import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Search } from "lucide-react";
import { formatKeybinding, type CommandDescriptor } from "@/lib/commands";
import { itemPreferenceKey, type MenuDefinition, type MenuPreferences } from "@/lib/menus";
import { cn } from "@/lib/utils";

export function MenuManager({
  menus,
  commands,
  preferences,
  bindings,
  onToggle,
  onMove,
  onReset,
}: {
  menus: MenuDefinition[];
  commands: CommandDescriptor[];
  preferences: MenuPreferences;
  bindings: Record<string, string>;
  onToggle: (menuId: string, itemId: string) => void;
  onMove: (menu: MenuDefinition, itemId: string, direction: -1 | 1) => void;
  onReset: () => void;
}) {
  const [query, setQuery] = useState("");
  const commandMap = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  const needle = query.trim().toLowerCase();
  const hidden = new Set(preferences.hidden);
  const changed = preferences.hidden.length > 0 || Object.keys(preferences.order).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background/60 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search menu items…"
            className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          disabled={!changed}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[10px] hover:bg-accent disabled:opacity-40"
          onClick={onReset}
        >
          <RotateCcw className="h-3 w-3" /> Reset menus
        </button>
      </div>
      <div className="border-b bg-muted/20 px-4 py-2 text-[9px] text-muted-foreground">
        Toggle visibility and reorder entries. Hidden items stay available in the command palette and command center; plugin
        commands are grouped under Tools automatically.
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="space-y-3">
          {menus.map((menu) => {
            const visible = menu.items.filter((item) => !item.separator);
            const items = menu.items.filter((item) => {
              if (!needle) return true;
              const command = item.commandId ? commandMap.get(item.commandId) : undefined;
              return `${item.label ?? ""} ${command?.title ?? ""} ${item.commandId ?? ""}`.toLowerCase().includes(needle);
            });
            if (items.length === 0) return null;
            return (
              <section key={menu.id} data-menu-id={menu.id} className="overflow-hidden rounded-lg border bg-panel/20">
                <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{menu.label}</span>
                    <span className="rounded-full border px-1.5 py-0.5 text-[8px] text-muted-foreground">{visible.length} items</span>
                  </div>
                  <span className="font-code text-[9px] text-muted-foreground">{menu.id}</span>
                </div>
                <div className="divide-y">
                  {items.map((item) => {
                    const command = item.commandId ? commandMap.get(item.commandId) : undefined;
                    const key = itemPreferenceKey(menu.id, item.id);
                    const isHidden = hidden.has(key);
                    const visibleIndex = visible.findIndex((entry) => entry.id === item.id);
                    const shortcut = item.commandId ? bindings[item.commandId] : "";
                    return (
                      <div
                        key={item.id}
                        data-menu-item={item.id}
                        className={cn("flex items-center gap-2 px-3 py-2", isHidden && "bg-muted/20 opacity-55")}
                      >
                        <button
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
                          title={isHidden ? "Show item" : "Hide item"}
                          onClick={() => onToggle(menu.id, item.id)}
                        >
                          {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium">{item.label ?? command?.title ?? item.commandId}</div>
                          <div className="flex min-w-0 items-center gap-2 text-[9px] text-muted-foreground">
                            <span className="truncate font-code">{item.commandId}</span>
                            {item.group && <span className="shrink-0">· {item.group}</span>}
                          </div>
                        </div>
                        {shortcut && (
                          <kbd className="hidden rounded border bg-muted/40 px-1.5 py-0.5 font-code text-[9px] text-muted-foreground sm:block">
                            {formatKeybinding(shortcut)}
                          </kbd>
                        )}
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25"
                            disabled={visibleIndex <= 0}
                            title="Move up"
                            onClick={() => onMove(menu, item.id, -1)}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25"
                            disabled={visibleIndex < 0 || visibleIndex >= visible.length - 1}
                            title="Move down"
                            onClick={() => onMove(menu, item.id, 1)}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
