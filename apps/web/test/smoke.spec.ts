import { expect, test } from "@playwright/test";

test("workspace opens with an actionable empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /new channel/i }).first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Codex model" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("channel creation exposes uploaded DNA mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /new channel/i }).first().click();
  await page.getByRole("button", { name: "Upload DNA", exact: true }).click();
  await expect(page.getByLabel("Channel DNA file")).toHaveAttribute("accept", ".md,text/markdown");
  await expect(page.locator("form.modal").getByRole("button", { name: "Create channel", exact: true })).toBeDisabled();
});

test("channel detail keeps topic generation progress visible", async ({ page }) => {
  const channel = { channel_id: "ch_demo", slug: "demo", display_name: "Demo channel", description: "A demo channel", target_audience: "Viewers", language: "English", market: "Global", channel_dna_path: "channels/demo/channel_dna.md", style_guide_path: "channels/demo/style_guide.md", status: "ACTIVE", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z", episode_count: 0 };
  const task = { task_id: "task_demo", task_type: "SUGGEST_TOPICS", channel_id: "ch_demo", episode_id: null, status: "RUNNING", created_at: "2026-08-16T00:00:00.000Z", started_at: "2026-08-16T00:00:05.000Z", completed_at: null, codex_thread_id: "thread_demo", codex_turn_id: "turn_demo", error: null, output_files: [], lock_key: "ch_demo", queue_position: null, progress_message: "Receiving output", scene_number: null };
  await page.route("**/api/channels", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ channels: [channel] }) }));
  await page.route("**/api/tasks", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ tasks: [task], codex_status: "connected" }) }));
  await page.route("**/api/channels/ch_demo/dna", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: "# Channel DNA\n", path: channel.channel_dna_path, modified_at: channel.updated_at }) }));
  await page.route("**/api/channels/ch_demo/topics", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ topics: [] }) }));
  await page.route("**/api/channels/ch_demo/episodes", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ episodes: [] }) }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /01.*Demo channel/ })).toBeVisible();
  await page.getByRole("button", { name: /Demo channel/ }).click();
  await expect(page.getByRole("heading", { name: "Production status" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "At a glance" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View DNA", exact: true })).toBeVisible();
  await expect(page.getByText("# Channel DNA", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "View DNA", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide DNA", exact: true })).toBeVisible();
  await expect(page.getByText("# Channel DNA", { exact: true })).toBeVisible();
  await expect(page.getByText("Topic generation", { exact: true })).toBeVisible();
  await expect(page.getByText("Receiving output", { exact: false })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Topic generation progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled();
});
