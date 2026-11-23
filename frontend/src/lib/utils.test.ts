import { afterEach, describe, expect, it, vi } from "vitest";
import { cn, fileLanguage, formatBytes, relativeTime } from "./utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatBytes", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("fileLanguage", () => {
  it("recognises first-class languages", () => {
    expect(fileLanguage("cmd/server/main.go")).toBe("Go");
    expect(fileLanguage("src/app.ts")).toBe("TypeScript");
    expect(fileLanguage("src/app.tsx")).toBe("TypeScript");
    expect(fileLanguage("web/server.js")).toBe("JavaScript");
    expect(fileLanguage("web/server.jsx")).toBe("JavaScript");
    expect(fileLanguage("config.json")).toBe("JSON");
    expect(fileLanguage("README.md")).toBe("Markdown");
    expect(fileLanguage("styles.css")).toBe("CSS");
    expect(fileLanguage("index.html")).toBe("HTML");
    expect(fileLanguage("Dockerfile")).toBe("Dockerfile");
    expect(fileLanguage("archive.tar")).toBe("TAR");
    expect(fileLanguage("LICENSE")).toBe("LICENSE");
  });
});

describe("relativeTime", () => {
  it("formats recent and older timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
    expect(relativeTime("2026-01-02T11:59:40Z")).toBe("just now");
    expect(relativeTime("2026-01-02T11:30:00Z")).toBe("30m ago");
    expect(relativeTime("2026-01-02T06:00:00Z")).toBe("6h ago");
    expect(relativeTime("2025-12-30T12:00:00Z")).toBe("3d ago");
  });
});

describe("cn", () => {
  it("merges conditional and conflicting classes", () => {
    expect(cn("px-2", undefined, "px-4", ["text-sm"])).toBe("px-4 text-sm");
  });
});
