import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, Plus, ShieldCheck, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { BYOKKey } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "custom", label: "Custom (OpenAI-compatible)", baseUrl: "" },
];

export function ByokDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [keys, setKeys] = useState<BYOKKey[]>([]);
  const [provider, setProvider] = useState("openai");
  const [label, setLabel] = useState("OpenAI");
  const [baseUrl, setBaseUrl] = useState(PRESETS[0].baseUrl);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKeys((await api.listByok()).keys);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load AI keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const preset = (id: string) => {
    const value = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
    setProvider(value.id);
    setLabel(value.label === "Custom (OpenAI-compatible)" ? "Custom" : value.label);
    setBaseUrl(value.baseUrl);
    setModel("");
    setModels([]);
  };

  const fetchModels = async () => {
    if (!baseUrl.trim() || !apiKey.trim() || loadingModels) return;
    setLoadingModels(true);
    try {
      const result = await api.listModels({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setModels(result.models);
      if (!model && result.models.length > 0) setModel(result.models[0]);
      if (result.models.length === 0) toast.info("Provider returned no models");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load provider models");
    } finally {
      setLoadingModels(false);
    }
  };

  const create = async () => {
    if (!apiKey.trim() || !baseUrl.trim() || !model.trim() || saving) return;
    setSaving(true);
    try {
      await api.createByok({
        provider,
        label: label.trim() || provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim(),
      });
      setApiKey("");
      await load();
      toast.success("AI provider key saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save AI key");
    } finally {
      setSaving(false);
    }
  };

  const test = async (key: BYOKKey) => {
    setTesting(key.id);
    try {
      const result = await api.chat({
        keyId: key.id,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        temperature: 0,
      });
      toast.success(`${key.label}: ${result.content.slice(0, 120)}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Provider test failed");
    } finally {
      setTesting("");
    }
  };

  const remove = async (key: BYOKKey) => {
    if (!window.confirm(`Delete AI key "${key.label}"?`)) return;
    try {
      await api.deleteByok(key.id);
      await load();
      toast.success("AI key deleted");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete AI key");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4" /> Bring your own AI key
          </DialogTitle>
          <DialogDescription>
            Keys are encrypted with the server master key and never returned to the browser. Any
            OpenAI-compatible endpoint works. Sessions and PATs with the <code>ai</code> scope can use them.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-auto pr-1">
          <section className="space-y-2 rounded-md border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="byok-provider">Provider</Label>
                <select
                  id="byok-provider"
                  value={provider}
                  onChange={(event) => preset(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  {PRESETS.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="byok-label">Label</Label>
                <Input id="byok-label" value={label} onChange={(event) => setLabel(event.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="byok-base">Base URL</Label>
                <Input id="byok-base" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" className="font-code text-[11px]" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="byok-model">Model</Label>
                  <button
                    type="button"
                    className="text-[10px] text-primary hover:underline disabled:opacity-40"
                    disabled={!baseUrl.trim() || !apiKey.trim() || loadingModels}
                    onClick={() => void fetchModels()}
                  >
                    {loadingModels ? "Loading…" : "Fetch models"}
                  </button>
                </div>
                <Input
                  id="byok-model"
                  list="byok-model-options"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Fetch models or type a model id"
                  className="font-code text-[11px]"
                />
                <datalist id="byok-model-options">
                  {models.map((item) => <option key={item} value={item} />)}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label htmlFor="byok-key">API key</Label>
                <Input id="byok-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" className="font-code text-[11px]" />
              </div>
            </div>
            <Button className="h-8 w-full text-xs" disabled={!apiKey.trim() || !baseUrl.trim() || !model.trim() || saving} onClick={() => void create()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save provider key
            </Button>
          </section>

          {error && <div className="text-xs text-red-400">{error}</div>}

          <section className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Your keys ({keys.length})
            </div>
            {loading && <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
            {!loading && keys.length === 0 && <div className="p-2 text-xs text-muted-foreground">No provider keys yet.</div>}
            {keys.map((key) => (
              <div key={key.id} className="flex items-center gap-2 rounded border px-2.5 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{key.label}</div>
                  <div className="truncate font-code text-[10px] text-muted-foreground">
                    {key.baseUrl} · {key.model}
                  </div>
                </div>
                <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Test key" onClick={() => void test(key)}>
                  {testing === key.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                </button>
                <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400" title="Delete key" onClick={() => void remove(key)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
