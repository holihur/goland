import { useState } from "react";
import {
  ArrowRight,
  Clock3,
  GitBranch,
  HardDrive,
  LogOut,
  Plus,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { User, Workspace } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { AdminUsersDialog } from "./AdminUsersDialog";
import { relativeTime } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { LanguageToggle, useI18n } from "@/lib/i18n";
import { ThemeToggle } from "@/lib/theme";

export function WorkspaceHome({
  user,
  workspaces,
  onOpen,
  onRefresh,
  onLogout,
}: {
  user: User;
  workspaces: Workspace[];
  onOpen: (workspace: Workspace) => void;
  onRefresh: () => Promise<Workspace[]>;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const filtered = workspaces.filter((workspace) =>
    `${workspace.name} ${workspace.repoUrl ?? ""} ${workspace.rootPath}`.toLowerCase().includes(query.toLowerCase()),
  );

  const remove = async (workspace: Workspace) => {
    const message = t("home.deleteConfirm", { name: workspace.name }) + (workspace.managed ? t("home.deleteConfirmManaged") : "");
    if (!window.confirm(message)) {
      return;
    }
    try {
      await api.deleteWorkspace(workspace.id);
      await onRefresh();
      toast.success(t("home.workspaceDeleted"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("home.deleteFailed"));
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />

      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b px-5">
        <div className="flex items-center gap-2.5">
          <Logo className="h-7 w-7 rounded-md" />
          <span className="text-sm font-semibold tracking-tight">Goland</span>
          <Badge variant="secondary" className="ml-1 text-[9px] uppercase tracking-wider">
            web
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1.5 rounded-full border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t("home.apiConnected")}
          </div>
          <LanguageToggle compact />
          <ThemeToggle compact />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-accent">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-500 text-[11px] font-semibold text-white">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:block">{user.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-xs font-medium text-foreground">{user.name}</div>
                <div className="mt-0.5 truncate text-[11px] font-normal">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {user.role === "admin" && (
                <DropdownMenuItem onSelect={() => setUsersOpen(true)}>
                  <Users className="h-4 w-4" /> {t("home.manageUsers")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => toast.info(t("home.settingsSoon"))}>
                <Settings2 className="h-4 w-4" /> {t("home.preferences")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onLogout}>
                <LogOut className="h-4 w-4" /> {t("home.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
                <Sparkles className="h-3.5 w-3.5" /> {t("home.kicker")}
              </div>
              <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("home.greeting", { name: user.name.split(" ")[0] })}</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                {t("home.body")}
              </p>
            </div>
            <Button className="h-9 shrink-0 gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> {t("home.newWorkspace")}
            </Button>
          </div>

          <div className="mt-10 flex items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("home.filter")}
                className="pl-8"
              />
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t(filtered.length === 1 ? "home.workspaceCount" : "home.workspaceCountPlural", { count: filtered.length })}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-6 grid min-h-[320px] place-items-center rounded-xl border border-dashed bg-card/30">
              <div className="max-w-sm text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border bg-background/60">
                  <HardDrive className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="mt-4 text-base font-medium">
                  {workspaces.length === 0 ? t("home.noWorkspaces") : t("home.noMatches")}
                </h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {workspaces.length === 0 ? t("home.noWorkspacesBody") : t("home.noMatchesBody")}
                </p>
                {workspaces.length === 0 && (
                  <Button size="sm" className="mt-5" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> {t("home.addFirst")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((workspace) => (
                <div
                  key={workspace.id}
                  className="group relative flex cursor-pointer flex-col rounded-lg border bg-card/70 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-xl"
                  onClick={() => onOpen(workspace)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-md border bg-background/70">
                      {workspace.source === "git" ? (
                        <GitBranch className="h-4 w-4 text-sky-400" />
                      ) : (
                        <HardDrive className="h-4 w-4 text-emerald-400" />
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-0 group-hover:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => onOpen(workspace)}>
                          <ArrowRight className="h-4 w-4" /> {t("home.open")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-red-400" onSelect={() => void remove(workspace)}>
                          <Trash2 className="h-4 w-4" /> {t("home.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mt-4 min-w-0">
                    <h2 className="truncate text-sm font-medium">{workspace.name}</h2>
                    <p className="mt-1 truncate font-code text-[10px] text-muted-foreground">
                      {workspace.repoUrl ?? workspace.rootPath}
                    </p>
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t pt-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      {workspace.source === "git" && workspace.branch ? (
                        <>
                          <GitBranch className="h-3 w-3" /> {workspace.branch}
                        </>
                      ) : (
                        <>
                          <HardDrive className="h-3 w-3" /> {t("home.local")}
                        </>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5" title={workspace.updatedAt}>
                      <Clock3 className="h-3 w-3" /> {relativeTime(workspace.updatedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-12 flex flex-wrap items-center gap-4 rounded-lg border bg-card/30 px-4 py-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-emerald-400" /> {t("home.isolation")}
            </span>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <span>{t("home.languageServices")}</span>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <span>{t("home.encryptedGit")}</span>
          </div>
        </div>
      </main>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(workspace) => {
          void onRefresh();
          onOpen(workspace);
          toast.success(t("home.workspaceReady"));
        }}
      />
      <AdminUsersDialog open={usersOpen} onOpenChange={setUsersOpen} />
    </div>
  );
}
