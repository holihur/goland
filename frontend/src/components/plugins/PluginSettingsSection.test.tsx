import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePlugin } from "@/lib/plugin-types";
import { PluginSettingsSection } from "./PluginSettingsSection";

const listWorkspace = vi.fn();
const updateWorkspace = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

vi.mock("@/lib/plugin-api", () => ({
  pluginApi: {
    listWorkspace: (...args: unknown[]) => listWorkspace(...args),
    updateWorkspace: (...args: unknown[]) => updateWorkspace(...args),
  },
}));

const plugin: WorkspacePlugin = {
  id: "demo.plugin",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 1,
  installedAt: "2026-01-01T00:00:00Z",
  enabled: false,
  config: { "demo.plugin.settings.mode": "fast" },
  defaults: { "demo.plugin.settings.mode": "fast", "demo.plugin.settings.enabled": true },
  manifest: {
    apiVersion: 1,
    id: "demo.plugin",
    name: "Demo",
    version: "1.0.0",
    executable: "bin/demo",
    contributes: {
      settings: [
        {
          id: "demo.plugin.settings",
          title: "Settings",
          fields: [
            { key: "name", type: "text", label: "Name" },
            { key: "mode", type: "select", label: "Mode", options: [{ label: "Fast", value: "fast" }] },
            { key: "enabled", type: "boolean", label: "Enabled" },
          ],
        },
      ],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  listWorkspace.mockResolvedValue({ plugins: [plugin] });
  updateWorkspace.mockImplementation(async (_ws: string, _id: string, input: { enabled: boolean }) => ({
    plugin: { ...plugin, enabled: input.enabled },
  }));
});

describe("PluginSettingsSection", () => {
  it("loads plugins with merged defaults", async () => {
    render(<PluginSettingsSection workspaceId="ws1" />);
    expect(await screen.findByText("Demo")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Mode")).toHaveValue("fast");
    expect(screen.getByLabelText("Enabled")).toBeChecked();
    expect(listWorkspace).toHaveBeenCalledWith("ws1");
  });

  it("enables a plugin and saves edited configuration", async () => {
    render(<PluginSettingsSection workspaceId="ws1" />);
    const toggle = await screen.findByLabelText("Enable Demo");
    fireEvent.click(toggle);
    await waitFor(() => expect(updateWorkspace).toHaveBeenCalledWith("ws1", "demo.plugin", expect.objectContaining({ enabled: true })));
    expect(toastSuccess).toHaveBeenCalledWith("Demo enabled");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "demo" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));
    await waitFor(() =>
      expect(updateWorkspace).toHaveBeenLastCalledWith("ws1", "demo.plugin", {
        enabled: true,
        config: expect.objectContaining({ "demo.plugin.settings.name": "demo" }),
      }),
    );
  });

  it("renders an empty state and surfaces errors", async () => {
    listWorkspace.mockResolvedValueOnce({ plugins: [] });
    const { unmount } = render(<PluginSettingsSection workspaceId="ws1" />);
    expect(await screen.findByText("No plugins installed by an administrator.")).toBeInTheDocument();
    unmount();

    listWorkspace.mockRejectedValueOnce(new Error("nope"));
    render(<PluginSettingsSection workspaceId="ws1" />);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not load plugins"));
  });

  it("reports save failures", async () => {
    updateWorkspace.mockRejectedValueOnce(new Error("denied"));
    render(<PluginSettingsSection workspaceId="ws1" />);
    fireEvent.click(await screen.findByLabelText("Enable Demo"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save plugin settings"));
  });
});
