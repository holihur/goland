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
      expect(execute).toHaveBeenCalledWith("demo.plugin", "demo.plugin.run", {
        inputs: { query: "needle", mode: "fast", fixed: true },
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("done"));
  });

  it("shows panel state output and a cancel button", async () => {
    const { cancel } = renderPanel({ state: { output: "server output", state: {} } });
    expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("server output");
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(cancel).toHaveBeenCalledWith("demo.plugin", "req-1");
  });

  it("prefers streamed command output for the active request", async () => {
    renderPanel({ state: { output: "panel output", state: {} }, outputs: { "req-1": "streamed" } });
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    await waitFor(() => expect(screen.getByLabelText("Demo panel output")).toHaveTextContent("streamed"));
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
