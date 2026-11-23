import { useState } from "react";
import { GitBranch, HardDrive, Loader2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Workspace } from "@/lib/types";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workspace: Workspace) => void;
}) {
  const [mode, setMode] = useState<"local" | "git">("local");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.createWorkspace({
        name: name.trim() || undefined,
        source: mode,
        path: mode === "local" ? path.trim() : undefined,
        repoUrl: mode === "git" ? repoUrl.trim() : undefined,
        branch: mode === "git" ? branch.trim() || undefined : undefined,
        token: mode === "git" ? token.trim() || undefined : undefined,
      });
      onCreated(result.workspace);
      onOpenChange(false);
      setName("");
      setPath("");
      setRepoUrl("");
      setBranch("");
      setToken("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create workspace");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            New workspace
          </DialogTitle>
          <DialogDescription>
            Import a directory already on the server, or clone a repository over HTTPS.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as "local" | "git")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="local" className="gap-1.5">
              <HardDrive className="h-3.5 w-3.5" /> Local directory
            </TabsTrigger>
            <TabsTrigger value="git" className="gap-1.5">
              <GitBranch className="h-3.5 w-3.5" /> Git repository
            </TabsTrigger>
          </TabsList>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Name (optional)</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="my-service"
              />
            </div>

            <TabsContent value="local" className="mt-0 space-y-2">
              <Label htmlFor="workspace-path">Server directory</Label>
              <Input
                id="workspace-path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/srv/projects/my-service"
                className="font-code text-xs"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Must be inside a directory configured by GOLAND_WORKSPACE_ROOTS.
              </p>
            </TabsContent>

            <TabsContent value="git" className="mt-0 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="repo-url">Repository URL</Label>
                <Input
                  id="repo-url"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/acme/service.git"
                  className="font-code text-xs"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="repo-branch">Branch (optional)</Label>
                  <Input
                    id="repo-branch"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="main"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="repo-token">Access token (optional)</Label>
                  <Input
                    id="repo-token"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="ghp_…"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Tokens are encrypted with AES-256-GCM before being stored in MongoDB.
              </p>
            </TabsContent>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {mode === "git" ? "Clone workspace" : "Add workspace"}
              </Button>
            </DialogFooter>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
