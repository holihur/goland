import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWebSocket, MockWebSocket, tick } from "@/test/setup";
import { DAPClient } from "./dap";

async function readyDap(kind: "go" | "node" | "browser" = "go") {
  installWebSocket();
  const error = vi.fn();
  const client = new DAPClient("w1", kind, error, "adapter-1");
  const socket = MockWebSocket.instances[0];
  await tick();
  return { client, socket, error };
}

function request(socket: MockWebSocket, command: string) {
  const found = [...socket.messages()].reverse().find((m) => m.type === "request" && m.command === command);
  if (!found) throw new Error(`missing request ${command}`);
  return found;
}

async function respond(socket: MockWebSocket, command: string, body: Record<string, unknown> = {}) {
  await tick();
  const req = request(socket, command);
  expect(req, `request ${command}`).toBeTruthy();
  socket.receive({ type: "response", request_seq: req.seq, success: true, command, body });
  await tick();
}

async function initializedClient(kind: "go" | "node" | "browser" = "go") {
  const setup = await readyDap(kind);
  const session = setup.client.initializeSession();
  await respond(setup.socket, "initialize");
  setup.socket.receive({ type: "event", event: "initialized", body: {} });
  await session;
  return setup;
}

beforeEach(() => {
  installWebSocket();
});

describe("DAPClient lifecycle", () => {
  it("connects, reports adapter ids and handles events", async () => {
    const { client, socket, error } = await readyDap("node");
    expect(socket.url).toContain("/debug/node?session=adapter-1");
    const listener = vi.fn();
    const off = client.onEvent(listener);
    socket.receive({ type: "event", event: "goland/adapter", body: { id: "sess-9" } });
    expect(client.adapterId).toBe("sess-9");
    expect(listener).toHaveBeenCalledWith({ event: "goland/adapter", body: { id: "sess-9" } });
    off();
    socket.receive({ type: "event", event: "stopped", body: { reason: "breakpoint" } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    client.dispose();
  });

  it("handles connection errors and close with pending requests", async () => {
    const { client, socket, error } = await readyDap();
    socket.fail();
    expect(error).toHaveBeenCalledWith("go debug adapter connection failed");
    const pending = client.request("threads", {}, 1000);
    await tick();
    socket.serverClose();
    await expect(pending).rejects.toThrow("debug adapter closed");
    socket.serverClose();
    client.dispose();
  });

  it("rejects ready when the socket errors", async () => {
    installWebSocket();
    const client = new DAPClient("w1", "go", vi.fn());
    void client.ready.catch(() => undefined);
    const socket = MockWebSocket.instances[0];
    socket.fail();
    await expect(client.ready).rejects.toThrow("debug adapter connection failed");
    client.dispose();
  });

  it("ignores malformed and binary frames", async () => {
    const { client, socket } = await readyDap();
    socket.onmessage?.({ data: 42 });
    socket.receive("{");
    socket.receive({ type: "response", request_seq: 999, success: true, body: {} });
    socket.receive({ type: "unknown" });
    client.dispose();
  });
});

describe("DAPClient requests", () => {
  it("initializes once", async () => {
    const { client, socket } = await initializedClient("browser");
    const req = request(socket, "initialize");
    expect(req.arguments.supportsStartDebuggingRequest).toBe(false);
    await client.initializeSession();
    expect(socket.messages().filter((m) => m.command === "initialize")).toHaveLength(1);
  });

  it("times out initialization wait when no initialized event arrives", async () => {
    const { client, socket } = await readyDap();
    vi.useFakeTimers();
    const session = client.initializeSession();
    await tick();
    const req = request(socket, "initialize");
    socket.receive({ type: "response", request_seq: req.seq, success: true, command: "initialize", body: {} });
    await tick();
    await vi.advanceTimersByTimeAsync(2501);
    await session;
  });

  it("launches with configurationDone ordering", async () => {
    const { client, socket } = await initializedClient();
    const before = vi.fn(async () => undefined);
    const launch = client.launch({ program: "main.go" }, before);
    await respond(socket, "launch", { ok: true });
    const launchRequest = request(socket, "launch");
    const configRequest = request(socket, "configurationDone");
    expect(configRequest.seq).toBeGreaterThan(launchRequest.seq);
    await respond(socket, "configurationDone");
    await expect(launch).resolves.toEqual({ ok: true });
    expect(before).toHaveBeenCalledTimes(1);
  });

  it("maps debug commands to DAP requests", async () => {
    const { client, socket } = await initializedClient();
    const commands: Array<[Promise<unknown>, string]> = [
      [client.setBreakpoints("main.go", [3, 5]), "setBreakpoints"],
      [client.setExceptionBreakpoints(["uncaught"]), "setExceptionBreakpoints"],
      [client.stackTrace(1), "stackTrace"],
      [client.scopes(2), "scopes"],
      [client.variables(3), "variables"],
      [client.evaluate("x", 4), "evaluate"],
      [client.continue(1), "continue"],
      [client.next(1), "next"],
      [client.stepIn(1), "stepIn"],
      [client.stepOut(1), "stepOut"],
      [client.pause(1), "pause"],
    ];
    for (const [promise, command] of commands) {
      await respond(socket, command, { command });
      await expect(promise).resolves.toEqual({ command });
    }
    expect(request(socket, "setBreakpoints").arguments).toMatchObject({
      source: { path: "main.go", name: "main.go" },
      breakpoints: [{ line: 3 }, { line: 5 }],
    });
  });

  it("rejects failed requests and times out", async () => {
    const { client, socket } = await initializedClient();
    const failed = client.stackTrace(1);
    await tick();
    const req = request(socket, "stackTrace");
    socket.receive({ type: "response", request_seq: req.seq, success: false, message: "no stack" });
    await expect(failed).rejects.toThrow("no stack");

    vi.useFakeTimers();
    const timed = client.request("threads", {}, 50);
    await tick();
    vi.advanceTimersByTime(51);
    await expect(timed).rejects.toThrow("threads timed out");
  });
});

describe("DAPClient reverse requests", () => {
  it("answers runInTerminal", async () => {
    const { client, socket } = await initializedClient();
    socket.receive({ type: "request", seq: 10, command: "runInTerminal", arguments: {} });
    await tick();
    const response = socket.messages().find((m) => m.type === "response" && m.request_seq === 10);
    expect(response).toMatchObject({ success: true, body: { processId: 0, shellProcessId: 0 } });
    client.dispose();
  });

  it("starts child sessions and reports failures", async () => {
    const { client, socket, error } = await initializedClient();
    const child = vi.fn(async () => undefined);
    client.onChildSession(child);
    socket.receive({ type: "request", seq: 11, command: "startDebugging", arguments: { configuration: { name: "child" } } });
    await tick(5);
    expect(child).toHaveBeenCalledWith({ name: "child" });
    expect(socket.messages().find((m) => m.type === "response" && m.request_seq === 11)?.success).toBe(true);

    child.mockRejectedValueOnce(new Error("child failed"));
    socket.receive({ type: "request", seq: 12, command: "startDebugging", arguments: { configuration: {} } });
    await tick(5);
    expect(error).toHaveBeenCalledWith("child failed");
    expect(socket.messages().find((m) => m.type === "response" && m.request_seq === 12)?.success).toBe(false);
    client.dispose();
  });

  it("can ignore startDebugging requests", async () => {
    const { client, socket } = await initializedClient();
    client.ignoreStartDebuggingRequests();
    socket.receive({ type: "request", seq: 13, command: "startDebugging", arguments: {} });
    await tick();
    expect(socket.messages().find((m) => m.type === "response" && m.request_seq === 13)).toBeUndefined();
    client.dispose();
  });

  it("handles unknown reverse commands", async () => {
    const { client, socket } = await initializedClient();
    socket.receive({ type: "request", seq: 14, command: "unknown", arguments: {} });
    await tick();
    expect(socket.messages().find((m) => m.type === "response" && m.request_seq === 14)).toMatchObject({ success: true, body: {} });
    client.dispose();
  });
});

describe("DAPClient shutdown", () => {
  it("sends disconnect and closes the socket", async () => {
    const { client, socket } = await initializedClient();
    vi.useFakeTimers();
    client.disconnect(false);
    expect(request(socket, "disconnect").arguments).toMatchObject({ terminateDebuggee: false });
    vi.advanceTimersByTime(301);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("dispose closes without emitting closed event", async () => {
    const { client, socket } = await initializedClient();
    const listener = vi.fn();
    client.onEvent(listener);
    client.dispose();
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(listener).not.toHaveBeenCalled();
    client.dispose();
  });
});
