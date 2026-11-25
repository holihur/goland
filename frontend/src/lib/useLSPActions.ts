import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import type { Diagnostic } from "./types";
import { clearDraft } from "./drafts";
import { applyTextEdits } from "./workspaceEdit";
import type { LSPClient, WorkspaceFileEdit } from "./lsp";

interface ActionTab {
  path: string;
  name: string;
  content: string;
  etag?: string;
  dirty: boolean;
  binary: boolean;
}

export function useLSPActions({
  workspaceId,
  userId,
  activeTab,
  cursorLine,
  cursorColumn,
  diagnostics,
  tabsRef,
  setTabs,
  refreshTree,
  refreshGit,
  lspClientForPath,
}: {
  workspaceId: string;
  userId: string;
  activeTab: ActionTab | null;
  cursorLine: number;
  cursorColumn: number;
  diagnostics: Record<string, Diagnostic[]>;
  tabsRef: RefObject<ActionTab[]>;
  setTabs: Dispatch<SetStateAction<ActionTab[]>>;
  refreshTree: () => void;
  refreshGit: () => void;
  lspClientForPath: (path: string) => LSPClient | null;
}) {
  const applyWorkspaceEdits = useCallback(
    async (files: WorkspaceFileEdit[]) => {
      if (!files.length) {
        toast.info("The language server returned no edits");
        return;
      }
      let applied = 0;
      let pending = 0;
      for (const file of files) {
        try {
          const tab = tabsRef.current.find((item) => item.path === file.path);
          let content = tab?.content;
          let etag = tab?.etag;
          if (content === undefined) {
            const fresh = await api.readFile(workspaceId, file.path);
            if (fresh.binary) continue;
            content = fresh.content ?? "";
            etag = fresh.etag;
          }
          const next = applyTextEdits(content, file.edits);
          if (next === content) continue;
          if (tab?.dirty) {
            setTabs((prev) => prev.map((item) => (item.path === file.path ? { ...item, content: next } : item)));
            void lspClientForPath(file.path)?.changeDocument(file.path, next).catch(() => undefined);
            pending++;
            continue;
          }
          const result = await api.writeFile(workspaceId, file.path, next, etag);
          if (tab) {
            setTabs((prev) =>
              prev.map((item) =>
                item.path === file.path ? { ...item, content: next, etag: result.etag, dirty: false } : item,
              ),
            );
          }
          clearDraft(userId, workspaceId, file.path);
          void lspClientForPath(file.path)?.saveDocument(file.path, next).catch(() => undefined);
          applied++;
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : `Could not update ${file.path}`);
        }
      }
      if (applied) {
        refreshTree();
        refreshGit();
      }
      if (applied || pending) {
        toast.success(
          `Applied edits to ${applied + pending} file${applied + pending === 1 ? "" : "s"}${
            pending ? ` (${pending} unsaved buffer${pending === 1 ? "" : "s"})` : ""
          }`,
        );
      }
    },
    [workspaceId, userId, tabsRef, setTabs, refreshTree, refreshGit, lspClientForPath],
  );

  const renameSymbol = useCallback(async () => {
    const tab = activeTab;
    if (!tab) return;
    const lsp = lspClientForPath(tab.path);
    if (!lsp) {
      toast.error("No language server is available for this file");
      return;
    }
    const newName = window.prompt(`Rename symbol in ${tab.name} to:`);
    if (!newName?.trim()) return;
    try {
      const edits = await lsp.rename(
        tab.path,
        { line: Math.max(0, cursorLine - 1), character: Math.max(0, cursorColumn - 1) },
        newName.trim(),
      );
      await applyWorkspaceEdits(edits);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    }
  }, [activeTab, cursorLine, cursorColumn, lspClientForPath, applyWorkspaceEdits]);

  const requestCodeActions = useCallback(async () => {
    const tab = activeTab;
    if (!tab) return [];
    const lsp = lspClientForPath(tab.path);
    if (!lsp) return [];
    try {
      const line = Math.max(0, cursorLine - 1);
      const character = Math.max(0, cursorColumn - 1);
      const actions = await lsp.codeActions(
        tab.path,
        { start: { line, character }, end: { line, character: character + 1 } },
        diagnostics[tab.path] ?? [],
      );
      return actions
        .filter((action) => action.edits.length > 0)
        .map((action, index) => ({
          id: `${index}:${action.title}`,
          title: action.title,
          run: () => void applyWorkspaceEdits(action.edits),
        }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load code actions");
      return [];
    }
  }, [activeTab, cursorLine, cursorColumn, diagnostics, lspClientForPath, applyWorkspaceEdits]);

  return { renameSymbol, requestCodeActions };
}
