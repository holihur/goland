export interface EditorSettings {
  formatOnSave: boolean;
}

const STORAGE_KEY = "goland.editor.settings";

export function readEditorSettings(): EditorSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<EditorSettings>) : {};
    return { formatOnSave: parsed.formatOnSave === true };
  } catch {
    return { formatOnSave: false };
  }
}

export function writeEditorSettings(settings: EditorSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage failures
  }
}
