export type ViewerKind = "code" | "image" | "pdf";

export interface FileAssociationOverrides {
  [target: string]: ViewerKind;
}

export const IMAGE_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg", ".avif", ".tif", ".tiff",
];

export const PDF_EXTENSIONS = [".pdf"];

const IMAGE_SET = new Set(IMAGE_EXTENSIONS);
const PDF_SET = new Set(PDF_EXTENSIONS);
const STORAGE_PREFIX = "goland.fileAssociations.";

export function associationTarget(path: string): string {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : name;
}

export function normalizeAssociationTarget(value: string): string | null {
  const target = value.trim().toLowerCase();
  if (!target || target.length > 80) return null;
  if (target.startsWith(".")) return /^\.[a-z0-9][a-z0-9.+-]*$/.test(target) ? target : null;
  return /^[a-z0-9][a-z0-9._+-]*$/.test(target) ? target : null;
}

export function defaultViewerForPath(path: string): ViewerKind {
  const target = associationTarget(path);
  if (PDF_SET.has(target)) return "pdf";
  if (IMAGE_SET.has(target)) return "image";
  return "code";
}

export function viewerForPath(path: string, overrides: FileAssociationOverrides): ViewerKind {
  return overrides[associationTarget(path)] ?? defaultViewerForPath(path);
}

export function viewerLabel(viewer: ViewerKind): string {
  return viewer === "image" ? "Image viewer" : viewer === "pdf" ? "PDF viewer" : "Code editor";
}

export function loadFileAssociations(userId: string): FileAssociationOverrides {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: FileAssociationOverrides = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const target = normalizeAssociationTarget(key);
      if (!target || (value !== "code" && value !== "image" && value !== "pdf")) continue;
      result[target] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveFileAssociations(userId: string, overrides: FileAssociationOverrides) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(overrides));
  } catch {
    // ignore storage failures
  }
}
