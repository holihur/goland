import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaletteAction } from "@/components/editor/paletteTypes";
import { useCommandSystem } from "./useCommandSystem";

function actions(run: () => void): PaletteAction[] {
  return [
    { id: "save", label: "Save", category: "Editor", defaultKey: "Mod+S", run },
    { id: "show-explorer", label: "Explorer", category: "View", defaultKey: "Mod+Shift+E", run },
    { id: "show-search", label: "Search", category: "View", run },
  ];
}

describe("useCommandSystem", () => {
  beforeEach(() => localStorage.clear());

  it("builds commands, menus, shortcuts and runs commands", () => {
    const run = vi.fn();
    const { result } = renderHook(() =>
      useCommandSystem({
        userId: "u1",
        actions: actions(run),
        pluginKeybindings: [],
        pluginMenus: [{ pluginId: "p", pluginName: "Plugin", menuId: "tools", label: "Tools", commandId: "save" }],
      }),
    );
    expect(result.current.commands.map((command) => command.id)).toContain("save");
    expect(result.current.shortcuts.save).toBeTruthy();
    expect(result.current.menus.find((menu) => menu.id === "view")?.items.length).toBeGreaterThan(0);
    expect(result.current.menus.find((menu) => menu.id === "tools")?.items.some((item) => item.commandId === "save")).toBe(true);
    act(() => result.current.runCommand("save"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dispatches global shortcuts and respects disabled state", () => {
    const run = vi.fn();
    const { rerender } = renderHook(
      ({ disabled }) =>
        useCommandSystem({ userId: "u1", actions: actions(run), pluginKeybindings: [], pluginMenus: [], disabled }),
      { initialProps: { disabled: false } },
    );
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true })));
    expect(run).toHaveBeenCalledTimes(1);
    rerender({ disabled: true });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true })));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("curates menus and persists preferences", () => {
    const { result } = renderHook(() =>
      useCommandSystem({
        userId: "u1",
        actions: actions(() => undefined),
        pluginKeybindings: [],
        pluginMenus: [],
      }),
    );
    const view = result.current.fullMenus.find((menu) => menu.id === "view")!;
    const first = view.items[0].id;
    act(() => result.current.toggleMenuItem("view", first));
    expect(result.current.menus.find((menu) => menu.id === "view")?.items.some((item) => item.id === first)).toBe(false);
    act(() => result.current.toggleMenuItem("view", first));
    act(() => result.current.moveMenuItem("view", view.items[1].id, -1));
    expect(result.current.menuPreferences.order.view?.[0]).toBe(view.items[1].id);
    act(() => result.current.resetMenus());
    expect(result.current.menuPreferences).toEqual({ hidden: [], order: {} });
  });
});
