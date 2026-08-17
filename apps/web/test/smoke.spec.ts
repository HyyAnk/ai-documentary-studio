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
  await expect(page.getByText("Receiving output", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Topic generation progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled();
});

test("episode generation stays visible and refreshes completed work without F5", async ({ page }) => {
  const channel = { channel_id: "ch_episode", slug: "episode-demo", display_name: "Episode demo", description: "A demo channel", target_audience: "Viewers", language: "English", market: "Global", channel_dna_path: "channels/episode-demo/channel_dna.md", style_guide_path: null, status: "ACTIVE", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z", episode_count: 1 };
  const episode = { episode_id: "ep_demo", channel_id: channel.channel_id, slug: "the-demo-story", topic: { title: "The Demo Story", premise: "A story used to verify realtime updates.", hook: "What happens next?" }, stage: "SCRIPT", script_path: "channels/episode-demo/episodes/the-demo-story/script.md", scene_plan_path: "channels/episode-demo/episodes/the-demo-story/scene_plan.json", dialogue_script_path: "channels/episode-demo/episodes/the-demo-story/dialogue_script.md", video_prompts_path: "channels/episode-demo/episodes/the-demo-story/video_prompts.md", created_at: channel.created_at, updated_at: channel.updated_at };
  let scriptContent = "Old script";
  let task = { task_id: "task_script", task_type: "GENERATE_SCRIPT", channel_id: channel.channel_id, episode_id: episode.episode_id, status: "RUNNING", created_at: "2026-08-16T00:00:00.000Z", started_at: "2026-08-16T00:00:05.000Z", completed_at: null as string | null, codex_thread_id: "thread_demo", codex_turn_id: "turn_demo", error: null, output_files: [] as string[], lock_key: episode.episode_id, queue_position: null, progress_message: "Writing the narrative", scene_number: null };

  await page.addInitScript(() => {
    const sockets: EventTarget[] = [];
    class MockWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      constructor() {
        super();
        sockets.push(this);
        window.setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }
      close() { this.readyState = 3; }
    }
    Object.defineProperty(window, "WebSocket", { value: MockWebSocket, configurable: true });
    Object.defineProperty(window, "__emitTaskEvent", { value: (event: unknown) => sockets.forEach((socket) => socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }))), configurable: true });
  });

  await page.route("**/api/channels", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ channels: [channel] }) }));
  await page.route("**/api/tasks", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ tasks: [task], codex_status: "connected" }) }));
  await page.route(`**/api/channels/${channel.channel_id}/dna`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: "# DNA", path: channel.channel_dna_path, modified_at: channel.updated_at }) }));
  await page.route(`**/api/channels/${channel.channel_id}/topics`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ topics: [] }) }));
  await page.route(`**/api/channels/${channel.channel_id}/episodes`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ episodes: [episode] }) }));
  await page.route(`**/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/file/script.md`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: scriptContent, path: episode.script_path, modified_at: episode.updated_at }) }));
  await page.route(`**/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/scenes`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ scenes: [] }) }));

  await page.goto("/");
  await page.getByRole("button", { name: /Episode demo/ }).click();
  await page.getByRole("button", { name: /The Demo Story/ }).click();

  await expect(page.getByRole("button", { name: "Generating script…", exact: true })).toBeDisabled();
  await expect(page.getByRole("progressbar", { name: "Script generation progress" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Active task progress" })).toBeVisible();
  await expect(page.getByText("Old script", { exact: true })).toBeVisible();

  scriptContent = "Fresh script received automatically";
  task = { ...task, status: "COMPLETED", completed_at: "2026-08-16T00:01:00.000Z", output_files: [episode.script_path], progress_message: "Script saved" };
  await page.evaluate((completedTask) => {
    (window as typeof window & { __emitTaskEvent: (event: unknown) => void }).__emitTaskEvent({ type: "task.updated", task: completedTask });
  }, task);

  await expect(page.getByText("Fresh script received automatically", { exact: true })).toBeVisible();
  await expect(page.getByText("Script ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Active task progress" })).toHaveCount(0);
});

test("scene audio updates inline and exposes the duration match action", async ({ page }) => {
  const channel = { channel_id: "ch_audio", slug: "audio-demo", display_name: "Audio demo", description: "A demo channel", target_audience: "Viewers", language: "English", market: "Global", channel_dna_path: "channels/audio-demo/channel_dna.md", style_guide_path: null, status: "ACTIVE", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z", episode_count: 1, voice_reference_path: null };
  const episode = { episode_id: "ep_audio", channel_id: channel.channel_id, slug: "audio-story", topic: { title: "The Audio Story", premise: "A story used to verify scene audio updates.", hook: "Can the voice keep up?" }, stage: "SCENE_READY", script_path: "channels/audio-demo/episodes/audio-story/script.md", scene_plan_path: "channels/audio-demo/episodes/audio-story/scene_plan.md", dialogue_script_path: "channels/audio-demo/episodes/audio-story/dialogue_script.md", video_prompts_path: "channels/audio-demo/episodes/audio-story/video_prompts.md", created_at: channel.created_at, updated_at: channel.updated_at };
  const scene = { scene_id: "scene_audio_1", episode_id: episode.episode_id, scene_number: 1, duration_seconds: 6, dialogue: "A line ready for local narration.", visual_prompt: "A quiet documentary shot.", transition_note: "", continuity_note: "", audio_asset_path: null as string | null, audio_generated_at: null as string | null, audio_duration_seconds: null as number | null };
  const completedScene = { ...scene, audio_asset_path: "channels/audio-demo/episodes/audio-story/assets/scene-01.wav", audio_generated_at: "2026-08-16T00:02:00.000Z", audio_duration_seconds: 8 };
  let scenes = [scene];
  let audioTask = null as Record<string, unknown> | null;

  await page.addInitScript(() => {
    const sockets: EventTarget[] = [];
    class MockWebSocket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      constructor() {
        super();
        sockets.push(this);
        window.setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }
      close() { this.readyState = 3; }
    }
    Object.defineProperty(window, "WebSocket", { value: MockWebSocket, configurable: true });
    Object.defineProperty(window, "__emitTaskEvent", { value: (event: unknown) => sockets.forEach((socket) => socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }))), configurable: true });
  });

  await page.route("**/api/config", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ video_generation: { provider: "none", model: "", max_scene_duration_seconds: 8, default_scene_duration_seconds: 6, aspect_ratio: "16:9" }, codex: { max_concurrent_tasks: 3, transport: "app_server", app_server_endpoint: "stdio://", command: "codex", model: "", experimental_api: false, api_base_url: "", api_key: "" }, audio_generation: { provider: "chatterbox", service_url: "http://127.0.0.1:8890", exaggeration: 0.5, cfg_weight: 0.5, max_concurrent_tasks: 2 } }) }));
  await page.route("**/api/git", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ branch: "main", dirty: false, changed_files: 0 }) }));
  await page.route("**/api/storage", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ path: "D:/Studio", default_path: "D:/Project", channel_path: "D:/Studio/channels", configured: true }) }));
  await page.route("**/api/codex/settings", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ settings: { transport: "app_server", model: "", api_base_url: "", has_api_key: false, app_server_endpoint: "stdio://", command: "codex" }, models: [], installation: { installed: false, command: "codex", version: null } }) }));
  await page.route("**/api/channels", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ channels: [channel] }) }));
  await page.route("**/api/tasks", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ tasks: audioTask ? [audioTask] : [], codex_status: "connected" }) }));
  await page.route(`**/api/channels/${channel.channel_id}/dna`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: "# DNA", path: channel.channel_dna_path, modified_at: channel.updated_at }) }));
  await page.route(`**/api/channels/${channel.channel_id}/topics`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ topics: [] }) }));
  await page.route(`**/api/channels/${channel.channel_id}/episodes`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ episodes: [episode] }) }));
  await page.route(`**/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/file/script.md`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: "A script", path: episode.script_path, modified_at: episode.updated_at }) }));
  await page.route(`**/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/scenes`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ scenes }) }));
  await page.route(`**/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/scenes/1/audio`, async (route) => {
    audioTask = { task_id: "task_audio", task_type: "GENERATE_AUDIO", channel_id: channel.channel_id, episode_id: episode.episode_id, status: "RUNNING", created_at: "2026-08-16T00:01:00.000Z", started_at: "2026-08-16T00:01:01.000Z", completed_at: null, codex_thread_id: null, codex_turn_id: null, error: null, output_files: [], lock_key: episode.episode_id, queue_position: null, progress_message: "Synthesizing dialogue", scene_number: 1 };
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ task: audioTask }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Audio demo/ }).click();
  await page.getByRole("button", { name: /The Audio Story/ }).click();
  await expect(page.getByRole("button", { name: "Generate Audio", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Generate Audio", exact: true }).click();
  await expect(page.locator(".scene-card .inline-task-state").filter({ hasText: "Synthesizing dialogue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate Audio", exact: true })).toBeDisabled();

  scenes = [completedScene];
  audioTask = { ...audioTask, status: "COMPLETED", completed_at: "2026-08-16T00:02:00.000Z", progress_message: "Audio ready", output_files: [completedScene.audio_asset_path] };
  await page.evaluate((completedTask) => {
    (window as typeof window & { __emitTaskEvent: (event: unknown) => void }).__emitTaskEvent({ type: "task.updated", task: completedTask });
  }, audioTask);

  await expect(page.getByLabel("Scene 1 dialogue audio")).toBeVisible();
  await expect(page.getByText("Audio is 2.0s longer", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Match duration", exact: true }).click();
  await expect(page.locator(".scene-card input[type=number]")).toHaveValue("8");
});
