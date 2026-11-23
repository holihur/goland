import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError as ApiErrorType } from "./api";

type ApiModule = typeof import("./api");
let api: ApiModule["api"];
let websocketURL: ApiModule["websocketURL"];
let terminalSocket: ApiModule["terminalSocket"];
let lspSocket: ApiModule["lspSocket"];
let taskSocket: ApiModule["taskSocket"];
let debugSocket: ApiModule["debugSocket"];
let ApiError: { new (status: number, code: string, message: string): ApiErrorType };

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContent() {
  return new Response(null, { status: 204 });
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const mod = await import("./api");
  api = mod.api;
  websocketURL = mod.websocketURL;
  terminalSocket = mod.terminalSocket;
  lspSocket = mod.lspSocket;
  taskSocket = mod.taskSocket;
  debugSocket = mod.debugSocket;
  ApiError = mod.ApiError;
});

describe("api request wrapper", () => {
  it("logs in, stores the CSRF token, and sends it on later mutations", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ csrfToken: "csrf-1", user: { id: "u1", email: "a@b.c" } }))
      .mockResolvedValueOnce(json({ user: { id: "u1" } }))
      .mockResolvedValueOnce(json({ user: { id: "u2" } }));

    const logged = await api.login("a@b.c", "secret");
    expect(logged.user.id).toBe("u1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "a@b.c", password: "secret" }),
        credentials: "include",
      }),
    );

    await api.me();
    expect(fetchMock.mock.calls[1][1].headers.get("X-CSRF-Token")).toBeNull();

    await api.createUser({ email: "c@d.e", name: "C", password: "password-1", role: "member" });
    const createHeaders = fetchMock.mock.calls[2][1].headers as Headers;
    expect(createHeaders.get("X-CSRF-Token")).toBe("csrf-1");
    expect(createHeaders.get("Content-Type")).toBe("application/json");
  });

  it("falls back to the CSRF cookie", async () => {
    document.cookie = "goland_csrf=cookie-token; path=/";
    fetchMock.mockResolvedValueOnce(noContent());
    await api.logout();
    expect((fetchMock.mock.calls[0][1].headers as Headers).get("X-CSRF-Token")).toBe("cookie-token");
  });

  it("returns undefined for 204", async () => {
    fetchMock.mockResolvedValueOnce(noContent());
    await expect(api.deleteWorkspace("w1")).resolves.toBeUndefined();
  });

  it("throws ApiError with server code and dispatches unauthorized", async () => {
    const listener = vi.fn();
    window.addEventListener("goland:unauthorized", listener);
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: "unauthorized", message: "login required" } }, 401),
    );
    await expect(api.me()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "unauthorized",
      message: "login required",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("goland:unauthorized", listener);
    expect(new ApiError(500, "x", "y")).toBeInstanceOf(Error);
  });

  it("uses fallback error text for non-JSON failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({
      status: 502,
      code: "request_failed",
      message: "Request failed (502)",
    });
  });
});

describe("api endpoints", () => {
  it("calls every workspace, file, git, task and debug endpoint", async () => {
    const payload = { ok: true };
    fetchMock.mockImplementation(() => Promise.resolve(json(payload)));

    const calls: Array<[() => Promise<unknown>, string, string | undefined]> = [
      [() => api.listUsers(), "/api/admin/users", "GET"],
      [() => api.listWorkspaces(), "/api/workspaces", "GET"],
      [() => api.getWorkspace("w1"), "/api/workspaces/w1", "GET"],
      [() => api.createWorkspace({ name: "n", source: "local", path: "/p" }), "/api/workspaces", "POST"],
      [() => api.deleteWorkspace("w1"), "/api/workspaces/w1", "DELETE"],
      [() => api.tree("w1", "a b"), "/api/workspaces/w1/tree?path=a+b", "GET"],
      [() => api.readFile("w1", "a b"), "/api/workspaces/w1/file?path=a+b", "GET"],
      [() => api.writeFile("w1", "a.go", "content", "etag"), "/api/workspaces/w1/file", "PUT"],
      [() => api.createEntry("w1", "a", "dir"), "/api/workspaces/w1/entry", "POST"],
      [() => api.renameEntry("w1", "a", "b"), "/api/workspaces/w1/rename", "POST"],
      [() => api.deleteEntry("w1", "a", true), "/api/workspaces/w1/entry?path=a&recursive=true", "DELETE"],
      [() => api.search("w1", "needle"), "/api/workspaces/w1/search?q=needle&limit=100", "GET"],
      [() => api.gitStatus("w1"), "/api/workspaces/w1/git/status", "GET"],
      [() => api.gitDiff("w1", "a.go", true), "/api/workspaces/w1/git/diff?path=a.go&cached=true", "GET"],
      [() => api.gitStage("w1", "a.go"), "/api/workspaces/w1/git/stage", "POST"],
      [() => api.gitUnstage("w1"), "/api/workspaces/w1/git/unstage", "POST"],
      [() => api.gitCommit("w1", "msg"), "/api/workspaces/w1/git/commit", "POST"],
      [() => api.gitBranches("w1"), "/api/workspaces/w1/git/branches", "GET"],
      [() => api.gitCreateBranch("w1", "feature"), "/api/workspaces/w1/git/branch", "POST"],
      [() => api.gitCheckout("w1", "main"), "/api/workspaces/w1/git/checkout", "POST"],
      [() => api.gitPull("w1"), "/api/workspaces/w1/git/pull", "POST"],
      [() => api.gitPush("w1"), "/api/workspaces/w1/git/push", "POST"],
      [() => api.gitLog("w1"), "/api/workspaces/w1/git/log", "GET"],
      [() => api.listTasks("w1"), "/api/workspaces/w1/tasks", "GET"],
      [() => api.runTask("w1", "go:test"), "/api/workspaces/w1/tasks/go:test/run", "POST"],
      [() => api.taskRuns("w1"), "/api/workspaces/w1/tasks/runs", "GET"],
      [() => api.diagnostics("w1", "a.go", "code"), "/api/workspaces/w1/diagnostics", "POST"],
      [() => api.startBrowser("w1", "https://example.com"), "/api/workspaces/w1/browser/session", "POST"],
      [() => api.stopBrowser("w1", "b1"), "/api/workspaces/w1/browser/session/b1", "DELETE"],
      [() => api.reloadBrowser("w1", "b1"), "/api/workspaces/w1/browser/session/b1/reload", "POST"],
      [() => api.debugConfig("w1"), "/api/workspaces/w1/debug/config", "GET"],
    ];

    for (const [run, path, method] of calls) {
      await expect(run()).resolves.toEqual(payload);
      const call = fetchMock.mock.calls.at(-1)!;
      expect(call[0]).toBe(path);
      expect(call[1]?.method ?? "GET").toBe(method);
    }

    const bodies = fetchMock.mock.calls.map((call) => call[1]?.body).filter(Boolean);
    expect(bodies).toContain(JSON.stringify({ from: "a", to: "b" }));
    expect(bodies).toContain(JSON.stringify({ path: "a.go", content: "content", etag: "etag" }));
    expect(bodies).toContain(JSON.stringify({ path: "a", kind: "dir" }));
    expect(bodies).toContain(JSON.stringify({ path: "", }));
    expect(bodies).toContain(JSON.stringify({ message: "msg" }));
    expect(bodies).toContain(JSON.stringify({ branch: "feature" }));
    expect(bodies).toContain(JSON.stringify({ path: "a.go", content: "code" }));
    expect(bodies).toContain(JSON.stringify({ url: "https://example.com" }));
  });
});

describe("websocket URLs", () => {
  it("builds socket URLs and encodes parameters", () => {
    expect(websocketURL("/api/ws/x")).toContain(":8788/api/ws/x");
    expect(terminalSocket("w 1")).toContain("/api/ws/workspaces/w 1/terminal");
    expect(lspSocket("w1", "go")).toContain("/api/ws/workspaces/w1/lsp?language=go");
    expect(taskSocket("w1", "go:test")).toContain("/api/ws/workspaces/w1/run?task=go%3Atest");
    expect(debugSocket("w1", "node", "a b")).toContain(
      "/api/ws/workspaces/w1/debug/node?session=a%20b",
    );
    expect(debugSocket("w1", "browser")).not.toContain("session=");
  });
});
