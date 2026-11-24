import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspacePlugin } from "@/lib/plugin-types";
import type { PluginPanelState } from "@/lib/usePlugins";
import { PluginPanel } from "./PluginPanel";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

const plugin: WorkspacePlugin = {
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
    contributes: { panels: [] },
  },
};

const panel: NonNullable<NonNullable<WorkspacePlugin["manifest"]>["contributes"]["panels"]>[number] = {
  id: "demo.plugin.panel",
  title: "Demo panel",
  fields: [
    { key: "query", type: "text", label: "Query", default: "initial" },
    { key: "mode", type: "select", label: "Mode", options: [{ label: "Fast", value: "fast" }], default: "fast" },
  ],
  actions: [
    { id: "run", label: "Run", command: "demo.plugin.run", args: { fixed: true } },
    { id: "other", label: "Other", command: "demo.plugin.other" },
  ],
};

function renderPanel(options?: { state?: PluginPanelState; outputs?: Record<string, string>; execute?: ReturnType<typeof vi.fn> }) {
  const execute = options?.execute ?? vi.fn().mockResolvedValue({ requestId: "req-1", output: "done" });
  const cancel = vi.fn().mockResolvedValue(undefined);
  render(
    <PluginPanel
      plugin={plugin}
      panel={panel}
      runtime={options?.state}
      outputs={options?.outputs ?? {}}
      execute={execute as never}
      cancel={cancel}
    />,
  );
  return { execute, cancel };
}

describe("PluginPanel", () => {
  it("renders declarative fields and runs actions with defaults", async () => {
    const { execute } = renderPanel();
    expect(screen.getByText("Demo panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Query")).toHaveValue("initial");
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "needle" } });
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        "demo.plugin",
        "demo.plugin.run",
        expect.objectContaining({ inputs: { query: "needle", mode: "fast", fixed: true } }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("done"));
  });

  it("shows panel state output", () => {
    renderPanel({ state: { output: "server output", state: {} } });
    expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("server output");
  });

  it("streams output and exposes cancel while a command is running", async () => {
    let resolveCommand: (value: { requestId: string; output: string }) => void = () => undefined;
    const execute = vi.fn().mockImplementation(
      () =>
        new Promise<{ requestId: string; output: string }>((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <PluginPanel
        plugin={plugin}
        panel={panel}
        runtime={{ output: "", state: {} }}
        outputs={{}}
        execute={execute as never}
        cancel={cancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const requestId = (execute.mock.calls[0][2] as { requestId: string }).requestId;
    expect(requestId).toBeTruthy();
    rerender(
      <PluginPanel
        plugin={plugin}
        panel={panel}
        runtime={{ output: "", state: {} }}
        outputs={{ [requestId]: "chunk 1\nchunk 2" }}
        execute={execute as never}
        cancel={cancel}
      />,
    );
    expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("chunk 1");
    const cancelButton = await screen.findByRole("button", { name: /Cancel/ });
    fireEvent.click(cancelButton);
    expect(cancel).toHaveBeenCalledWith("demo.plugin", requestId);
    resolveCommand({ requestId, output: "cancelled" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull());
    expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("chunk 1");
  });

  it("shows an error when a command fails", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("failed"));
    renderPanel({ execute });
    fireEvent.click(screen.getByRole("button", { name: /Other/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Plugin command failed"));
  });

  it("shows the empty state", () => {
    renderPanel();
    expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("Run an action to see plugin output.");
  });
});
