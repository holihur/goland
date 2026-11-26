import { beforeEach, describe, expect, it } from "vitest";
import {
  associationTarget,
  defaultViewerForPath,
  loadFileAssociations,
  normalizeAssociationTarget,
  saveFileAssociations,
  viewerForPath,
} from "./fileAssociations";

describe("file associations", () => {
  beforeEach(() => localStorage.clear());

  it("infers extension and filename targets", () => {
    expect(associationTarget("assets/photo.PNG")).toBe(".png");
    expect(associationTarget("Dockerfile")).toBe("dockerfile");
    expect(associationTarget("archive.tar.gz")).toBe(".gz");
    expect(normalizeAssociationTarget(".svg")).toBe(".svg");
    expect(normalizeAssociationTarget("Dockerfile")).toBe("dockerfile");
    expect(normalizeAssociationTarget("../bad")).toBeNull();
  });

  it("maps images and PDFs by default and everything else to code", () => {
    expect(defaultViewerForPath("a.png")).toBe("image");
    expect(defaultViewerForPath("a.SVG")).toBe("image");
    expect(defaultViewerForPath("a.pdf")).toBe("pdf");
    expect(defaultViewerForPath("a.go")).toBe("code");
  });

  it("applies overrides for extensions and filenames", () => {
    expect(viewerForPath("a.pdf", { ".pdf": "code" })).toBe("code");
    expect(viewerForPath("Dockerfile", { dockerfile: "pdf" })).toBe("pdf");
  });

  it("persists overrides per user", () => {
    saveFileAssociations("u1", { ".foo": "image" });
    expect(loadFileAssociations("u1")).toEqual({ ".foo": "image" });
    expect(loadFileAssociations("u2")).toEqual({});
    localStorage.setItem("goland.fileAssociations.u1", "{bad");
    expect(loadFileAssociations("u1")).toEqual({});
  });
});
