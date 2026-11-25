import { beforeEach, describe, expect, it } from "vitest";
import { readEditorSettings, writeEditorSettings } from "./editorSettings";

beforeEach(() => localStorage.clear());

describe("editor settings", () => {
  it("defaults to format on save disabled", () => {
    expect(readEditorSettings()).toEqual({ formatOnSave: false });
  });

  it("persists the format on save toggle", () => {
    writeEditorSettings({ formatOnSave: true });
    expect(readEditorSettings().formatOnSave).toBe(true);
    localStorage.setItem("goland.editor.settings", "{bad");
    expect(readEditorSettings().formatOnSave).toBe(false);
  });
});
