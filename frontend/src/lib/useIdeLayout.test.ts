import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BOTTOM_HEIGHT, DEFAULT_SIDEBAR_WIDTH, layoutStorageKey } from "./layout";
import { useIdeLayout } from "./useIdeLayout";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});

describe("useIdeLayout", () => {
  it("starts from the default layout and persists panel changes", async () => {
    const { result, unmount } = renderHook(() => useIdeLayout("u1", "w1"));
    expect(result.current.layout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(result.current.layout.bottomOpen).toBe(true);
    expect(result.current.compact).toBe(false);

    act(() => result.current.setSidebarWidth(360));
    act(() => result.current.setSidebarOpen(false));
    act(() => result.current.setBottomHeight(300));
    act(() => result.current.setBottomView("output"));
    act(() => result.current.setBottomMaximized(true));

    expect(result.current.layout.sidebarWidth).toBe(360);
    expect(result.current.layout.sidebarOpen).toBe(false);
    expect(result.current.layout.bottomHeight).toBe(300);
    expect(result.current.layout.bottomView).toBe("output");
    expect(result.current.layout.bottomMaximized).toBe(true);

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(layoutStorageKey("u1", "w1")) ?? "{}");
      expect(stored.sidebarWidth).toBe(360);
      expect(stored.bottomView).toBe("output");
    });

    unmount();
    const restored = renderHook(() => useIdeLayout("u1", "w1"));
    expect(restored.result.current.layout.sidebarWidth).toBe(360);
    expect(restored.result.current.layout.bottomMaximized).toBe(true);
  });

  it("starts narrow layouts with the sidebar and bottom dock closed", () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    expect(result.current.compact).toBe(true);
    expect(result.current.layout.sidebarOpen).toBe(false);
    expect(result.current.layout.bottomOpen).toBe(false);
  });

  it("isolates layouts per user and workspace", () => {
    const first = renderHook(() => useIdeLayout("u1", "w1"));
    act(() => first.result.current.setSidebarWidth(500));

    const otherUser = renderHook(() => useIdeLayout("u2", "w1"));
    const otherWorkspace = renderHook(() => useIdeLayout("u1", "w2"));
    expect(otherUser.result.current.layout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(otherWorkspace.result.current.layout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("falls back to defaults for corrupt stored layouts", () => {
    localStorage.setItem(layoutStorageKey("u1", "w1"), "{not-json");
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    expect(result.current.layout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(result.current.restoredPaths).toEqual([]);
  });

  it("toggles the sidebar and bottom dock", () => {
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    act(() => result.current.toggleSidebar());
    expect(result.current.layout.sidebarOpen).toBe(false);
    act(() => result.current.toggleSidebar());
    expect(result.current.layout.sidebarOpen).toBe(true);

    act(() => result.current.toggleBottom("terminal"));
    expect(result.current.layout.bottomOpen).toBe(false);
    act(() => result.current.toggleBottom("terminal"));
    expect(result.current.layout.bottomOpen).toBe(true);
    act(() => result.current.setBottomView("output"));
    act(() => result.current.toggleBottom("terminal"));
    expect(result.current.layout.bottomView).toBe("terminal");
    act(() => result.current.toggleBottom("terminal"));
    expect(result.current.layout.bottomOpen).toBe(false);
  });

  it("opens the bottom dock in a specific view", () => {
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    act(() => result.current.setBottomOpen(false));
    act(() => result.current.openBottom("output"));
    expect(result.current.layout.bottomOpen).toBe(true);
    expect(result.current.layout.bottomView).toBe("output");
  });

  it("manages tabs, groups and the active path", () => {
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    act(() => result.current.assignTab("a.go"));
    act(() => result.current.assignTab("b.go"));
    expect(result.current.restoredPaths).toEqual([]);
    expect(result.current.activePath).toBe("b.go");
    expect(result.current.layout.groups["group-1"].paths).toEqual(["a.go", "b.go"]);

    act(() => result.current.split("right"));
    expect(result.current.layout.rows).toEqual([["group-1", "group-2"]]);
    const second = result.current.layout.activeGroupId;

    act(() => result.current.moveTabToGroup("a.go", second));
    expect(result.current.layout.groups["group-1"].paths).toEqual(["b.go"]);
    expect(result.current.layout.groups[second].paths).toEqual(["a.go"]);
    expect(result.current.activePath).toBe("a.go");

    act(() => result.current.selectTab("group-1", "b.go"));
    expect(result.current.activePath).toBe("b.go");
    act(() => result.current.focusGroup(second));
    expect(result.current.activePath).toBe("a.go");

    act(() => result.current.assignTab("c.go"));
    expect(result.current.layout.groups[second].paths).toEqual(["a.go", "c.go"]);
    act(() => result.current.closeEditorGroup(second));
    expect(result.current.layout.rows).toEqual([["group-1"]]);
    expect(result.current.layout.groups["group-1"].paths).toEqual(["b.go", "a.go", "c.go"]);

    act(() => result.current.unassignTab("c.go"));
    expect(result.current.layout.groups["group-1"].paths).toEqual(["b.go", "a.go"]);

    act(() => result.current.reset(["a.go", "b.go"], "b.go"));
    expect(result.current.layout.rows).toHaveLength(1);
    expect(result.current.layout.groups["group-1"].paths).toEqual(["a.go", "b.go"]);
    expect(result.current.activePath).toBe("b.go");
  });

  it("caps splits at four groups", () => {
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    act(() => result.current.split("right"));
    act(() => result.current.split("right"));
    act(() => result.current.split("down"));
    act(() => result.current.split("right"));
    expect(result.current.layout.rows.flat()).toHaveLength(4);
  });

  it("tracks the viewport, narrow mode and maximum sizes", () => {
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    expect(result.current.maxBottomHeight).toBe(630);
    expect(result.current.sidebarMax).toBe(600);

    act(() => setViewport(880, 600));
    expect(result.current.compact).toBe(true);
    expect(result.current.sidebarMax).toBe(600);
    expect(result.current.maxBottomHeight).toBe(420);

    act(() => setViewport(700, 300));
    expect(result.current.sidebarMax).toBe(440);
    expect(result.current.maxBottomHeight).toBe(210);

    act(() => result.current.setBottomHeight(290));
    expect(result.current.layout.bottomHeight).toBe(210);

    act(() => setViewport(1280, 900));
    expect(result.current.compact).toBe(false);
    expect(result.current.maxBottomHeight).toBe(630);
  });

  it("clamps panel sizes written through actions", () => {
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    act(() => result.current.setSidebarWidth(5000));
    expect(result.current.layout.sidebarWidth).toBe(600);
    act(() => result.current.setBottomHeight(5000));
    expect(result.current.layout.bottomHeight).toBe(630);
    act(() => result.current.setSidebarWidth(10));
    expect(result.current.layout.sidebarWidth).toBe(180);
  });

  it("exposes restored tab paths from stored layouts", () => {
    localStorage.setItem(
      layoutStorageKey("u1", "w1"),
      JSON.stringify({
        version: 1,
        rows: [["group-1"]],
        groups: { "group-1": { paths: ["src/main.go"], activePath: "src/main.go" } },
        activeGroupId: "group-1",
      }),
    );
    const { result } = renderHook(() => useIdeLayout("u1", "w1"));
    expect(result.current.restoredPaths).toEqual(["src/main.go"]);
    expect(result.current.activePath).toBe("src/main.go");
  });

  it("keeps the default bottom height constant", () => {
    expect(DEFAULT_BOTTOM_HEIGHT).toBe(230);
  });
});
