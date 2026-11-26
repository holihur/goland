import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDescriptor } from "./commands";
import { useKeybindings } from "./useKeybindings";

const commands: CommandDescriptor[] = [
  { id: "save", title: "Save", defaultKey: "Mod+S", run: () => undefined },
  { id: "hello", title: "Hello", run: () => undefined },
];

describe("useKeybindings", () => {
  beforeEach(() => localStorage.clear());

  it("resolves defaults, plugin bindings and user overrides", () => {
    const { result } = renderHook(() =>
      useKeybindings("u1", commands, [{ pluginId: "demo", pluginName: "Demo", commandId: "hello", key: "Mod+Alt+H" }]),
    );
    expect(result.current.bindings.save).toBe("Mod+S");
    expect(result.current.bindings.hello).toBe("Mod+Alt+H");
    expect(result.current.defaults.save).toBe("Mod+S");
    expect(result.current.overrides).toEqual({});
  });

  it("sets, resets and persists bindings", () => {
    const { result } = renderHook(() => useKeybindings("u1", commands, []));
    act(() => result.current.setBinding("save", "Mod+Shift+S"));
    expect(result.current.bindings.save).toBe("Mod+Shift+S");
    expect(result.current.overrides.save).toBe("Mod+Shift+S");
    act(() => result.current.setBinding("save", ""));
    expect(result.current.bindings.save).toBeUndefined();
    act(() => result.current.resetBinding("save"));
    expect(result.current.bindings.save).toBe("Mod+S");
    act(() => result.current.setBinding("hello", "Mod+Shift+K"));
    act(() => result.current.resetAll());
    expect(result.current.overrides).toEqual({});
    expect(window.localStorage.getItem("goland.keybindings.u1")).toBe("{}");
  });
});
