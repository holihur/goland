import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskInfo } from "@/lib/types";
import { BottomPanel } from "./BottomPanel";

vi.mock("@/components/editor/TerminalPanel", () => ({
  TerminalPanel: ({ workspaceId, visible }: { workspaceId: string; visible: boolean }) => (
    <div data-testid="terminal">
      terminal:{workspaceId}:{visible ? "visible" : "hidden"}
    </div>
  ),
}));

const runningTask: TaskInfo = {
  id: "task-1",
  workspaceId: "w1",
  kind: "go",
  label: "go test ./...",
  command: "go",
  args: ["test", "./..."],
  status: "running",
} as TaskInfo;

function setup(overrides: Partial<Parameters<typeof BottomPanel>[0]> = {}) {
  const props = {
    workspaceId: "w1",
    view: "terminal" as const,
    maximized: false,
    visible: true,
    output: "hello output",
    problems: 0,
    runningTask: null,
    outputRef: { current: null },
    onSelectView: vi.fn(),
    onShowProblems: vi.fn(),
    onClose: vi.fn(),
    onToggleMaximize: vi.fn(),
    onStopTask: vi.fn(),
    ...overrides,
  };
  render(<BottomPanel {...props} />);
  return props;
}

describe("BottomPanel", () => {
  it("switches between terminal and output views", async () => {
    const props = setup();
    expect(await screen.findByTestId("terminal")).toHaveTextContent("terminal:w1:visible");
    fireEvent.click(screen.getByRole("button", { name: /Output/ }));
    expect(props.onSelectView).toHaveBeenCalledWith("output");
    fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
    expect(props.onSelectView).toHaveBeenCalledWith("terminal");
  });

  it("shows output and lets the running task be stopped", async () => {
    const props = setup({ view: "output", runningTask, output: "compiling" });
    expect(screen.getByText("running: go test ./...")).toBeInTheDocument();
    expect(screen.getByText("compiling")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onStopTask).toHaveBeenCalledTimes(1);
    // The terminal stays mounted (hidden) so its PTY survives view switches.
    expect(await screen.findByTestId("terminal")).toHaveTextContent("hidden");
  });

  it("reports problems and closes or maximizes the panel", () => {
    const props = setup({ problems: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Show problems" }));
    expect(props.onShowProblems).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Maximize panel" }));
    expect(props.onToggleMaximize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a restore action while maximized", () => {
    const props = setup({ maximized: true });
    fireEvent.click(screen.getByRole("button", { name: "Restore panel size" }));
    expect(props.onToggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("does not mount the terminal when the panel is hidden", () => {
    setup({ visible: false });
    expect(screen.queryByTestId("terminal")).toBeNull();
  });

  it("marks the active view with aria-pressed", () => {
    setup({ view: "output" });
    expect(screen.getByRole("button", { name: /Output/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Terminal/ })).toHaveAttribute("aria-pressed", "false");
  });
});
