import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "goland.breakpoints";

function loadBreakpoints(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, number[]>;
  } catch {
    return {};
  }
}

export function useBreakpoints() {
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>(loadBreakpoints);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(breakpoints));
  }, [breakpoints]);

  const toggleBreakpoint = useCallback((path: string, line: number) => {
    setBreakpoints((current) => {
      const next = { ...current };
      const lines = new Set(next[path] ?? []);
      if (lines.has(line)) lines.delete(line);
      else lines.add(line);
      if (lines.size) next[path] = [...lines].sort((a, b) => a - b);
      else delete next[path];
      return next;
    });
  }, []);

  return { breakpoints, setBreakpoints, toggleBreakpoint };
}
