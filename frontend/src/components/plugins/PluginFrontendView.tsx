import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Workspace } from "@/lib/types";
import type { PluginFrontend, WorkspacePlugin } from "@/lib/plugin-types";
import { pluginFrontendAsset } from "@/lib/plugin-api";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";

export interface PluginFrontendApi {
  pluginId: string;
  workspace: Workspace;
  theme: "light" | "dark";
  language: string;
  execute: (
    commandId: string,
    inputs?: Record<string, unknown>,
    options?: { onChunk?: (chunk: string) => void; onRequest?: (requestId: string) => void },
  ) => Promise<{ output: string; requestId: string; result?: unknown }>;
  cancel: (requestId: string) => Promise<void>;
  setStatus: (text: string, kind?: "info" | "success" | "error" | "running") => void;
  notify: (level: "info" | "warning" | "error", message: string) => void;
  openFile: (path: string, line?: number) => void;
}

interface FrontendElement extends HTMLElement {
  api?: PluginFrontendApi;
}

interface FrontendModule {
  default?: CustomElementConstructor;
  tagName?: string;
}

function tagFor(plugin: string, view: string) {
  return `goland-${plugin}-${view}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function PluginFrontendView({
  plugin,
  frontend,
  workspace,
  execute,
  cancel,
  outputs,
  onOpenFile,
  onConfigure,
}: {
  plugin: WorkspacePlugin;
  frontend: PluginFrontend;
  workspace: Workspace;
  execute: (
    pluginId: string,
    commandId: string,
    input?: { inputs?: Record<string, unknown>; requestId?: string },
  ) => Promise<{ requestId: string; output: string; result?: unknown }>;
  cancel: (pluginId: string, requestId: string) => Promise<void>;
  outputs: Record<string, string>;
  onOpenFile?: (path: string, line: number) => void;
  onConfigure?: () => void;
}) {
  const { theme } = useTheme();
  const { language } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const elementRef = useRef<FrontendElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ text: string; kind: "info" | "success" | "error" | "running" }>({
    text: plugin.health === "running" ? "Ready" : plugin.health === "error" ? "Error" : "Idle",
    kind: plugin.health === "running" ? "success" : plugin.health === "error" ? "error" : "info",
  });
  const listenersRef = useRef<Map<string, (chunk: string) => void>>(new Map());
  const outputsRef = useRef<Record<string, string>>(outputs);

  useEffect(() => {
    const previous = outputsRef.current;
    for (const [requestId, value] of Object.entries(outputs)) {
      const old = previous[requestId] ?? "";
      if (value.length > old.length) listenersRef.current.get(requestId)?.(value.slice(old.length));
    }
    outputsRef.current = outputs;
  }, [outputs]);

  const api = useMemo<PluginFrontendApi>(
    () => ({
      pluginId: plugin.id,
      workspace,
      theme,
      language,
      execute: async (commandId, inputs, options) => {
        const requestId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        options?.onRequest?.(requestId);
        if (options?.onChunk) listenersRef.current.set(requestId, options.onChunk);
        try {
          const result = await execute(plugin.id, commandId, { requestId, inputs });
          return { output: result.output, requestId: result.requestId, result: result.result };
        } finally {
          listenersRef.current.delete(requestId);
        }
      },
      cancel: (requestId) => cancel(plugin.id, requestId),
      setStatus: (text, kind = "info") => setStatus({ text, kind }),
      notify: (level, message) => {
        if (level === "error") toast.error(message);
        else if (level === "warning") toast.warning(message);
        else toast.info(message);
      },
      openFile: (path, line) => onOpenFile?.(path, line ?? 1),
    }),
    [plugin.id, workspace, theme, language, execute, cancel, onOpenFile],
  );
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    setLoading(true);
    setError("");
    host.replaceChildren();
    const baseTag = tagFor(plugin.id, frontend.id);
    const tagName = reloadKey ? `${baseTag}-r${reloadKey}` : baseTag;
    const url = `${pluginFrontendAsset(workspace.id, plugin.id, frontend.entry)}${reloadKey ? `?v=${reloadKey}` : ""}`;
    void import(/* @vite-ignore */ url)
      .then((module: FrontendModule) => {
        if (cancelled) return;
        const Constructor = module.default;
        if (!Constructor) throw new Error("Plugin module must default-export a custom element class");
        if (!customElements.get(tagName)) customElements.define(tagName, Constructor);
        const element = document.createElement(tagName) as FrontendElement;
        element.api = apiRef.current;
        elementRef.current = element;
        host.replaceChildren(element);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Could not load plugin frontend");
      });
    return () => {
      cancelled = true;
      elementRef.current = null;
      host.replaceChildren();
    };
  }, [frontend.entry, frontend.id, plugin.id, reloadKey, workspace.id]);

  useEffect(() => {
    if (elementRef.current) elementRef.current.api = api;
  }, [api]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span className="truncate">{frontend.title}</span>
        <span
          className={
            status.kind === "error"
              ? "rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] text-red-400"
              : status.kind === "running"
                ? "rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-400"
                : status.kind === "success"
                  ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-400"
                  : "rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
          }
        >
          {status.text}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {onConfigure && (
            <button className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider hover:bg-accent" onClick={onConfigure}>
              Configure
            </button>
          )}
          <button
            className="rounded p-1 hover:bg-accent"
            title="Reload plugin view"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <RotateCw className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 grid place-items-center p-4 text-center text-xs text-red-400">
            <div>
              <AlertTriangle className="mx-auto mb-2 h-5 w-5" />
              {error}
            </div>
          </div>
        )}
        <div ref={hostRef} className="h-full min-h-0" data-testid={`plugin-frontend-${plugin.id}-${frontend.id}`} />
      </div>
    </div>
  );
}
