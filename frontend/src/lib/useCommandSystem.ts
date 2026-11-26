import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaletteAction } from "@/components/editor/paletteTypes";
import {
  commandForEvent,
  formatKeybinding,
  isEditableTarget,
  isModifierOnly,
  type CommandDescriptor,
  type PluginKeybindingContribution,
} from "./commands";
import {
  applyMenuPreferences,
  buildMenus,
  loadMenuPreferences,
  moveMenuItem,
  saveMenuPreferences,
  toggleMenuItem,
  type MenuPreferences,
  type PluginMenuContribution,
} from "./menus";
import { useKeybindings } from "./useKeybindings";

export function useCommandSystem({
  userId,
  actions,
  pluginKeybindings,
  pluginMenus,
  disabled = false,
}: {
  userId: string;
  actions: PaletteAction[];
  pluginKeybindings: PluginKeybindingContribution[];
  pluginMenus: PluginMenuContribution[];
  disabled?: boolean;
}) {
  const commands = useMemo<CommandDescriptor[]>(
    () =>
      actions.map((action) => ({
        id: action.id,
        title: action.label,
        description: action.description,
        category: action.category,
        source: action.source ?? "Goland",
        icon: action.icon,
        defaultKey: action.defaultKey,
        keywords: action.keywords,
        run: action.run,
      })),
    [actions],
  );
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const keybindings = useKeybindings(userId, commands, pluginKeybindings);
  const bindingsRef = useRef(keybindings.bindings);
  bindingsRef.current = keybindings.bindings;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const [menuPreferences, setMenuPreferences] = useState<MenuPreferences>(() => loadMenuPreferences(userId));
  useEffect(() => {
    saveMenuPreferences(userId, menuPreferences);
  }, [menuPreferences, userId]);

  const fullMenus = useMemo(() => buildMenus(commands, pluginMenus), [commands, pluginMenus]);
  const menus = useMemo(() => applyMenuPreferences(fullMenus, menuPreferences), [fullMenus, menuPreferences]);
  const shortcuts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(keybindings.bindings).map(([commandId, value]) => [commandId, formatKeybinding(value)]),
      ),
    [keybindings.bindings],
  );

  const runCommand = useCallback((commandId: string) => {
    commandsRef.current.find((command) => command.id === commandId)?.run();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabledRef.current) return;
      const commandId = commandForEvent(event, bindingsRef.current);
      if (!commandId) return;
      const binding = bindingsRef.current[commandId] ?? "";
      const target = (event.composedPath?.()[0] ?? event.target) as EventTarget | null;
      if (isEditableTarget(target) && !isModifierOnly(binding) && !binding.split("+").pop()?.startsWith("F")) return;
      event.preventDefault();
      runCommand(commandId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runCommand]);

  const toggleMenuItemPreference = useCallback((menuId: string, itemId: string) => {
    setMenuPreferences((current) => toggleMenuItem(current, menuId, itemId));
  }, []);
  const moveMenuItemPreference = useCallback(
    (menuId: string, itemId: string, direction: -1 | 1) => {
      setMenuPreferences((current) => {
        const menu = fullMenus.find((item) => item.id === menuId);
        return menu ? moveMenuItem(current, menu, itemId, direction) : current;
      });
    },
    [fullMenus],
  );
  const resetMenus = useCallback(() => setMenuPreferences({ hidden: [], order: {} }), []);

  return {
    commands,
    keybindings,
    shortcuts,
    runCommand,
    fullMenus,
    menus,
    menuPreferences,
    toggleMenuItem: toggleMenuItemPreference,
    moveMenuItem: moveMenuItemPreference,
    resetMenus,
  };
}
