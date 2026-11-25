import { describe, expect, it } from "vitest";
import { markdownNodes } from "./markdown";

function render(markdown: string) {
  const host = document.createElement("div");
  host.append(...markdownNodes(markdown));
  return host;
}

describe("markdownNodes", () => {
  it("renders code fences and inline code", () => {
    const host = render("```go\nfunc greet() string\n```\n\nUse `greet()` here.");
    expect(host.querySelector("pre code")?.textContent).toBe("func greet() string");
    expect(host.querySelector("pre code")?.className).toBe("language-go");
    expect(host.querySelector("p, div")?.textContent).toContain("Use greet() here.");
    expect(host.querySelector("code:not(pre code)")?.textContent).toBe("greet()");
  });

  it("renders headings, lists, emphasis and safe links", () => {
    const host = render("# Title\n\n**bold** and *em*\n\n- one\n- two\n\n1. first\n2. second\n\n[docs](https://example.com) [bad](javascript:alert(1))");
    expect(host.querySelector(".cm-md-heading")?.textContent).toBe("Title");
    expect(host.querySelector("strong")?.textContent).toBe("bold");
    expect(host.querySelector("em")?.textContent).toBe("em");
    expect(host.querySelectorAll("ul li")).toHaveLength(2);
    expect(host.querySelectorAll("ol li")).toHaveLength(2);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(host.querySelectorAll("a")).toHaveLength(1);
    expect(host.textContent).toContain("javascript:alert(1)");
  });

  it("preserves meaningful line breaks in plain paragraphs", () => {
    const host = render("line one\nline two");
    expect(host.querySelectorAll("br")).toHaveLength(1);
    expect(host.textContent).toBe("line oneline two");
  });
});
