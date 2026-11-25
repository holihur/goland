export interface Draft {
  content: string;
  etag?: string;
  updatedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function draftKey(userId: string, workspaceId: string, path: string) {
  return `goland.draft.${userId}.${workspaceId}.${encodeURIComponent(path)}`;
}

export function readDraft(userId: string, workspaceId: string, path: string): Draft | null {
  const raw = storage()?.getItem(draftKey(userId, workspaceId, path));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Draft>;
    if (typeof value.content !== "string" || typeof value.updatedAt !== "number") return null;
    return {
      content: value.content,
      etag: typeof value.etag === "string" ? value.etag : undefined,
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

export function writeDraft(userId: string, workspaceId: string, path: string, content: string, etag?: string) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      draftKey(userId, workspaceId, path),
      JSON.stringify({ content, etag, updatedAt: Date.now() } satisfies Draft),
    );
  } catch {
    // Quota or private-mode failures must not break editing.
  }
}

export function clearDraft(userId: string, workspaceId: string, path: string) {
  try {
    storage()?.removeItem(draftKey(userId, workspaceId, path));
  } catch {
    // ignore storage failures
  }
}
