import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultLayout, assignTab } from "./layout";
import { useFileURL } from "./useFileURL";
import type { EditorTab } from "@/components/ide/EditorGroups";

const tab = (path: string): EditorTab => ({ path, name: path, content: "", binary: false, dirty: false });

describe("useFileURL", () => {
  it("opens an initial file that is not in the restored layout", async () => {
    const openFile = vi.fn(async () => undefined);
    const onFileChange = vi.fn();
    renderHook(() =>
      useFileURL({
        initialFile: "src/a.go",
        restoredReady: true,
        activePath: "",
        layout: defaultLayout(),
        tabs: [],
        openFile,
        selectTab: vi.fn(),
        onFileChange,
      }),
    );
    await waitFor(() => expect(openFile).toHaveBeenCalledWith("src/a.go"));
    await waitFor(() => expect(onFileChange).toHaveBeenCalledWith("src/a.go"));
  });

  it("selects an initial file already present in the layout", () => {
    const layout = assignTab(defaultLayout(), "src/a.go");
    const selectTab = vi.fn();
    const onFileChange = vi.fn();
    renderHook(() =>
      useFileURL({
        initialFile: "src/a.go",
        restoredReady: true,
        activePath: "src/a.go",
        layout,
        tabs: [tab("src/a.go")],
        openFile: vi.fn(async () => undefined),
        selectTab,
        onFileChange,
      }),
    );
    expect(selectTab).toHaveBeenCalled();
    expect(onFileChange).toHaveBeenCalledWith("src/a.go");
  });

  it("does nothing before restore completes and syncs after it", () => {
    const onFileChange = vi.fn();
    const { rerender } = renderHook(
      ({ ready }) =>
        useFileURL({
          initialFile: "",
          restoredReady: ready,
          activePath: "src/b.go",
          layout: defaultLayout(),
          tabs: [],
          openFile: vi.fn(async () => undefined),
          selectTab: vi.fn(),
          onFileChange,
        }),
      { initialProps: { ready: false } },
    );
    expect(onFileChange).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(onFileChange).toHaveBeenCalledWith("src/b.go");
  });
});
