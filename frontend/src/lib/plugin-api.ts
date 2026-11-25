import { request, websocketURL } from "./api";
import type { InstalledPlugin, PluginConfigValues, WorkspacePlugin } from "./plugin-types";

export const pluginApi = {
  listAdmin() {
    return request<{ plugins: InstalledPlugin[] }>("/api/admin/plugins");
  },
  installFromPath(path: string) {
    return request<{ plugin: InstalledPlugin }>("/api/admin/plugins", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },
  upload(file: File) {
    const body = new FormData();
    body.append("package", file);
    return request<{ plugin: InstalledPlugin }>("/api/admin/plugins/upload", { method: "POST", body });
  },
  uninstall(pluginId: string) {
    return request<void>(`/api/admin/plugins/${encodeURIComponent(pluginId)}`, { method: "DELETE" });
  },
  listWorkspace(workspaceId: string) {
    return request<{ plugins: WorkspacePlugin[] }>(`/api/workspaces/${workspaceId}/plugins`);
  },
  updateWorkspace(workspaceId: string, pluginId: string, input: { enabled: boolean; config?: PluginConfigValues }) {
    return request<{ plugin: WorkspacePlugin }>(
      `/api/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}`,
      { method: "PUT", body: JSON.stringify(input) },
    );
  },
  removeWorkspace(workspaceId: string, pluginId: string) {
    return request<void>(`/api/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}`, {
      method: "DELETE",
    });
  },
};

export function pluginFrontendAsset(workspaceId: string, pluginId: string, entry: string) {
  const path = entry
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(pluginId)}/frontend/${path}`;
}

export function pluginSocket(workspaceId: string) {
  return `/api/ws/workspaces/${workspaceId}/plugins`;
}

export function pluginLSPPath(workspaceId: string, pluginId: string, serverId: string) {
  return `/api/ws/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}/lsp/${encodeURIComponent(serverId)}`;
}

export function pluginDAPPath(workspaceId: string, pluginId: string, kind: string) {
  return `/api/ws/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}/debug/${encodeURIComponent(kind)}`;
}

export interface PluginCommandInput {
  requestId?: string;
  args?: string[];
  inputs?: Record<string, unknown>;
  path?: string;
  selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number; text?: string };
}

export async function executePluginCommand(
  workspaceId: string,
  pluginId: string,
  commandId: string,
  input: PluginCommandInput = {},
) {
  return request<{ requestId: string; commandId: string; output?: string; result?: unknown }>(
    `/api/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}/commands/${encodeURIComponent(commandId)}`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function cancelPluginCommand(workspaceId: string, pluginId: string, requestId: string) {
  return request<void>(`/api/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ requestId }),
  });
}

export function pluginLspSocket(workspaceId: string, pluginId: string, serverId: string) {
  return websocketURL(pluginLSPPath(workspaceId, pluginId, serverId));
}

export function pluginDapSocket(workspaceId: string, pluginId: string, kind: string) {
  return websocketURL(pluginDAPPath(workspaceId, pluginId, kind));
}
