import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { User, Workspace } from "@/lib/types";
import { LoginPage } from "@/components/LoginPage";
import { WorkspaceHome } from "@/components/WorkspaceHome";
import { useI18n } from "@/lib/i18n";

const IDE = lazy(() => import("@/components/ide/IDE").then((module) => ({ default: module.IDE })));

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        {label}
      </div>
    </div>
  );
}

type Phase = "loading" | "login" | "ready";

export default function App() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedID, setSelectedID] = useState<string>(() => window.location.hash.replace(/^#\/?/, ""));

  const loadWorkspaces = useCallback(async () => {
    const result = await api.listWorkspaces();
    setWorkspaces(result.workspaces);
    return result.workspaces;
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(({ user: me }) => {
        if (!alive) return;
        setUser(me);
        return loadWorkspaces().then(() => alive && setPhase("ready"));
      })
      .catch(() => alive && setPhase("login"));
    return () => {
      alive = false;
    };
  }, [loadWorkspaces]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setPhase("login");
    };
    const onHash = () => setSelectedID(window.location.hash.replace(/^#\/?/, ""));
    window.addEventListener("goland:unauthorized", onUnauthorized);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("goland:unauthorized", onUnauthorized);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setPhase("login");
      window.location.hash = "";
    }
  };

  if (phase === "loading") {
    return <LoadingScreen label={t("app.opening")} />;
  }

  if (phase === "login" || !user) {
    return (
      <LoginPage
        onLogin={(me) => {
          setUser(me);
          setPhase("loading");
          loadWorkspaces()
            .then(() => setPhase("ready"))
            .catch(() => setPhase("ready"));
        }}
      />
    );
  }

  const selected = workspaces.find((workspace) => workspace.id === selectedID) ?? null;
  if (selected) {
    return (
      <Suspense fallback={<LoadingScreen label={t("app.opening")} />}>
        <IDE
          user={user}
          workspace={selected}
          onExit={() => {
            window.location.hash = "";
            setSelectedID("");
            void loadWorkspaces();
          }}
          onWorkspaceChanged={() => void loadWorkspaces()}
        />
      </Suspense>
    );
  }

  return (
    <WorkspaceHome
      user={user}
      workspaces={workspaces}
      onOpen={(workspace) => {
        window.location.hash = `/${workspace.id}`;
        setSelectedID(workspace.id);
      }}
      onRefresh={loadWorkspaces}
      onLogout={logout}
    />
  );
}
