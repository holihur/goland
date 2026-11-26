import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { Workspace } from "@/lib/types";
import type { PluginFrontend, WorkspacePlugin } from "@/lib/plugin-types";
import { pluginFrontendAsset } from "@/lib/plugin-api";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { pluginIcon } from "@/lib/plugin-icons";
import { cn } from "@/lib/utils";

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
  configure: () => void;
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
  runtimeStatus,
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
  runtimeStatus?: { text: string; tooltip?: string };
}) {
  const { theme } = useTheme();
  const { language } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const elementRef = useRef<FrontendElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [localStatus, setLocalStatus] = useState<{
    text: string;
    kind: "info" | "success" | "error" | "running";
  } | null>(null);
  const meaningfulRuntime = runtimeStatus && runtimeStatus.text.trim() !== plugin.name ? runtimeStatus : undefined;
  const runtimeKind: "info" | "success" | "error" | "running" | null = meaningfulRuntime
    ? /fail|error/i.test(meaningfulRuntime.text)
      ? "error"
      : /working|running|loading|starting/i.test(meaningfulRuntime.text)
        ? "running"
        : /ready|loaded|finished|answered|ok|created|built/i.test(meaningfulRuntime.text)
          ? "success"
          : "info"
    : null;
  const status =
    localStatus ??
    (meaningfulRuntime && runtimeKind
      ? { text: meaningfulRuntime.text, kind: runtimeKind }
      : {
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
      setStatus: (text, kind = "info") => setLocalStatus({ text, kind }),
      notify: (level, message) => {
        if (level === "error") toast.error(message);
        else if (level === "warning") toast.warning(message);
        else toast.info(message);
      },
      openFile: (path, line) => onOpenFile?.(path, line ?? 1),
      configure: () => onConfigure?.(),
    }),
    [plugin.id, workspace, theme, language, execute, cancel, onOpenFile, onConfigure],
  );
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    setLoading(true);
    setError("");
    setLocalStatus(null);
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

  const statusTone =
    status.kind === "error"
      ? "border-red-500/25 bg-red-500/10 text-red-400"
      : status.kind === "running"
        ? "border-sky-500/25 bg-sky-500/10 text-sky-400"
        : status.kind === "success"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
          : "border-border bg-muted/60 text-muted-foreground";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b bg-panel/70 px-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/80 bg-background/60 text-primary">
          {pluginIcon(frontend.icon ?? plugin.manifest?.icon, "h-4 w-4")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold tracking-tight text-foreground" title={frontend.title}>{frontend.title}</div>
          <div className="truncate text-[9px] text-muted-foreground">
            {plugin.name} · v{plugin.version}
          </div>
        </div>
        <span
          aria-live="polite"
          className={cn("flex max-w-[45%] items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-medium", statusTone)}
          title={status.text}
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", status.kind === "running" && "animate-pulse")} />
          <span className="truncate">{status.text}</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {onConfigure && (
            <button
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Configure plugin"
              aria-label="Configure plugin"
              onClick={onConfigure}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Reload plugin view"
            aria-label="Reload plugin view"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <RotateCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col gap-3 bg-background p-4">
            <div className="h-8 w-2/3 animate-pulse rounded-lg bg-muted/70" />
            <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
            <div className="h-32 animate-pulse rounded-lg bg-muted/40" />
            <div className="mt-auto flex items-center gap-2 text-[10px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading {frontend.title}…
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background p-6">
            <div className="max-w-sm rounded-xl border border-red-500/25 bg-red-500/5 p-5 text-center">
              <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-red-400" />
              <div className="text-xs font-medium text-foreground">This plugin view failed to load</div>
              <p className="mt-1 break-words text-[10px] leading-5 text-muted-foreground">{error}</p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-medium text-primary-foreground hover:opacity-90"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  Try again
                </button>
                {onConfigure && (
                  <button
                    className="rounded-md border px-3 py-1.5 text-[10px] font-medium hover:bg-accent"
                    onClick={onConfigure}
                  >
                    Configure
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={hostRef} className="h-full min-h-0 w-full min-w-0 overflow-hidden" data-testid={`plugin-frontend-${plugin.id}-${frontend.id}`} />
      </div>
    </div>
  );
}
