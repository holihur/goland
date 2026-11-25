/**
 * Minimal Markdown renderer for LSP hover popovers. It builds DOM nodes
 * instead of HTML strings so language-server comments cannot inject markup.
 */
function inlineNodes(text: string): Node[] {
  const nodes: Node[] = [];
  let index = 0;
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push(document.createTextNode(buffer));
    buffer = "";
  };
  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index) {
        flush();
        const code = document.createElement("code");
        code.textContent = text.slice(index + 1, end);
        nodes.push(code);
        index = end + 1;
        continue;
      }
    }
    if (text.startsWith("**", index) || text.startsWith("__", index)) {
      const marker = text.slice(index, index + 2);
      const end = text.indexOf(marker, index + 2);
      if (end > index + 2) {
        flush();
        const strong = document.createElement("strong");
        strong.append(...inlineNodes(text.slice(index + 2, end)));
        nodes.push(strong);
        index = end + 2;
        continue;
      }
    }
    if (text[index] === "*" || text[index] === "_") {
      const marker = text[index];
      const end = text.indexOf(marker, index + 1);
      if (end > index + 1) {
        flush();
        const emphasis = document.createElement("em");
        emphasis.append(...inlineNodes(text.slice(index + 1, end)));
        nodes.push(emphasis);
        index = end + 1;
        continue;
      }
    }
    if (text[index] === "[") {
      const close = text.indexOf("]", index + 1);
      if (close > index && text[close + 1] === "(") {
        const end = text.indexOf(")", close + 2);
        if (end > close) {
          const label = text.slice(index + 1, close);
          const href = text.slice(close + 2, end).trim();
          if (/^(https?:|mailto:)/i.test(href)) {
            flush();
            const link = document.createElement("a");
            link.href = href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.append(...inlineNodes(label));
            nodes.push(link);
            index = end + 1;
            continue;
          }
        }
      }
    }
    buffer += text[index];
    index++;
  }
  flush();
  return nodes;
}

export function markdownNodes(markdown: string): Node[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nodes: Node[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        code.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      const pre = document.createElement("pre");
      const block = document.createElement("code");
      if (language) block.className = `language-${language}`;
      block.textContent = code.join("\n");
      pre.append(block);
      nodes.push(pre);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const element = document.createElement("div");
      element.className = `cm-md-heading cm-md-h${heading[1].length}`;
      element.append(...inlineNodes(heading[2]));
      nodes.push(element);
      index++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        const item = document.createElement("li");
        item.append(...inlineNodes(lines[index].replace(/^\s*[-*+]\s+/, "")));
        list.append(item);
        index++;
      }
      nodes.push(list);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const list = document.createElement("ol");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = document.createElement("li");
        item.append(...inlineNodes(lines[index].replace(/^\s*\d+\.\s+/, "")));
        list.append(item);
        index++;
      }
      nodes.push(list);
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      nodes.push(document.createElement("hr"));
      index++;
      continue;
    }
    const paragraph = document.createElement("div");
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trimStart().startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[index]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[index])
    ) {
      if (paragraph.childNodes.length > 0) paragraph.append(document.createElement("br"));
      paragraph.append(...inlineNodes(lines[index]));
      index++;
    }
    nodes.push(paragraph);
  }
  return nodes;
}
