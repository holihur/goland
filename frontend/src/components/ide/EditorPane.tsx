import { lazy, Suspense } from "react";
import { FileCode2 } from "lucide-react";
import { ImageViewer } from "@/components/editor/ImageViewer";
import { PdfViewer } from "@/components/editor/PdfViewer";
import type { Diagnostic } from "@/lib/types";
import type { LSPClient, SourceLocation } from "@/lib/lsp";
import type { EditorTab } from "./EditorGroups";

const CodeEditor = lazy(() => import("@/components/editor/CodeEditor").then((module) => ({ default: module.CodeEditor })));

export function EditorPane({
  workspaceId,
  path,
  tabs,
  diagnostics,
  lspClients,
  lspTargetForPath,
  jumpTo,
  breakpoints,
  toggleBreakpoint,
  updateContent,
  saveTab,
  rememberCursor,
  rememberScroll,
  viewStateRef,
}: {
  workspaceId: string;
  path: string;
  tabs: EditorTab[];
  diagnostics: Record<string, Diagnostic[]>;
  lspClients: Record<string, LSPClient>;
  lspTargetForPath: (path: string) => { key: string } | null;
  jumpTo: (SourceLocation & { nonce: number }) | null;
  breakpoints: Record<string, number[]>;
  toggleBreakpoint: (path: string, line: number) => void;
  updateContent: (path: string, content: string) => void;
  saveTab: (path: string) => Promise<void>;
  rememberCursor: (path: string, line: number, column: number) => void;
  rememberScroll: (path: string, scrollTop: number) => void;
  viewStateRef: React.RefObject<Record<string, { line: number; scrollTop: number }>>;
}) {
  const tab = tabs.find((item) => item.path === path);
  if (!tab) return null;
  if (tab.viewer === "image") {
    return <ImageViewer workspaceId={workspaceId} path={tab.path} name={tab.name} />;
  }
  if (tab.viewer === "pdf") {
    return <PdfViewer workspaceId={workspaceId} path={tab.path} name={tab.name} />;
  }
  if (tab.binary) {
    return (
      <div className="grid h-full place-items-center">
        <div className="max-w-sm text-center">
          <FileCode2 className="mx-auto h-9 w-9 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-medium">Binary file</h2>
          <p className="mt-1 text-xs text-muted-foreground">{path} cannot be displayed in the text editor.</p>
        </div>
      </div>
    );
  }
  const state = viewStateRef.current?.[path];
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">Loading editor…</div>}>
      <CodeEditor
        key={path}
        path={path}
        value={tab.content}
        onChange={(value) => updateContent(path, value)}
        onSave={() => void saveTab(path)}
        diagnostics={diagnostics[path] ?? []}
        lsp={lspClients[lspTargetForPath(path)?.key ?? ""] ?? null}
        jumpTo={jumpTo?.path === path ? jumpTo : null}
        breakpoints={breakpoints[path] ?? []}
        onToggleBreakpoint={(line) => toggleBreakpoint(path, line)}
        initialCursorLine={state?.line ?? 0}
        initialScrollTop={state?.scrollTop ?? 0}
        onCursorChange={(line, column) => rememberCursor(path, line, column)}
        onScrollChange={(scrollTop) => rememberScroll(path, scrollTop)}
      />
    </Suspense>
  );
}
