import { useState } from "react";
import { ArrowRight, Braces, Check, GitBranch, Loader2, LockKeyhole, TerminalSquare } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("admin@goland.local");
  const [password, setPassword] = useState("admin123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.login(email.trim(), password);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 overflow-hidden bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-[#090b0e] p-12 lg:flex">
        <div className="absolute inset-0 bg-grid opacity-[0.18]" />
        <div className="absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-md border border-primary/30 bg-primary/10">
            <Braces className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Goland</span>
          <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            web ide
          </span>
        </div>

        <div className="relative max-w-xl">
          <p className="mb-4 font-code text-xs uppercase tracking-[0.2em] text-primary/80">Go &amp; TypeScript</p>
          <h1 className="text-balance text-4xl font-semibold leading-[1.12] tracking-[-0.03em]">
            Your whole development environment, one browser tab away.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground">
            Files, language intelligence, terminals, tests, debuggers and Git — connected to isolated workspaces and
            built for the two languages you actually ship.
          </p>
          <div className="mt-9 overflow-hidden rounded-lg border bg-black/50 shadow-2xl">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              <span className="ml-2 font-code text-[11px] text-muted-foreground">main.go</span>
            </div>
            <pre className="overflow-hidden p-5 font-code text-[12px] leading-6 text-slate-300">
              <span className="text-purple-400">package</span> main{"\n\n"}
              <span className="text-purple-400">import</span>{" "}
              <span className="text-amber-300">&quot;fmt&quot;</span>
              {"\n\n"}
              <span className="text-purple-400">func</span> <span className="text-sky-400">main</span>() {"{"}
              {"\n    "}fmt.<span className="text-sky-400">Println</span>(
              <span className="text-amber-300">&quot;ship it&quot;</span>){"\n"}
              {"}"}
            </pre>
          </div>
        </div>

        <div className="relative flex gap-6 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-400" /> CodeMirror 6
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-400" /> Multi-user isolation
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-400" /> Self-hosted
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-slide-in">
          <div className="mb-9 lg:hidden">
            <div className="mb-6 flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-md border border-primary/30 bg-primary/10">
                <Braces className="h-4 w-4 text-primary" />
              </div>
              <span className="font-semibold">Goland</span>
            </div>
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Welcome back</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Sign in to your IDE</h2>
          <p className="mt-2 text-sm text-muted-foreground">Use the account provisioned by your administrator.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••"
                required
              />
            </div>
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <Button type="submit" className="h-9 w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Sign in
              {!loading && <ArrowRight className="ml-auto h-4 w-4 opacity-60" />}
            </Button>
          </form>

          {import.meta.env.DEV && (
            <div className="mt-6 rounded-md border bg-muted/30 p-3 font-code text-[11px] text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wider">development</div>
              admin@goland.local / admin123456
            </div>
          )}

          <div className="mt-10 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <TerminalSquare className="h-3.5 w-3.5" /> PTY terminal
            </span>
            <span className="flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" /> Git built in
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
