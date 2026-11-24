import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWebSocket, MockWebSocket, tick } from "@/test/setup";
import { LSPClient, languageForPath } from "./lsp";
import type { Diagnostic } from "./types";

const root = "/workspace/project";

async function readyClient(language: "go" | "typescript" = "go") {
  installWebSocket();
  const diagnostics = vi.fn<(path: string, items: Diagnostic[]) => void>();
  const status = vi.fn();
  const error = vi.fn();
  const client = new LSPClient("ws1", root, language, diagnostics, status, error);
  const socket = MockWebSocket.instances[0];
  await tick();
  const initialize = socket.last("initialize");
  socket.receive({ jsonrpc: "2.0", id: initialize.id, result: { capabilities: {} } });
  await tick();
  return { client, socket, diagnostics, status, error };
}

async function respond(socket: MockWebSocket, method: string, result: unknown) {
  await tick();
  const request = socket.last(method);
  expect(request, `request ${method}`).toBeTruthy();
  socket.receive({ jsonrpc: "2.0", id: request.id, result });
  await tick();
}

beforeEach(() => {
  installWebSocket();
});

describe("LSPClient lifecycle", () => {
  it("initializes and reports ready", async () => {
    const { client, socket, status } = await readyClient("typescript");
    expect(socket.url).toContain("language=typescript");
    expect(socket.last("initialize").params.rootUri).toBe("file:///workspace/project");
    expect(status).toHaveBeenCalledWith("connecting");
    expect(status).toHaveBeenCalledWith("ready");
    expect(client.language).toBe("typescript");
  });

  it("handles connection errors and closes", async () => {
    const { socket, status, error, client } = await readyClient();
    socket.fail();
    expect(status).toHaveBeenCalledWith("error");
    expect(error).toHaveBeenCalledWith("go language server connection failed");

    const pending = client.hover("main.go", { line: 0, character: 0 });
    await tick();
    socket.serverClose();
    await expect(pending).rejects.toThrow("language server closed");
    expect(status).toHaveBeenCalledWith("closed");

    client.dispose();
    client.dispose();
  });

  it("rejects initialization failures", async () => {
    installWebSocket();
    const error = vi.fn();
    const client = new LSPClient("ws1", root, "go", vi.fn(), vi.fn(), error);
    void (client as unknown as { ready: Promise<void> }).ready.catch(() => undefined);
    const socket = MockWebSocket.instances[0];
    await tick();
    const initialize = socket.last("initialize");
    socket.receive({ jsonrpc: "2.0", id: initialize.id, error: { message: "boom" } });
    await tick();
    expect(error).toHaveBeenCalledWith("boom");
    client.dispose();
  });
});

describe("LSPClient documents", () => {
  it("opens, changes, saves and closes documents", async () => {
    const { client, socket } = await readyClient();
    await client.openDocument("cmd/main.go", "package main");
    expect(socket.last("textDocument/didOpen").params.textDocument).toMatchObject({
      languageId: "go",
      version: 1,
      text: "package main",
      uri: "file:///workspace/project/cmd/main.go",
    });
    await client.changeDocument("cmd/main.go", "package main\n");
    expect(socket.last("textDocument/didChange").params.textDocument.version).toBe(2);
    await client.changeDocument("cmd/main.go", "package main\n");
    expect(socket.messages().filter((m) => m.method === "textDocument/didChange")).toHaveLength(1);
    await client.saveDocument("cmd/main.go", "package main\n");
    expect(socket.last("textDocument/didSave").params.text).toBe("package main\n");
    client.closeDocument("cmd/main.go");
    expect(socket.last("textDocument/didClose")).toBeTruthy();
    client.closeDocument("missing.go");
    await client.changeDocument("new.ts", "let x = 1");
    expect(socket.last("textDocument/didOpen").params.textDocument.languageId).toBe("go");
  });
});

describe("LSPClient requests", () => {
  it("handles completion, hover, locations and formatting", async () => {
    const { client, socket } = await readyClient();
    const completion = client.completion("main.go", "package main", { line: 0, character: 0 });
    await respond(socket, "textDocument/completion", [{ label: "fmt" }]);
    await expect(completion).resolves.toEqual([{ label: "fmt" }]);

    const completion2 = client.completion("main.go", "package main", { line: 0, character: 0 });
    await respond(socket, "textDocument/completion", { items: [{ label: "Println" }] });
    await expect(completion2).resolves.toEqual([{ label: "Println" }]);

    const hovers: Array<[unknown, string]> = [
      ["plain", "plain"],
      [[{ value: "a" }, "b", null], "a\n\nb"],
      [{ value: "object" }, "object"],
      [42, ""],
    ];
    for (const [contents, want] of hovers) {
      const promise = client.hover("main.go", { line: 0, character: 0 });
      await respond(socket, "textDocument/hover", { contents });
      await expect(promise).resolves.toBe(want);
    }
    const nullHover = client.hover("main.go", { line: 0, character: 0 });
    await respond(socket, "textDocument/hover", null);
    await expect(nullHover).resolves.toBe("");

    const locations = client.definition("main.go", { line: 0, character: 0 });
    await respond(socket, "textDocument/definition", [
      { uri: "file:///workspace/project/a.go", range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } },
      { targetUri: "file:///workspace/project/b.go", targetSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
      { uri: "file:///other/c.go", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
      null,
    ]);
    await expect(locations).resolves.toEqual([
      { path: "a.go", line: 2, column: 3, endLine: 2, endColumn: 6 },
      { path: "b.go", line: 1, column: 1, endLine: 1, endColumn: 2 },
      { path: "/other/c.go", line: 1, column: 1, endLine: 1, endColumn: 1 },
    ]);

    const refs = client.references("main.go", { line: 0, character: 0 });
    await respond(socket, "textDocument/references", { uri: "file:///workspace/project/main.go", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } });
    await expect(refs).resolves.toHaveLength(1);

    const formatting = client.formatting("main.go");
    await respond(socket, "textDocument/formatting", [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "x" }]);
    await expect(formatting).resolves.toHaveLength(1);
    const noFormatting = client.formatting("main.go");
    await respond(socket, "textDocument/formatting", null);
    await expect(noFormatting).resolves.toEqual([]);
  });

  it("handles rejected requests and timeouts", async () => {
    const { client, socket } = await readyClient();
    const rejected = client.hover("main.go", { line: 0, character: 0 });
    await tick();
    const request = socket.last("textDocument/hover");
    socket.receive({ jsonrpc: "2.0", id: request.id, error: { message: "nope" } });
    await expect(rejected).rejects.toThrow("nope");

    vi.useFakeTimers();
    const timed = client.hover("main.go", { line: 0, character: 0 });
    await tick();
    vi.advanceTimersByTime(15001);
    await expect(timed).rejects.toThrow("textDocument/hover timed out");
  });
});

describe("LSPClient notifications and server requests", () => {
  it("publishes diagnostics with severities", async () => {
    const { socket, diagnostics } = await readyClient();
    socket.receive({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///workspace/project/main.go",
        diagnostics: [
          { range: { start: { line: 0, character: 1 }, end: { line: 1, character: 2 } }, severity: 1, message: "err", source: "gopls" },
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 2, message: "warn" },
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 3, message: "info" },
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 4, message: "hint" },
        ],
      },
    });
    expect(diagnostics).toHaveBeenCalledWith("main.go", [
      expect.objectContaining({ severity: "error", line: 1, column: 2, endLine: 2, endColumn: 3, source: "gopls" }),
      expect.objectContaining({ severity: "warning" }),
      expect.objectContaining({ severity: "info" }),
      expect.objectContaining({ severity: "hint" }),
    ]);
    socket.receive({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {} });
    socket.receive({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: "file:///workspace/project/x.go" } });
    expect(diagnostics).toHaveBeenCalledWith("x.go", []);
  });

  it("answers server requests and reports custom errors", async () => {
    const { socket, error } = await readyClient();
    socket.receive({
      jsonrpc: "2.0",
      id: 90,
      method: "workspace/configuration",
      params: { items: [{}, {}] },
    });
    expect(socket.messages().find((m) => m.id === 90)).toMatchObject({ result: [{}, {}] });
    socket.receive({ jsonrpc: "2.0", id: 91, method: "workspace/applyEdit", params: {} });
    expect(socket.messages().find((m) => m.id === 91)?.result).toMatchObject({ applied: false });
    socket.receive({ jsonrpc: "2.0", id: 92, method: "unknown/request", params: {} });
    expect(socket.messages().find((m) => m.id === 92)?.result).toBeNull();
    socket.receive({ jsonrpc: "2.0", method: "goland/error", params: { message: "custom" } });
    expect(error).toHaveBeenCalledWith("custom");
    socket.receive({ jsonrpc: "2.0", method: "goland/error" });
    expect(error).toHaveBeenCalledWith("Language server error");
  });

  it("ignores malformed and binary frames", async () => {
    const { socket } = await readyClient();
    socket.onmessage?.({ data: 42 });
    socket.receive("{");
    socket.receive({ jsonrpc: "2.0", id: 123, result: null });
    socket.receive({ jsonrpc: "2.0", method: "unknown/method", params: {} });
    expect(socket.messages().filter((m) => m.method === "unknown/method")).toHaveLength(0);
  });
});

describe("TypeScript document language IDs", () => {
  it("maps tsx, jsx, js and mjs files", async () => {
    const { client, socket } = await readyClient("typescript");
    for (const [path, languageId] of [
      ["view.tsx", "typescriptreact"],
      ["view.jsx", "javascriptreact"],
      ["view.js", "javascript"],
      ["view.mjs", "javascript"],
      ["view.ts", "typescript"],
    ] as const) {
      await client.openDocument(path, "");
      expect(socket.last("textDocument/didOpen").params.textDocument.languageId).toBe(languageId);
    }
  });
});

describe("languageForPath", () => {
  it("detects supported languages", () => {
    expect(languageForPath("main.go")).toBe("go");
    for (const path of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs"]) {
      expect(languageForPath(path)).toBe("typescript");
    }
    expect(languageForPath("README.md")).toBeNull();
  });
});

describe("plugin language sockets", () => {
  it("uses a plugin-provided websocket URL", async () => {
    installWebSocket();
    const client = new LSPClient(
      "ws1",
      root,
      "demo",
      vi.fn(),
      vi.fn(),
      vi.fn(),
      "ws://127.0.0.1:8788/api/ws/workspaces/ws1/plugins/demo/lsp/demo-lang",
    );
    await tick();
    expect(MockWebSocket.instances[0].url).toBe(
      "ws://127.0.0.1:8788/api/ws/workspaces/ws1/plugins/demo/lsp/demo-lang",
    );
    expect(client.language).toBe("demo");
  });
});
