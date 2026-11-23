import { Moon, Sun } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { languages, useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <section className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t("settings.appearance")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "light", label: t("common.theme.light"), icon: Sun },
                { value: "dark", label: t("common.theme.dark"), icon: Moon },
              ] as const).map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTheme(option.value)}
                    aria-pressed={theme === option.value}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
                      theme === option.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "bg-card/50 text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <label
              htmlFor="settings-language"
              className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              {t("common.language")}
            </label>
            <select
              id="settings-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value as typeof language)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {languages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
