import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PluginField } from "@/lib/plugin-types";
import { PluginFieldInput } from "./PluginFieldInput";

function renderField(field: PluginField, value?: unknown) {
  const onChange = vi.fn();
  render(<PluginFieldInput field={field} value={value} onChange={onChange} />);
  return onChange;
}

describe("PluginFieldInput", () => {
  it("renders text and textarea fields", () => {
    const text = renderField({ key: "name", type: "text", label: "Name", placeholder: "demo", required: true }, "x");
    const input = screen.getByLabelText(/Name/);
    expect(input).toHaveValue("x");
    expect(input).toHaveAttribute("placeholder", "demo");
    fireEvent.change(input, { target: { value: "next" } });
    expect(text).toHaveBeenCalledWith("next");

    const notes = renderField({ key: "notes", type: "textarea", label: "Notes", help: "free text" }, "body");
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "more" } });
    expect(notes).toHaveBeenCalledWith("more");
    expect(screen.getByText("free text")).toBeInTheDocument();
  });

  it("renders booleans, numbers and selects", () => {
    const bool = renderField({ key: "enabled", type: "boolean", label: "Enabled" }, true);
    fireEvent.click(screen.getByLabelText("Enabled"));
    expect(bool).toHaveBeenCalledWith(false);

    const number = renderField({ key: "level", type: "number", label: "Level", min: 1, max: 9 }, 3);
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "5" } });
    expect(number).toHaveBeenCalledWith(5);
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "" } });
    expect(number).toHaveBeenCalledWith(undefined);

    const select = renderField(
      { key: "mode", type: "select", label: "Mode", options: [{ label: "Fast", value: "fast" }, { label: "Slow", value: "slow" }] },
      "fast",
    );
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "slow" } });
    expect(select).toHaveBeenCalledWith("slow");
    expect(screen.getByRole("option", { name: "Fast" })).toBeInTheDocument();
  });

  it("respects disabled state and missing values", () => {
    const onChange = vi.fn();
    render(<PluginFieldInput field={{ key: "name", type: "text", label: "Name" }} value={undefined} disabled onChange={onChange} />);
    const input = screen.getByLabelText("Name");
    expect(input).toBeDisabled();
    expect(input).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
  });
});
