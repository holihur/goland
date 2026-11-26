import { describe, expect, it } from "vitest";
import {
  bindingConflicts,
  commandForEvent,
  commandSearchText,
  eventToKeybinding,
  formatKeybinding,
  normalizeKeybinding,
  parseKeybinding,
  resolveKeybindings,
  type CommandDescriptor,
} from "./commands";

function command(id: string, title: string, defaultKey?: string, source = "Goland"): CommandDescriptor {
  return { id, title, defaultKey, source, run: () => undefined };
}

function keyEvent(key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...opts });
}

describe("keybinding helpers", () => {
  it("normalizes aliases and modifiers", () => {
    expect(normalizeKeybinding("ctrl+shift+k")).toBe("Mod+Shift+K");
    expect(normalizeKeybinding("cmd+alt+\\")).toBe("Mod+Alt+\\");
    expect(normalizeKeybinding("escape")).toBe("Escape");
    expect(normalizeKeybinding("nope+x")).toBeNull();
  });

  it("parses and formats shortcuts", () => {
    expect(parseKeybinding("Mod+Alt+K")).toEqual({ mod: true, alt: true, shift: false, key: "K" });
    const formatted = formatKeybinding("Mod+Shift+K");
    expect(formatted.endsWith("K")).toBe(true);
    expect(formatted.length).toBeGreaterThan(1);
  });

  it("matches keyboard events", () => {
    expect(eventToKeybinding(keyEvent("k", { ctrlKey: true }))).toBe("Mod+K");
    expect(eventToKeybinding(keyEvent("K", { metaKey: true, shiftKey: true }))).toBe("Mod+Shift+K");
    expect(eventToKeybinding(keyEvent("Shift", { shiftKey: true }))).toBeNull();
  });

  it("resolves defaults, plugin bindings and user overrides", () => {
    const commands = [command("save", "Save", "Mod+S"), command("hello", "Hello")];
    const plugin = [{ pluginId: "demo", pluginName: "Demo", commandId: "hello", key: "Mod+Alt+H" }];
    const resolved = resolveKeybindings(commands, plugin, { save: "Mod+Shift+S" });
    expect(resolved.save).toBe("Mod+Shift+S");
    expect(resolved.hello).toBe("Mod+Alt+H");
    expect(resolveKeybindings(commands, plugin, { save: "" }).save).toBeUndefined();
  });

  it("finds commands and conflicts", () => {
    const bindings = { save: "Mod+S", hello: "Mod+S", other: "Mod+K" };
    expect(commandForEvent(keyEvent("s", { ctrlKey: true }), bindings)).toMatch(/save|hello/);
    expect(bindingConflicts(bindings)).toEqual({ save: ["hello"], hello: ["save"] });
  });

  it("builds searchable command text", () => {
    expect(commandSearchText({ ...command("demo.hello", "Say hello"), description: "Greeting", category: "Demo" })).toContain("greeting");
  });
});
