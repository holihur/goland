import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "./api";
import type { Diagnostic, FileContent } from "./types";
import type { EditorTab } from "@/components/ide/EditorGroups";
import { groupOfPath, type LayoutState } from "./layout";
import type { ViewerKind } from "./fileAssociations";

export function useRestoreTabs({
  workspaceId,
  paths,
  layout,
  viewerFor,
  draftForFile,
  setTabs,
  setDiagnostics,
  unassignTab,
  selectTab,
}: {
  workspaceId: string;
  paths: string[];
  layout: LayoutState;
  viewerFor: (path: string) => ViewerKind;
  draftForFile: (path: string, file: FileContent) => { content: string; etag?: string; dirty: boolean };
  setTabs: Dispatch<SetStateAction<EditorTab[]>>;
  setDiagnostics: Dispatch<SetStateAction<Record<string, Diagnostic[]>>>;
  unassignTab: (path: string) => void;
  selectTab: (groupId: string, path: string) => void;
}) {
  const [ready, setReady] = useState(paths.length === 0);
  const initialLayout = useRef(layout);

  useEffect(() => {
    if (!paths.length) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    const restore = async () => {
      for (const path of paths) {
        try {
          const viewer = viewerFor(path);
          if (viewer !== "code") {
            if (!cancelled) {
              setTabs((previous) =>
                previous.some((tab) => tab.path === path)
                  ? previous
                  : [
                      ...previous,
                      {
                        path,
                        name: path.split("/").pop() ?? path,
                        content: "",
                        binary: true,
                        dirty: false,
                        viewer,
                      },
                    ],
              );
            }
            continue;
          }
          const file = await api.readFile(workspaceId, path);
          if (cancelled) return;
          const draft = draftForFile(path, file);
          setTabs((previous) =>
            previous.some((tab) => tab.path === path)
              ? previous
              : [
                  ...previous,
                  {
                    path,
                    name: path.split("/").pop() ?? path,
                    content: draft.content,
                    etag: draft.etag,
                    binary: file.binary,
                    dirty: draft.dirty,
                    viewer: "code",
                  },
                ],
          );
          setDiagnostics((current) => ({ ...current, [path]: current[path] ?? [] }));
        } catch {
          if (!cancelled) unassignTab(path);
        }
      }
      const initial = initialLayout.current;
      const target = initial.groups[initial.activeGroupId]?.activePath;
      const group = target ? groupOfPath(initial, target) : null;
      if (!cancelled && group && target) selectTab(group, target);
      if (!cancelled) setReady(true);
    };
    void restore();
    return () => {
      cancelled = true;
    };
    // Restore is intentionally a one-shot operation for the workspace mount.
  }, [workspaceId, paths]);

  return ready;
}
