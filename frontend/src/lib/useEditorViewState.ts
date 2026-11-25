import { useRef } from "react";

export function useEditorViewState(
  activePath: string,
  setCursorLine: (line: number) => void,
  setCursorColumn: (column: number) => void,
) {
  const viewStateRef = useRef<Record<string, { line: number; scrollTop: number }>>({});

  const rememberCursor = (path: string, line: number, column: number) => {
    const current = viewStateRef.current[path] ?? { line: 1, scrollTop: 0 };
    viewStateRef.current[path] = { ...current, line };
    if (path === activePath) {
      setCursorLine(line);
      setCursorColumn(column);
    }
  };

  const rememberScroll = (path: string, scrollTop: number) => {
    const current = viewStateRef.current[path] ?? { line: 1, scrollTop: 0 };
    viewStateRef.current[path] = { ...current, scrollTop };
  };

  return { viewStateRef, rememberCursor, rememberScroll };
}
