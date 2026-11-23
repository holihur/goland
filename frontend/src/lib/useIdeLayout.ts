import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_GROUPS,
  activePathOf,
  assignTab,
  closeGroup,
  defaultLayout,
  groupIds,
  isNarrowViewport,
  loadLayout,
  moveTab,
  nextGroupId,
  saveLayout,
  setGroupActivePath,
  splitGroup,
  unassignTab,
  updateBottom,
  updateSidebar,
  activeGroupIdOf,
  type BottomView,
  type LayoutState,
  type SideView,
  type SplitDirection,
} from "./layout";

function currentViewport() {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function storage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Owns the layout state for one user/workspace: restores from localStorage,
 * persists every change, tracks viewport size and exposes layout actions.
 */
export function useIdeLayout(userId: string, workspaceId: string) {
  const initialViewport = useRef(currentViewport());
  const [layout, setLayout] = useState<LayoutState>(() =>
    loadLayout(storage(), userId, workspaceId, initialViewport.current.height),
  );
  const [viewport, setViewport] = useState(initialViewport.current);
  const [restoredPaths] = useState(() => groupIds(layout).flatMap((id) => layout.groups[id]?.paths ?? []));

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    // Debounce so dragging a splitter does not hit localStorage on every frame.
    const timer = window.setTimeout(() => saveLayout(storage(), userId, workspaceId, layout), 80);
    return () => window.clearTimeout(timer);
  }, [layout, userId, workspaceId]);

  useEffect(() => {
    return () => saveLayout(storage(), userId, workspaceId, layoutRef.current);
  }, [userId, workspaceId]);

  useEffect(() => {
    const onResize = () => {
      const next = currentViewport();
      setViewport(next);
      setLayout((current) => {
        const bounded = updateBottom(current, {}, next.height);
        return updateSidebar(bounded, { sidebarWidth: bounded.sidebarWidth });
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    setLayout((current) => updateSidebar(current, { sidebarWidth: width }));
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    setLayout((current) => updateSidebar(current, { sidebarOpen: open }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setLayout((current) => updateSidebar(current, { sidebarOpen: !current.sidebarOpen }));
  }, []);

  const setSideView = useCallback((view: SideView) => {
    setLayout((current) => updateSidebar(current, { sideView: view, sidebarOpen: true }));
  }, []);

  const setBottomView = useCallback((view: BottomView) => {
    setLayout((current) => updateBottom(current, { bottomView: view }, currentViewport().height));
  }, []);

  const setBottomOpen = useCallback((open: boolean) => {
    setLayout((current) => updateBottom(current, { bottomOpen: open }, currentViewport().height));
  }, []);

  const setBottomMaximized = useCallback((maximized: boolean) => {
    setLayout((current) => updateBottom(current, { bottomMaximized: maximized }, currentViewport().height));
  }, []);

  const setBottomHeight = useCallback((height: number) => {
    setLayout((current) => updateBottom(current, { bottomHeight: height }, currentViewport().height));
  }, []);

  const openBottom = useCallback(
    (view: BottomView) => {
      setLayout((current) => updateBottom(current, { bottomOpen: true, bottomView: view }, currentViewport().height));
    },
    [],
  );

  const toggleBottom = useCallback((view?: BottomView) => {
    setLayout((current) => {
      if (view && current.bottomView !== view) {
        return updateBottom(current, { bottomOpen: true, bottomView: view }, currentViewport().height);
      }
      return updateBottom(current, { bottomOpen: !current.bottomOpen }, currentViewport().height);
    });
  }, []);

  const addTab = useCallback((path: string) => {
    setLayout((current) => assignTab(current, path));
  }, []);

  const removeTab = useCallback((path: string) => {
    setLayout((current) => unassignTab(current, path));
  }, []);

  const selectTab = useCallback((groupId: string, path: string) => {
    setLayout((current) => setGroupActivePath(current, groupId, path));
  }, []);

  const focusGroup = useCallback((groupId: string) => {
    setLayout((current) => ({ ...current, activeGroupId: groupId }));
  }, []);

  const moveTabToGroup = useCallback((path: string, groupId: string, index?: number) => {
    setLayout((current) => moveTab(current, path, groupId, index));
  }, []);

  const split = useCallback((direction: SplitDirection) => {
    setLayout((current) => {
      if (groupIds(current).length >= MAX_GROUPS) return current;
      return splitGroup(current, direction, nextGroupId(current));
    });
  }, []);

  const closeEditorGroup = useCallback((groupId: string) => {
    setLayout((current) => closeGroup(current, groupId));
  }, []);

  const reset = useCallback((paths: string[], activePath?: string) => {
    setLayout(() => {
      let next = defaultLayout();
      for (const path of paths) next = assignTab(next, path);
      if (activePath && groupOfPathSafe(next, activePath)) next = setGroupActivePath(next, activeGroupIdOf(next), activePath);
      return next;
    });
  }, []);

  const compact = isNarrowViewport(viewport.width);
  // Keep the sidebar from squeezing the editor below a usable width.
  const sidebarMax = Math.max(180, Math.min(600, viewport.width - 260));

  const actions = useMemo(
    () => ({
      setSidebarWidth,
      setSidebarOpen,
      toggleSidebar,
      setSideView,
      setBottomView,
      setBottomOpen,
      setBottomMaximized,
      setBottomHeight,
      openBottom,
      toggleBottom,
      assignTab: addTab,
      unassignTab: removeTab,
      selectTab,
      focusGroup,
      moveTabToGroup,
      split,
      closeEditorGroup,
      reset,
    }),
    [
      setSidebarWidth,
      setSidebarOpen,
      toggleSidebar,
      setSideView,
      setBottomView,
      setBottomOpen,
      setBottomMaximized,
      setBottomHeight,
      openBottom,
      toggleBottom,
      addTab,
      removeTab,
      selectTab,
      focusGroup,
      moveTabToGroup,
      split,
      closeEditorGroup,
      reset,
    ],
  );

  return {
    layout,
    viewport,
    compact,
    sidebarMax,
    maxBottomHeight: Math.max(120, Math.round(viewport.height * 0.7)),
    restoredPaths,
    activePath: activePathOf(layout),
    ...actions,
  };
}

function groupOfPathSafe(layout: LayoutState, path: string): boolean {
  return Object.values(layout.groups).some((group) => group.paths.includes(path));
}
