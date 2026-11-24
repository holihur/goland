export type PluginFieldType = "text" | "textarea" | "boolean" | "number" | "select";

export interface PluginOption {
  label: string;
  value: string;
}

export interface PluginField {
  key: string;
  type: PluginFieldType;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  default?: unknown;
  options?: PluginOption[];
  min?: number;
  max?: number;
}

export interface PluginCommand {
  id: string;
  title: string;
  description?: string;
  args?: string[];
}

export interface PluginPanelAction {
  id: string;
  label: string;
  command: string;
  args?: Record<string, unknown>;
}

export interface PluginPanel {
  id: string;
  title: string;
  icon?: string;
  fields?: PluginField[];
  actions?: PluginPanelAction[];
}

export interface PluginStatusItem {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
}

export interface PluginSettingsView {
  id: string;
  title: string;
  fields: PluginField[];
}

export interface PluginHook {
  command: string;
  failure?: "open" | "closed";
}

export interface PluginEditorAction {
  id: string;
  title: string;
  command: string;
}

export interface PluginLanguage {
  id: string;
  extensions: string[];
  languageId: string;
  server: { command: string; args?: string[]; transport?: string };
}

export interface PluginDebugger {
  kind: string;
  label: string;
  server: { command: string; args?: string[]; transport?: string };
}

export interface PluginContributions {
  commands?: PluginCommand[];
  panels?: PluginPanel[];
  status?: PluginStatusItem[];
  settings?: PluginSettingsView[];
  hooks?: {
    onOpen?: PluginHook;
    onSave?: PluginHook;
    preCommit?: PluginHook;
    postPull?: PluginHook;
  };
  editorActions?: PluginEditorAction[];
  languages?: PluginLanguage[];
  debuggers?: PluginDebugger[];
}

export interface PluginManifest {
  apiVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  executable: string;
  contributes: PluginContributions;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  installedAt: string;
  manifest: PluginManifest | null;
}

export interface WorkspacePlugin extends InstalledPlugin {
  enabled: boolean;
  config: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  health?: "running" | "stopped" | "error";
  lastError?: string;
}

export interface PluginConfigValues {
  [key: string]: unknown;
}

export function pluginConfigDefaults(plugin: WorkspacePlugin): PluginConfigValues {
  return { ...(plugin.defaults ?? {}), ...(plugin.config ?? {}) };
}
