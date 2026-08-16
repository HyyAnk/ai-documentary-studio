import { expect, test } from "@playwright/test";

test("workspace opens with an actionable empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Dashboard")).toBeVisible();
  await expect(page.getByRole("button", { name: /new channel/i }).first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Codex model" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
