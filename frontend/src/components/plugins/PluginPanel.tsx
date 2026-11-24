import { useMemo, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import type { PluginField, PluginPanel as PluginPanelContribution, WorkspacePlugin } from "@/lib/plugin-types";
import type { PluginPanelState } from "@/lib/usePlugins";
import { PluginFieldInput } from "./PluginFieldInput";

function defaultsFor(fields: PluginField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) if (field.default !== undefined) values[field.key] = field.default;
  return values;
}

export function PluginPanel({
  plugin,
  panel,
  runtime,
  outputs,
  execute,
  cancel,
}: {
  plugin: WorkspacePlugin;
  panel: PluginPanelContribution;
  runtime: PluginPanelState | undefined;
  outputs: Record<string, string>;
  execute: (
    pluginId: string,
    commandId: string,
    input?: { inputs?: Record<string, unknown>; path?: string },
  ) => Promise<{ requestId: string; output: string }>;
  cancel: (pluginId: string, requestId: string) => Promise<void>;
}) {
  const initial = useMemo(() => defaultsFor(panel.fields ?? []), [panel.fields]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultOutput, setResultOutput] = useState("");
  const output = requestId
    ? (outputs[requestId] ?? resultOutput ?? runtime?.output ?? "")
    : (runtime?.output ?? "");

  const run = async (commandId: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const result = await execute(plugin.id, commandId, { inputs: { ...values, ...extra } });
      setResultOutput(result.output);
      setRequestId(result.requestId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Plugin command failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={`plugin-panel-${plugin.id}-${panel.id}`}>
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span className="truncate">{runtime?.title ?? panel.title}</span>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      </div>
      <div className="space-y-2 border-b p-3">
        {(panel.fields ?? []).map((field) => (
          <PluginFieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            disabled={busy}
            onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(panel.actions ?? []).map((action) => (
            <button
              key={action.id}
              type="button"
              className="flex h-7 items-center gap-1.5 rounded border px-2 text-[10px] hover:bg-accent disabled:opacity-50"
              disabled={busy}
              onClick={() => void run(action.command, action.args)}
            >
              <Play className="h-3 w-3" /> {action.label}
            </button>
          ))}
          {requestId && (
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded border px-2 text-[10px] text-red-300 hover:bg-red-500/10"
              onClick={() => void cancel(plugin.id, requestId)}
            >
              <Square className="h-3 w-3" /> Cancel
            </button>
          )}
        </div>
      </div>
      <pre
        aria-label={`${panel.title} output`}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-muted/40 p-3 font-code text-[11px] leading-5 text-muted-foreground"
      >
        {output || "Run an action to see plugin output."}
      </pre>
    </div>
  );
}
