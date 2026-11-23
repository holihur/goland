import { lspSocket } from "./api";
import type { Diagnostic } from "./types";

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Status = "connecting" | "ready" | "closed" | "error";

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind?: string; value?: string };
  insertText?: string;
  sortText?: string;
  filterText?: string;
  textEdit?: { newText?: string };
}

interface TextEdit {
  range: Range;
  newText: string;
}

function fileURI(rootPath: string, relative = "") {
  const root = rootPath.replace(/\/+$/, "");
  const full = relative ? `${root}/${relative}` : root;
  return `file://${full.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function uriPath(rootPath: string, uri: string) {
  const root = rootPath.replace(/\/+$/, "");
  let path = decodeURIComponent(uri.replace(/^file:\/\//, ""));
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === root) return "";
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return path;
}

function hoverText(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n\n");
  if (contents && typeof contents === "object") {
    const obj = contents as { value?: string; language?: string };
    if (typeof obj.value === "string") return obj.value;
  }
  return "";
}

function normalizeLocations(rootPath: string, result: unknown): SourceLocation[] {
  const values = Array.isArray(result) ? result : result ? [result] : [];
  const out: SourceLocation[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const obj = value as { uri?: string; range?: Range; targetUri?: string; targetRange?: Range; targetSelectionRange?: Range };
    const uri = obj.uri ?? obj.targetUri;
    const range = obj.range ?? obj.targetSelectionRange ?? obj.targetRange;
    if (!uri || !range) continue;
    out.push({
      path: uriPath(rootPath, uri),
      line: range.start.line + 1,
      column: range.start.character + 1,
      endLine: range.end.line + 1,
      endColumn: range.end.character + 1,
    });
  }
  return out;
}

export class LSPClient {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private ready: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private opened = new Map<string, { version: number; text: string }>();
  private disposed = false;
  readonly language: "go" | "typescript";

  constructor(
    private workspaceId: string,
    private rootPath: string,
    language: "go" | "typescript",
    private onDiagnostics: (path: string, diagnostics: Diagnostic[]) => void,
    private onStatus: (status: Status) => void,
    private onError: (message: string) => void = () => undefined,
  ) {
    this.language = language;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.connect();
  }

  private connect() {
    this.onStatus("connecting");
    const socket = new WebSocket(lspSocket(this.workspaceId, this.language));
    this.socket = socket;
    socket.onopen = () => {
      void this.initialize();
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.handle(JSON.parse(event.data));
      } catch {
        // Ignore malformed server frames.
      }
    };
    socket.onerror = () => {
      if (this.disposed) return;
      this.onStatus("error");
      this.onError(`${this.language} language server connection failed`);
    };
    socket.onclose = () => {
      if (this.disposed) return;
      this.onStatus("closed");
      for (const [, item] of this.pending) {
        window.clearTimeout(item.timer);
        item.reject(new Error("language server closed"));
      }
      this.pending.clear();
    };
  }

  private async initialize() {
    try {
      await this.request("initialize", {
        processId: null,
        clientInfo: { name: "goland-web", version: "0.1.0" },
        rootUri: fileURI(this.rootPath),
        rootPath: this.rootPath,
        workspaceFolders: [{ uri: fileURI(this.rootPath), name: "workspace" }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true, willSave: false },
            completion: {
              dynamicRegistration: false,
              completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"] },
            },
            hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
            definition: { dynamicRegistration: false, linkSupport: true },
            references: { dynamicRegistration: false },
            formatting: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: {
            workspaceFolders: true,
            configuration: true,
          },
          window: { workDoneProgress: true },
        },
      });
      this.notify("initialized", {});
      this.onStatus("ready");
      this.readyResolve();
    } catch (err) {
      this.readyReject(err instanceof Error ? err : new Error(String(err)));
      this.onError(err instanceof Error ? err.message : "Language server failed to initialize");
    }
  }

  private handle(message: Record<string, unknown>) {
    if (import.meta.env.DEV) console.debug("[lsp]", this.language, message.method ?? `response#${message.id}`);
    if ((typeof message.id === "number" || typeof message.id === "string") && !message.method) {
      if (import.meta.env.DEV) console.debug("[lsp-resp]", this.language, typeof message.id, message.id, [...this.pending.keys()]);
      const numericID = Number(message.id);
      const item = this.pending.get(numericID);
      if (!item) return;
      this.pending.delete(numericID);
      window.clearTimeout(item.timer);
      if (message.error) {
        item.reject(new Error(String((message.error as { message?: string }).message ?? "LSP error")));
      } else {
        item.resolve(message.result);
      }
      return;
    }
    if ((typeof message.id === "number" || typeof message.id === "string") && typeof message.method === "string") {
      this.handleServerRequest(message.id, message.method, message.params);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: string; diagnostics?: Array<Record<string, unknown>> };
      if (!params?.uri) return;
      const path = uriPath(this.rootPath, params.uri);
      const diagnostics: Diagnostic[] = (params.diagnostics ?? []).map((item) => {
        const range = item.range as Range;
        const severity = Number(item.severity ?? 1);
        return {
          severity: severity === 1 ? "error" : severity === 2 ? "warning" : severity === 3 ? "info" : "hint",
          message: String(item.message ?? ""),
          line: range.start.line + 1,
          column: range.start.character + 1,
          endLine: range.end.line + 1,
          endColumn: range.end.character + 1,
          source: item.source ? String(item.source) : undefined,
        };
      });
      if (import.meta.env.DEV) console.debug("[lsp-diag]", this.language, path, diagnostics.length, diagnostics.slice(0, 2));
      this.onDiagnostics(path, diagnostics);
      return;
    }
    if (message.method === "goland/error") {
      const params = message.params as { message?: string };
      this.onError(params?.message ?? "Language server error");
    }
  }

  private handleServerRequest(id: number | string, method: string, params: unknown) {
    let result: unknown = null;
    if (method === "workspace/configuration") {
      const items = (params as { items?: unknown[] })?.items ?? [];
      result = items.map(() => ({}));
    } else if (method === "workspace/applyEdit") {
      result = { applied: false, failureReason: "Edits are applied by the editor UI." };
    }
    if (import.meta.env.DEV) console.debug("[lsp-out]", this.language, `response#${id}`);
    this.raw("response", { jsonrpc: "2.0", id, result });
  }

  private raw(_kind: string, body: Record<string, unknown>) {
    if (import.meta.env.DEV && body.method && _kind === "request") console.debug("[lsp-out]", this.language, body.method);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(body));
    }
  }

  private notify(method: string, params: unknown) {
    if (import.meta.env.DEV) console.debug("[lsp-out]", this.language, method);
    this.raw("notification", { jsonrpc: "2.0", method, params });
  }

  private request<T = unknown>(method: string, params: unknown, timeout = 15000): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.raw("request", { jsonrpc: "2.0", id, method, params });
    });
  }

  async openDocument(path: string, text: string) {
    await this.ready;
    if (this.opened.has(path)) {
      await this.changeDocument(path, text);
      return;
    }
    this.opened.set(path, { version: 1, text });
    const languageId =
      this.language === "go"
        ? "go"
        : path.endsWith(".tsx")
          ? "typescriptreact"
          : path.endsWith(".jsx")
            ? "javascriptreact"
            : path.endsWith(".js") || path.endsWith(".mjs")
              ? "javascript"
              : "typescript";
    this.notify("textDocument/didOpen", {
      textDocument: { uri: fileURI(this.rootPath, path), languageId, version: 1, text },
    });
  }

  async changeDocument(path: string, text: string) {
    if (!this.opened.has(path)) {
      await this.openDocument(path, text);
      return;
    }
    await this.ready;
    const current = this.opened.get(path)!;
    if (current.text === text) return;
    const version = current.version + 1;
    this.opened.set(path, { version, text });
    this.notify("textDocument/didChange", {
      textDocument: { uri: fileURI(this.rootPath, path), version },
      contentChanges: [{ text }],
    });
  }

  async saveDocument(path: string, text: string) {
    if (!this.opened.has(path)) {
      await this.openDocument(path, text);
    }
    await this.ready;
    this.notify("textDocument/didSave", {
      textDocument: { uri: fileURI(this.rootPath, path) },
      text,
    });
  }

  closeDocument(path: string) {
    if (!this.opened.has(path)) return;
    this.opened.delete(path);
    this.notify("textDocument/didClose", { textDocument: { uri: fileURI(this.rootPath, path) } });
  }

  async completion(path: string, text: string, position: Position): Promise<CompletionItem[]> {
    await this.openDocument(path, text);
    const result = (await this.request<CompletionItem[] | { items?: CompletionItem[] }>(
      "textDocument/completion",
      { textDocument: { uri: fileURI(this.rootPath, path) }, position, context: { triggerKind: 1 } },
    )) as CompletionItem[] | { items?: CompletionItem[] };
    return Array.isArray(result) ? result : (result?.items ?? []);
  }

  async hover(path: string, position: Position): Promise<string> {
    await this.ready;
    const result = (await this.request<{ contents?: unknown }>("textDocument/hover", {
      textDocument: { uri: fileURI(this.rootPath, path) },
      position,
    })) as { contents?: unknown } | null;
    return result ? hoverText(result.contents) : "";
  }

  async definition(path: string, position: Position): Promise<SourceLocation[]> {
    await this.ready;
    return normalizeLocations(
      this.rootPath,
      await this.request("textDocument/definition", {
        textDocument: { uri: fileURI(this.rootPath, path) },
        position,
      }),
    );
  }

  async references(path: string, position: Position): Promise<SourceLocation[]> {
    await this.ready;
    return normalizeLocations(
      this.rootPath,
      await this.request("textDocument/references", {
        textDocument: { uri: fileURI(this.rootPath, path) },
        position,
        context: { includeDeclaration: true },
      }),
    );
  }

  async formatting(path: string): Promise<TextEdit[]> {
    await this.ready;
    return (
      ((await this.request<TextEdit[]>("textDocument/formatting", {
        textDocument: { uri: fileURI(this.rootPath, path) },
        options: { tabSize: 2, insertSpaces: true },
      })) as TextEdit[] | null) ?? []
    );
  }

  dispose() {
    this.disposed = true;
    for (const [, item] of this.pending) {
      window.clearTimeout(item.timer);
      item.reject(new Error("language server disposed"));
    }
    this.pending.clear();
    this.socket?.close();
    this.socket = null;
  }
}

export function languageForPath(path: string): "go" | "typescript" | null {
  if (path.endsWith(".go")) return "go";
  if (/\.(ts|tsx|js|jsx|mjs)$/.test(path)) return "typescript";
  return null;
}

export type { CompletionItem, TextEdit, Position };
