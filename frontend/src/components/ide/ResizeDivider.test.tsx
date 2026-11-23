import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizeDivider } from "./ResizeDivider";

function setup(overrides: Partial<Parameters<typeof ResizeDivider>[0]> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const props = {
    axis: "x" as const,
    value: 270,
    min: 180,
    max: 600,
    onChange,
    onReset,
    label: "Resize sidebar",
    ...overrides,
  };
  render(<ResizeDivider {...props} />);
  const divider = screen.getByRole("separator", { name: props.label });
  return { divider, onChange, onReset, props };
}

describe("ResizeDivider", () => {
  it("exposes separator semantics and accessible values", () => {
    const { divider } = setup();
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveAttribute("aria-valuenow", "270");
    expect(divider).toHaveAttribute("aria-valuemin", "180");
    expect(divider).toHaveAttribute("aria-valuemax", "600");
    expect(divider).toHaveAttribute("tabindex", "0");
    expect(divider).toHaveAttribute("data-axis", "x");
    expect(divider).toHaveAttribute("data-dragging", "false");
  });

  it("resizes on horizontal pointer drag and clamps to the max", () => {
    const { divider, onChange } = setup();
    fireEvent.pointerDown(divider, { button: 0, clientX: 100, clientY: 10, pointerId: 1 });
    expect(divider).toHaveAttribute("data-dragging", "true");
    fireEvent.pointerMove(divider, { clientX: 160, clientY: 10, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(330);
    fireEvent.pointerMove(divider, { clientX: 900, clientY: 10, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(600);
    fireEvent.pointerUp(divider, { clientX: 900, clientY: 10, pointerId: 1 });
    expect(divider).toHaveAttribute("data-dragging", "false");
  });

  it("clamps to the min and ignores movement before pointer down", () => {
    const { divider, onChange } = setup();
    fireEvent.pointerMove(divider, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(divider, { button: 0, clientX: 300, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 0, clientY: 10, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(180);
  });

  it("sizes a bottom panel upwards on the y axis", () => {
    const { divider, onChange } = setup({ axis: "y", value: 230, min: 120, max: 700, label: "Resize panel" });
    expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    fireEvent.pointerDown(divider, { button: 0, clientX: 10, clientY: 500, pointerId: 2 });
    fireEvent.pointerMove(divider, { clientX: 10, clientY: 440, pointerId: 2 });
    expect(onChange).toHaveBeenLastCalledWith(290);
    fireEvent.pointerMove(divider, { clientX: 10, clientY: 1000, pointerId: 2 });
    expect(onChange).toHaveBeenLastCalledWith(120);
    fireEvent.pointerMove(divider, { clientX: 10, clientY: -500, pointerId: 2 });
    expect(onChange).toHaveBeenLastCalledWith(700);
  });

  it("ignores non-primary buttons and locks text selection while dragging", () => {
    const { divider, onChange } = setup();
    fireEvent.pointerDown(divider, { button: 2, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 200, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(divider, { button: 0, clientX: 100, pointerId: 1 });
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerUp(divider, { pointerId: 1 });
    expect(document.body.style.userSelect).toBe("");
  });

  it("supports keyboard resizing with arrows and shift for larger steps", () => {
    const { divider, onChange } = setup();
    divider.focus();
    expect(divider).toHaveFocus();
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(286);
    fireEvent.keyDown(divider, { key: "ArrowLeft", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(206);
    fireEvent.keyDown(divider, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(334);
  });

  it("resizes the y axis with up/down keys and ignores unrelated keys", () => {
    const { divider, onChange } = setup({ axis: "y", value: 300, max: 700 });
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(284);
    onChange.mockClear();
    fireEvent.keyDown(divider, { key: "Enter" });
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resets on double click", () => {
    const { divider, onReset } = setup();
    fireEvent.doubleClick(divider);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("clamps keyboard input at the boundaries", () => {
    const { divider, onChange } = setup({ value: 590, max: 600 });
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(600);
  });
});
