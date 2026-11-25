import { describe, expect, it } from "vitest";
import { applyTextEdits } from "./workspaceEdit";

describe("applyTextEdits", () => {
  it("applies multiple edits from the bottom up", () => {
    const text = "func Foo() {\n\treturn Foo()\n}\n";
    const next = applyTextEdits(text, [
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } }, newText: "Bar" },
      { range: { start: { line: 1, character: 8 }, end: { line: 1, character: 11 } }, newText: "Bar" },
    ]);
    expect(next).toBe("func Bar() {\n\treturn Bar()\n}\n");
  });

  it("handles insertions, deletions and missing lines", () => {
    expect(
      applyTextEdits("abc", [
        { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, newText: "" },
      ]),
    ).toBe("ac");
    expect(
      applyTextEdits("abc", [
        { range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } }, newText: "!" },
      ]),
    ).toBe("abc!");
  });
});
