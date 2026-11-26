import { Fragment, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CommandDescriptor } from "@/lib/commands";
import { formatKeybinding } from "@/lib/commands";
import type { MenuDefinition } from "@/lib/menus";

export function MenuBar({
  menus,
  commands,
  bindings,
  onRunCommand,
}: {
  menus: MenuDefinition[];
  commands: CommandDescriptor[];
  bindings: Record<string, string>;
  onRunCommand: (commandId: string) => void;
}) {
  const commandMap = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  if (menus.length === 0) return null;
  return (
    <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main menu">
      {menus.map((menu) => {
        let lastGroup = "";
        return (
          <DropdownMenu key={menu.id}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`${menu.label} menu`}
                className="flex h-7 items-center gap-0.5 rounded px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {menu.label}
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[70vh] w-64 overflow-y-auto">
              {menu.items.map((item) => {
                if (item.separator) return <DropdownMenuSeparator key={item.id} />;
                const command = item.commandId ? commandMap.get(item.commandId) : undefined;
                if (!command) return null;
                const group = item.group ?? "";
                const showGroup = group !== lastGroup;
                lastGroup = group;
                const shortcut = item.commandId ? bindings[item.commandId] : "";
                return (
                  <Fragment key={item.id}>
                    {showGroup && group && <DropdownMenuLabel className="pb-0.5 pt-1 text-[8px]">{group}</DropdownMenuLabel>}
                    <DropdownMenuItem onSelect={() => onRunCommand(command.id)} className="gap-2">
                      <span className="text-muted-foreground">{command.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px]">{item.label ?? command.title}</span>
                      {shortcut && (
                        <kbd className="shrink-0 font-code text-[9px] text-muted-foreground">{formatKeybinding(shortcut)}</kbd>
                      )}
                    </DropdownMenuItem>
                  </Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
