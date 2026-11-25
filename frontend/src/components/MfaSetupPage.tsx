import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Loader2, LockKeyhole } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";

export function MfaSetupPage({ user, onComplete }: { user: User; onComplete: () => void }) {
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const setup = async () => {
    setLoading(true);
    try {
      const result = await api.setupMfa();
      setSecret(result.secret);
      setOtpauthUrl(result.otpauthUrl);
      setQr(await QRCode.toDataURL(result.otpauthUrl, { margin: 1, width: 220 }));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start MFA setup");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void setup();
    // Setup is intentionally started once when the forced-enrollment page mounts.
  }, []);

  const enable = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await api.enableMfa(code.trim());
      setRecoveryCodes(result.recoveryCodes);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invalid authenticator code");
    } finally {
      setLoading(false);
    }
  };

  const copy = (value: string, label: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    });
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-xl border bg-card/50 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Logo className="h-10 w-10 rounded-lg" />
          <div>
            <div className="text-base font-semibold tracking-tight">Secure your account</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">MFA enrollment required</div>
          </div>
        </div>

        {recoveryCodes.length > 0 ? (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-emerald-400" /> MFA enabled
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Store these recovery codes somewhere safe. Each code can be used once if you lose access to your
              authenticator.
            </p>
            <div className="grid grid-cols-2 gap-1 rounded-md border bg-background/60 p-3 font-code text-xs">
              {recoveryCodes.map((value) => (
                <span key={value}>{value}</span>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => copy(recoveryCodes.join("\n"), "recovery")}>
                {copied === "recovery" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copy codes
              </Button>
              <Button className="flex-1" onClick={onComplete}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={enable} className="mt-6 space-y-5">
            <p className="text-xs leading-5 text-muted-foreground">
              This server requires multi-factor authentication for <span className="font-medium text-foreground">{user.email}</span>.
              Scan the QR code with an authenticator app, then enter the 6-digit code.
            </p>
            <div className="flex flex-col items-center gap-3">
              {qr ? <img src={qr} alt="Authenticator QR code" className="h-[220px] w-[220px] rounded-lg bg-white p-2" /> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
              <div className="flex w-full items-center gap-1.5">
                <code className="min-w-0 flex-1 break-all rounded border bg-background/60 p-2 text-center font-code text-[11px]">{secret || "…"}</code>
                <Button type="button" variant="secondary" size="icon-sm" title="Copy secret" onClick={() => secret && copy(secret, "secret")}>
                  {copied === "secret" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              {otpauthUrl && <div className="w-full break-all text-center font-code text-[9px] text-muted-foreground">{otpauthUrl}</div>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mfa-setup-code">Authenticator code</Label>
              <Input
                id="mfa-setup-code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                className="text-center font-code text-lg tracking-[0.4em]"
                required
              />
            </div>
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-400">{error}</div>}
            <Button type="submit" className="h-9 w-full" disabled={loading || code.trim().length < 6 || !secret}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Enable MFA
            </Button>
            {error && (
              <button type="button" className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void setup()}>
                Restart setup
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
