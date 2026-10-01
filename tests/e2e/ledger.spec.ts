import { expect, test } from "@playwright/test";

test("expense create/edit/delete, filtering, export and persistence", async ({ page }) => {
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Merchant or description").fill("Browser test groceries");
  await page.getByLabel("Amount (INR)").fill("12.34");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("textbox", { name: "Search expenses" }).fill("Browser test");
  await expect(page.getByRole("cell", { name: "\u20b912.34", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const key = "pocketledger.synthetic-demo.v1";
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.profile.currency = "USD";
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole("textbox", { name: "Search expenses" }).fill("Browser test");
  await expect(page.getByText("Browser test groceries", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "\u20b912.34", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Browser test groceries" }).click();
  await page.getByLabel("Amount (INR)").fill("15.01");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByRole("cell", { name: "\u20b915.01", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toContain("pocketledger-");
  await page.getByRole("button", { name: "Delete Browser test groceries" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("No expenses found", { exact: true })).toBeVisible();
});

test("budget validation rejects excess allocations", async ({ page }) => {
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Edit budget", exact: true }).click();
  await page.getByLabel("Overall limit (INR)").fill("1.00");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("alert").last()).toContainText("allocations cannot exceed");
});

test("desktop and mobile render nonblank charts without page overflow", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await expect(page.locator(".recharts-area-area")).toBeVisible();
  await expect(page.locator(".recharts-area-curve")).toHaveAttribute("d", /^M.+/);
  await expect(page.locator(".demo-badge")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${info.project.name}-dashboard.png`, fullPage: true });
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Spending reports" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});