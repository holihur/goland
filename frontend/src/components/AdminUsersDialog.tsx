import { useEffect, useState } from "react";
import { Loader2, Shield, UserPlus, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function AdminUsersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.listUsers();
      setUsers(result.users);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not list users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      await api.createUser({ email: email.trim(), name: name.trim(), password, role });
      setEmail("");
      setName("");
      setPassword("");
      setRole("member");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create user");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Users &amp; access
          </DialogTitle>
          <DialogDescription>Admin-created accounts. Each user only sees their own workspaces.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
          <div className="min-h-[220px] rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium">Members</span>
              <span className="text-[10px] text-muted-foreground">{users.length} total</span>
            </div>
            <div className="max-h-[300px] divide-y overflow-auto">
              {loading && (
                <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}
              {!loading && users.length === 0 && (
                <div className="p-4 text-xs text-muted-foreground">No users yet.</div>
              )}
              {users.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{user.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
                  </div>
                  <Badge variant={user.role === "admin" ? "default" : "secondary"} className="shrink-0 gap-1">
                    {user.role === "admin" && <Shield className="h-2.5 w-2.5" />}
                    {user.role}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={create} className="space-y-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium">
              <UserPlus className="h-3.5 w-3.5 text-primary" /> Add member
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="dev@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-name">Display name</Label>
              <Input
                id="new-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Dev"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-password">Temporary password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 10 characters"
                minLength={10}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-role">Role</Label>
              <select
                id="new-user-role"
                value={role}
                onChange={(event) => setRole(event.target.value as "member" | "admin")}
                className="h-8 w-full rounded-md border border-input bg-background/50 px-2 text-sm"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
            {error && <div className="text-xs text-red-300">{error}</div>}
            <Button type="submit" className="w-full" disabled={creating}>
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create user
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
