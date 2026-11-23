import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";

const repoRoot = process.env.GOLAND_REPO_ROOT ?? resolve(process.cwd(), "..");
const frontendRoot = process.env.GOLAND_FRONTEND_ROOT ?? process.cwd();

const stamp = Date.now();
const aliceEmail = `alice-${stamp}@test.local`;
const bobEmail = `bob-${stamp}@test.local`;
const password = "member-password-1";
const alicePath = `${repoRoot}/.data/workspaces/e2e-alice-${stamp}`;
let aliceWorkspaceID = "";
let alice: Awaited<ReturnType<typeof apiLogin>>;

async function apiLogin(request: APIRequestContext, email: string, pass: string) {
  const response = await request.post("/api/auth/login", { data: { email, password: pass } });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return { csrf: body.csrfToken as string, user: body.user as { id: string } };
}

async function uiLogin(page: Page, email: string, pass = password) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(page.getByText("New workspace", { exact: true })).toBeVisible({ timeout: 90_000 });
}

test.beforeAll(async ({ request }) => {
  const admin = await apiLogin(request, "admin@goland.local", "admin123456");
  for (const email of [aliceEmail, bobEmail]) {
    const response = await request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": admin.csrf },
      data: { email, name: email.split("@")[0], password, role: "member" },
    });
    expect(response.status()).toBe(201);
  }
  mkdirSync(alicePath, { recursive: true });
  alice = await apiLogin(request, aliceEmail, password);
  const response = await request.post("/api/workspaces", {
    headers: { "X-CSRF-Token": alice.csrf },
    data: { name: `alice-e2e-${stamp}`, source: "local", path: alicePath },
  });
  expect(response.status()).toBe(201);
  aliceWorkspaceID = (await response.json()).workspace.id;
});

test.afterAll(async ({ request }) => {
  try {
    alice = await apiLogin(request, aliceEmail, password);
    await request.delete(`/api/workspaces/${aliceWorkspaceID}`, {
      headers: { "X-CSRF-Token": alice.csrf },
    });
  } catch {
    // best effort cleanup
  }
  rmSync(alicePath, { recursive: true, force: true });
});

test("tenant isolation across API and UI", async ({ browser, request }) => {
  test.setTimeout(300_000);

  alice = await apiLogin(request, aliceEmail, password);
  const aliceWorkspaces = await request.get("/api/workspaces", {
    headers: { "X-CSRF-Token": alice.csrf },
  });
  expect((await aliceWorkspaces.json()).workspaces).toContainEqual(
    expect.objectContaining({ id: aliceWorkspaceID }),
  );

  // Bob's API session cannot see or address Alice's workspace.
  const bobContext = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8788" });
  const bob = await apiLogin(bobContext, bobEmail, password);
  const bobList = await bobContext.get("/api/workspaces");
  expect(JSON.stringify(await bobList.json())).not.toContain(aliceWorkspaceID);
  const forbidden = await bobContext.get(`/api/workspaces/${aliceWorkspaceID}`, {
    headers: { "X-CSRF-Token": bob.csrf },
  });
  expect(forbidden.status()).toBe(404);

  // Bob's UI does not show Alice's workspace.
  const bobPage = await browser.newPage();
  await uiLogin(bobPage, bobEmail);
  await expect(bobPage.getByText(`alice-e2e-${stamp}`, { exact: true })).toHaveCount(0);
  await bobPage.screenshot({ path: "test-results/bob-workspaces.png", fullPage: true });
  await bobPage.close();
  await bobContext.dispose();

  // Alice's UI does show it and can open the editor.
  const alicePage = await browser.newPage();
  await uiLogin(alicePage, aliceEmail);
  await alicePage.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await expect(alicePage.getByText("Explorer", { exact: true })).toBeVisible();
  await alicePage.screenshot({ path: "test-results/alice-editor.png", fullPage: true });
  await alicePage.close();
});


test("workspace creation from UI and file search", async ({ browser, request }) => {
  test.setTimeout(180_000);
  alice = await apiLogin(request, aliceEmail, password);
  const path = `/root/goland/.data/workspaces/e2e-ui-${stamp}`;
  mkdirSync(path, { recursive: true });
  writeFileSync(`${path}/search-me.go`, "package searchme\n");
  const name = `ui-${stamp}`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await uiLogin(page, aliceEmail);
  await page.getByRole("button", { name: "New workspace" }).click();
  await page.getByLabel("Name (optional)").fill(name);
  await page.getByLabel("Server directory").fill(path);
  await page.getByRole("button", { name: "Add workspace" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible();

  await page.getByLabel("Search", { exact: true }).click();
  await page.getByPlaceholder("Filename or path…").fill("search-me");
  await expect(page.locator("aside").getByText("search-me.go", { exact: true })).toBeVisible({ timeout: 20_000 });

  const list = await (await request.get("/api/workspaces")).json();
  const created = list.workspaces.find((workspace: { name: string }) => workspace.name === name);
  if (created) {
    await request.delete(`/api/workspaces/${created.id}`, { headers: { "X-CSRF-Token": alice.csrf } });
  }
  rmSync(path, { recursive: true, force: true });
  await page.close();
});

test("admin user management from the UI", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await uiLogin(page, "admin@goland.local", "admin123456");
  await page.locator("header button").last().click();
  await page.getByText("Manage users", { exact: true }).click();
  await expect(page.getByText("Users & access", { exact: true })).toBeVisible();
  const email = `managed-${stamp}@test.local`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill("Managed User");
  await page.getByLabel("Temporary password").fill("managed-password-1");
  await page.getByLabel("Role").selectOption("member");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.close();
});

test("file tree create, save, rename and delete", async ({ browser, request }) => {
  test.setTimeout(120_000);
  alice = await apiLogin(request, aliceEmail, password);
  const page = await browser.newPage();
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible();

  const oldName = `e2e-${stamp}.go`;
  const newName = `renamed-${stamp}.go`;

  await page.getByTitle("New file").click();
  await page.getByLabel("File path").fill(oldName);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator("aside").getByText(oldName, { exact: true })).toBeVisible();

  await page.locator(".cm-content").click();
  await page.keyboard.type(`package main

func main() { println("e2e") }
`);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => {
    const response = await request.get(`/api/workspaces/${aliceWorkspaceID}/file?path=${encodeURIComponent(oldName)}`);
    if (!response.ok()) return "";
    return (await response.json()).content as string;
  }, { timeout: 15_000 }).toContain('println("e2e")');

  const oldRow = page.locator("aside").getByText(oldName, { exact: true }).locator("..");
  await oldRow.hover();
  await oldRow.locator("button").last().click();
  await page.getByText("Rename…", { exact: true }).click();
  await page.locator("#prompt-value").fill(newName);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator("aside").getByText(newName, { exact: true })).toBeVisible();

  page.on("dialog", (dialog) => void dialog.accept());
  const newRow = page.locator("aside").getByText(newName, { exact: true }).locator("..");
  await newRow.hover();
  await newRow.locator("button").last().click();
  await page.getByText("Delete", { exact: true }).click();
  await expect(page.locator("aside").getByText(newName, { exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    const response = await request.get(`/api/workspaces/${aliceWorkspaceID}/file?path=${encodeURIComponent(newName)}`);
    return response.status();
  }, { timeout: 10_000 }).toBe(404);

  await page.screenshot({ path: "test-results/file-tree.png", fullPage: true });
  await page.close();
});


test("editor save, dirty close confirm and 409 conflict", async ({ browser, request }) => {
  test.setTimeout(300_000);

  alice = await apiLogin(request, aliceEmail, password);
  const put = async (path: string, content: string, etag?: string) => {
    const response = await request.put(`/api/workspaces/${aliceWorkspaceID}/file`, {
      headers: { "X-CSRF-Token": alice.csrf },
      data: { path, content, etag },
    });
    expect(response.ok()).toBeTruthy();
    return response.json() as Promise<{ etag: string; content: string }>;
  };
  await put("main.go", 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("one") }\n');
  await put("go.mod", "module example.com/editor\n\ngo 1.22\n");

  const page = await browser.newPage();
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible();
  await page.locator("aside").getByText("main.go", { exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("fmt.Println");

  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// saved by e2e");
  const tab = page.locator('[role="tab"]').filter({ hasText: "main.go" });
  await expect(tab.locator("span.bg-amber-300")).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(async () => {
    const response = await request.get(`/api/workspaces/${aliceWorkspaceID}/file?path=main.go`);
    return (await response.json()).content as string;
  }, { timeout: 15_000 }).toContain("saved by e2e");

  // Change the file behind the editor's back, then save to trigger the 409 flow.
  const current = await (await request.get(`/api/workspaces/${aliceWorkspaceID}/file?path=main.go`)).json();
  await put("main.go", 'package main\n\n// external change\n', current.etag);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// local edit");
  let conflictMessage = "";
  page.once("dialog", async (dialog) => {
    conflictMessage = dialog.message();
    await dialog.accept();
  });
  await page.keyboard.press("Control+s");
  await expect.poll(() => conflictMessage, { timeout: 10_000 }).toContain("changed on disk");
  await expect(page.locator(".cm-content")).toContainText("external change");

  // The dirty tab must ask for confirmation before closing.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// unsaved");
  let closeMessage = "";
  page.once("dialog", async (dialog) => {
    closeMessage = dialog.message();
    await dialog.accept();
  });
  await tab.locator("button").last().click();
  await expect.poll(() => closeMessage, { timeout: 10_000 }).toContain("without saving");
  await expect(page.locator('[role="tab"]').filter({ hasText: "main.go" })).toHaveCount(0);

  await page.screenshot({ path: "test-results/editor-conflict.png", fullPage: true });
  await page.close();
});

test("terminal runs as workspace UID, resizes and cleans up processes", async ({ browser, request }) => {
  test.setTimeout(300_000);
  await apiLogin(request, aliceEmail, password);
  const { mkdirSync: mkdir, writeFileSync, chmodSync } = await import("node:fs");
  const { join } = await import("node:path");
  const secretDir = join(alicePath, "locked");
  mkdir(secretDir, { recursive: true });
  chmodSync(secretDir, 0o700);
  const secretFile = join(secretDir, "secret.txt");
  writeFileSync(secretFile, "do-not-leak");

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await page.locator(".xterm-screen").click();
  await page.waitForTimeout(700);

  const rows = page.locator(".xterm-rows");
  await page.keyboard.type("clear; pwd; id -u; go version; pnpm --version");
  await page.keyboard.press("Enter");
  await expect.poll(async () => await rows.innerText(), { timeout: 25_000 }).toContain("12.15.0");
  let screen = await rows.innerText();
  expect(screen).not.toContain("uid=0");
  expect(screen).toContain("go version go");
  expect(screen).toContain("12.15.0");
  expect(Number((screen.match(/\n(\d{5,})\n/) ?? [])[1] ?? 0)).toBeGreaterThan(1000);

  await page.keyboard.type("echo SIZE1:$(stty size)");
  await page.keyboard.press("Enter");
  await expect.poll(async () => await rows.innerText(), { timeout: 10_000 }).toMatch(/SIZE1:\d+ \d+/);
  const firstColumns = Number(((await rows.innerText()).match(/SIZE1:\d+ (\d+)/) ?? [])[1]);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(900);
  await page.keyboard.type("echo SIZE2:$(stty size)");
  await page.keyboard.press("Enter");
  await expect.poll(async () => await rows.innerText(), { timeout: 10_000 }).toMatch(/SIZE2:\d+ \d+/);
  screen = await rows.innerText();
  const secondColumns = Number(((screen.match(/SIZE2:\d+ (\d+)/) ?? [])[1]));
  expect(firstColumns).toBeGreaterThan(0);
  expect(secondColumns).toBeLessThan(firstColumns);

  await page.keyboard.type(`cat ${secretFile} 2>/dev/null && echo DATA_LEAK || echo ACCESS_DENIED`);
  await page.keyboard.press("Enter");
  await expect.poll(async () => await rows.innerText(), { timeout: 10_000 }).toContain("ACCESS_DENIED");

  await page.keyboard.type("sleep 60 & echo SLEEP_PID:$!");
  await page.keyboard.press("Enter");
  await expect.poll(async () => {
    const match = (await rows.innerText()).match(/SLEEP_PID:(\d+)/);
    return match ? Number(match[1]) : 0;
  }, { timeout: 10_000 }).toBeGreaterThan(0);
  const sleepPID = Number(((await rows.innerText()).match(/SLEEP_PID:(\d+)/) ?? [])[1]);
  await page.getByLabel("Close panel").click();
  await expect.poll(async () => {
    try {
      process.kill(sleepPID, 0);
      return true;
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(false);

  await page.screenshot({ path: "test-results/terminal.png", fullPage: true });
  await page.close();
});

test("task runner streams Go/pnpm output, cancels process tree and isolates history", async ({ browser, request }) => {
  test.setTimeout(300_000);

  alice = await apiLogin(request, aliceEmail, password);
  const put = async (path: string, content: string) => {
    const response = await request.put(`/api/workspaces/${aliceWorkspaceID}/file`, {
      headers: { "X-CSRF-Token": alice.csrf },
      data: { path, content },
    });
    expect(response.ok()).toBeTruthy();
  };
  await put("go.mod", "module example.com/e2e\n\ngo 1.22\n");
  await put("sample_test.go", 'package main\n\nimport "testing"\n\nfunc TestOK(t *testing.T) { t.Log("GO_TEST_OK") }\n');
  await put("package.json", JSON.stringify({
    scripts: {
      e2e: "node -e \"console.log('PNPM_E2E_OK')\"",
      slow: "node slow.js",
    },
  }, null, 2));
  await put("slow.js", 'console.log("SLOW_PID:" + process.pid); setInterval(() => {}, 1000);\n');

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("go test ./...", { exact: true }).click();
  const output = page.locator("pre").last();
  await expect.poll(async () => await output.innerText(), { timeout: 240_000 }).toContain("[exit 0");
  expect(await output.innerText()).toContain("example.com/e2e");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("pnpm run e2e", { exact: true }).click();
  await expect.poll(async () => await output.innerText(), { timeout: 30_000 }).toContain("PNPM_E2E_OK");
  await expect.poll(async () => await output.innerText(), { timeout: 10_000 }).toContain("[exit 0");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("pnpm run slow", { exact: true }).click();
  await expect.poll(async () => await output.innerText(), { timeout: 20_000 }).toContain("SLOW_PID:");
  const slowPID = Number(((await output.innerText()).match(/SLOW_PID:(\d+)/) ?? [])[1]);
  expect(slowPID).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(async () => await output.innerText(), { timeout: 10_000 }).toContain("cancelled");
  await expect.poll(async () => {
    try {
      process.kill(slowPID, 0);
      return true;
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(false);

  const runs = await (await request.get(`/api/workspaces/${aliceWorkspaceID}/tasks/runs`)).json();
  expect(runs.runs).toEqual(expect.arrayContaining([
    expect.objectContaining({ command: "pnpm run e2e", status: "success" }),
    expect.objectContaining({ command: "pnpm run slow", status: "cancelled" }),
  ]));
  const bob = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8788" });
  await apiLogin(bob, bobEmail, password);
  const hidden = await bob.get(`/api/workspaces/${aliceWorkspaceID}/tasks/runs`);
  expect(hidden.status()).toBe(404);
  await bob.dispose();

  await page.screenshot({ path: "test-results/tasks.png", fullPage: true });
  await page.close();
});

function debugProcesses(root: string, markers: string[]) {
  const found: string[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readlinkSync(`/proc/${entry}/cwd`) !== root) continue;
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ");
      if (markers.some((marker) => cmdline.includes(marker))) found.push(`${entry}:${cmdline}`);
    } catch {
      // process disappeared
    }
  }
  return found;
}

test("Go DAP breakpoints, stepping, continue and cleanup", async ({ browser, request }) => {
  test.setTimeout(600_000);

  alice = await apiLogin(request, aliceEmail, password);
  const put = async (path: string, content: string) => {
    const response = await request.put(`/api/workspaces/${aliceWorkspaceID}/file`, {
      headers: { "X-CSRF-Token": alice.csrf },
      data: { path, content },
    });
    expect(response.ok()).toBeTruthy();
  };
  await put("go.mod", "module example.com/debug\n\ngo 1.22\n");
  await put("main.go", 'package main\n\nimport "fmt"\n\nfunc add(a, b int) int {\n\treturn a + b\n}\n\nfunc main() {\n\tfmt.Println(add(2, 3))\n}\n');
  await put("debug.js", 'function add(a, b) {\n  const total = a + b;\n  return total;\n}\nconsole.log(add(2, 3));\nsetInterval(() => {}, 1000);\n');

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible();

  // Go: breakpoint on `return a + b`.
  await page.locator("aside").getByText("main.go", { exact: true }).click();
  await page.locator(".cm-line").nth(5).click();
  await page.keyboard.press("F9");
  await page.keyboard.press("F5");
  await page.getByRole("button", { name: /Start debugging/ }).click();
  await expect(page.getByText("main.add", { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Locals", { exact: true })).toBeVisible();
  await page.getByTitle("Step over").click();
  await expect.poll(async () => (await page.locator("body").innerText()).includes("stopped"), { timeout: 30_000 }).toBe(true);
  await page.getByTitle("Continue (F5)").click();
  await expect.poll(async () => (await page.locator("body").innerText()).includes("terminated"), { timeout: 30_000 }).toBe(true);
  await page.getByLabel("Explorer (⌘B)").click();
  await expect.poll(() => debugProcesses(alicePath, ["dlv", "__debug_bin"]).length, { timeout: 20_000 }).toBe(0);

  await page.close();
});

test("Node DAP breakpoint, variables and cleanup", async ({ browser, request }) => {
  test.setTimeout(240_000);

  alice = await apiLogin(request, aliceEmail, password);
  const put = async (path: string, content: string) => {
    const response = await request.put(`/api/workspaces/${aliceWorkspaceID}/file`, {
      headers: { "X-CSRF-Token": alice.csrf },
      data: { path, content },
    });
    expect(response.ok()).toBeTruthy();
  };
  await put("debug.js", 'function add(a, b) {\n  const total = a + b;\n  return total;\n}\nsetTimeout(() => { console.log(add(2, 3)); }, 3000);\nsetInterval(() => {}, 1000);\n');
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByText("debug.js", { exact: true }).click();
  await page.locator(".cm-line").nth(2).click();
  await page.keyboard.press("F9");
  await page.keyboard.press("F5");
  await page.getByRole("button", { name: "node", exact: true }).click();
  await page.getByRole("button", { name: /Start debugging/ }).click();
  await expect(page.locator("aside").getByText("global.add", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect.poll(async () => await page.locator("aside").innerText(), { timeout: 20_000 }).toMatch(/total\s*=\s*5/);
  await page.getByTitle("Step over").click();
  await page.waitForTimeout(800);
  await page.getByTitle("Continue (F5)").click();
  await page.waitForTimeout(800);
  await page.getByTitle("Stop").click();
  await page.getByLabel("Explorer (⌘B)").click();
  await expect.poll(() => debugProcesses(alicePath, ["debug.js", "dapDebugServer.js"]).length, { timeout: 20_000 }).toBe(0);

  await page.screenshot({ path: "test-results/dap-node.png", fullPage: true });
  await page.close();
});

test("IDE shell, shortcuts, terminal, Git panel and narrow viewport", async ({ browser, request }) => {
  test.setTimeout(240_000);

  alice = await apiLogin(request, aliceEmail, password);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible();

  // Terminal remains functional.
  const terminalRows = page.locator(".xterm-rows");
  await expect.poll(async () => await terminalRows.innerText(), { timeout: 20_000 }).toContain(alicePath);
  await page.locator(".xterm-screen").click();
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  await expect.poll(async () => await terminalRows.innerText(), { timeout: 10_000 }).toContain(alicePath);

  // Initialize Git as the workspace owner without relying on terminal typing.
  const uid = statSync(alicePath).uid;
  const gid = statSync(alicePath).gid;
  execFileSync("git", ["init", "-q"], { cwd: alicePath });
  execFileSync("git", ["-c", "safe.directory=*", "add", "-A"], { cwd: alicePath });
  execFileSync("git", ["-c", "safe.directory=*", "-c", "user.email=e2e@test.local", "-c", "user.name=E2E", "commit", "--allow-empty", "-q", "-m", "initial"], { cwd: alicePath });
  execFileSync("chown", ["-R", `${uid}:${gid}`, alicePath]);

  // Edit a file through the API, then exercise the Git panel.
  const file = await request.put(`/api/workspaces/${aliceWorkspaceID}/file`, {
    headers: { "X-CSRF-Token": alice.csrf },
    data: { path: "gitfile.txt", content: "git panel\n" },
  });
  expect(file.ok()).toBeTruthy();
  await page.getByLabel("Source control").click();
  const row = page.locator("aside").getByText("gitfile.txt", { exact: true });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await row.locator("..").hover();
  await row.locator("..").locator('button[title="Stage"]').click();
  await page.getByPlaceholder("Commit message").fill("add git file");
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByText(/Working tree clean/)).toBeVisible({ timeout: 20_000 });

  await page.getByTitle("Create branch").click();
  await page.locator("#prompt-value").fill("e2e-feature");
  await page.getByRole("button", { name: "Create & switch", exact: true }).click();
  await expect(page.locator("aside select")).toHaveValue("e2e-feature");

  // File search.
  await page.getByLabel("Search", { exact: true }).click();
  await page.getByPlaceholder("Filename or path…").fill("gitfile");
  await expect(page.locator("aside").getByText("gitfile.txt", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Command palette and narrow layout.
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Search files or run a command…")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.getByLabel("Explorer (⌘B)")).toBeVisible();
  expect(pageErrors).toEqual([]);

  await page.screenshot({ path: "test-results/ide-shell.png", fullPage: true });
  await page.close();
});


test("Browser CDP debugging with source maps and cleanup", async ({ browser, request }) => {
  test.setTimeout(600_000);

  alice = await apiLogin(request, aliceEmail, password);
  const put = async (path: string, content: string) => {
    const response = await request.put(`/api/workspaces/${aliceWorkspaceID}/file`, {
      headers: { "X-CSRF-Token": alice.csrf },
      data: { path, content },
    });
    expect(response.ok()).toBeTruthy();
  };
  await put("web/index.html", '<!doctype html><html><body><h1 id="app">loading</h1><script type="module" src="./dist/app.js"></script></body></html>');
  await put("web/app.ts", 'type User = { name: string };\n\nfunction greeting(user: User): string {\n  debugger;\n  const message = `Hello, ${user.name}`;\n  return message;\n}\n\nsetTimeout(() => {\n  const target = document.getElementById("app");\n  if (target) target.textContent = greeting({ name: "Ada" });\n}, 30000);\n');
  const uid = statSync(alicePath).uid;
  const gid = statSync(alicePath).gid;
  execFileSync(resolve(frontendRoot, "node_modules/.bin/tsc"), ["app.ts", "--target", "ES2022", "--module", "ES2022", "--sourceMap", "--outDir", "dist"], { cwd: `${alicePath}/web` });
  execFileSync("chown", ["-R", `${uid}:${gid}`, alicePath]);
  const server = createServer((req, res) => {
    const rel = req.url === "/" ? "index.html" : (req.url ?? "").replace(/^\//, "");
    try {
      const data = readFileSync(`${alicePath}/web/${rel}`);
      if (rel.endsWith(".js")) res.setHeader("Content-Type", "text/javascript");
      if (rel.endsWith(".map")) res.setHeader("Content-Type", "application/json");
      if (rel.endsWith(".html")) res.setHeader("Content-Type", "text/html");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  console.log("browser: login");
  await uiLogin(page, aliceEmail);
  await page.getByText(`alice-e2e-${stamp}`, { exact: true }).click();
  console.log("browser: workspace");
  await page.getByText("web", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByText("app.ts", { exact: true }).last().click();
  await page.waitForTimeout(1000);
  await page.locator(".cm-line").nth(3).click();
  await page.keyboard.press("F9");
  console.log("browser: breakpoint");
  await page.keyboard.press("F5");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "browser", exact: true }).click();
  await page.locator("#debug-url").fill(`http://127.0.0.1:${port}/index.html`);
  console.log("browser: start");
  await page.getByRole("button", { name: /Start debugging/ }).click();
  await expect(page.getByRole("button", { name: /greeting app\.ts/ })).toBeVisible({ timeout: 240_000 });
  console.log("browser: stopped");
  await expect.poll(async () => await page.locator("aside").innerText(), { timeout: 20_000 }).toMatch(/name\s*[:=]\s*['"]Ada['"]/);
  await page.getByTitle("Step over").click();
  await page.waitForTimeout(800);
  await page.getByTitle("Continue (F5)").click();
  await page.getByTitle("Stop").click();
  await page.getByLabel("Explorer (⌘B)").click();
  await expect.poll(() => debugProcesses(alicePath, ["--headless=new", "dapDebugServer.js"]).length, { timeout: 20_000 }).toBe(0);

  await page.screenshot({ path: "test-results/browser-dap.png", fullPage: true });
  await page.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
