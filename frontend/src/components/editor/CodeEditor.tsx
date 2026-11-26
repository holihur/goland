import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, GutterMarker, gutter, hoverTooltip, keymap, lineNumbers } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { foldEffect, foldGutter, foldable, foldedRanges, unfoldEffect } from "@codemirror/language";
import { lintGutter, linter, setDiagnostics, type Diagnostic as CMDiagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { toast } from "sonner";
import type { Diagnostic } from "@/lib/types";
import type { LSPClient, SourceLocation } from "@/lib/lsp";
import { languageForPath } from "@/lib/languages";
import { markdownNodes } from "@/lib/markdown";
import { useTheme } from "@/lib/theme";

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", height: "100%" },
  ".cm-content": { padding: "0 0 80px" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { paddingLeft: "0" },
  ".cm-tooltip": { border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "hsl(var(--accent))",
    color: "hsl(var(--accent-foreground))",
  },
  ".cm-lsp-hover": {
    maxWidth: "620px",
    padding: "8px 10px",
    whiteSpace: "pre-wrap",
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: "11px",
    lineHeight: "1.6",
    color: "hsl(var(--popover-foreground))",
  },
  ".cm-lsp-hover pre": {
    margin: "6px 0",
    overflowX: "auto",
    borderRadius: "4px",
    background: "hsl(var(--muted))",
    padding: "6px 8px",
  },
  ".cm-lsp-hover code": {
    borderRadius: "3px",
    background: "hsl(var(--muted))",
    padding: "0 3px",
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
  },
  ".cm-lsp-hover pre code": { background: "transparent", padding: "0" },
  ".cm-lsp-hover a": { color: "hsl(var(--primary))", textDecoration: "underline" },
  ".cm-lsp-hover ul": { listStyle: "disc", paddingLeft: "18px" },
  ".cm-lsp-hover ol": { listStyle: "decimal", paddingLeft: "18px" },
  ".cm-lsp-hover .cm-md-heading": { margin: "4px 0", fontWeight: "600" },
});

function toggleFoldAtLine(view: EditorView, line: { from: number; to: number }) {
  let foldedFrom = -1;
  let foldedTo = -1;
  foldedRanges(view.state).between(line.from, line.to, (from, to) => {
    foldedFrom = from;
    foldedTo = to;
  });
  if (foldedFrom >= 0) {
    view.dispatch({ effects: unfoldEffect.of({ from: foldedFrom, to: foldedTo }) });
    return;
  }
  const range = foldable(view.state, line.from, line.to);
  if (range) view.dispatch({ effects: foldEffect.of(range) });
}

const foldingExtension = foldGutter({
  domEventHandlers: {
    // Fold toggling is handled on mousedown below so that a gutter re-render
    // between mousedown and click cannot swallow the interaction.
    click: () => true,
  },
});

function handleFoldMouseDown(event: MouseEvent, view: EditorView) {
  if (event.button !== 0) return;
  const gutter = view.dom.querySelector<HTMLElement>(".cm-foldGutter");
  if (!gutter) return;
  const rect = gutter.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right) return;
  const line = view.lineBlockAtHeight(event.clientY - view.documentTop);
  let folded = false;
  foldedRanges(view.state).between(line.from, line.to, () => {
    folded = true;
  });
  if (!folded && !foldable(view.state, line.from, line.to)) return;
  event.preventDefault();
  toggleFoldAtLine(view, line);
}

const breakpointEffect = StateEffect.define<number[]>();

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-breakpoint-dot";
    dot.title = "Breakpoint";
    return dot;
  }
}

const breakpointMarker = new BreakpointMarker();

const breakpointField = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(breakpointEffect)) return effect.value;
    }
    return value;
  },
});

function createBreakpointGutter(onToggle: (line: number) => void) {
  return gutter({
    class: "cm-breakpointGutter",
    markers(view) {
      const builder = new RangeSetBuilder<GutterMarker>();
      const lines = [...view.state.field(breakpointField)].sort((a, b) => a - b);
      for (const lineNumber of lines) {
        if (lineNumber < 1 || lineNumber > view.state.doc.lines) continue;
        const line = view.state.doc.line(lineNumber);
        builder.add(line.from, line.from, breakpointMarker);
      }
      return builder.finish();
    },
    initialSpacer: () => breakpointMarker,
    domEventHandlers: {
      mousedown: (view, line, event) => {
        if (!(event instanceof MouseEvent) || event.button !== 0) return false;
        event.preventDefault();
        onToggle(view.state.doc.lineAt(line.from).number);
        return true;
      },
      click: () => true,
    },
  });
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
  jumpTo,
  breakpoints = [],
  onToggleBreakpoint,
  onCursorChange,
  initialCursorLine = 0,
  initialScrollTop = 0,
  onScrollChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  diagnostics?: Diagnostic[];
  lsp?: LSPClient | null;
  jumpTo?: (SourceLocation & { nonce: number }) | null;
  breakpoints?: number[];
  onToggleBreakpoint?: (line: number) => void;
  onCursorChange?: (line: number, column: number) => void;
  /** Restored when a tab is remounted after a group move or layout change. */
  initialCursorLine?: number;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
}) {
  const { theme } = useTheme();
  const [language, setLanguage] = useState<Extension>([]);
  const viewRef = useRef<EditorView | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const jumpRef = useRef(jumpTo);
  jumpRef.current = jumpTo;
  const cursorRef = useRef(onCursorChange);
  cursorRef.current = onCursorChange;
  const scrollRef = useRef(onScrollChange);
  scrollRef.current = onScrollChange;
  const initialCursorRef = useRef(initialCursorLine);
  const initialScrollRef = useRef(initialScrollTop);
  const onToggleBreakpointRef = useRef(onToggleBreakpoint);
  onToggleBreakpointRef.current = onToggleBreakpoint;
  const breakpointGutterExtension = useMemo(
    () => createBreakpointGutter((line) => onToggleBreakpointRef.current?.(line)),
    [],
  );
  const scrollHandlerRef = useRef<(() => void) | null>(null);
  const foldMouseRef = useRef<{ dom: HTMLElement; handler: (event: MouseEvent) => void } | null>(null);

  useEffect(() => {
    return () => {
      const view = viewRef.current;
      const handler = scrollHandlerRef.current;
      if (view && handler) view.scrollDOM.removeEventListener("scroll", handler);
      scrollHandlerRef.current = null;
      const foldMouse = foldMouseRef.current;
      if (foldMouse) foldMouse.dom.removeEventListener("mousedown", foldMouse.handler, true);
      foldMouseRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const description = languageForPath(path);
    if (!description) {
      setLanguage([]);
      return;
    }
    setLanguage(description.support ?? []);
    if (!description.support) {
      void description
        .load()
        .then((support) => {
          if (!cancelled) setLanguage(support);
        })
        .catch(() => {
          if (!cancelled) setLanguage([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [path]);

  const extensions = useMemo(() => {
    const list = [
      language,
      breakpointGutterExtension,
      lineNumbers(),
      foldingExtension,
      editorTheme,
      linter(null),
      lintGutter(),
      breakpointField,
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        cursorRef.current?.(line.number, head - line.from + 1);
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
              dom.append(...markdownNodes(text));
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
  }, [path, lsp, language]);

  useEffect(() => {
    if (!lsp) return;
    void lsp.openDocument(path, value).catch(() => undefined);
    // The document is opened once per editor instance.
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
      theme={theme === "dark" ? oneDark : undefined}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
        const handler = () => scrollRef.current?.(view.scrollDOM.scrollTop);
        scrollHandlerRef.current = handler;
        view.scrollDOM.addEventListener("scroll", handler, { passive: true });
        const foldMouse = (event: MouseEvent) => handleFoldMouseDown(event, view);
        foldMouseRef.current = { dom: view.dom, handler: foldMouse };
        view.dom.addEventListener("mousedown", foldMouse, true);
        if (initialScrollRef.current > 0) {
          const scrollTop = initialScrollRef.current;
          requestAnimationFrame(() => {
            view.scrollDOM.scrollTop = scrollTop;
          });
        }
        if (initialCursorRef.current > 1) {
          const line = view.state.doc.line(Math.min(initialCursorRef.current, view.state.doc.lines));
          view.dispatch({ selection: { anchor: line.from } });
        }
      }}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
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
