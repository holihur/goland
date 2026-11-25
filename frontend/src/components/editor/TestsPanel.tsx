import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileCode2, FlaskConical, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { TestDiscovery, TestItem, TestRunResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TestsPanel({
  workspaceId,
  onOpenFile,
}: {
  workspaceId: string;
  onOpenFile: (path: string, line: number) => void;
}) {
  const [discovery, setDiscovery] = useState<TestDiscovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState("");
  const [results, setResults] = useState<Record<string, TestRunResult>>({});
  const [output, setOutput] = useState("");
  const [outputTest, setOutputTest] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDiscovery(await api.listTests(workspaceId));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not discover tests");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, TestItem[]>();
    for (const test of discovery?.tests ?? []) {
      const list = map.get(test.path) ?? [];
      list.push(test);
      map.set(test.path, list);
    }
    return [...map.entries()];
  }, [discovery]);

  const run = async (test: TestItem) => {
    if (running) return;
    setRunning(test.id);
    setOutputTest(test.id);
    setOutput("");
    try {
      const result = await api.runTest(workspaceId, test);
      setResults((current) => ({ ...current, [test.id]: result }));
      setOutput(result.output || "(no output)");
      if (result.status === "success") toast.success(`Passed ${test.name}`);
      else toast.error(`Failed ${test.name}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Test run failed";
      setOutput(message);
      toast.error(message);
    } finally {
      setRunning("");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tests-panel">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-[10px] text-muted-foreground">
        <FlaskConical className="h-3 w-3" />
        <span>Tests</span>
        {discovery?.frameworks.length ? <span className="font-code">{discovery.frameworks.join(" · ")}</span> : null}
        <span className="ml-auto">{discovery?.tests.length ?? 0} discovered</span>
        <button className="rounded p-0.5 hover:bg-accent" title="Refresh tests" onClick={() => void load()}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>
      {error && <div className="p-2 text-xs text-red-300">{error}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {!loading && !error && groups.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">No Go or Vitest tests discovered in this workspace.</div>
        )}
        {groups.map(([path, tests]) => (
          <div key={path}>
            <div className="sticky top-0 flex items-center gap-1.5 border-b bg-panel/95 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
              <FileCode2 className="h-3 w-3 shrink-0 text-sky-400" />
              <span className="truncate">{path}</span>
              <span className="ml-auto shrink-0">{tests.length}</span>
            </div>
            {tests.map((test) => {
              const result = results[test.id];
              return (
                <div key={test.id} className="group flex items-center gap-2 border-b border-border/50 px-2 py-1 text-[11px]">
                  <button
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Run test"
                    disabled={!!running}
                    onClick={() => void run(test)}
                  >
                    {running === test.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    className="min-w-0 flex-1 truncate text-left hover:text-primary"
                    title={`${test.name} · line ${test.line}`}
                    onClick={() => onOpenFile(test.path, test.line)}
                  >
                    {test.name}
                  </button>
                  <span className="shrink-0 font-code text-[9px] text-muted-foreground">{test.kind}</span>
                  {result ? (
                    <span className={cn("flex shrink-0 items-center gap-1 text-[9px]", result.status === "success" ? "text-emerald-400" : "text-red-400")}>
                      {result.status === "success" ? <CheckCircle2 className="h-3 w-3" /> : result.status === "timeout" ? <Clock3 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {Math.round(result.durationMs)}ms
                    </span>
                  ) : (
                    <span className="w-10 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {outputTest && (
        <div className="flex h-[40%] min-h-20 shrink-0 flex-col border-t">
          <div className="flex h-6 shrink-0 items-center justify-between border-b px-2 text-[9px] uppercase tracking-wider text-muted-foreground">
            <span>Test output</span>
            <Button variant="ghost" size="icon-sm" className="h-5 w-5" title="Clear output" onClick={() => { setOutput(""); setOutputTest(""); }}>
              ×
            </Button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-muted/40 p-2 font-code text-[10px] leading-4 text-muted-foreground">
            {output || (running === outputTest ? "Running…" : "")}
          </pre>
        </div>
      )}
    </div>
  );
}
