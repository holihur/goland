import type {
  APIToken,
  BYOKKey,
  ChatMessage,
  ContentReplaceResult,
  ContentSearchResult,
  Diagnostic,
  Entry,
  FileContent,
  GitBranch,
  GitConflict,
  GitStatus,
  TaskInfo,
  TaskRun,
  TestDiscovery,
  TestItem,
  TestRunResult,
  User,
  Workspace,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let csrfToken = "";

function readCookie(name: string) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

function currentCSRF() {
  return csrfToken || readCookie("goland_csrf");
}

function qs(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isForm && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method)) {
    const token = currentCSRF();
    if (token) headers.set("X-CSRF-Token", token);
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("goland:unauthorized"));
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "request_failed",
      payload?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return payload as T;
}

export const api = {
  login(email: string, password: string) {
    return request<{
      user: User;
      csrfToken?: string;
      mfaRequired?: boolean;
      challengeToken?: string;
      mfaSetupRequired?: boolean;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }).then((result) => {
      if (result.csrfToken) csrfToken = result.csrfToken;
      return result;
    });
  },
  oidcConfig() {
    return request<{ enabled: boolean; name?: string; issuer?: string; loginUrl?: string; error?: string }>(
      "/api/auth/oidc/config",
    );
  },
  verifyMfa(challengeToken: string, code: string) {
    return request<{ user: User; csrfToken: string }>("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code }),
    }).then((result) => {
      csrfToken = result.csrfToken;
      return result;
    });
  },
  mfaStatus() {
    return request<{ enabled: boolean; required: boolean; enrolledAt?: string; recoveryCodes: number }>(
      "/api/auth/mfa/status",
    );
  },
  setupMfa() {
    return request<{ secret: string; otpauthUrl: string }>("/api/auth/mfa/setup", { method: "POST" });
  },
  enableMfa(code: string) {
    return request<{ enabled: boolean; recoveryCodes: string[] }>("/api/auth/mfa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },
  disableMfa(password: string, code: string) {
    return request<void>("/api/auth/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ password, code }),
    });
  },
  logout() {
    return request<void>("/api/auth/logout", { method: "POST" });
  },
  me() {
    return request<{ user: User; mfaRequired: boolean; mfaSetupRequired: boolean }>("/api/auth/me");
  },
  listTokens() {
    return request<{ tokens: APIToken[] }>("/api/auth/tokens");
  },
  listByok() {
    return request<{ keys: BYOKKey[] }>("/api/auth/byok");
  },
  createByok(input: { provider: string; label: string; baseUrl: string; model: string; apiKey: string }) {
    return request<{ key: BYOKKey }>("/api/auth/byok", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  deleteByok(id: string) {
    return request<void>(`/api/auth/byok/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  listModels(input: { baseUrl?: string; apiKey?: string; keyId?: string }) {
    return request<{ models: string[] }>("/api/ai/models", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  chat(input: { keyId: string; model?: string; messages: ChatMessage[]; temperature?: number }) {
    return request<{ content: string; role: string; model: string; finish?: string; usage?: Record<string, unknown> }>(
      "/api/ai/chat",
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  createToken(input: { name: string; scopes: string[]; expiresInDays: number }) {
    return request<{ token: string; record: APIToken }>("/api/auth/tokens", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  deleteToken(id: string) {
    return request<void>(`/api/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  listUsers() {
    return request<{ users: User[] }>("/api/admin/users");
  },
  createUser(input: { email: string; name: string; password: string; role: "member" | "admin" }) {
    return request<{ user: User }>("/api/admin/users", { method: "POST", body: JSON.stringify(input) });
  },
  listWorkspaces() {
    return request<{ workspaces: Workspace[] }>("/api/workspaces");
  },
  getWorkspace(id: string) {
    return request<{ workspace: Workspace }>(`/api/workspaces/${id}`);
  },
  createWorkspace(input: {
    name?: string;
    source: "local" | "git";
    path?: string;
    repoUrl?: string;
    branch?: string;
    token?: string;
  }) {
    return request<{ workspace: Workspace }>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  deleteWorkspace(id: string) {
    return request<void>(`/api/workspaces/${id}`, { method: "DELETE" });
  },
  tree(workspaceId: string, path = "") {
    return request<{ entries: Entry[]; path: string }>(
      `/api/workspaces/${workspaceId}/tree${qs({ path })}`,
    );
  },
  readFile(workspaceId: string, path: string) {
    return request<FileContent>(`/api/workspaces/${workspaceId}/file${qs({ path })}`);
  },
  writeFile(workspaceId: string, path: string, content: string, etag?: string) {
    return request<FileContent>(`/api/workspaces/${workspaceId}/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content, etag }),
    });
  },
  createEntry(workspaceId: string, path: string, kind: "file" | "dir") {
    return request<Entry>(`/api/workspaces/${workspaceId}/entry`, {
      method: "POST",
      body: JSON.stringify({ path, kind }),
    });
  },
  renameEntry(workspaceId: string, from: string, to: string) {
    return request<void>(`/api/workspaces/${workspaceId}/rename`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    });
  },
  deleteEntry(workspaceId: string, path: string, recursive = false) {
    return request<void>(
      `/api/workspaces/${workspaceId}/entry${qs({ path, recursive })}`,
      { method: "DELETE" },
    );
  },
  search(workspaceId: string, query: string) {
    return request<{ results: Entry[] }>(
      `/api/workspaces/${workspaceId}/search${qs({ q: query, limit: 100 })}`,
    );
  },
  searchContent(
    workspaceId: string,
    input: { query: string; path?: string; regex?: boolean; caseSensitive?: boolean; limit?: number },
  ) {
    return request<ContentSearchResult>(
      `/api/workspaces/${workspaceId}/search/content${qs({
        q: input.query,
        path: input.path,
        regex: input.regex,
        caseSensitive: input.caseSensitive,
        limit: input.limit,
      })}`,
    );
  },
  replaceContent(
    workspaceId: string,
    input: { query: string; replacement: string; path?: string; regex?: boolean; caseSensitive?: boolean },
  ) {
    return request<ContentReplaceResult>(`/api/workspaces/${workspaceId}/search/replace`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  gitStatus(workspaceId: string) {
    return request<GitStatus>(`/api/workspaces/${workspaceId}/git/status`);
  },
  gitDiff(workspaceId: string, path: string, cached = false) {
    return request<{ diff: string; cached: boolean }>(
      `/api/workspaces/${workspaceId}/git/diff${qs({ path, cached })}`,
    );
  },
  gitConflict(workspaceId: string, path: string) {
    return request<GitConflict>(`/api/workspaces/${workspaceId}/git/conflict${qs({ path })}`);
  },
  gitResolve(workspaceId: string, path: string, resolution: "ours" | "theirs" | "both" | "mark" | "content", content = "") {
    return request<void>(`/api/workspaces/${workspaceId}/git/resolve`, {
      method: "POST",
      body: JSON.stringify({ path, resolution, content }),
    });
  },
  gitApplyPatch(workspaceId: string, patch: string, reverse = false) {
    return request<void>(`/api/workspaces/${workspaceId}/git/apply`, {
      method: "POST",
      body: JSON.stringify({ patch, reverse }),
    });
  },
  gitStage(workspaceId: string, path = "") {
    return request<void>(`/api/workspaces/${workspaceId}/git/stage`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },
  gitUnstage(workspaceId: string, path = "") {
    return request<void>(`/api/workspaces/${workspaceId}/git/unstage`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },
  gitCommit(workspaceId: string, message: string) {
    return request<{ output: string }>(`/api/workspaces/${workspaceId}/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  },
  gitBranches(workspaceId: string) {
    return request<{ branches: GitBranch[] }>(`/api/workspaces/${workspaceId}/git/branches`);
  },
  gitCreateBranch(workspaceId: string, branch: string) {
    return request<void>(`/api/workspaces/${workspaceId}/git/branch`, {
      method: "POST",
      body: JSON.stringify({ branch }),
    });
  },
  gitCheckout(workspaceId: string, branch: string) {
    return request<void>(`/api/workspaces/${workspaceId}/git/checkout`, {
      method: "POST",
      body: JSON.stringify({ branch }),
    });
  },
  gitPull(workspaceId: string) {
    return request<{ output: string }>(`/api/workspaces/${workspaceId}/git/pull`, { method: "POST" });
  },
  gitPush(workspaceId: string) {
    return request<{ output: string }>(`/api/workspaces/${workspaceId}/git/push`, { method: "POST" });
  },
  gitLog(workspaceId: string) {
    return request<{ log: string }>(`/api/workspaces/${workspaceId}/git/log`);
  },
  listTasks(workspaceId: string) {
    return request<{ tasks: TaskInfo[] }>(`/api/workspaces/${workspaceId}/tasks`);
  },
  runTask(workspaceId: string, taskId: string) {
    return request<{ run: TaskRun }>(`/api/workspaces/${workspaceId}/tasks/${taskId}/run`, {
      method: "POST",
    });
  },
  taskRuns(workspaceId: string) {
    return request<{ runs: TaskRun[] }>(`/api/workspaces/${workspaceId}/tasks/runs`);
  },
  listTests(workspaceId: string) {
    return request<TestDiscovery>(`/api/workspaces/${workspaceId}/tests`);
  },
  runTest(workspaceId: string, test: TestItem) {
    return request<TestRunResult>(`/api/workspaces/${workspaceId}/tests/run`, {
      method: "POST",
      body: JSON.stringify(test),
    });
  },
  diagnostics(workspaceId: string, path: string, content: string) {
    return request<{ diagnostics: Diagnostic[] }>(
      `/api/workspaces/${workspaceId}/diagnostics`,
      { method: "POST", body: JSON.stringify({ path, content }) },
    );
  },
  startBrowser(workspaceId: string, url: string) {
    return request<{ id: string; port: number }>(`/api/workspaces/${workspaceId}/browser/session`, {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  },
  stopBrowser(workspaceId: string, id: string) {
    return request<void>(`/api/workspaces/${workspaceId}/browser/session/${id}`, { method: "DELETE" });
  },
  reloadBrowser(workspaceId: string, id: string) {
    return request<void>(`/api/workspaces/${workspaceId}/browser/session/${id}/reload`, { method: "POST" });
  },
  debugConfig(workspaceId: string) {
    return request<{ chrome: string; node: string; dlv: string }>(
      `/api/workspaces/${workspaceId}/debug/config`,
    );
  },
};

export function websocketURL(path: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Keep development WebSockets off the Vite proxy: long build/debug sessions
  // can otherwise be closed by the proxy's idle timeout.
  if (import.meta.env.DEV) return `${protocol}//${window.location.hostname}:8788${path}`;
  return `${protocol}//${window.location.host}${path}`;
}

export function terminalSocket(workspaceId: string) {
  return websocketURL(`/api/ws/workspaces/${workspaceId}/terminal`);
}

export function lspSocket(workspaceId: string, language: "go" | "typescript") {
  return websocketURL(`/api/ws/workspaces/${workspaceId}/lsp?language=${language}`);
}

export function taskSocket(workspaceId: string, taskId: string) {
  return websocketURL(`/api/ws/workspaces/${workspaceId}/run?task=${encodeURIComponent(taskId)}`);
}

export function debugSocket(workspaceId: string, kind: "go" | "node" | "browser", adapterId?: string) {
  return websocketURL(`/api/ws/workspaces/${workspaceId}/debug/${kind}${adapterId ? `?session=${encodeURIComponent(adapterId)}` : ""}`);
}
