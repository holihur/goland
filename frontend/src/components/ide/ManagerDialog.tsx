import { useState } from "react";
import { Files, Keyboard, Menu, Terminal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { CommandDescriptor } from "@/lib/commands";
import type { MenuDefinition, MenuPreferences } from "@/lib/menus";
import { cn } from "@/lib/utils";
import { CommandManager } from "./CommandManager";
import { KeybindingManager } from "./KeybindingManager";
import { MenuManager } from "./MenuManager";
import { FileAssociationManager } from "./FileAssociationManager";
import type { FileAssociationOverrides, ViewerKind } from "@/lib/fileAssociations";

type ManagerTab = "commands" | "keybindings" | "menus" | "files";

const TABS: Array<{ id: ManagerTab; label: string; icon: typeof Terminal; description: string }> = [
  { id: "commands", label: "Commands", icon: Terminal, description: "Browse and run every command" },
  { id: "keybindings", label: "Keybindings", icon: Keyboard, description: "Assign and resolve shortcuts" },
  { id: "menus", label: "Menus", icon: Menu, description: "Organize menu entries" },
  { id: "files", label: "Files", icon: Files, description: "Choose viewers for file types" },
];

export function ManagerDialog({
  open,
  onOpenChange,
  commands,
  bindings,
  defaults,
  overrides,
  conflicts,
  menus,
  menuPreferences,
  fileAssociations,
  onSetFileAssociation,
  onRemoveFileAssociation,
  onResetFileAssociations,
  onRunCommand,
  onSetBinding,
  onResetBinding,
  onResetAllBindings,
  onToggleMenuItem,
  onMoveMenuItem,
  onResetMenus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: CommandDescriptor[];
  bindings: Record<string, string>;
  defaults: Record<string, string>;
  overrides: Record<string, string>;
  conflicts: Record<string, string[]>;
  menus: MenuDefinition[];
  menuPreferences: MenuPreferences;
  fileAssociations: FileAssociationOverrides;
  onSetFileAssociation: (target: string, viewer: ViewerKind) => void;
  onRemoveFileAssociation: (target: string) => void;
  onResetFileAssociations: () => void;
  onRunCommand: (commandId: string) => void;
  onSetBinding: (commandId: string, value: string) => void;
  onResetBinding: (commandId: string) => void;
  onResetAllBindings: () => void;
  onToggleMenuItem: (menuId: string, itemId: string) => void;
  onMoveMenuItem: (menu: MenuDefinition, itemId: string, direction: -1 | 1) => void;
  onResetMenus: () => void;
}) {
  const [tab, setTab] = useState<ManagerTab>("commands");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,86vh)] w-[min(1080px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command center</DialogTitle>
        <DialogDescription className="sr-only">
          Manage commands, keyboard shortcuts and menu entries.
        </DialogDescription>
        <header className="flex shrink-0 items-center gap-3 border-b bg-panel/50 px-5 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Terminal className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">Command center</div>
            <div className="text-[10px] text-muted-foreground">
              {commands.length} commands · {Object.keys(bindings).length} shortcuts · {Object.keys(fileAssociations).length} file rules
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 border-r bg-muted/15 p-2">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    tab === item.id ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                  onClick={() => setTab(item.id)}
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">{item.description}</span>
                  </span>
                </button>
              );
            })}
            <div className="mt-3 border-t px-2.5 pt-3 text-[9px] leading-4 text-muted-foreground">
              Settings are stored per user in this browser. Plugin commands and shortcuts are included automatically.
            </div>
          </nav>
          <main className="min-w-0 flex-1 overflow-hidden">
            {tab === "commands" && (
              <CommandManager
                commands={commands}
                bindings={bindings}
                onRun={(commandId) => {
                  onRunCommand(commandId);
                  onOpenChange(false);
                }}
              />
            )}
            {tab === "keybindings" && (
              <KeybindingManager
                commands={commands}
                bindings={bindings}
                defaults={defaults}
                overrides={overrides}
                conflicts={conflicts}
                onSetBinding={onSetBinding}
                onResetBinding={onResetBinding}
                onResetAll={onResetAllBindings}
              />
            )}
            {tab === "menus" && (
              <MenuManager
                menus={menus}
                commands={commands}
                preferences={menuPreferences}
                bindings={bindings}
                onToggle={onToggleMenuItem}
                onMove={onMoveMenuItem}
                onReset={onResetMenus}
              />
            )}
            {tab === "files" && (
              <FileAssociationManager
                overrides={fileAssociations}
                onSet={onSetFileAssociation}
                onRemove={onRemoveFileAssociation}
                onReset={onResetFileAssociations}
              />
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
