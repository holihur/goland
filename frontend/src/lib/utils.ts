import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function relativeTime(value: string) {
  const date = new Date(value);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function fileLanguage(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const name = path.split("/").pop() ?? path;
  if (ext === "go") return "Go";
  if (ext === "ts" || ext === "tsx") return "TypeScript";
  if (ext === "js" || ext === "jsx") return "JavaScript";
  if (ext === "json") return "JSON";
  if (ext === "md") return "Markdown";
  if (ext === "css") return "CSS";
  if (ext === "html") return "HTML";
  if (name === "Dockerfile") return "Dockerfile";
  return ext ? ext.toUpperCase() : "Plain text";
}
