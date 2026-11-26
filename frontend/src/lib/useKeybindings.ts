import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bindingConflicts,
  loadKeybindingOverrides,
  normalizeKeybinding,
  resolveKeybindings,
  saveKeybindingOverrides,
  type CommandDescriptor,
  type PluginKeybindingContribution,
} from "./commands";

export function useKeybindings(
  userId: string,
  commands: CommandDescriptor[],
  pluginBindings: PluginKeybindingContribution[],
) {
  const [overrides, setOverrides] = useState<Record<string, string>>(() => loadKeybindingOverrides(userId));

  useEffect(() => {
    setOverrides(loadKeybindingOverrides(userId));
  }, [userId]);

  useEffect(() => {
    saveKeybindingOverrides(userId, overrides);
  }, [overrides, userId]);

  const bindings = useMemo(
    () => resolveKeybindings(commands, pluginBindings, overrides),
    [commands, pluginBindings, overrides],
  );
  const defaults = useMemo(() => resolveKeybindings(commands, pluginBindings, {}), [commands, pluginBindings]);
  const conflicts = useMemo(() => bindingConflicts(bindings), [bindings]);

  const setBinding = useCallback((commandId: string, value: string) => {
    const normalized = value ? normalizeKeybinding(value) : "";
    setOverrides((current) => {
      const next = { ...current };
      if (!normalized) next[commandId] = "";
      else next[commandId] = normalized;
      return next;
    });
  }, []);

  const resetBinding = useCallback((commandId: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[commandId];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => setOverrides({}), []);

  return { bindings, defaults, overrides, conflicts, setBinding, resetBinding, resetAll };
}
