import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.env.GOLAND_REPO_ROOT ?? resolve(process.cwd(), "..");
const pluginZip = process.env.GOLAND_E2E_DEMO_PLUGIN ?? resolve(repoRoot, "examples/plugins/demo/demo.zip");
const stamp = Date.now();
const email = `plugin-${stamp}@test.local`;
const bobEmail = `plugin-bob-${stamp}@test.local`;
const password = "member-password-1";
const workspaceName = `plugin-e2e-${stamp}`;
const workspacePath = `${repoRoot}/.data/workspaces/e2e-plugin-${stamp}`;
let workspaceID = "";

async function apiLogin(request: APIRequestContext, who = email) {
  const response = await request.post("/api/auth/login", { data: { email: who, password } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).csrfToken as string;
}

async function uiLogin(page: Page, who = email) {
  await page.goto("/");
  await page.getByLabel("Email").fill(who);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(page.getByText("New workspace", { exact: true })).toBeVisible({ timeout: 90_000 });
}

test.beforeAll(async ({ request }) => {
  const admin = await request.post("/api/auth/login", {
    data: { email: "admin@goland.local", password: "admin123456" },
  });
  expect(admin.ok()).toBeTruthy();
  const adminCsrf = (await admin.json()).csrfToken as string;
  for (const [who, name] of [[email, "Plugin Tester"], [bobEmail, "Plugin Bob"]] as const) {
    const response = await request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": adminCsrf },
      data: { email: who, name, password, role: "member" },
    });
    expect(response.status()).toBe(201);
  }
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(`${workspacePath}/notes.txt`, "hello\n");
  const csrf = await apiLogin(request);
  const created = await request.post("/api/workspaces", {
    headers: { "X-CSRF-Token": csrf },
    data: { name: workspaceName, source: "local", path: workspacePath },
  });
  expect(created.status()).toBe(201);
  workspaceID = (await created.json()).workspace.id;
});

test.afterAll(async ({ request }) => {
  try {
    const csrf = await apiLogin(request);
    await request.delete(`/api/workspaces/${workspaceID}`, { headers: { "X-CSRF-Token": csrf } });
  } catch {
    // best effort cleanup
  }
  rmSync(workspacePath, { recursive: true, force: true });
});

test("plugin install, enable, UI contributions, hooks and isolation", async ({ browser, request }) => {
  test.setTimeout(420_000);

  // Admin installs the packaged example through the UI upload.
  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await uiLogin(admin, "admin@goland.local");
  await admin.locator("header button").last().click();
  await admin.getByText("Plugins", { exact: true }).click();
  await admin.getByLabel("Upload plugin zip").setInputFiles(pluginZip);
  await expect(admin.getByText("Demo Toolkit", { exact: true })).toBeVisible({ timeout: 30_000 });
  await admin.keyboard.press("Escape");
  await admin.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await uiLogin(page);
  await page.getByText(workspaceName, { exact: true }).click();
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible();

  // Enable the plugin and keep defaults (Greeting=Hello, formatOnSave=true).
  await page.getByLabel("Workspace settings").click();
  const settings = page.getByTestId("plugin-settings");
  await expect(settings.getByText("Demo Toolkit")).toBeVisible({ timeout: 20_000 });
  await settings.getByLabel("Enable Demo Toolkit").check();
  await expect(page.getByText("Demo ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Declarative panel: run the scan action and read streamed output.
  await page.getByLabel("Demo toolkit").click();
  const panel = page.getByTestId("plugin-panel-demo-demo.panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Scan" }).click();
  await expect(panel.getByLabel("Demo toolkit output")).toContainText("notes.txt", { timeout: 20_000 });

  // Command palette includes plugin commands; execution shows output.
  await page.keyboard.press("Control+k");
  await page.getByText("Demo Toolkit: Say hello", { exact: true }).click();
  await expect(page.getByText("Hello!", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Save hook formats the file (trailing whitespace removed, newline ensured).
  await page.getByTestId("sidebar").getByText("notes.txt", { exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type("   ");
  await page.getByRole("button", { name: "Save file" }).first().click();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/workspaces/${workspaceID}/file?path=notes.txt`);
      if (!response.ok()) return "";
      return (await response.json()).content as string;
    }, { timeout: 20_000 })
    .toBe("hello\n");

  // Initialize a repository in the workspace and exercise the Git hook.
  await page.locator(".xterm-screen").click();
  await page.keyboard.type(
    `git init -q && git config user.email e2e@test.local && git config user.name E2E && git add -A && git commit -q -m initial`,
  );
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const response = await request.get(`/api/workspaces/${workspaceID}/git/log`);
      return response.status();
    }, { timeout: 30_000 })
    .toBe(200);
  await page.keyboard.type("echo change >> notes.txt && git add notes.txt");
  await page.keyboard.press("Enter");
  await page.getByLabel("Source control").click();
  await page.getByPlaceholder("Commit message").fill("block me");
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByText(/Demo plugin blocks commits/)).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Commit message").fill("allow me");
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByText(/Working tree clean/)).toBeVisible({ timeout: 20_000 });

  // Disabling stops the host and removes contributions from the UI.
  await page.getByLabel("Workspace settings").click();
  await page.getByTestId("plugin-settings").getByLabel("Enable Demo Toolkit").uncheck();
  await expect(page.getByText("Demo ready", { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await page.keyboard.press("Control+k");
  await expect(page.getByText("Demo Toolkit: Say hello", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect
    .poll(async () => {
      try {
        const output = execFileSync("pgrep", ["-f", "plugins/demo/1.0.0/bin/demo"], { encoding: "utf8" });
        return output.trim();
      } catch {
        return "";
      }
    }, { timeout: 20_000 })
    .toBe("");

  // Another tenant cannot address the workspace plugin state.
  const bobContext = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:8788" });
  await apiLogin(bobContext, bobEmail);
  const forbidden = await bobContext.get(`/api/workspaces/${workspaceID}/plugins`);
  expect(forbidden.status()).toBe(404);
  await bobContext.dispose();

  await page.screenshot({ path: "test-results/plugin.png", fullPage: true });
  await page.close();
});
