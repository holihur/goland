export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  rootPath: string;
  source: "local" | "git";
  repoUrl?: string;
  branch?: string;
  managed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size?: number;
  modifiedAt?: string;
}

export interface FileContent {
  path: string;
  content?: string;
  etag?: string;
  size: number;
  modifiedAt: string;
  binary: boolean;
}

export interface GitFileStatus {
  path: string;
  origPath?: string;
  index: string;
  worktree: string;
}

export interface GitStatus {
  branch: string;
  detached: boolean;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface TaskInfo {
  id: string;
  label: string;
  kind: "go" | "pnpm";
  command: string;
  args: string[];
}

export interface TaskRun {
  id: string;
  workspaceId: string;
  kind: string;
  command: string;
  status: string;
  exitCode: number;
  output: string;
  createdAt: string;
  finishedAt?: string;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  source?: string;
}

export interface DebugSession {
  id: string;
  language: "go" | "node" | "browser";
  status: "starting" | "running" | "stopped" | "terminated";
  config: Record<string, unknown>;
}
