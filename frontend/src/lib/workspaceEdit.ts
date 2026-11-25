import type { TextEdit } from "./lsp";

function offsetAt(text: string, line: number, character: number) {
  let offset = 0;
  for (let index = 0; index < line; index++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + character, text.length);
}

export function applyTextEdits(text: string, edits: TextEdit[]) {
  const ordered = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  let next = text;
  for (const edit of ordered) {
    const from = offsetAt(next, edit.range.start.line, edit.range.start.character);
    const to = offsetAt(next, edit.range.end.line, edit.range.end.character);
    if (to < from) continue;
    next = next.slice(0, from) + edit.newText + next.slice(to);
  }
  return next;
}
