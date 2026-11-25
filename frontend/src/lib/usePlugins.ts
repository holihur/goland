import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "./api";
import { websocketURL } from "./api";
import { cancelPluginCommand, executePluginCommand, pluginApi, pluginSocket, type PluginCommandInput } from "./plugin-api";
import { pluginConfigDefaults, type PluginConfigValues, type WorkspacePlugin } from "./plugin-types";

export interface PluginStatusState {
  text: string;
  tooltip?: string;
}

export interface PluginPanelState {
  title?: string;
  output: string;
  state: Record<string, unknown>;
}

interface PluginEvent {
  type: string;
  pluginId?: string;
  statusId?: string;
  text?: string;
  tooltip?: string;
  panelId?: string;
  title?: string;
  state?: Record<string, unknown>;
  output?: string;
  level?: string;
  message?: string;
  requestId?: string;
  chunk?: string;
  error?: string;
}

function panelKey(pluginId: string, panelId: string) {
  return `${pluginId}:${panelId}`;
}

function upsertOutput(current: Record<string, string>, requestId: string, chunk: string) {
  const next = (current[requestId] ?? "") + chunk;
  return { ...current, [requestId]: next.length > 400_000 ? next.slice(-320_000) : next };
}

export function usePlugins(workspaceId: string) {
  const [plugins, setPlugins] = useState<WorkspacePlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Record<string, PluginStatusState>>({});
  const [panels, setPanels] = useState<Record<string, PluginPanelState>>({});
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const closedRef = useRef(false);
  const pendingChunksRef = useRef<Record<string, string>>({});
  const chunkTimerRef = useRef<number | null>(null);

  const flushChunks = useCallback(() => {
    if (chunkTimerRef.current !== null) {
      window.clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    const pending = pendingChunksRef.current;
    pendingChunksRef.current = {};
    if (Object.keys(pending).length === 0) return;
    setOutputs((current) => {
      let next = current;
      for (const [requestId, chunk] of Object.entries(pending)) {
        next = upsertOutput(next, requestId, chunk);
      }
      return next;
    });
  }, []);

  const queueChunk = useCallback(
    (requestId: string, chunk: string) => {
      if (!chunk) return;
      pendingChunksRef.current[requestId] = (pendingChunksRef.current[requestId] ?? "") + chunk;
      if (chunkTimerRef.current === null) {
        chunkTimerRef.current = window.setTimeout(flushChunks, 16);
      }
    },
    [flushChunks],
  );

  const applyPlugins = useCallback((list: WorkspacePlugin[]) => {
    setPlugins(list);
    const nextStatus: Record<string, PluginStatusState> = {};
    const nextPanels: Record<string, PluginPanelState> = {};
    for (const plugin of list) {
      if (!plugin.enabled || !plugin.manifest) continue;
      for (const item of plugin.manifest.contributes.status ?? []) {
        nextStatus[`${plugin.id}:${item.id}`] = { text: item.text, tooltip: item.tooltip };
      }
      for (const panel of plugin.manifest.contributes.panels ?? []) {
        const key = panelKey(plugin.id, panel.id);
        nextPanels[key] = nextPanels[key] ?? { output: "", state: {} };
      }
    }
    setStatus(nextStatus);
    setPanels((current) => {
      const merged: Record<string, PluginPanelState> = { ...nextPanels };
      for (const [key, value] of Object.entries(current)) {
        if (merged[key]) merged[key] = value;
      }
      return merged;
    });
  }, []);

  const reload = useCallback(async () => {
    try {
      const result = await pluginApi.listWorkspace(workspaceId);
      applyPlugins(result.plugins);
      setPluginErrors((current) => {
        const next = { ...current };
        for (const plugin of result.plugins) {
          if (plugin.health === "running" || plugin.health === "stopped") delete next[plugin.id];
        }
        return next;
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load plugins");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, applyPlugins]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onChanged = () => void reload();
    window.addEventListener("goland:plugins-changed", onChanged);
    return () => window.removeEventListener("goland:plugins-changed", onChanged);
  }, [reload]);

  useEffect(() => {
    closedRef.current = false;
    const connect = () => {
      const socket = new WebSocket(websocketURL(pluginSocket(workspaceId)));
      socketRef.current = socket;
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message: PluginEvent;
        try {
          message = JSON.parse(event.data) as PluginEvent;
        } catch {
          return;
        }
        const pluginId = message.pluginId ?? "";
        if (message.type === "status" && message.statusId) {
          setStatus((current) => ({
            ...current,
            [`${pluginId}:${message.statusId}`]: { text: message.text ?? "", tooltip: message.tooltip },
          }));
        } else if (message.type === "panel" && message.panelId) {
          const key = panelKey(pluginId, message.panelId);
          setPanels((current) => ({
            ...current,
            [key]: {
              title: message.title ?? current[key]?.title,
              output: message.output ?? current[key]?.output ?? "",
              state: { ...(current[key]?.state ?? {}), ...(message.state ?? {}) },
            },
          }));
        } else if (message.type === "output" && message.requestId) {
          queueChunk(message.requestId, message.chunk ?? "");
        } else if (message.type === "notify" || message.type === "log") {
          if (!message.message) return;
          if (message.level === "error") toast.error(message.message);
          else if (message.level === "warning" || message.level === "warn") toast.warning(message.message);
          else toast.info(message.message);
        } else if (message.type === "crashed") {
          setPluginErrors((current) => ({ ...current, [pluginId]: message.error ?? "Plugin crashed" }));
          toast.error(`${pluginId || "Plugin"} crashed: ${message.error ?? "unknown error"}`);
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
        if (closedRef.current) return;
        retryRef.current = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closedRef.current = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [workspaceId, queueChunk]);

  useEffect(() => {
    return () => {
      if (chunkTimerRef.current !== null) window.clearTimeout(chunkTimerRef.current);
    };
  }, []);

  const execute = useCallback(
    async (
      pluginId: string,
      commandId: string,
      input: PluginCommandInput = {},
    ): Promise<{ requestId: string; output: string; result?: unknown }> => {
      const requestId =
        input.requestId ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      setOutputs((current) => ({ ...current, [requestId]: current[requestId] ?? "" }));
      try {
        const result = await executePluginCommand(workspaceId, pluginId, commandId, { ...input, requestId });
        flushChunks();
        setOutputs((current) => ({
          ...current,
          [requestId]: result.output && result.output.length >= (current[requestId]?.length ?? 0)
            ? result.output
            : current[requestId] ?? result.output ?? "",
        }));
        return { requestId, output: result.output ?? "", result: result.result };
      } catch (err) {
        flushChunks();
        const message = err instanceof ApiError ? err.message : "Plugin command failed";
        setOutputs((current) => ({ ...current, [requestId]: (current[requestId] ?? "") + `\n[error] ${message}` }));
        throw err;
      }
    },
    [workspaceId, flushChunks],
  );

  const cancel = useCallback(
    async (pluginId: string, requestId: string) => {
      try {
        await cancelPluginCommand(workspaceId, pluginId, requestId);
      } catch {
        // The command may have completed between the click and the request.
      }
    },
    [workspaceId],
  );

  const enabled = plugins.filter((plugin) => plugin.enabled && plugin.manifest);
  return { plugins, enabled, loading, status, panels, outputs, pluginErrors, reload, execute, cancel };
}

export function pluginSettings(plugin: WorkspacePlugin): PluginConfigValues {
  return pluginConfigDefaults(plugin);
}
