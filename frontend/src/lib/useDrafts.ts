import { useCallback, useEffect, type RefObject } from "react";
import { toast } from "sonner";
import type { FileContent } from "./types";
import { clearDraft, readDraft, writeDraft } from "./drafts";

export interface DraftTab {
  path: string;
  content: string;
  etag?: string;
  dirty: boolean;
  binary: boolean;
}

function tabName(path: string) {
  return path.split("/").pop() ?? path;
}

export function useDrafts(
  userId: string,
  workspaceId: string,
  tabs: DraftTab[],
  tabsRef: RefObject<DraftTab[]>,
) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const tab of tabs) {
        if (tab.dirty && !tab.binary) writeDraft(userId, workspaceId, tab.path, tab.content, tab.etag);
        else clearDraft(userId, workspaceId, tab.path);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [tabs, userId, workspaceId]);

  useEffect(() => {
    const flush = () => {
      for (const tab of tabsRef.current) {
        if (tab.dirty && !tab.binary) writeDraft(userId, workspaceId, tab.path, tab.content, tab.etag);
        else clearDraft(userId, workspaceId, tab.path);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [userId, workspaceId, tabsRef]);

  return useCallback(
    (path: string, file: FileContent) => {
      const draft = file.binary ? null : readDraft(userId, workspaceId, path);
      if (!draft) return { content: file.content ?? "", etag: file.etag, dirty: false };
      if (draft.content === (file.content ?? "")) {
        clearDraft(userId, workspaceId, path);
        return { content: file.content ?? "", etag: file.etag, dirty: false };
      }
      if (draft.etag && draft.etag !== file.etag) {
        toast.warning(`Recovered a draft for ${tabName(path)} that differs from the current file on disk`);
      } else {
        toast.info(`Recovered unsaved changes for ${tabName(path)}`);
      }
      return { content: draft.content, etag: draft.etag ?? file.etag, dirty: true };
    },
    [userId, workspaceId],
  );
}
