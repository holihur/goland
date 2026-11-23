import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const me = vi.fn();
const listWorkspaces = vi.fn();
const logout = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      me: (...args: unknown[]) => me(...args),
      listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
      logout: (...args: unknown[]) => logout(...args),
    },
  };
});

vi.mock("@/components/LoginPage", () => ({
  LoginPage: ({ onLogin }: { onLogin: (user: unknown) => void }) => (
    <button onClick={() => onLogin({ id: "u1", name: "User" })}>mock-login</button>
  ),
}));

vi.mock("@/components/WorkspaceHome", () => ({
  WorkspaceHome: ({ workspaces, onOpen, onLogout }: {
    workspaces: Array<{ id: string; name: string }>;
    onOpen: (workspace: { id: string; name: string }) => void;
    onLogout: () => void;
  }) => (
    <div>
      <span>home:{workspaces.length}</span>
      {workspaces.map((workspace) => (
        <button key={workspace.id} onClick={() => onOpen(workspace)}>{workspace.name}</button>
      ))}
      <button onClick={onLogout}>mock-logout</button>
    </div>
  ),
}));

vi.mock("@/components/ide/IDE", () => ({
  IDE: ({ workspace, onExit }: { workspace: { name: string }; onExit: () => void }) => (
    <div>
      <span>ide:{workspace.name}</span>
      <button onClick={onExit}>mock-exit</button>
    </div>
  ),
}));

const workspaces = [
  { id: "w1", name: "workspace-one" },
  { id: "w2", name: "workspace-two" },
];

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  me.mockReset();
  listWorkspaces.mockReset();
  logout.mockReset();
});

describe("App", () => {
  it("shows login when unauthenticated and loads workspaces after login", async () => {
    me.mockRejectedValue(new Error("unauthorized"));
    listWorkspaces.mockResolvedValue({ workspaces });
    render(<App />);
    expect(await screen.findByText("mock-login")).toBeInTheDocument();
    fireEvent.click(screen.getByText("mock-login"));
    expect(await screen.findByText("home:2")).toBeInTheDocument();
    expect(listWorkspaces).toHaveBeenCalled();
  });

  it("restores a session and opens a workspace from the hash", async () => {
    me.mockResolvedValue({ user: { id: "u1", name: "User" } });
    listWorkspaces.mockResolvedValue({ workspaces });
    window.location.hash = "#/w2";
    render(<App />);
    expect(await screen.findByText("ide:workspace-two")).toBeInTheDocument();
    fireEvent.click(screen.getByText("mock-exit"));
    await waitFor(() => expect(screen.getByText("home:2")).toBeInTheDocument());
  });

  it("reacts to hash changes and unauthorized events", async () => {
    me.mockResolvedValue({ user: { id: "u1", name: "User" } });
    listWorkspaces.mockResolvedValue({ workspaces });
    render(<App />);
    expect(await screen.findByText("home:2")).toBeInTheDocument();

    window.location.hash = "#/w1";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText("ide:workspace-one")).toBeInTheDocument();

    window.dispatchEvent(new Event("goland:unauthorized"));
    expect(await screen.findByText("mock-login")).toBeInTheDocument();
  });

  it("logs out and clears the selected workspace", async () => {
    me.mockResolvedValue({ user: { id: "u1", name: "User" } });
    listWorkspaces.mockResolvedValue({ workspaces });
    window.location.hash = "#/w1";
    render(<App />);
    expect(await screen.findByText("ide:workspace-one")).toBeInTheDocument();
    fireEvent.click(screen.getByText("mock-exit"));
    await screen.findByText("mock-logout");
    logout.mockResolvedValue(undefined);
    fireEvent.click(screen.getByText("mock-logout"));
    expect(await screen.findByText("mock-login")).toBeInTheDocument();
    expect(logout).toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("still enters the app when workspace loading fails after login", async () => {
    me.mockRejectedValue(new Error("unauthorized"));
    listWorkspaces.mockRejectedValue(new Error("offline"));
    render(<App />);
    fireEvent.click(await screen.findByText("mock-login"));
    expect(await screen.findByText("home:0")).toBeInTheDocument();
  });
});
