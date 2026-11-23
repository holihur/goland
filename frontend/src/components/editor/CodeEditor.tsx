import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { go } from "@codemirror/lang-go";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView, WidgetType, hoverTooltip, keymap } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { lintGutter, linter, setDiagnostics, type Diagnostic as CMDiagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { toast } from "sonner";
import type { Diagnostic } from "@/lib/types";
import type { LSPClient, SourceLocation } from "@/lib/lsp";

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", height: "100%" },
  ".cm-content": { padding: "10px 0 80px" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { paddingLeft: "6px" },
  ".cm-tooltip": { border: "1px solid hsl(218 13% 22%)", background: "hsl(220 14% 10%)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "hsl(218 14% 18%)",
    color: "hsl(210 20% 96%)",
  },
  ".cm-lsp-hover": {
    maxWidth: "620px",
    padding: "8px 10px",
    whiteSpace: "pre-wrap",
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: "11px",
    lineHeight: "1.6",
    color: "hsl(213 20% 88%)",
  },
});

const breakpointEffect = StateEffect.define<number[]>();

class BreakpointWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-breakpoint-dot";
    dot.title = "Breakpoint";
    return dot;
  }
}

const breakpointField = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(breakpointEffect)) return effect.value;
    }
    return value;
  },
});

const breakpointDecorations = EditorView.decorations.compute([breakpointField], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  const lines = [...state.field(breakpointField)].sort((a, b) => a - b);
  for (const lineNumber of lines) {
    if (lineNumber < 1 || lineNumber > state.doc.lines) continue;
    const line = state.doc.line(lineNumber);
    builder.add(
      line.from,
      line.from,
      Decoration.widget({ widget: new BreakpointWidget(), side: -1 }),
    );
  }
  return builder.finish();
});

function languageExtension(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".go")) return go();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return javascript({ typescript: true, jsx: true });
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) {
    return javascript({ jsx: true });
  }
  if (lower.endsWith(".json")) return json();
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return markdown();
  return [];
}

function positionAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
}

function offsetAt(view: EditorView, line: number, character: number) {
  const docLine = view.state.doc.line(Math.max(1, Math.min(line + 1, view.state.doc.lines)));
  return Math.min(docLine.from + Math.max(0, character), docLine.to);
}

function completionType(kind?: number) {
  switch (kind) {
    case 2:
    case 3:
      return "function";
    case 4:
      return "function";
    case 6:
      return "variable";
    case 7:
      return "class";
    case 8:
      return "interface";
    case 9:
      return "namespace";
    case 10:
      return "property";
    case 14:
      return "keyword";
    case 21:
      return "constant";
    default:
      return "text";
  }
}

function documentation(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return "";
}

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  diagnostics = [],
  lsp = null,
  onOpenLocation,
  onReferences,
  jumpTo,
  breakpoints = [],
  onCursorChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  diagnostics?: Diagnostic[];
  lsp?: LSPClient | null;
  onOpenLocation?: (location: SourceLocation) => void;
  onReferences?: (locations: SourceLocation[]) => void;
  jumpTo?: (SourceLocation & { nonce: number }) | null;
  breakpoints?: number[];
  onCursorChange?: (line: number) => void;
}) {
  const viewRef = useRef<EditorView | null>(null);
  const saveRef = useRef(onSave);
  const openLocationRef = useRef(onOpenLocation);
  const referencesRef = useRef(onReferences);
  saveRef.current = onSave;
  openLocationRef.current = onOpenLocation;
  referencesRef.current = onReferences;
  const jumpRef = useRef(jumpTo);
  jumpRef.current = jumpTo;
  const cursorRef = useRef(onCursorChange);
  cursorRef.current = onCursorChange;

  const extensions = useMemo(() => {
    const list = [
      languageExtension(path),
      editorTheme,
      linter(null),
      lintGutter(),
      breakpointField,
      breakpointDecorations,
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        const line = update.state.doc.lineAt(update.state.selection.main.head);
        cursorRef.current?.(line.number);
      }),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            saveRef.current();
            const view = viewRef.current;
            if (lsp && view) {
              void lsp.saveDocument(path, view.state.doc.toString()).catch(() => undefined);
            }
            return true;
          },
        },
      ]),
    ];
    if (!lsp) return list;

    const lspCompletion = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const view = viewRef.current;
      if (!view) return null;
      const word = context.matchBefore(/[\w$]*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      try {
        const items = await lsp.completion(path, context.state.doc.toString(), positionAt(view, context.pos));
        if (!items.length) return null;
        return {
          from: word.from,
          options: items.map((item) => ({
            label: item.label,
            detail: item.detail,
            info: documentation(item.documentation),
            type: completionType(item.kind),
            apply: item.textEdit?.newText ?? item.insertText ?? item.label,
            boost: item.sortText ? -Number.parseInt(item.sortText, 10) || 0 : 0,
          })),
        };
      } catch {
        return null;
      }
    };

    const hoverSource = hoverTooltip(
      async (view, pos) => {
        try {
          const text = await lsp.hover(path, positionAt(view, pos));
          if (!text.trim()) return null;
          return {
            pos,
            end: pos,
            above: true,
            create: () => {
              const dom = document.createElement("div");
              dom.className = "cm-lsp-hover";
              dom.textContent = text;
              return { dom };
            },
          };
        } catch {
          return null;
        }
      },
      { hoverTime: 300 },
    );

    list.push(
      autocompletion({ override: [lspCompletion], activateOnTyping: true, maxRenderedOptions: 60 }),
      hoverSource,
      keymap.of([
        {
          key: "F12",
          preventDefault: true,
          run: (view) => {
            void (async () => {
              try {
                const locations = await lsp.definition(path, positionAt(view, view.state.selection.main.head));
                const first = locations[0];
                if (!first) {
                  toast.info("No definition found");
                  return;
                }
                if (first.path === path) {
                  const pos = offsetAt(view, first.line - 1, first.column - 1);
                  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
                } else {
                  openLocationRef.current?.(first);
                }
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Go to definition failed");
              }
            })();
            return true;
          },
        },
        {
          key: "Shift-F12",
          preventDefault: true,
          run: (view) => {
            void (async () => {
              try {
                const locations = await lsp.references(path, positionAt(view, view.state.selection.main.head));
                referencesRef.current?.(locations);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Find references failed");
              }
            })();
            return true;
          },
        },
        {
          key: "Mod-Shift-f",
          preventDefault: true,
          run: (view) => {
            void (async () => {
              try {
                const edits = await lsp.formatting(path);
                if (!edits.length) {
                  toast.info("No formatting changes");
                  return;
                }
                const changes = edits
                  .map((edit) => ({
                    from: offsetAt(view, edit.range.start.line, edit.range.start.character),
                    to: offsetAt(view, edit.range.end.line, edit.range.end.character),
                    insert: edit.newText,
                  }))
                  .sort((a, b) => b.from - a.from);
                view.dispatch({ changes });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Formatting failed");
              }
            })();
            return true;
          },
        },
      ]),
    );
    return list;
  }, [path, lsp]);

  useEffect(() => {
    if (!lsp) return;
    void lsp.openDocument(path, value).catch(() => undefined);
    // The document is opened once per editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsp, path]);

  useEffect(() => {
    if (!lsp) return;
    const timer = window.setTimeout(() => {
      void lsp.changeDocument(path, value).catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [lsp, path, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: breakpointEffect.of(breakpoints) });
  }, [breakpoints]);

  useEffect(() => {
    if (!jumpTo) return;
    const timer = window.setTimeout(() => {
      const view = viewRef.current;
      if (!view) return;
      const pos = offsetAt(view, jumpTo.line - 1, jumpTo.column - 1);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [jumpTo]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const mapped: CMDiagnostic[] = [];
    for (const item of diagnostics) {
      const line = view.state.doc.line(Math.max(1, Math.min(item.line, view.state.doc.lines)));
      const from = Math.min(line.from + Math.max(0, item.column - 1), line.to);
      const endLine = view.state.doc.line(Math.max(1, Math.min(item.endLine || item.line, view.state.doc.lines)));
      const to = Math.max(from, Math.min(endLine.from + Math.max(0, (item.endColumn || item.column) - 1), endLine.to));
      mapped.push({
        from,
        to,
        severity: item.severity === "warning" ? "warning" : item.severity === "info" || item.severity === "hint" ? "info" : "error",
        message: item.message,
        source: item.source,
      });
    }
    view.dispatch(setDiagnostics(view.state, mapped));
  }, [diagnostics, value]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={oneDark}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
      }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        indentOnInput: true,
        tabSize: 2,
      }}
    />
  );
}
