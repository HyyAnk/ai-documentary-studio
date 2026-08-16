import { expect, test } from "@playwright/test";

test("workspace opens with an actionable empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Production desk")).toBeVisible();
  await expect(page.getByRole("button", { name: /new channel/i }).first()).toBeVisible();
});
