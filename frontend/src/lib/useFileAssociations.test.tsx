import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useFileAssociations } from "./useFileAssociations";

describe("useFileAssociations", () => {
  beforeEach(() => localStorage.clear());

  it("resolves, updates, removes and resets associations", () => {
    const { result } = renderHook(() => useFileAssociations("u1"));
    expect(result.current.viewerFor("a.png")).toBe("image");
    expect(result.current.viewerFor("a.go")).toBe("code");
    act(() => result.current.setAssociation(".go", "image"));
    expect(result.current.viewerFor("a.go")).toBe("image");
    expect(JSON.parse(localStorage.getItem("goland.fileAssociations.u1") ?? "{}")).toEqual({ ".go": "image" });
    act(() => result.current.removeAssociation(".go"));
    expect(result.current.viewerFor("a.go")).toBe("code");
    act(() => result.current.setAssociation(".pdf", "code"));
    act(() => result.current.resetAssociations());
    expect(result.current.overrides).toEqual({});
  });
});
