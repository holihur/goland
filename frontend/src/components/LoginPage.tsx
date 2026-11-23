import { useState } from "react";
import { ArrowRight, Loader2, LockKeyhole, Settings2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useI18n } from "@/lib/i18n";
import { SettingsDialog } from "@/components/SettingsDialog";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("admin@goland.local");
  const [password, setPassword] = useState("admin123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.login(email.trim(), password);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-background p-6">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-4 top-4"
        aria-label={t("settings.open")}
        title={t("settings.open")}
        onClick={() => setSettingsOpen(true)}
      >
        <Settings2 className="h-4 w-4" />
      </Button>

      <div className="w-full max-w-sm animate-slide-in">
        <div className="mb-8 flex items-center gap-3">
          <Logo className="h-10 w-10 rounded-lg" />
          <div>
            <div className="text-base font-semibold tracking-tight">Goland</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Web IDE</div>
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("login.subtitle")}</p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("login.email")}</Label>
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
            <Label htmlFor="password">{t("login.password")}</Label>
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
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
          <Button type="submit" className="h-9 w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            {t("login.signIn")}
            {!loading && <ArrowRight className="ml-auto h-4 w-4 opacity-60" />}
          </Button>
        </form>

        <div className="mt-6 text-center text-[10px] text-muted-foreground">
          {t("login.subtitle")}
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
