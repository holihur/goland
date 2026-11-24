/**
 * Window/layout model for the IDE: resizable side and bottom panels, editor
 * groups (up to 2x2) and per-group tab assignment. Pure functions only, so the
 * model can be unit tested without React.
 */

export const LAYOUT_VERSION = 1;

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 600;
export const DEFAULT_SIDEBAR_WIDTH = 270;

export const BOTTOM_MIN = 120;
export const BOTTOM_MAX_RATIO = 0.7;
export const DEFAULT_BOTTOM_HEIGHT = 230;

export const MAX_GROUPS = 4;
export const NARROW_BREAKPOINT = 900;

export type SideView = "explorer" | "search" | "git" | "debug" | "settings" | `plugin:${string}`;
export type BottomView = "terminal" | "output";
export type SplitDirection = "right" | "down";

export interface EditorGroupState {
  /** Tab paths in display order. */
  paths: string[];
  /** Path shown by this group; empty when the group has no tabs. */
  activePath: string;
}

export interface LayoutState {
  version: number;
  sidebarWidth: number;
  sidebarOpen: boolean;
  sideView: SideView;
  bottomHeight: number;
  bottomOpen: boolean;
  bottomMaximized: boolean;
  bottomView: BottomView;
  /** Groups per row, top to bottom. Rows are rendered as flex columns. */
  rows: string[][];
  groups: Record<string, EditorGroupState>;
  activeGroupId: string;
}

const SIDE_VIEWS: SideView[] = ["explorer", "search", "git", "debug", "settings"];

export function isSideView(value: unknown): value is SideView {
  if (typeof value !== "string") return false;
  if (SIDE_VIEWS.includes(value as SideView)) return true;
  return value.startsWith("plugin:") && value.length > 7 && value.length <= 200;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function clampSidebarWidth(value: number): number {
  return Math.round(clamp(value, SIDEBAR_MIN, SIDEBAR_MAX));
}

export function clampBottomHeight(value: number, viewportHeight: number): number {
  const viewport = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  const max = Math.max(BOTTOM_MIN, Math.round(viewport * BOTTOM_MAX_RATIO));
  return Math.round(clamp(value, BOTTOM_MIN, max));
}

export function layoutStorageKey(userId: string, workspaceId: string): string {
  return `goland.layout.${userId}.${workspaceId}`;
}

export function defaultLayout(groupId = "group-1"): LayoutState {
  return {
    version: LAYOUT_VERSION,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarOpen: true,
    sideView: "explorer",
    bottomHeight: DEFAULT_BOTTOM_HEIGHT,
    bottomOpen: true,
    bottomMaximized: false,
    bottomView: "terminal",
    rows: [[groupId]],
    groups: { [groupId]: { paths: [], activePath: "" } },
    activeGroupId: groupId,
  };
}

export function groupIds(layout: LayoutState): string[] {
  return layout.rows.flat();
}

export function activeGroupIdOf(layout: LayoutState): string {
  if (layout.groups[layout.activeGroupId]) return layout.activeGroupId;
  return groupIds(layout)[0] ?? "";
}

export function groupState(layout: LayoutState, groupId: string): EditorGroupState {
  const group = layout.groups[groupId];
  if (group) return group;
  return { paths: [], activePath: "" };
}

export function activePathOf(layout: LayoutState): string {
  return groupState(layout, activeGroupIdOf(layout)).activePath;
}

export function groupOfPath(layout: LayoutState, path: string): string | null {
  for (const id of groupIds(layout)) {
    if (layout.groups[id]?.paths.includes(path)) return id;
  }
  return null;
}

export function allLayoutPaths(layout: LayoutState): string[] {
  return groupIds(layout).flatMap((id) => layout.groups[id]?.paths ?? []);
}

/** Adds `path` to a group's tabs (default: active group) and activates it. */
export function assignTab(layout: LayoutState, path: string, groupId?: string): LayoutState {
  if (!path) return layout;
  const target = groupId && layout.groups[groupId] ? groupId : activeGroupIdOf(layout);
  if (!layout.groups[target]) return layout;
  const existing = groupOfPath(layout, path);
  if (existing) {
    return {
      ...layout,
      activeGroupId: existing,
      groups: { ...layout.groups, [existing]: { ...layout.groups[existing], activePath: path } },
    };
  }
  const group = layout.groups[target];
  return {
    ...layout,
    activeGroupId: target,
    groups: {
      ...layout.groups,
      [target]: { paths: [...group.paths, path], activePath: path },
    },
  };
}

/** Removes a path from every group; picks a neighbouring tab as active. */
export function unassignTab(layout: LayoutState, path: string): LayoutState {
  const groups: Record<string, EditorGroupState> = {};
  for (const [id, group] of Object.entries(layout.groups)) {
    if (!group.paths.includes(path)) {
      groups[id] = group;
      continue;
    }
    const paths = group.paths.filter((item) => item !== path);
    const activePath = group.activePath === path ? (paths[0] ?? "") : group.activePath;
    groups[id] = { paths, activePath };
  }
  return { ...layout, groups };
}

export function setGroupActivePath(layout: LayoutState, groupId: string, path: string): LayoutState {
  const group = layout.groups[groupId];
  if (!group) return layout;
  if (path && !group.paths.includes(path)) return layout;
  return {
    ...layout,
    activeGroupId: groupId,
    groups: { ...layout.groups, [groupId]: { ...group, activePath: path } },
  };
}

export function activateGroup(layout: LayoutState, groupId: string): LayoutState {
  const group = layout.groups[groupId];
  if (!group) return layout;
  return { ...layout, activeGroupId: groupId };
}

/** Moves a tab to a target group at an optional index. */
export function moveTab(layout: LayoutState, path: string, targetGroupId: string, index?: number): LayoutState {
  if (!layout.groups[targetGroupId]) return layout;
  const groups: Record<string, EditorGroupState> = {};
  for (const [id, group] of Object.entries(layout.groups)) {
    if (!group.paths.includes(path)) {
      groups[id] = group;
      continue;
    }
    const paths = group.paths.filter((item) => item !== path);
    groups[id] = {
      paths,
      activePath: group.activePath === path ? (paths[0] ?? "") : group.activePath,
    };
  }
  if (groups[targetGroupId].paths.includes(path)) return layout;
  const insertAt = index === undefined ? groups[targetGroupId].paths.length : clamp(index, 0, groups[targetGroupId].paths.length);
  const paths = [...groups[targetGroupId].paths];
  paths.splice(insertAt, 0, path);
  groups[targetGroupId] = { paths, activePath: path };
  return { ...layout, groups, activeGroupId: targetGroupId };
}

/** Splits the active group to the right or below. No-op at MAX_GROUPS. */
export function splitGroup(layout: LayoutState, direction: SplitDirection, newGroupId: string): LayoutState {
  if (groupIds(layout).length >= MAX_GROUPS) return layout;
  if (!newGroupId || layout.groups[newGroupId]) return layout;
  const activeId = activeGroupIdOf(layout);
  if (!activeId) return layout;
  const groups: Record<string, EditorGroupState> = {
    ...layout.groups,
    [newGroupId]: { paths: [], activePath: "" },
  };
  let rows: string[][];
  if (direction === "right") {
    rows = layout.rows.map((row) => {
      if (!row.includes(activeId)) return row;
      const next = [...row];
      next.splice(next.indexOf(activeId) + 1, 0, newGroupId);
      return next;
    });
  } else {
    rows = [];
    for (const row of layout.rows) {
      rows.push(row);
      if (row.includes(activeId)) rows.push([newGroupId]);
    }
  }
  return { ...layout, rows, groups, activeGroupId: newGroupId };
}

/**
 * Closes a group, recycling its tabs into a neighbouring group. The last group
 * cannot be removed; it is emptied instead.
 */
export function closeGroup(layout: LayoutState, groupId: string): LayoutState {
  if (!layout.groups[groupId]) return layout;
  const ids = groupIds(layout);
  if (ids.length <= 1) {
    const only = ids[0] ?? activeGroupIdOf(layout);
    if (!only) return defaultLayout();
    return {
      ...layout,
      rows: [[only]],
      groups: { [only]: { paths: [], activePath: "" } },
      activeGroupId: only,
    };
  }
  const closed = layout.groups[groupId];
  const remaining = ids.filter((id) => id !== groupId);
  const neighbour = remaining[Math.max(0, ids.indexOf(groupId) - 1)] ?? remaining[0];
  const groups: Record<string, EditorGroupState> = { ...layout.groups };
  delete groups[groupId];
  const neighbourGroup = groups[neighbour];
  const recycled = closed.paths.filter((path) => !neighbourGroup.paths.includes(path));
  groups[neighbour] = {
    paths: [...neighbourGroup.paths, ...recycled],
    activePath: neighbourGroup.activePath || recycled[0] || "",
  };
  const rows = layout.rows
    .map((row) => row.filter((id) => id !== groupId))
    .filter((row) => row.length > 0);
  return {
    ...layout,
    rows,
    groups,
    activeGroupId: neighbour,
  };
}

export function updateSidebar(layout: LayoutState, patch: Partial<Pick<LayoutState, "sidebarWidth" | "sidebarOpen" | "sideView">>): LayoutState {
  const next = { ...layout, ...patch };
  return { ...next, sidebarWidth: clampSidebarWidth(next.sidebarWidth) };
}

export function updateBottom(
  layout: LayoutState,
  patch: Partial<Pick<LayoutState, "bottomHeight" | "bottomOpen" | "bottomMaximized" | "bottomView">>,
  viewportHeight: number,
): LayoutState {
  const next = { ...layout, ...patch };
  return { ...next, bottomHeight: clampBottomHeight(next.bottomHeight, viewportHeight) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Validates persisted data. Unknown fields, corrupt group references and
 * out-of-range sizes are dropped or clamped; a fully corrupt input yields the
 * default layout.
 */
export function sanitizeLayout(raw: unknown, viewportHeight: number): LayoutState {
  const fallback = defaultLayout();
  if (!isRecord(raw)) return fallback;

  const sidebarWidth = clampSidebarWidth(typeof raw.sidebarWidth === "number" ? raw.sidebarWidth : fallback.sidebarWidth);
  const bottomHeight = clampBottomHeight(
    typeof raw.bottomHeight === "number" ? raw.bottomHeight : fallback.bottomHeight,
    viewportHeight,
  );
  const sideView = isSideView(raw.sideView) ? raw.sideView : fallback.sideView;
  const bottomView: BottomView = raw.bottomView === "output" ? "output" : "terminal";

  const rawGroups = isRecord(raw.groups) ? raw.groups : {};
  const seen = new Set<string>();
  const groups: Record<string, EditorGroupState> = {};
  const rows: string[][] = [];
  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  let count = 0;

  for (const rawRow of rawRows) {
    if (!Array.isArray(rawRow)) continue;
    const row: string[] = [];
    for (const rawId of rawRow) {
      if (typeof rawId !== "string" || !rawId || groups[rawId]) continue;
      if (count >= MAX_GROUPS) break;
      const rawGroup = isRecord(rawGroups[rawId]) ? rawGroups[rawId] : {};
      const paths: string[] = [];
      const rawPaths = Array.isArray(rawGroup.paths) ? rawGroup.paths : [];
      for (const rawPath of rawPaths) {
        if (typeof rawPath !== "string" || !rawPath || seen.has(rawPath)) continue;
        seen.add(rawPath);
        paths.push(rawPath);
      }
      const candidate = typeof rawGroup.activePath === "string" && paths.includes(rawGroup.activePath) ? rawGroup.activePath : (paths[0] ?? "");
      groups[rawId] = { paths, activePath: candidate };
      row.push(rawId);
      count += 1;
    }
    if (row.length) rows.push(row);
    if (count >= MAX_GROUPS) break;
  }

  if (!rows.length || !Object.keys(groups).length) return fallback;

  const ids = rows.flat();
  const activeGroupId = typeof raw.activeGroupId === "string" && groups[raw.activeGroupId] ? raw.activeGroupId : ids[0];
  return {
    version: LAYOUT_VERSION,
    sidebarWidth,
    sidebarOpen: asBoolean(raw.sidebarOpen, fallback.sidebarOpen),
    sideView,
    bottomHeight,
    bottomOpen: asBoolean(raw.bottomOpen, fallback.bottomOpen),
    bottomMaximized: asBoolean(raw.bottomMaximized, fallback.bottomMaximized),
    bottomView,
    rows,
    groups,
    activeGroupId,
  };
}

export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadLayout(storage: LayoutStorage | undefined, userId: string, workspaceId: string, viewportHeight: number): LayoutState {
  const key = layoutStorageKey(userId, workspaceId);
  if (!storage) return defaultLayout();
  try {
    const raw = storage.getItem(key);
    if (!raw) return defaultLayout();
    return sanitizeLayout(JSON.parse(raw), viewportHeight);
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(storage: LayoutStorage | undefined, userId: string, workspaceId: string, layout: LayoutState): void {
  if (!storage) return;
  try {
    storage.setItem(layoutStorageKey(userId, workspaceId), JSON.stringify(layout));
  } catch {
    // Quota or privacy-mode failures must never break the IDE.
  }
}

export function nextGroupId(layout: LayoutState): string {
  let index = Object.keys(layout.groups).length + 1;
  while (layout.groups[`group-${index}`]) index += 1;
  return `group-${index}`;
}

export function hasRoomToSplit(layout: LayoutState): boolean {
  return groupIds(layout).length < MAX_GROUPS;
}

export function isNarrowViewport(width: number): boolean {
  return width > 0 && width < NARROW_BREAKPOINT;
}

/** Paths to show for a group, limited to currently open tabs. */
export function visiblePaths(layout: LayoutState, groupId: string, openPaths: string[]): string[] {
  const set = new Set(openPaths);
  return groupState(layout, groupId).paths.filter((path) => set.has(path));
}

export function displayActivePath(layout: LayoutState, groupId: string, openPaths: string[]): string {
  const group = groupState(layout, groupId);
  const visible = visiblePaths(layout, groupId, openPaths);
  return visible.includes(group.activePath) ? group.activePath : (visible[0] ?? "");
}
