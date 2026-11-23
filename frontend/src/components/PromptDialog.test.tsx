import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptDialog, type PromptState } from "./PromptDialog";

function state(overrides: Partial<PromptState> = {}): PromptState {
  return {
    title: "Create file",
    description: "Enter a path",
    label: "File path",
    initial: "main.go",
    confirmLabel: "Create",
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe("PromptDialog", () => {
  it("renders nothing when closed", () => {
    render(<PromptDialog state={null} onClose={vi.fn()} />);
    expect(screen.queryByText("Create file")).not.toBeInTheDocument();
  });

  it("submits the trimmed value and closes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<PromptDialog state={state({ onSubmit })} onClose={onClose} />);
    const input = screen.getByLabelText("File path");
    fireEvent.change(input, { target: { value: "  cmd/new.go  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("cmd/new.go"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows submit failures and stays open", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("already exists"));
    const onClose = vi.fn();
    render(<PromptDialog state={state({ onSubmit })} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("already exists")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables submit for whitespace and supports cancel", () => {
    const onClose = vi.fn();
    render(<PromptDialog state={state()} onClose={onClose} />);
    const input = screen.getByLabelText("File path");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("applies danger styling and default confirm label", () => {
    render(<PromptDialog state={state({ danger: true, confirmLabel: undefined })} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByLabelText("File path")).toHaveValue("main.go");
  });
});
