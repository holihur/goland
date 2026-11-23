import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.env.GOLAND_REPO_ROOT ?? resolve(process.cwd(), "..");
const stamp = Date.now();
const email = `layout-${stamp}@test.local`;
const password = "member-password-1";
const workspaceName = `layout-e2e-${stamp}`;
const workspacePath = `${repoRoot}/.data/workspaces/e2e-layout-${stamp}`;
let workspaceID = "";

async function apiLogin(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", { data: { email, password } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).csrfToken as string;
}

async function uiLogin(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(page.getByText("New workspace", { exact: true })).toBeVisible({ timeout: 90_000 });
}

async function dragTab(page: Page, from: Locator, to: Locator) {
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error("drag source/target is not visible");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2 + 10, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.beforeAll(async ({ request }) => {
  const admin = await request.post("/api/auth/login", {
    data: { email: "admin@goland.local", password: "admin123456" },
  });
  expect(admin.ok()).toBeTruthy();
  const csrf = (await admin.json()).csrfToken as string;
  const user = await request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": csrf },
    data: { email, name: "Layout Tester", password, role: "member" },
  });
  expect(user.status()).toBe(201);

  mkdirSync(workspacePath, { recursive: true });
  for (const [name, body] of [
    ["one.go", "package layout\n"],
    ["two.go", "package layout\n"],
    ["three.go", "package layout\n"],
  ]) {
    writeFileSync(`${workspacePath}/${name}`, body);
  }

  const memberCsrf = await apiLogin(request);
  const created = await request.post("/api/workspaces", {
    headers: { "X-CSRF-Token": memberCsrf },
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

test("window management: resize, dock, split, drag, persist and reset", async ({ browser }) => {
  test.setTimeout(420_000);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await uiLogin(page);
  await page.getByText(workspaceName, { exact: true }).click();
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible();

  const sidebar = page.getByTestId("sidebar");
  const groups = page.locator("[data-editor-group]");
  const g1 = page.locator('[data-editor-group="group-1"]');
  const g2 = page.locator('[data-editor-group="group-2"]');
  const g3 = page.locator('[data-editor-group="group-3"]');
  const panel = page.getByTestId("bottom-panel");

  // Open the first file and resize the sidebar by dragging its splitter.
  await sidebar.getByText("one.go", { exact: true }).click();
  await expect(page.locator('[data-editor-path="one.go"]')).toBeVisible();
  const initialSidebarWidth = (await sidebar.boundingBox())!.width;
  const sidebarBox = (await page.getByRole("separator", { name: "Resize sidebar" }).boundingBox())!;
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2, sidebarBox.y + sidebarBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2 + 90, sidebarBox.y + sidebarBox.height / 2, { steps: 6 });
  expect(await page.evaluate(() => document.body.style.userSelect)).toBe("none");
  await page.mouse.up();
  expect(await page.evaluate(() => document.body.style.userSelect)).toBe("");
  const resizedSidebarWidth = (await sidebar.boundingBox())!.width;
  expect(resizedSidebarWidth).toBeGreaterThan(initialSidebarWidth + 50);

  // Collapse and reopen with the keyboard shortcut; the width is preserved.
  await page.keyboard.press("Control+b");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await expect(page.getByTestId("sidebar")).toBeVisible();
  expect((await page.getByTestId("sidebar").boundingBox())!.width).toBeGreaterThan(initialSidebarWidth + 50);

  // Split right, then down, then right again up to the four group limit.
  await g1.getByRole("button", { name: "Split editor right" }).click();
  await expect(groups).toHaveCount(2);
  await page.getByTestId("sidebar").getByText("two.go", { exact: true }).click();
  await expect(g2.locator('[data-tab-path="two.go"]')).toBeVisible();
  await g2.getByRole("button", { name: "Split editor down" }).click();
  await expect(groups).toHaveCount(3);
  await g3.getByRole("button", { name: "Split editor right" }).click();
  await expect(groups).toHaveCount(4);
  await page.locator('[data-editor-group][data-active="true"]').getByRole("button", { name: "Split editor right" }).click();
  await expect(groups).toHaveCount(4);

  // Active group follows tab selection and is highlighted.
  await page.locator('[data-editor-group="group-1"] [data-tab-path="one.go"]').click();
  await expect(g1).toHaveAttribute("data-active", "true");
  await expect(g2).toHaveAttribute("data-active", "false");

  // Drag a tab to another group: the path appears in exactly one group.
  await dragTab(page, page.locator('[data-editor-group="group-2"] [data-tab-path="two.go"]'), g1);
  await expect(g1.locator('[data-tab-path="two.go"]')).toBeVisible();
  await expect(page.locator('[data-tab-path="two.go"]')).toHaveCount(1);

  // Dirty state, cursor content and the editor survive a cross-group drag.
  await g1.locator('[data-tab-path="one.go"]').click();
  await g1.locator('[data-editor-path="one.go"] .cm-content').click();
  await page.keyboard.type("// layout-note");
  await expect(g1.locator('[aria-label="Unsaved changes"]')).toBeVisible();
  await dragTab(page, g1.locator('[data-tab-path="one.go"]'), g2);
  await expect(g2.locator('[data-editor-path="one.go"] .cm-content')).toContainText("// layout-note");
  await expect(g2.locator('[aria-label="Unsaved changes"]')).toBeVisible();
  await g2.getByRole("button", { name: "Save file" }).click();
  await expect(g2.locator('[aria-label="Unsaved changes"]')).toHaveCount(0, { timeout: 15_000 });

  // Closing a group recycles its tabs into a neighbour.
  await g2.getByRole("button", { name: "Close editor group" }).click();
  await expect(groups).toHaveCount(3);
  await expect(page.locator('[data-tab-path="one.go"]')).toHaveCount(1);

  // Resize the bottom dock, select Output and maximize/restore it.
  const initialPanelHeight = (await panel.boundingBox())!.height;
  const bottomBox = (await page.getByRole("separator", { name: "Resize bottom panel" }).boundingBox())!;
  await page.mouse.move(bottomBox.x + bottomBox.width / 2, bottomBox.y + bottomBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bottomBox.x + bottomBox.width / 2, bottomBox.y + bottomBox.height / 2 - 70, { steps: 6 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.height).toBeGreaterThan(initialPanelHeight + 30);

  await panel.getByRole("button", { name: /Output/ }).click();
  await expect(panel.getByRole("button", { name: /Output/ })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Maximize panel" }).click();
  await expect(panel.getByRole("button", { name: "Restore panel size" })).toBeVisible();
  expect((await panel.boundingBox())!.height).toBeGreaterThan(500);
  await panel.getByRole("button", { name: "Restore panel size" }).click();

  // Closing and reopening the dock keeps the selected view.
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(page.getByTestId("bottom-panel")).toHaveCount(0);
  await page.keyboard.press("Control+`");
  await expect(page.getByTestId("bottom-panel")).toBeVisible();
  await expect(page.getByTestId("bottom-panel").getByRole("button", { name: /Output/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((key) => key.startsWith("goland.layout.") && key.endsWith(workspaceID))).toBe(true);

  // Reload restores groups, tabs, sidebar width and the bottom dock view.
  await page.waitForFunction(
    (id) => {
      const key = Object.keys(localStorage).find(
        (candidate) => candidate.startsWith("goland.layout.") && candidate.endsWith(id),
      );
      if (!key) return false;
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as { bottomOpen?: boolean; bottomView?: string };
      return stored.bottomOpen === true && stored.bottomView === "output";
    },
    workspaceID,
    { timeout: 10_000 },
  );
  await page.reload();
  await expect(page.getByText("Explorer", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(groups).toHaveCount(3);
  await expect(page.locator('[data-tab-path="one.go"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("bottom-panel").getByRole("button", { name: /Output/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await page.getByTestId("sidebar").boundingBox())!.width).toBeGreaterThan(initialSidebarWidth + 50);

  // Narrow viewports degrade to the active group without breaking.
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(groups).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Split editor right" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(groups).toHaveCount(3);

  // Reset layout from the command palette.
  await page.keyboard.press("Control+k");
  await page.getByText("Reset layout", { exact: true }).click();
  await expect(groups).toHaveCount(1);
  await expect(page.locator('[data-tab-path="one.go"]')).toBeVisible();

  await page.screenshot({ path: "test-results/layout.png", fullPage: true });
  await page.close();
});
