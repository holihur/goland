import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { APIToken } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SCOPES = [
  { id: "read", label: "Read", help: "Files, content search and workspace metadata" },
  { id: "write", label: "Write", help: "Write and replace files" },
  { id: "git", label: "Git", help: "Status and diffs" },
  { id: "run", label: "Run", help: "Run tests" },
  { id: "mcp", label: "MCP", help: "Use the Model Context Protocol endpoint" },
];

export function TokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tokens, setTokens] = useState<APIToken[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(SCOPES.map((scope) => scope.id));
  const [expiry, setExpiry] = useState("90");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTokens((await api.listTokens()).tokens);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setCreated("");
      void load();
    }
  }, [open, load]);

  const create = async () => {
    if (!name.trim() || scopes.length === 0 || creating) return;
    setCreating(true);
    try {
      const result = await api.createToken({
        name: name.trim(),
        scopes,
        expiresInDays: Number(expiry),
      });
      setCreated(result.token);
      setName("");
      await load();
      toast.success("Token created; copy it now");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create token");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (token: APIToken) => {
    if (!window.confirm(`Revoke token "${token.name}"?`)) return;
    try {
      await api.deleteToken(token.id);
      await load();
      toast.success("Token revoked");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not revoke token");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Personal access tokens
          </DialogTitle>
          <DialogDescription>
            Bearer tokens for the API and MCP endpoint. Tokens are shown once and cannot be recovered.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-auto pr-1">
          <section className="space-y-2 rounded-md border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
              <div className="space-y-1">
                <Label htmlFor="token-name">Name</Label>
                <Input id="token-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude Desktop / CI" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="token-expiry">Expiry</Label>
                <select
                  id="token-expiry"
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                  <option value="0">Never</option>
                </select>
              </div>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {SCOPES.map((scope) => (
                <button
                  key={scope.id}
                  type="button"
                  aria-pressed={scopes.includes(scope.id)}
                  onClick={() =>
                    setScopes((current) =>
                      current.includes(scope.id) ? current.filter((item) => item !== scope.id) : [...current, scope.id],
                    )
                  }
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs",
                    scopes.includes(scope.id) ? "border-primary/40 bg-primary/10" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <ShieldCheck className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", scopes.includes(scope.id) ? "text-primary" : "opacity-40")} />
                  <span>
                    <span className="block font-medium text-foreground">{scope.label}</span>
                    <span className="block text-[10px]">{scope.help}</span>
                  </span>
                </button>
              ))}
            </div>
            <Button className="h-8 w-full text-xs" disabled={!name.trim() || scopes.length === 0 || creating} onClick={() => void create()}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Create token
            </Button>
          </section>

          {created && (
            <section className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Copy this token now</div>
              <div className="mt-2 flex gap-1.5">
                <code className="min-w-0 flex-1 break-all rounded border bg-background/60 p-2 text-[11px]">{created}</code>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  title="Copy token"
                  onClick={() => {
                    void navigator.clipboard?.writeText(created).then(
                      () => toast.success("Token copied"),
                      () => toast.error("Clipboard is unavailable"),
                    );
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </section>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          <section className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Existing tokens ({tokens.length})
            </div>
            {loading && <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
            {!loading && tokens.length === 0 && <div className="p-2 text-xs text-muted-foreground">No tokens yet.</div>}
            {tokens.map((token) => (
              <div key={token.id} className="group flex items-center gap-2 rounded border px-2.5 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{token.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {token.scopes.join(" · ")} · created {new Date(token.createdAt).toLocaleDateString()}
                    {token.lastUsedAt ? ` · used ${new Date(token.lastUsedAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <button
                  className="text-muted-foreground hover:text-red-400"
                  title="Revoke token"
                  onClick={() => void revoke(token)}
                >
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
