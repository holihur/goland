import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installWebSocket, MockWebSocket } from "@/test/setup";
import type { WorkspacePlugin } from "./plugin-types";
import { usePlugins } from "./usePlugins";

const listWorkspace = vi.fn();
const executePluginCommand = vi.fn();
const cancelPluginCommand = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("./plugin-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./plugin-api")>();
  return {
    ...actual,
    pluginApi: { listWorkspace: (...args: unknown[]) => listWorkspace(...args) },
    executePluginCommand: (...args: unknown[]) => executePluginCommand(...args),
    cancelPluginCommand: (...args: unknown[]) => cancelPluginCommand(...args),
  };
});

function plugin(overrides: Partial<WorkspacePlugin> = {}): WorkspacePlugin {
  return {
    id: "demo.plugin",
    name: "Demo",
    version: "1.0.0",
    apiVersion: 1,
    installedAt: "2026-01-01T00:00:00Z",
    enabled: true,
    config: {},
    manifest: {
      apiVersion: 1,
      id: "demo.plugin",
      name: "Demo",
      version: "1.0.0",
      executable: "bin/demo",
      contributes: {
        commands: [{ id: "demo.plugin.hello", title: "Hello" }],
        status: [{ id: "demo.plugin.status", text: "Demo" }],
        panels: [{ id: "demo.plugin.panel", title: "Demo panel", fields: [], actions: [] }],
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installWebSocket();
  listWorkspace.mockResolvedValue({ plugins: [plugin(), plugin({ id: "off.plugin", name: "Off", enabled: false })] });
  executePluginCommand.mockResolvedValue({ requestId: "req-1", output: "hello" });
  cancelPluginCommand.mockResolvedValue(undefined);
});

describe("usePlugins", () => {
  it("loads workspace plugins and exposes only enabled contributions", async () => {
    const { result } = renderHook(() => usePlugins("ws1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plugins).toHaveLength(2);
    expect(result.current.enabled.map((item) => item.id)).toEqual(["demo.plugin"]);
    expect(result.current.status["demo.plugin:demo.plugin.status"].text).toBe("Demo");
    expect(result.current.panels["demo.plugin:demo.plugin.panel"]).toEqual({ output: "", state: {} });
    expect(MockWebSocket.instances[0].url).toContain("/api/ws/workspaces/ws1/plugins");
  });

  it("applies status, panel, output and notification events", async () => {
    const { result } = renderHook(() => usePlugins("ws1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.receive({ type: "status", pluginId: "demo.plugin", statusId: "demo.plugin.status", text: "Busy", tooltip: "working" });
      socket.receive({
        type: "panel",
        pluginId: "demo.plugin",
        panelId: "demo.plugin.panel",
        title: "Updated",
        output: "line",
        state: { count: 1 },
      });
      socket.receive({ type: "output", pluginId: "demo.plugin", requestId: "r1", chunk: "abc" });
      socket.receive({ type: "output", pluginId: "demo.plugin", requestId: "r1", chunk: "def" });
      socket.receive({ type: "notify", pluginId: "demo.plugin", level: "error", message: "boom" });
    });
    expect(result.current.status["demo.plugin:demo.plugin.status"]).toEqual({ text: "Busy", tooltip: "working" });
    expect(result.current.panels["demo.plugin:demo.plugin.panel"].title).toBe("Updated");
    expect(result.current.panels["demo.plugin:demo.plugin.panel"].state).toEqual({ count: 1 });
    await waitFor(() => expect(result.current.outputs.r1).toBe("abcdef"));
    expect(toastError).toHaveBeenCalledWith("boom");
  });

  it("executes commands and stores their output", async () => {
    const { result } = renderHook(() => usePlugins("ws1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let response: { requestId: string; output: string } | undefined;
    await act(async () => {
      response = await result.current.execute("demo.plugin", "demo.plugin.hello", { inputs: { name: "x" } });
    });
    expect(executePluginCommand).toHaveBeenCalledWith(
      "ws1",
      "demo.plugin",
      "demo.plugin.hello",
      expect.objectContaining({ inputs: { name: "x" }, requestId: expect.any(String) }),
    );
    expect(response?.output).toBe("hello");
    expect(result.current.outputs[response!.requestId]).toBe("hello");
  });

  it("keeps streamed output when a command fails and rethrows", async () => {
    const { result } = renderHook(() => usePlugins("ws1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const socket = MockWebSocket.instances[0];
    executePluginCommand.mockImplementationOnce(async (_ws: string, _plugin: string, _command: string, input: { requestId: string }) => {
      socket.receive({ type: "output", requestId: input.requestId, chunk: "partial" });
      throw new Error("boom");
    });
    await act(async () => {
      await expect(result.current.execute("demo.plugin", "demo.plugin.hello")).rejects.toThrow("boom");
    });
    await waitFor(() => {
      const requestId = Object.keys(result.current.outputs)[0];
      expect(result.current.outputs[requestId]).toContain("partial");
    });
  });

  it("reports crashes and cancels commands", async () => {
    const { result } = renderHook(() => usePlugins("ws1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.receive({ type: "crashed", pluginId: "demo.plugin", error: "segfault" });
    });
    expect(result.current.pluginErrors["demo.plugin"]).toBe("segfault");
    expect(toastError).toHaveBeenCalledWith("demo.plugin crashed: segfault");
    await act(async () => {
      await result.current.cancel("demo.plugin", "r1");
    });
    expect(cancelPluginCommand).toHaveBeenCalledWith("ws1", "demo.plugin", "r1");
  });

});
