import { useEffect, useRef } from "react";
import { groupOfPath, type LayoutState } from "./layout";
import type { EditorTab } from "@/components/ide/EditorGroups";

export function useFileURL({
  initialFile,
  restoredReady,
  activePath,
  layout,
  tabs,
  openFile,
  selectTab,
  onFileChange,
}: {
  initialFile: string;
  restoredReady: boolean;
  activePath: string;
  layout: LayoutState;
  tabs: EditorTab[];
  openFile: (path: string) => Promise<void>;
  selectTab: (groupId: string, path: string) => void;
  onFileChange?: (path?: string) => void;
}) {
  const urlReady = useRef(!initialFile);
  const applied = useRef("");

  useEffect(() => {
    if (!restoredReady) return;
    if (!initialFile) {
      applied.current = "";
      urlReady.current = true;
      return;
    }
    if (applied.current === initialFile) {
      urlReady.current = true;
      return;
    }
    applied.current = initialFile;
    urlReady.current = false;
    const group = groupOfPath(layout, initialFile);
    if (group) {
      selectTab(group, initialFile);
      urlReady.current = true;
      return;
    }
    const existing = tabs.find((tab) => tab.path === initialFile);
    if (existing) {
      const existingGroup = groupOfPath(layout, initialFile);
      if (existingGroup) selectTab(existingGroup, initialFile);
      urlReady.current = true;
      return;
    }
    void openFile(initialFile).finally(() => {
      urlReady.current = true;
      onFileChange?.(initialFile);
    });
  }, [restoredReady, initialFile, layout, tabs, openFile, selectTab, onFileChange]);

  useEffect(() => {
    if (!restoredReady || !urlReady.current) return;
    onFileChange?.(activePath || undefined);
  }, [activePath, restoredReady, onFileChange]);
}
