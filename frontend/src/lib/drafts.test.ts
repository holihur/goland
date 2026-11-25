import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, draftKey, readDraft, writeDraft } from "./drafts";

beforeEach(() => {
  localStorage.clear();
});

describe("drafts", () => {
  it("stores, reads and clears a workspace draft", () => {
    writeDraft("u1", "w1", "src/main.go", "hello", "etag-1");
    const draft = readDraft("u1", "w1", "src/main.go");
    expect(draft?.content).toBe("hello");
    expect(draft?.etag).toBe("etag-1");
    expect(draft?.updatedAt).toBeTypeOf("number");
    expect(draftKey("u1", "w1", "src/main.go")).toContain("src%2Fmain.go");
    clearDraft("u1", "w1", "src/main.go");
    expect(readDraft("u1", "w1", "src/main.go")).toBeNull();
  });

  it("isolates users, workspaces and ignores corrupt values", () => {
    writeDraft("u1", "w1", "a.go", "one");
    expect(readDraft("u2", "w1", "a.go")).toBeNull();
    expect(readDraft("u1", "w2", "a.go")).toBeNull();
    localStorage.setItem(draftKey("u1", "w1", "broken.go"), "{not-json");
    expect(readDraft("u1", "w1", "broken.go")).toBeNull();
    localStorage.setItem(draftKey("u1", "w1", "shape.go"), JSON.stringify({ content: 1 }));
    expect(readDraft("u1", "w1", "empty.go")).toBeNull();
  });
});
