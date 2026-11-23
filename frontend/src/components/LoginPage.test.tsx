import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { ApiError } from "@/lib/api";

const login = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, login: (...args: unknown[]) => login(...args) } };
});

const user = {
  id: "u1",
  email: "user@example.com",
  name: "User",
  role: "member" as const,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  login.mockReset();
});

describe("LoginPage", () => {
  it("submits trimmed credentials and reports success", async () => {
    login.mockResolvedValue({ user, csrfToken: "csrf" });
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);

    expect(screen.getByLabelText("Email")).toHaveValue("admin@goland.local");
    expect(screen.getByLabelText("Password")).toHaveValue("admin123456");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  user@example.com  " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(user));
    expect(login).toHaveBeenCalledWith("user@example.com", "secret");
  });

  it("shows API and generic errors", async () => {
    login.mockRejectedValueOnce(new ApiError(401, "invalid_credentials", "invalid email or password"));
    render(<LoginPage onLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(await screen.findByText("invalid email or password")).toBeInTheDocument();

    login.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(await screen.findByText("Unable to sign in")).toBeInTheDocument();
  });

  it("disables the button while signing in", async () => {
    let resolve!: (value: unknown) => void;
    login.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<LoginPage onLogin={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Sign in/ });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    resolve({ user, csrfToken: "csrf" });
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
