import { useEffect, useState } from "react";
import { ArrowRight, Loader2, LockKeyhole, Settings2, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useI18n } from "@/lib/i18n";
import { SettingsDialog } from "@/components/SettingsDialog";

export function LoginPage({
  onLogin,
  initialChallengeToken = "",
}: {
  onLogin: (user: User, mfaSetupRequired?: boolean) => void;
  initialChallengeToken?: string;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("admin@goland.local");
  const [password, setPassword] = useState("admin123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const [oidc, setOidc] = useState<{ enabled: boolean; name?: string; loginUrl?: string; error?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const challenge = initialChallengeToken || params.get("mfa_challenge") || "";
    if (challenge) setChallengeToken(challenge);
    const oidcError = params.get("oidc_error");
    if (oidcError) setError(oidcError);
    if (challenge || oidcError) {
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
    void api
      .oidcConfig()
      .then(setOidc)
      .catch(() => setOidc({ enabled: false }));
  }, [initialChallengeToken]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.login(email.trim(), password);
      if (result.mfaRequired && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        setError("");
        return;
      }
      if (result.mfaSetupRequired) onLogin(result.user, true);
      else onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.verifyMfa(challengeToken, code.trim());
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invalid authenticator code");
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

        {challengeToken ? (
          <form onSubmit={verify} className="mt-7 space-y-4">
            <div className="rounded-md border bg-card/50 p-3 text-xs text-muted-foreground">
              Enter the 6-digit code from your authenticator app, or a recovery code.
            </div>
            <div className="space-y-2">
              <Label htmlFor="mfa-code">Authenticator code</Label>
              <Input
                id="mfa-code"
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                className="font-code tracking-[0.3em]"
                required
              />
            </div>
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}
            <Button type="submit" className="h-9 w-full" disabled={loading || !code.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Verify
            </Button>
            <button
              type="button"
              className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setChallengeToken("");
                setCode("");
                setError("");
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
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
        )}

        {!challengeToken && oidc?.enabled && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            {oidc.error ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                SSO is configured but unavailable: {oidc.error}
              </div>
            ) : (
              <a
                href={oidc.loginUrl ?? "/api/auth/oidc/login"}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-card/50 text-xs font-medium transition-colors hover:bg-accent"
              >
                <ShieldCheck className="h-4 w-4" />
                Continue with {oidc.name ?? "single sign-on"}
              </a>
            )}
          </div>
        )}

        <div className="mt-6 text-center text-[10px] text-muted-foreground">
          {t("login.subtitle")}
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
