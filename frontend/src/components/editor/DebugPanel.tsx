import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Pause,
  Play,
  Plus,
  SkipForward,
  Square,
  StepForward,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Workspace } from "@/lib/types";
import { DAPClient, type Scope, type StackFrame, type Variable } from "@/lib/dap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, fileLanguage } from "@/lib/utils";
import type { SourceLocation } from "@/lib/lsp";
import { pluginDapSocket } from "@/lib/plugin-api";

export interface PluginDebuggerContribution {
  pluginId: string;
  pluginName: string;
  kind: string;
  label: string;
}

type DebugKind = string;
type Status = "idle" | "starting" | "running" | "stopped" | "terminated" | "error";

interface VariableGroup {
  scope: Scope;
  variables: Variable[];
}

export function DebugPanel({
  workspace,
  activePath,
  breakpoints,
  onBreakpointsChange,
  onOpenLocation,
  pluginDebuggers = [],
}: {
  workspace: Workspace;
  activePath: string;
  breakpoints: Record<string, number[]>;
  onBreakpointsChange: (next: Record<string, number[]>) => void;
  onOpenLocation: (location: SourceLocation) => void;
  pluginDebuggers?: PluginDebuggerContribution[];
}) {
  const [kind, setKind] = useState<DebugKind>("go");
  const [program, setProgram] = useState(".");
  const [url, setUrl] = useState("http://127.0.0.1:5173");
  const [status, setStatus] = useState<Status>("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [threadId, setThreadId] = useState<number | null>(null);
  const [frames, setFrames] = useState<StackFrame[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<StackFrame | null>(null);
  const [groups, setGroups] = useState<VariableGroup[]>([]);
  const [output, setOutput] = useState("");
  const [expression, setExpression] = useState("");
  const [debugConfig, setDebugConfig] = useState<{ chrome: string; node: string; dlv: string } | null>(null);
  const [newPath, setNewPath] = useState(activePath || "");
  const [newLine, setNewLine] = useState("1");
  const clientRef = useRef<DAPClient | null>(null);
  const parentRef = useRef<DAPClient | null>(null);
  const browserRef = useRef("");
  const statusRef = useRef<Status>("idle");
  const outputRef = useRef<HTMLPreElement | null>(null);
  statusRef.current = status;

  useEffect(() => {
    api.debugConfig(workspace.id).then(setDebugConfig).catch(() => setDebugConfig(null));
  }, [workspace.id]);

  useEffect(() => {
    setNewPath(activePath || "");
    if (kind === "node" && activePath.match(/\.(ts|tsx|js|jsx|mjs)$/)) setProgram(activePath);
  }, [activePath, kind]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  useEffect(() => {
    return () => {
      parentRef.current?.dispose();
      clientRef.current?.dispose();
      if (browserRef.current) void api.stopBrowser(workspace.id, browserRef.current).catch(() => undefined);
      browserRef.current = "";
      parentRef.current = null;
      clientRef.current = null;
    };
  }, []);

  const appendOutput = (text: string) => {
    setOutput((current) => (current + text).slice(-200_000));
  };

  const sourcePath = (path?: string) => {
    if (!path) return "";
    const root = workspace.rootPath.replace(/\/+$/, "");
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  };

  const syncBreakpoints = async (client: DAPClient, next = breakpoints) => {
    for (const [path, lines] of Object.entries(next)) {
      if (!lines.length) continue;
      const absolute = path.startsWith("/") ? path : `${workspace.rootPath.replace(/\/+$/, "")}/${path}`;
      const result = await client.setBreakpoints(absolute, [...lines].sort((a, b) => a - b));
      if (import.meta.env.DEV) console.debug("[dap-bp]", absolute, JSON.stringify(result));
    }
  };

  const loadVariables = async (client: DAPClient, frame: StackFrame) => {
    setSelectedFrame(frame);
    try {
      const scopeResult = await client.scopes(frame.id);
      const scopes = ((scopeResult.scopes as Scope[] | undefined) ?? []).filter((scope) => !scope.expensive);
      const loaded = await Promise.all(
        scopes.map(async (scope) => {
          if (!scope.variablesReference) return { scope, variables: [] };
          const result = await client.variables(scope.variablesReference);
          return { scope, variables: (result.variables as Variable[] | undefined) ?? [] };
        }),
      );
      setGroups(loaded);
    } catch (err) {
      appendOutput(`\n[variables] ${err instanceof Error ? err.message : "failed"}\n`);
    }
  };

  const loadStack = async (client: DAPClient, thread: number) => {
    try {
      const result = await client.stackTrace(thread);
      const list = (result.stackFrames as StackFrame[] | undefined) ?? [];
      setFrames(list);
      if (list[0]) await loadVariables(client, list[0]);
    } catch (err) {
      appendOutput(`\n[stack] ${err instanceof Error ? err.message : "failed"}\n`);
    }
  };

  const handleEvent = (client: DAPClient) => (event: { event: string; body?: Record<string, unknown> }) => {
    const body = event.body ?? {};
    switch (event.event) {
      case "stopped": {
        const active = clientRef.current ?? client;
        const thread = Number(body.threadId ?? 1);
        setThreadId(thread);
        setStatus("stopped");
        setReason(String(body.reason ?? body.description ?? "paused"));
        appendOutput(`\n[stopped] ${String(body.reason ?? "paused")}${body.description ? `: ${String(body.description)}` : ""}\n`);
        void (async () => {
          try {
            await new Promise((resolve) => window.setTimeout(resolve, 250));
            let threadID = thread;
            if (!threadID) {
              const threads = await active.request("threads", {});
              const list = (threads.threads as Array<{ id: number }> | undefined) ?? [];
              threadID = list[0]?.id ?? 1;
              setThreadId(threadID);
            }
            await loadStack(active, threadID);
          } catch (err) {
            appendOutput(`\n[stopped handler] ${err instanceof Error ? err.message : "failed"}\n`);
          }
        })();
        break;
      }
      case "continued":
        setStatus("running");
        setFrames([]);
        setGroups([]);
        setSelectedFrame(null);
        break;
      case "output": {
        const text = String(body.output ?? "");
        if (text) appendOutput(text);
        break;
      }
      case "exited":
        appendOutput(`\n[process exited with code ${String(body.exitCode ?? "?")}]\n`);
        break;
      case "terminated":
        setStatus("terminated");
        setFrames([]);
        setGroups([]);
        appendOutput("\n[session terminated]\n");
        if (browserRef.current) {
          void api.stopBrowser(workspace.id, browserRef.current).catch(() => undefined);
          browserRef.current = "";
        }
        break;
      case "thread":
        if (body.reason === "started") setThreadId(Number(body.threadId ?? 1));
        break;
      case "goland/closed":
        if (statusRef.current !== "terminated") setStatus("terminated");
        break;
      case "breakpoint":
        break;
      default:
        break;
    }
  };

  const launchConfig = async (): Promise<Record<string, unknown>> => {
    const root = workspace.rootPath;
    const cfg = debugConfig ?? (await api.debugConfig(workspace.id));
    const pluginDebugger = pluginDebuggers.find((item) => item.kind === kind);
    if (pluginDebugger) {
      return {
        type: kind,
        request: "launch",
        name: pluginDebugger.label,
        program: program || ".",
        cwd: root,
        args: [],
        console: "internalConsole",
      };
    }
    if (kind === "go") {
      return {
        type: "go",
        request: "launch",
        name: "Go: debug",
        mode: "debug",
        program: program || ".",
        cwd: root,
        args: [],
        buildFlags: "-buildvcs=false",
        console: "internalConsole",
      };
    }
    if (kind === "node") {
      const absolute = program.startsWith("/") ? program : `${root.replace(/\/+$/, "")}/${program}`;
      return {
        type: "pwa-node",
        request: "launch",
        name: "Node: debug",
        program: absolute,
        cwd: root,
        console: "internalConsole",
        sourceMaps: true,
        skipFiles: ["<node_internals>/**"],
        runtimeExecutable: cfg.node || "node",
        runtimeArgs: program.endsWith(".ts") ? ["--experimental-strip-types"] : [],
      };
    }
    return {
      type: "pwa-chrome",
      request: "attach",
      name: "Browser: attach",
      address: "127.0.0.1",
      port: 9222,
      webRoot: root,
      sourceMaps: true,
      urlFilter: "*",
    };
  };

  const start = async () => {
    setError("");
    setOutput("");
    setFrames([]);
    setGroups([]);
    setStatus("starting");
    const pluginDebugger = pluginDebuggers.find((item) => item.kind === kind);
    const socketUrl = pluginDebugger ? pluginDapSocket(workspace.id, pluginDebugger.pluginId, kind) : undefined;
    const client = new DAPClient(workspace.id, kind, (message) => {
      setError(message);
      appendOutput(`\n[error] ${message}\n`);
    }, "", socketUrl);
    parentRef.current?.dispose();
    parentRef.current = client;
    clientRef.current = client;
    client.onEvent(handleEvent(client));
    client.onChildSession(async (configuration) => {
      const child = new DAPClient(workspace.id, kind, (message) => {
        setError(message);
        appendOutput(`\n[error] ${message}\n`);
      }, client.adapterId, socketUrl);
      clientRef.current = child;
      child.onEvent(handleEvent(child));
      appendOutput("[child debug target attached]\n");
      void (async () => {
        try {
          await child.launch(
            { ...configuration, cwd: workspace.rootPath, webRoot: workspace.rootPath, sourceMaps: true },
            kind === "browser" ? undefined : async () => {
              await syncBreakpoints(child);
              await child.setExceptionBreakpoints([]);
            },
          );
          if (kind === "browser") await syncBreakpoints(child);
          setStatus("running");
        } catch (err) {
          appendOutput(`\n[child] ${err instanceof Error ? err.message : "launch failed"}\n`);
        }
      })();
    });
    try {
      let config = await launchConfig();
      if (kind === "browser") {
        const browser = await api.startBrowser(workspace.id, url);
        browserRef.current = browser.id;
        config = {
          type: "pwa-chrome",
          request: "attach",
          name: "Browser: attach",
          address: "127.0.0.1",
          port: browser.port,
          webRoot: workspace.rootPath,
          sourceMaps: true,
          urlFilter: "*",
        };
        await client.launch(config);
        await syncBreakpoints(client);
        await api.reloadBrowser(workspace.id, browser.id);
      } else {
        await client.launch(config, async () => {
          await syncBreakpoints(client);
          await client.setExceptionBreakpoints(kind === "go" ? ["unrecovered"] : []);
        });
      }
      setStatus("running");
      appendOutput(`[${kind} debugger started]\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start debugger";
      setStatus("error");
      setError(message);
      appendOutput(`[error] ${message}\n`);
    }
  };

  const stop = () => {
    parentRef.current?.disconnect(true);
    if (clientRef.current !== parentRef.current) clientRef.current?.disconnect(true);
    if (browserRef.current) {
      void api.stopBrowser(workspace.id, browserRef.current).catch(() => undefined);
      browserRef.current = "";
    }
    setStatus("terminated");
    setFrames([]);
    setGroups([]);
  };

  const paused = status === "stopped";
  const active = status === "running" || status === "stopped" || status === "starting";

  const step = async (action: "next" | "stepIn" | "stepOut" | "continue" | "pause") => {
    const client = clientRef.current;
    if (!client || !threadId) return;
    try {
      if (action === "continue") {
        setStatus("running");
        await client.continue(threadId);
      } else if (action === "pause") {
        await client.pause(threadId);
      } else {
        await client[action](threadId);
        setStatus("running");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Debug action failed");
    }
  };

  const evaluate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!expression.trim() || !clientRef.current) return;
    const expr = expression.trim();
    setExpression("");
    try {
      const result = await clientRef.current.evaluate(expr, selectedFrame?.id);
      appendOutput(`\n> ${expr}\n${String(result.result ?? "")}\n`);
    } catch (err) {
      appendOutput(`\n> ${expr}\n${err instanceof Error ? err.message : "evaluation failed"}\n`);
    }
  };

  const addBreakpoint = () => {
    const line = Number.parseInt(newLine, 10);
    if (!newPath.trim() || !Number.isFinite(line) || line < 1) return;
    const next = { ...breakpoints };
    const lines = new Set(next[newPath] ?? []);
    lines.add(line);
    next[newPath] = [...lines].sort((a, b) => a - b);
    onBreakpointsChange(next);
    if (clientRef.current && active) void syncBreakpoints(clientRef.current, next);
  };

  const removeBreakpoint = (path: string, line: number) => {
    const next = { ...breakpoints };
    next[path] = (next[path] ?? []).filter((value) => value !== line);
    if (!next[path].length) delete next[path];
    onBreakpointsChange(next);
    if (clientRef.current && active) void syncBreakpoints(clientRef.current, next);
  };

  const breakpointCount = Object.values(breakpoints).reduce((sum, lines) => sum + lines.length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Run &amp; debug
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === "running" && "bg-emerald-400",
              status === "stopped" && "bg-amber-400",
              status === "starting" && "bg-sky-400",
              (status === "error" || status === "terminated") && "bg-red-400",
              status === "idle" && "bg-slate-500",
            )}
          />
          {status}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-2 border-b p-2.5">
          <div className="flex flex-wrap gap-1">
            {["go", "node", "browser", ...pluginDebuggers.map((item) => item.kind)].map((item) => (
              <button
                key={item}
                disabled={active}
                title={pluginDebuggers.find((entry) => entry.kind === item)?.label ?? item}
                className={cn(
                  "min-w-[54px] flex-1 rounded border px-1 py-1 text-[10px]",
                  kind === item ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
                )}
                onClick={() => setKind(item)}
              >
                {pluginDebuggers.find((entry) => entry.kind === item)?.label ?? item}
              </button>
            ))}
          </div>

          {kind === "browser" ? (
            <div className="space-y-1.5">
              <Label htmlFor="debug-url">URL</Label>
              <Input
                id="debug-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="h-7 font-code text-[10px]"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="debug-program">Program</Label>
              <Input
                id="debug-program"
                value={program}
                onChange={(event) => setProgram(event.target.value)}
                className="h-7 font-code text-[10px]"
              />
              <p className="text-[9px] leading-4 text-muted-foreground">
                {kind === "go"
                  ? "Go package or file, relative to the workspace."
                  : pluginDebuggers.some((item) => item.kind === kind)
                    ? "Entry point passed to the plugin debugger."
                    : "Entry point, for example web/app.ts."}
              </p>
            </div>
          )}

          <div className="flex gap-1.5">
            {!active ? (
              <Button size="sm" className="h-7 flex-1 text-xs" onClick={() => void start()}>
                <Play className="h-3.5 w-3.5" /> Start debugging
              </Button>
            ) : (
              <>
                <Button
                  size="icon-sm"
                  variant="secondary"
                  title="Continue (F5)"
                  disabled={!paused}
                  onClick={() => void step("continue")}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="secondary" title="Pause" disabled={!status.startsWith("running")} onClick={() => void step("pause")}>
                  <Pause className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="secondary" title="Step over" disabled={!paused} onClick={() => void step("next")}>
                  <SkipForward className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="secondary" title="Step into" disabled={!paused} onClick={() => void step("stepIn")}>
                  <StepForward className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="secondary" title="Step out" disabled={!paused} onClick={() => void step("stepOut")}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="destructive" title="Stop" onClick={stop}>
                  <Square className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
          {error && <div className="text-[10px] leading-4 text-red-300">{error}</div>}
        </div>

        <div className="border-b p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Breakpoints ({breakpointCount})
            </span>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => onBreakpointsChange({})}>
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-0.5">
            {Object.entries(breakpoints).flatMap(([path, lines]) =>
              lines.map((line) => (
                <div key={`${path}:${line}`} className="group flex items-center gap-1.5 text-[10px]">
                  <Circle className="h-2 w-2 shrink-0 fill-red-400 text-red-400" />
                  <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpenLocation({ path, line, column: 1, endLine: line, endColumn: 1 })}>
                    {path}:{line}
                  </button>
                  <button className="hidden text-muted-foreground group-hover:block" onClick={() => removeBreakpoint(path, line)}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )),
            )}
            {breakpointCount === 0 && <div className="text-[10px] text-muted-foreground">No breakpoints. Press F9 in the editor.</div>}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_38px_24px] gap-1">
            <Input
              value={newPath}
              onChange={(event) => setNewPath(event.target.value)}
              placeholder="path/file.go"
              className="h-6 font-code text-[9px]"
            />
            <Input
              value={newLine}
              onChange={(event) => setNewLine(event.target.value)}
              className="h-6 px-1 text-center font-code text-[9px]"
            />
            <Button size="icon-sm" variant="secondary" className="h-6 w-6" onClick={addBreakpoint}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {paused && (
          <div className="border-b p-2.5">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Call stack · {reason}
            </div>
            <div className="space-y-0.5">
              {frames.map((frame) => {
                const path = sourcePath(frame.source?.path);
                return (
                  <button
                    key={frame.id}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[10px]",
                      selectedFrame?.id === frame.id ? "bg-accent" : "hover:bg-accent/60",
                    )}
                    onClick={() => clientRef.current && void loadVariables(clientRef.current, frame)}
                    onDoubleClick={() =>
                      path &&
                      onOpenLocation({
                        path,
                        line: frame.line,
                        column: frame.column || 1,
                        endLine: frame.line,
                        endColumn: frame.column || 1,
                      })
                    }
                  >
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                    {path && (
                      <span className="shrink-0 font-code text-[9px] text-muted-foreground">
                        {path.split("/").pop()}:{frame.line}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {groups.length > 0 && (
          <div className="border-b p-2.5">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Variables</div>
            {groups.map((group) => (
              <div key={group.scope.name} className="mb-2">
                <div className="text-[10px] font-medium text-foreground">{group.scope.name}</div>
                <div className="mt-0.5 space-y-0.5">
                  {group.variables.map((variable) => (
                    <VariableRow key={variable.name} variable={variable} client={clientRef.current} depth={0} />
                  ))}
                  {group.variables.length === 0 && <div className="text-[9px] text-muted-foreground">empty</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {output && (
          <div className="p-2.5">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Debug console</div>
            <pre ref={outputRef} className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-code text-[9px] leading-4 text-muted-foreground">
              {output}
            </pre>
          </div>
        )}
      </div>

      <form onSubmit={evaluate} className="border-t p-2">
        <Input
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          placeholder={paused ? "Evaluate expression…" : "Start a session to evaluate"}
          disabled={!paused}
          className="h-7 font-code text-[10px]"
        />
      </form>
    </div>
  );
}

function VariableRow({
  variable,
  client,
  depth,
}: {
  variable: Variable;
  client: DAPClient | null;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Variable[]>([]);
  const expandable = variable.variablesReference > 0;

  const toggle = async () => {
    if (!expandable || !client) return;
    if (!expanded && children.length === 0) {
      try {
        const result = await client.variables(variable.variablesReference);
        setChildren((result.variables as Variable[] | undefined) ?? []);
      } catch {
        return;
      }
    }
    setExpanded((value) => !value);
  };

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded px-0.5 py-0.5 text-left text-[9px] hover:bg-accent/60"
        style={{ paddingLeft: depth * 10 }}
        onClick={() => void toggle()}
      >
        {expandable ? (
          expanded ? (
            <ChevronDown className="h-2.5 w-2.5 shrink-0" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5 shrink-0" />
          )
        ) : (
          <span className="w-2.5 shrink-0" />
        )}
        <span className="shrink-0 text-sky-300">{variable.name}</span>
        <span className="ml-1 truncate text-muted-foreground">= {variable.value}</span>
      </button>
      {expanded &&
        children.map((child, index) => (
          <VariableRow key={`${child.name}-${index}`} variable={child} client={client} depth={depth + 1} />
        ))}
    </div>
  );
}

export const debugKindLabel: Record<string, string> = {
  go: "Go",
  node: "Node / TypeScript",
  browser: "Browser",
};

export const debugFileLanguage = (path: string) => fileLanguage(path);

export const debugWarningIcon = TriangleAlert;
