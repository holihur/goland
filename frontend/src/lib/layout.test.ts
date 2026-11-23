import { describe, expect, it } from "vitest";
import {
  BOTTOM_MAX_RATIO,
  DEFAULT_BOTTOM_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  LAYOUT_VERSION,
  MAX_GROUPS,
  activeGroupIdOf,
  activePathOf,
  activateGroup,
  allLayoutPaths,
  assignTab,
  clampBottomHeight,
  clampSidebarWidth,
  closeGroup,
  defaultLayout,
  displayActivePath,
  groupIds,
  groupOfPath,
  groupState,
  hasRoomToSplit,
  isNarrowViewport,
  layoutStorageKey,
  loadLayout,
  moveTab,
  nextGroupId,
  sanitizeLayout,
  saveLayout,
  setGroupActivePath,
  splitGroup,
  unassignTab,
  updateBottom,
  updateSidebar,
  visiblePaths,
  type LayoutState,
} from "./layout";

function withTabs(paths: string[], activeGroupId = "group-1"): LayoutState {
  let layout = defaultLayout();
  for (const path of paths) layout = assignTab(layout, path);
  return { ...layout, activeGroupId };
}

describe("clamping", () => {
  it("clamps sidebar width into 180..600 and falls back for NaN", () => {
    expect(clampSidebarWidth(120)).toBe(180);
    expect(clampSidebarWidth(999)).toBe(600);
    expect(clampSidebarWidth(320.6)).toBe(321);
    expect(clampSidebarWidth(Number.NaN)).toBe(180);
  });

  it("clamps bottom height using the viewport ratio", () => {
    expect(clampBottomHeight(50, 1000)).toBe(120);
    expect(clampBottomHeight(5000, 1000)).toBe(700);
    expect(clampBottomHeight(300, 1000)).toBe(300);
    expect(clampBottomHeight(5000, 100)).toBe(120);
    expect(BOTTOM_MAX_RATIO).toBe(0.7);
  });
});

describe("default layout and selectors", () => {
  it("creates a single empty group", () => {
    const layout = defaultLayout();
    expect(layout.version).toBe(LAYOUT_VERSION);
    expect(layout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(layout.bottomHeight).toBe(DEFAULT_BOTTOM_HEIGHT);
    expect(layout.rows).toEqual([["group-1"]]);
    expect(layout.activeGroupId).toBe("group-1");
    expect(activeGroupIdOf(layout)).toBe("group-1");
    expect(activePathOf(layout)).toBe("");
    expect(groupState(layout, "missing")).toEqual({ paths: [], activePath: "" });
  });

  it("derives paths per group and finds owners", () => {
    let layout = withTabs(["a.go", "b.go"]);
    layout = splitGroup(layout, "right", "group-2");
    layout = moveTab(layout, "b.go", "group-2");
    expect(groupIds(layout)).toEqual(["group-1", "group-2"]);
    expect(allLayoutPaths(layout).sort()).toEqual(["a.go", "b.go"]);
    expect(groupOfPath(layout, "a.go")).toBe("group-1");
    expect(groupOfPath(layout, "b.go")).toBe("group-2");
    expect(groupOfPath(layout, "missing.go")).toBeNull();
    expect(activePathOf(layout)).toBe("b.go");
    expect(activeGroupIdOf(layout)).toBe("group-2");
  });

  it("falls back to the first group when active group is unknown", () => {
    const layout = { ...defaultLayout(), activeGroupId: "ghost" };
    expect(activeGroupIdOf(layout)).toBe("group-1");
    expect(activePathOf(layout)).toBe("");
  });
});

describe("tab assignment", () => {
  it("assigns tabs to the active group and activates them", () => {
    const layout = withTabs(["a.go"]);
    expect(layout.groups["group-1"]).toEqual({ paths: ["a.go"], activePath: "a.go" });
  });

  it("does not duplicate an existing path and activates its group", () => {
    let layout = withTabs(["a.go"]);
    layout = splitGroup(layout, "right", "group-2");
    layout = assignTab(layout, "a.go");
    expect(layout.groups["group-2"].paths).toEqual([]);
    expect(groupIds(layout)).toEqual(["group-1", "group-2"]);
    expect(layout.activeGroupId).toBe("group-1");
    expect(layout.groups["group-1"].activePath).toBe("a.go");
  });

  it("ignores empty paths and unknown groups", () => {
    const layout = withTabs([]);
    expect(assignTab(layout, "")).toBe(layout);
    expect(assignTab(layout, "x.go", "ghost").groups["group-1"].paths).toEqual(["x.go"]);
  });

  it("unassigns a tab from every group and reselects a neighbour", () => {
    let layout = withTabs(["a.go", "b.go"]);
    layout = unassignTab(layout, "b.go");
    expect(layout.groups["group-1"]).toEqual({ paths: ["a.go"], activePath: "a.go" });
    layout = unassignTab(layout, "a.go");
    expect(layout.groups["group-1"]).toEqual({ paths: [], activePath: "" });
    expect(unassignTab(layout, "missing.go").groups).toEqual(layout.groups);
  });

  it("moves a tab across groups, preserving order and activating it", () => {
    let layout = withTabs(["a.go", "b.go"]);
    layout = splitGroup(layout, "right", "group-2");
    layout = moveTab(layout, "a.go", "group-2");
    expect(layout.groups["group-1"]).toEqual({ paths: ["b.go"], activePath: "b.go" });
    expect(layout.groups["group-2"]).toEqual({ paths: ["a.go"], activePath: "a.go" });
    expect(layout.activeGroupId).toBe("group-2");
  });

  it("inserts moved tabs at a requested index and clamps it", () => {
    let layout = withTabs(["a.go", "b.go", "c.go"]);
    layout = assignTab(layout, "d.go");
    layout = splitGroup(layout, "right", "group-2");
    layout = moveTab(layout, "a.go", "group-2", 0);
    layout = moveTab(layout, "d.go", "group-2", 999);
    layout = moveTab(layout, "b.go", "group-2", -5);
    expect(layout.groups["group-2"].paths).toEqual(["b.go", "a.go", "d.go"]);
    expect(layout.groups["group-2"].activePath).toBe("b.go");
    expect(visiblePaths(layout, "group-2", ["a.go", "b.go"])).toEqual(["b.go", "a.go"]);
    expect(displayActivePath(layout, "group-2", ["a.go", "b.go"])).toBe("b.go");
    layout = setGroupActivePath(layout, "group-2", "a.go");
    expect(displayActivePath(layout, "group-2", ["a.go", "b.go"])).toBe("a.go");
    expect(displayActivePath(layout, "group-2", ["b.go"])).toBe("b.go");
    expect(displayActivePath(layout, "group-2", [])).toBe("");
  });

  it("ignores moves to unknown groups", () => {
    const layout = withTabs(["a.go"]);
    expect(moveTab(layout, "a.go", "ghost")).toBe(layout);
  });

  it("sets the per-group active tab and validates membership", () => {
    let layout = withTabs(["a.go", "b.go"]);
    layout = setGroupActivePath(layout, "group-1", "a.go");
    expect(layout.groups["group-1"].activePath).toBe("a.go");
    const unchanged = setGroupActivePath(layout, "group-1", "missing.go");
    expect(unchanged).toBe(layout);
    expect(setGroupActivePath(layout, "ghost", "a.go")).toBe(layout);
    expect(activateGroup(layout, "ghost")).toBe(layout);
    expect(activateGroup(layout, "group-1").activeGroupId).toBe("group-1");
  });
});

describe("splitting", () => {
  it("splits to the right within the active row", () => {
    let layout = withTabs(["a.go"]);
    layout = splitGroup(layout, "right", "group-2");
    expect(layout.rows).toEqual([["group-1", "group-2"]]);
    expect(layout.activeGroupId).toBe("group-2");
    expect(layout.groups["group-2"]).toEqual({ paths: [], activePath: "" });
  });

  it("splits below into a new row", () => {
    let layout = withTabs(["a.go"]);
    layout = splitGroup(layout, "down", "group-2");
    expect(layout.rows).toEqual([["group-1"], ["group-2"]]);
  });

  it("caps the layout at MAX_GROUPS", () => {
    let layout = defaultLayout();
    layout = splitGroup(layout, "right", "group-2");
    layout = splitGroup(layout, "right", "group-3");
    layout = splitGroup(layout, "right", "group-4");
    const capped = splitGroup(layout, "right", "group-5");
    expect(capped).toBe(layout);
    expect(groupIds(layout)).toHaveLength(MAX_GROUPS);
    expect(hasRoomToSplit(layout)).toBe(false);
    expect(hasRoomToSplit(defaultLayout())).toBe(true);
  });

  it("rejects duplicate or empty group ids", () => {
    const layout = defaultLayout();
    expect(splitGroup(layout, "right", "group-1")).toBe(layout);
    expect(splitGroup(layout, "right", "")).toBe(layout);
  });

  it("computes a free group id", () => {
    let layout = defaultLayout();
    expect(nextGroupId(layout)).toBe("group-2");
    layout = splitGroup(layout, "right", "group-2");
    expect(nextGroupId(layout)).toBe("group-3");
    layout = { ...layout, groups: { ...layout.groups, "group-3": { paths: [], activePath: "" } } };
    expect(nextGroupId(layout)).toBe("group-4");
  });
});

describe("closing groups", () => {
  it("recycles tabs into a neighbouring group", () => {
    let layout = withTabs(["a.go", "b.go"]);
    layout = splitGroup(layout, "right", "group-2");
    layout = moveTab(layout, "b.go", "group-2");
    const closed = closeGroup(layout, "group-2");
    expect(closed.rows).toEqual([["group-1"]]);
    expect(closed.groups["group-1"].paths).toEqual(["a.go", "b.go"]);
    expect(closed.groups["group-2"]).toBeUndefined();
    expect(closed.activeGroupId).toBe("group-1");
  });

  it("keeps an empty active tab when the neighbour had none", () => {
    let layout = withTabs(["a.go"]);
    layout = splitGroup(layout, "right", "group-2");
    layout = moveTab(layout, "a.go", "group-2");
    const closed = closeGroup(layout, "group-2");
    expect(closed.groups["group-1"]).toEqual({ paths: ["a.go"], activePath: "a.go" });
  });

  it("removes empty rows and ignores unknown groups", () => {
    let layout = defaultLayout();
    layout = splitGroup(layout, "down", "group-2");
    const closed = closeGroup(layout, "group-2");
    expect(closed.rows).toEqual([["group-1"]]);
    expect(closeGroup(layout, "ghost")).toBe(layout);
  });

  it("empties the last remaining group instead of removing it", () => {
    const layout = withTabs(["a.go"]);
    const closed = closeGroup(layout, "group-1");
    expect(closed.rows).toEqual([["group-1"]]);
    expect(closed.groups["group-1"]).toEqual({ paths: [], activePath: "" });
    expect(closed.activeGroupId).toBe("group-1");
  });
});

describe("panel updates", () => {
  it("clamps sidebar updates", () => {
    const layout = updateSidebar(defaultLayout(), { sidebarWidth: 9999, sidebarOpen: false, sideView: "git" });
    expect(layout.sidebarWidth).toBe(600);
    expect(layout.sidebarOpen).toBe(false);
    expect(layout.sideView).toBe("git");
  });

  it("clamps bottom updates", () => {
    const layout = updateBottom(defaultLayout(), { bottomHeight: 9999, bottomMaximized: true }, 1000);
    expect(layout.bottomHeight).toBe(700);
    expect(layout.bottomMaximized).toBe(true);
  });
});

describe("sanitizing persisted layouts", () => {
  it("returns the default layout for non-objects", () => {
    expect(sanitizeLayout(null, 800)).toEqual(defaultLayout());
    expect(sanitizeLayout("oops", 800)).toEqual(defaultLayout());
    expect(sanitizeLayout([], 800)).toEqual(defaultLayout());
  });

  it("clamps corrupt sizes and enums", () => {
    const layout = sanitizeLayout(
      {
        sidebarWidth: -50,
        sidebarOpen: "yes",
        sideView: "nope",
        bottomHeight: Number.NaN,
        bottomOpen: false,
        bottomMaximized: 1,
        bottomView: "nope",
        rows: [["g1"]],
        groups: { g1: { paths: [], activePath: "" } },
        activeGroupId: "g1",
      },
      1000,
    );
    expect(layout.sidebarWidth).toBe(180);
    expect(layout.sidebarOpen).toBe(true);
    expect(layout.sideView).toBe("explorer");
    expect(layout.bottomHeight).toBe(120);
    expect(layout.bottomOpen).toBe(false);
    expect(layout.bottomMaximized).toBe(false);
    expect(layout.bottomView).toBe("terminal");
  });

  it("drops unknown groups, duplicate paths and caps group count", () => {
    const layout = sanitizeLayout(
      {
        rows: [["a", "b", "c"], ["d"], ["e"], "bad", [42]],
        groups: {
          a: { paths: ["one.go", "two.go"], activePath: "two.go" },
          b: { paths: ["one.go"], activePath: "missing.go" },
          c: { paths: "bad" },
          d: { paths: ["three.go"] },
          e: { paths: ["four.go"] },
        },
        activeGroupId: "ghost",
      },
      1000,
    );
    expect(layout.rows).toEqual([["a", "b", "c"], ["d"]]);
    expect(layout.groups).not.toHaveProperty("e");
    expect(layout.groups.a.paths).toEqual(["one.go", "two.go"]);
    expect(layout.groups.b.paths).toEqual([]);
    expect(layout.groups.b.activePath).toBe("");
    expect(layout.groups.c.paths).toEqual([]);
    expect(layout.activeGroupId).toBe("a");
    expect(allLayoutPaths(layout)).toEqual(["one.go", "two.go", "three.go"]);
  });

  it("restores a valid active path and group", () => {
    const layout = sanitizeLayout(
      {
        version: 99,
        rows: [["g1", "g2"]],
        groups: {
          g1: { paths: ["a.go"], activePath: "a.go" },
          g2: { paths: ["b.go"], activePath: "b.go" },
        },
        activeGroupId: "g2",
      },
      800,
    );
    expect(layout.version).toBe(LAYOUT_VERSION);
    expect(layout.activeGroupId).toBe("g2");
    expect(activePathOf(layout)).toBe("b.go");
  });

  it("falls back when rows or groups are unusable", () => {
    expect(sanitizeLayout({ rows: [], groups: {} }, 800)).toEqual(defaultLayout());
    expect(sanitizeLayout({ rows: [["g1"]], groups: { g1: { paths: [] } } }, 800).activeGroupId).toBe("g1");
    const recovered = sanitizeLayout({ rows: [["g1"]], groups: {} }, 800);
    expect(recovered.rows).toEqual([["g1"]]);
    expect(recovered.groups).toEqual({ g1: { paths: [], activePath: "" } });
    expect(recovered.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("persistence", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    };
  }

  it("keys layouts by user and workspace", () => {
    expect(layoutStorageKey("u1", "w1")).toBe("goland.layout.u1.w1");
    expect(layoutStorageKey("u1", "w1")).not.toBe(layoutStorageKey("u2", "w1"));
    expect(layoutStorageKey("u1", "w1")).not.toBe(layoutStorageKey("u1", "w2"));
  });

  it("round-trips a layout and isolates users/workspaces", () => {
    const storage = memoryStorage();
    let layout = withTabs(["a.go"]);
    layout = splitGroup(layout, "right", "group-2");
    saveLayout(storage, "u1", "w1", layout);
    expect(loadLayout(storage, "u1", "w1", 800)).toEqual(layout);
    expect(loadLayout(storage, "u2", "w1", 800)).toEqual(defaultLayout());
    expect(loadLayout(storage, "u1", "w2", 800)).toEqual(defaultLayout());
  });

  it("recovers from missing, corrupt or throwing storage", () => {
    const storage = memoryStorage();
    expect(loadLayout(storage, "u1", "w1", 800)).toEqual(defaultLayout());
    storage.map.set("goland.layout.u1.w1", "{not json");
    expect(loadLayout(storage, "u1", "w1", 800)).toEqual(defaultLayout());
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadLayout(throwing, "u1", "w1", 800)).toEqual(defaultLayout());
    expect(() => saveLayout(throwing, "u1", "w1", defaultLayout())).not.toThrow();
    expect(loadLayout(undefined, "u1", "w1", 800)).toEqual(defaultLayout());
    expect(() => saveLayout(undefined, "u1", "w1", defaultLayout())).not.toThrow();
  });

  it("sanitizes stored out-of-range values on load", () => {
    const storage = memoryStorage();
    storage.map.set(
      "goland.layout.u1.w1",
      JSON.stringify({
        sidebarWidth: 5000,
        bottomHeight: -10,
        rows: [["g1"]],
        groups: { g1: { paths: ["a.go"], activePath: "a.go" } },
        activeGroupId: "g1",
      }),
    );
    const layout = loadLayout(storage, "u1", "w1", 1000);
    expect(layout.sidebarWidth).toBe(600);
    expect(layout.bottomHeight).toBe(120);
    expect(layout.groups.g1.paths).toEqual(["a.go"]);
  });
});

describe("viewport helpers", () => {
  it("detects narrow viewports", () => {
    expect(isNarrowViewport(899)).toBe(true);
    expect(isNarrowViewport(900)).toBe(false);
    expect(isNarrowViewport(1440)).toBe(false);
    expect(isNarrowViewport(0)).toBe(false);
  });
});
