import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  assignTab,
  defaultLayout,
  splitGroup,
  moveTab,
  type LayoutState,
} from "@/lib/layout";
import { EditorGroups, type EditorTab } from "./EditorGroups";

function makeTabs(paths: string[], dirty: string[] = []): EditorTab[] {
  return paths.map((path) => ({
    path,
    name: path.split("/").pop() ?? path,
    content: `content:${path}`,
    binary: false,
    dirty: dirty.includes(path),
  }));
}

function makeLayout(): LayoutState {
  let layout = defaultLayout();
  layout = assignTab(layout, "a.go");
  layout = assignTab(layout, "b.go");
  layout = splitGroup(layout, "right", "group-2");
  layout = moveTab(layout, "b.go", "group-2");
  return layout;
}

function setup(overrides: Partial<Parameters<typeof EditorGroups>[0]> = {}) {
  const props = {
    layout: makeLayout(),
    compact: false,
    tabs: makeTabs(["a.go", "b.go"], ["a.go"]),
    savingPath: "",
    renderEditor: (path: string) => <div data-testid={`editor-${path}`}>editor:{path}</div>,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onSave: vi.fn(),
    onActivateGroup: vi.fn(),
    onSplit: vi.fn(),
    onCloseGroup: vi.fn(),
    onMoveTab: vi.fn(),
    ...overrides,
  };
  const view = render(<EditorGroups {...props} />);
  return { ...props, ...view };
}

function drag(tab: HTMLElement, group: HTMLElement, distance = 30) {
  fireEvent.pointerDown(tab, { button: 0, clientX: 0, clientY: 0 });
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: distance, clientY: 0 }));
  });
  fireEvent.pointerEnter(group);
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: distance, clientY: 0 }));
  });
}

describe("EditorGroups", () => {
  it("renders one section per group with the active group highlighted", () => {
    setup();
    const sections = screen.getAllByRole("region").filter((node) => node.hasAttribute("data-editor-group"));
    expect(sections).toHaveLength(2);
    const first = document.querySelector('[data-editor-group="group-1"]');
    const second = document.querySelector('[data-editor-group="group-2"]');
    expect(first).toHaveAttribute("data-active", "false");
    expect(second).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("editor-a.go")).toBeInTheDocument();
    expect(screen.getByTestId("editor-b.go")).toBeInTheDocument();
  });

  it("selects, closes and middle-clicks tabs", () => {
    const props = setup();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[0]);
    expect(props.onSelectTab).toHaveBeenCalledWith("a.go");
    fireEvent.click(screen.getByRole("button", { name: "Close a.go" }));
    expect(props.onCloseTab).toHaveBeenCalledWith("a.go");
    fireEvent(screen.getByTitle("b.go"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(props.onCloseTab).toHaveBeenCalledWith("b.go");
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
  });

  it("activates a group on pointer down", () => {
    const props = setup();
    fireEvent.pointerDown(document.querySelector('[data-editor-group="group-1"]')!);
    expect(props.onActivateGroup).toHaveBeenCalledWith("group-1");
  });

  it("splits right and down from the toolbar", () => {
    const props = setup();
    fireEvent.click(screen.getAllByRole("button", { name: "Split editor right" })[0]);
    expect(props.onSplit).toHaveBeenCalledWith("right");
    fireEvent.click(screen.getAllByRole("button", { name: "Split editor down" })[0]);
    expect(props.onSplit).toHaveBeenCalledWith("down");
  });

  it("closes a group only when more than one exists", () => {
    const props = setup();
    fireEvent.click(screen.getAllByRole("button", { name: "Close editor group" })[1]);
    expect(props.onCloseGroup).toHaveBeenCalledWith("group-2");
    props.unmount();

    setup({ layout: defaultLayout(), tabs: makeTabs(["a.go"]) });
    expect(screen.queryAllByRole("button", { name: "Close editor group" })).toHaveLength(0);
  });

  it("saves the active tab of each group and shows a spinner", () => {
    const props = setup({ savingPath: "b.go", tabs: makeTabs(["a.go", "b.go"], ["a.go", "b.go"]) });
    const saveButtons = screen.getAllByRole("button", { name: "Save file" });
    fireEvent.click(saveButtons[1]);
    expect(props.onSave).toHaveBeenCalledWith("b.go");
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("disables save for clean tabs", () => {
    setup({ tabs: makeTabs(["a.go", "b.go"]) });
    for (const button of screen.getAllByRole("button", { name: "Save file" })) {
      expect(button).toBeDisabled();
    }
  });

  it("moves a dragged tab to the group under the pointer", () => {
    const props = setup();
    const tabs = screen.getAllByRole("tab");
    const target = document.querySelector('[data-editor-group="group-2"]') as HTMLElement;
    drag(tabs[0], target);
    expect(props.onMoveTab).toHaveBeenCalledWith("a.go", "group-2");
  });

  it("ignores tiny pointer movements and drops on the same group", () => {
    const props = setup();
    const tabs = screen.getAllByRole("tab");
    const target = document.querySelector('[data-editor-group="group-1"]') as HTMLElement;
    drag(tabs[0], target, 2);
    expect(props.onMoveTab).not.toHaveBeenCalled();

    const other = document.querySelector('[data-editor-group="group-2"]') as HTMLElement;
    fireEvent.pointerDown(tabs[1], { button: 0, clientX: 0, clientY: 0 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 40, clientY: 0 }));
    });
    fireEvent.pointerEnter(other);
    expect(other).toHaveAttribute("data-drop-target", "true");
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 40, clientY: 0 }));
    });
    expect(props.onMoveTab).not.toHaveBeenCalled();
    expect(other).toHaveAttribute("data-drop-target", "false");
  });

  it("cancels a drag without moving", () => {
    const props = setup();
    const tabs = screen.getAllByRole("tab");
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 0, clientY: 0 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 40, clientY: 0 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointercancel", { clientX: 40, clientY: 0 }));
    });
    expect(props.onMoveTab).not.toHaveBeenCalled();
  });

  it("degrades to the active group only on narrow viewports", () => {
    setup({ compact: true });
    const groups = document.querySelectorAll("[data-editor-group]");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAttribute("data-editor-group", "group-2");
    expect(screen.queryByRole("button", { name: "Split editor right" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close editor group" })).toBeNull();
  });

  it("renders plugin editor actions for the active tab", async () => {
    const onSelect = vi.fn();
    setup({ editorActions: [{ id: "demo.action", title: "Demo: Format", onSelect }] });
    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Editor actions" })[1], { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("Demo: Format"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows a placeholder for an empty group", () => {
    let layout = defaultLayout();
    layout = splitGroup(layout, "right", "group-2");
    setup({ layout, tabs: makeTabs([]) });
    expect(screen.getAllByText(/No open editors in this group/)).toHaveLength(2);
  });
});
