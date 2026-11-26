import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { User, Workspace } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

const IDE = lazy(() => import("@/components/ide/IDE").then((module) => ({ default: module.IDE })));
const LoginPage = lazy(() =>
  import("@/components/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const WorkspaceHome = lazy(() =>
  import("@/components/WorkspaceHome").then((module) => ({ default: module.WorkspaceHome })),
);
const MfaSetupPage = lazy(() =>
  import("@/components/MfaSetupPage").then((module) => ({ default: module.MfaSetupPage })),
);

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

function parseRoute(hash: string): { workspaceID: string; file: string } {
  const raw = hash.replace(/^#\/?/, "");
  const separator = raw.indexOf("?");
  const workspaceID = separator >= 0 ? raw.slice(0, separator) : raw;
  const file = separator >= 0 ? new URLSearchParams(raw.slice(separator + 1)).get("file") ?? "" : "";
  return { workspaceID, file };
}

export default function App() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const initialRoute = parseRoute(window.location.hash);
  const [selectedID, setSelectedID] = useState<string>(initialRoute.workspaceID);
  const [selectedFile, setSelectedFile] = useState<string>(initialRoute.file);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    const result = await api.listWorkspaces();
    setWorkspaces(result.workspaces);
    return result.workspaces;
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(({ user: me, mfaSetupRequired: setup }) => {
        if (!alive) return;
        setUser(me);
        setMfaSetupRequired(setup);
        if (setup) {
          setPhase("ready");
          return;
        }
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
    const onHash = () => {
      const route = parseRoute(window.location.hash);
      setSelectedID(route.workspaceID);
      setSelectedFile(route.file);
    };
    window.addEventListener("goland:unauthorized", onUnauthorized);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("goland:unauthorized", onUnauthorized);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const updateFileURL = useCallback(
    (file?: string) => {
      const next = file ? `#/${selectedID}?file=${encodeURIComponent(file)}` : `#/${selectedID}`;
      setSelectedFile(file ?? "");
      if (window.location.hash !== next) window.history.replaceState(null, "", next);
    },
    [selectedID],
  );

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
      <Suspense fallback={<LoadingScreen label={t("app.opening")} />}>
        <LoginPage
          onLogin={(me, setupRequired = false) => {
            setUser(me);
            setMfaSetupRequired(setupRequired);
            if (setupRequired) {
              setPhase("ready");
              return;
            }
            setPhase("loading");
            loadWorkspaces()
              .then(() => setPhase("ready"))
              .catch(() => setPhase("ready"));
          }}
        />
      </Suspense>
    );
  }

  if (mfaSetupRequired) {
    return (
      <Suspense fallback={<LoadingScreen label={t("app.opening")} />}>
        <MfaSetupPage
          user={user}
          onComplete={() => {
            setMfaSetupRequired(false);
            setPhase("loading");
            loadWorkspaces()
              .then(() => setPhase("ready"))
              .catch(() => setPhase("login"));
          }}
        />
      </Suspense>
    );
  }

  const selected = workspaces.find((workspace) => workspace.id === selectedID) ?? null;
  if (selected) {
    return (
      <Suspense fallback={<LoadingScreen label={t("app.opening")} />}>
        <IDE
          key={selected.id}
          user={user}
          workspace={selected}
          initialFile={selectedFile}
          onFileChange={updateFileURL}
          onExit={() => {
            window.location.hash = "";
            setSelectedID("");
            setSelectedFile("");
            void loadWorkspaces();
          }}
          onWorkspaceChanged={() => void loadWorkspaces()}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingScreen label={t("app.opening")} />}>
      <WorkspaceHome
        user={user}
        workspaces={workspaces}
        onOpen={(workspace) => {
          window.location.hash = `/${workspace.id}`;
          setSelectedID(workspace.id);
          setSelectedFile("");
        }}
        onRefresh={loadWorkspaces}
        onLogout={logout}
      />
    </Suspense>
  );
}
