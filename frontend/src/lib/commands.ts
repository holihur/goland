import type { ReactNode } from "react";

export type CommandSource = "Goland" | string;

export interface CommandDescriptor {
  id: string;
  title: string;
  description?: string;
  category?: string;
  source?: CommandSource;
  icon?: ReactNode;
  run: () => void;
  defaultKey?: string;
  keywords?: string[];
}

export interface PluginKeybindingContribution {
  pluginId: string;
  pluginName: string;
  commandId: string;
  key: string;
}

export interface ParsedKeybinding {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  backquote: "`",
  backslash: "\\",
  slash: "/",
  comma: ",",
  period: ".",
  minus: "-",
  equal: "=",
  "+": "Plus",
  plus: "Plus",
};

function canonicalKey(raw: string): string | null {
  const key = raw.trim();
  if (!key) return null;
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (key === "+") return "Plus";
  if (key.length === 1) return key.toUpperCase();
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (["Home", "End", "PageUp", "PageDown", "Insert", "ContextMenu"].includes(key)) return key;
  return null;
}

export function parseKeybinding(value: string | undefined | null): ParsedKeybinding | null {
  if (!value) return null;
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let mod = false;
  let alt = false;
  let shift = false;
  let key = "";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "meta" || lower === "cmd" || lower === "command" || lower === "ctrl" || lower === "control") mod = true;
    else if (lower === "alt" || lower === "option" || lower === "opt") alt = true;
    else if (lower === "shift") shift = true;
    else {
      const normalized = canonicalKey(part);
      if (!normalized) return null;
      key = normalized;
    }
  }
  return key ? { mod, alt, shift, key } : null;
}

export function normalizeKeybinding(value: string | undefined | null): string | null {
  const parsed = parseKeybinding(value);
  if (!parsed) return null;
  return [parsed.mod ? "Mod" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : "", parsed.key]
    .filter(Boolean)
    .join("+");
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export function formatKeybinding(value: string | undefined | null): string {
  const parsed = parseKeybinding(value);
  if (!parsed) return "";
  const mac = isMacPlatform();
  const keyLabel =
    parsed.key === "Escape"
      ? "esc"
      : parsed.key === "ArrowUp"
        ? "↑"
        : parsed.key === "ArrowDown"
          ? "↓"
          : parsed.key === "ArrowLeft"
            ? "←"
            : parsed.key === "ArrowRight"
              ? "→"
              : parsed.key === "Backspace"
                ? "⌫"
                : parsed.key;
  if (mac) return `${parsed.mod ? "⌘" : ""}${parsed.alt ? "⌥" : ""}${parsed.shift ? "⇧" : ""}${keyLabel}`;
  return [parsed.mod ? "Ctrl" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : "", keyLabel]
    .filter(Boolean)
    .join("+");
}

export function eventToKeybinding(event: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead"].includes(event.key)) return null;
  const key = canonicalKey(event.key);
  if (!key) return null;
  return [
    event.metaKey || event.ctrlKey ? "Mod" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function matchesKeybinding(event: KeyboardEvent, value: string | undefined | null): boolean {
  const normalized = normalizeKeybinding(value);
  return normalized !== null && eventToKeybinding(event) === normalized;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function isModifierOnly(value: string): boolean {
  const parsed = parseKeybinding(value);
  return !!parsed && (parsed.mod || parsed.alt);
}

export function commandForEvent(event: KeyboardEvent, bindings: Record<string, string>): string | null {
  const pressed = eventToKeybinding(event);
  if (!pressed) return null;
  for (const [commandId, value] of Object.entries(bindings)) {
    if (value === pressed) return commandId;
  }
  return null;
}

export function resolveKeybindings(
  commands: CommandDescriptor[],
  pluginBindings: PluginKeybindingContribution[],
  overrides: Record<string, string>,
): Record<string, string> {
  const effective: Record<string, string> = {};
  for (const command of commands) {
    const normalized = normalizeKeybinding(command.defaultKey);
    if (normalized) effective[command.id] = normalized;
  }
  for (const binding of pluginBindings) {
    const normalized = normalizeKeybinding(binding.key);
    if (normalized) effective[binding.commandId] = normalized;
  }
  for (const [commandId, value] of Object.entries(overrides)) {
    if (!value) delete effective[commandId];
    else {
      const normalized = normalizeKeybinding(value);
      if (normalized) effective[commandId] = normalized;
    }
  }
  return effective;
}

export function bindingConflicts(bindings: Record<string, string>): Record<string, string[]> {
  const byKey: Record<string, string[]> = {};
  for (const [commandId, value] of Object.entries(bindings)) {
    (byKey[value] ??= []).push(commandId);
  }
  const conflicts: Record<string, string[]> = {};
  for (const commandIds of Object.values(byKey)) {
    if (commandIds.length > 1) {
      for (const commandId of commandIds) conflicts[commandId] = commandIds.filter((id) => id !== commandId);
    }
  }
  return conflicts;
}

export function commandSearchText(command: CommandDescriptor): string {
  return [command.id, command.title, command.description, command.category, command.source, ...(command.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const KEYBINDINGS_PREFIX = "goland.keybindings.";

export function loadKeybindingOverrides(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`${KEYBINDINGS_PREFIX}${userId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function saveKeybindingOverrides(userId: string, overrides: Record<string, string>) {
  try {
    localStorage.setItem(`${KEYBINDINGS_PREFIX}${userId}`, JSON.stringify(overrides));
  } catch {
    // ignore storage failures
  }
}
