import { describe, expect, it } from "vitest";
import { fileLanguage, formatBytes } from "./utils";

describe("formatBytes", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("fileLanguage", () => {
  it("recognises first-class languages", () => {
    expect(fileLanguage("cmd/server/main.go")).toBe("Go");
    expect(fileLanguage("src/app.tsx")).toBe("TypeScript");
    expect(fileLanguage("web/server.js")).toBe("JavaScript");
    expect(fileLanguage("config.json")).toBe("JSON");
  });
});
