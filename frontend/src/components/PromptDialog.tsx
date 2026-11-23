import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PromptState {
  title: string;
  description?: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  danger?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
}

export function PromptDialog({
  state,
  onClose,
}: {
  state: PromptState | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(state?.initial ?? "");
    setError("");
    setBusy(false);
  }, [state]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state || !value.trim()) return;
    setBusy(true);
    setError("");
    try {
      await state.onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          {state?.description && <DialogDescription>{state.description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prompt-value">{state?.label}</Label>
            <Input
              id="prompt-value"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={state?.placeholder}
              className="font-code text-xs"
            />
          </div>
          {error && <div className="text-xs text-red-300">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={state?.danger ? "destructive" : "default"} disabled={busy || !value.trim()}>
              {state?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
