import { describe, expect, it } from "vitest";
import { applyMenuPreferences, buildMenus, itemPreferenceKey, moveMenuItem, toggleMenuItem } from "./menus";
import type { CommandDescriptor } from "./commands";

const commands: CommandDescriptor[] = [
  { id: "save", title: "Save", source: "Goland", run: () => undefined },
  { id: "show-search", title: "Search", source: "Goland", run: () => undefined },
  { id: "show-explorer", title: "Explorer", source: "Goland", run: () => undefined },
  { id: "show-outline", title: "Outline", source: "Goland", run: () => undefined },
  { id: "show-git", title: "Git", source: "Goland", run: () => undefined },
  { id: "toggle-sidebar", title: "Sidebar", source: "Goland", run: () => undefined },
  { id: "plugin:demo:hello", title: "Demo: Hello", source: "Demo", run: () => undefined },
];

describe("menu model", () => {
  it("builds built-in and plugin menus", () => {
    const menus = buildMenus(commands, [{ pluginId: "demo", pluginName: "Demo", menuId: "tools", label: "Tools", commandId: "plugin:demo:hello" }]);
    expect(menus.find((menu) => menu.id === "file")?.items.some((item) => item.commandId === "save")).toBe(true);
    expect(menus.find((menu) => menu.id === "tools")?.items.some((item) => item.commandId === "plugin:demo:hello")).toBe(true);
  });

  it("hides and reorders items", () => {
    const menus = buildMenus(commands, []);
    const view = menus.find((menu) => menu.id === "view")!;
    const first = view.items[0].id;
    let preferences = toggleMenuItem({ hidden: [], order: {} }, "view", first);
    expect(applyMenuPreferences(menus, preferences).find((menu) => menu.id === "view")?.items.some((item) => item.id === first)).toBe(false);
    preferences = toggleMenuItem(preferences, "view", first);
    preferences = moveMenuItem(preferences, view, view.items[1].id, -1);
    const second = applyMenuPreferences(menus, preferences).find((menu) => menu.id === "view")!;
    expect(second.items[0].id).toBe(view.items[1].id);
    expect(itemPreferenceKey("view", first)).toBe(`view:${first}`);
  });
});
