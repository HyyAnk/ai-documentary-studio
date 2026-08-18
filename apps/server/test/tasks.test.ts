import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/context.js";
import { StudioLogger } from "../src/logger.js";
import { RepositoryService } from "../src/repository.js";
import { TaskManager } from "../src/tasks.js";
import type { AudioProvider } from "../src/providers/index.js";

const roots: string[] = [];

class FakeCodex extends EventEmitter {
  private turnNumber = 0;
  activeTurns = 0;
  maxActiveTurns = 0;
  deletedThreads: string[] = [];
  async connect(): Promise<void> { this.emit("status", "connected"); }
  async startThread(): Promise<string> { return `thread_${this.turnNumber + 1}`; }
  async resumeThread(threadId: string): Promise<string> { return threadId; }
  async startTurn(threadId: string, prompt = ""): Promise<string> {
    const turnId = `turn_${++this.turnNumber}`;
    this.activeTurns += 1;
    this.maxActiveTurns = Math.max(this.maxActiveTurns, this.activeTurns);
    setTimeout(() => {
      const visualBible = prompt.includes("Task type: GENERATE_VISUAL_BIBLE");
      const strictVisualRetry = visualBible && prompt.includes("STRICT RETRY");
      const validVisualBible = "# Episode Visual Bible\n\n" + Array.from({ length: 5 }, (_, index) => `## Continuity bundle CB-0${index + 1} — Bundle ${index + 1}\n\n- Era: 1950s\n- Location: Test location\n- Subjects: Test subject\n- Palette: Warm neutral\n- Lighting: Soft side light\n- Anchor-frame prompt: A coherent documentary environment for bundle ${index + 1}.\n- Reference asset slots: anchor`).join("\n\n");
      const delta = prompt.includes("Generate exactly one reference image")
        ? "data:image/png;base64,iVBORw0KGgo="
        : visualBible
          ? strictVisualRetry ? validVisualBible : "# Episode Visual Bible\n\nThe visual bible needs revision."
          : "# Research Dossier\n\nC01 https://example.com/1\nC02 https://example.com/2\nC03 https://example.com/3\nC04 https://example.com/4\nC05 https://example.com/5";
      this.emit("notification", { method: "item/agentMessage/delta", params: { threadId, turnId, delta } });
      this.activeTurns -= 1;
      this.emit("notification", { method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
    }, 30);
    return turnId;
  }
  async interruptTurn(): Promise<void> { /* deterministic fake */ }
  async deleteThread(threadId: string): Promise<boolean> { this.deletedThreads.push(threadId); return true; }
  respond(): void { /* deterministic fake */ }
}

function fakeWav(seconds = 2): Uint8Array {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TaskManager locks", () => {
  it("serializes two tasks targeting the same episode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-tasks-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    await writeFile(path.join(root, "shared", "script_rules.md"), "# Script\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Task Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `topic_${index}`, channel_id: channel.channel_id, title: `Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    const logger = new StudioLogger(root);
    await logger.init();
    const fake = new FakeCodex();
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), fake as never, 3, 8, logger);
    await manager.load();
    const first = manager.submit("GENERATE_RESEARCH", channel.channel_id, episode.episode_id);
    const second = manager.submit("GENERATE_RESEARCH", channel.channel_id, episode.episode_id);
    expect(second.status).toBe("QUEUED");
    await waitFor(() => manager.get(first.task_id).status === "COMPLETED");
    await waitFor(() => manager.get(second.task_id).status === "COMPLETED");
    expect(manager.get(first.task_id).status).toBe("COMPLETED");
    expect(manager.get(second.task_id).status).toBe("COMPLETED");
    expect(fake.deletedThreads).toContain("thread_1");
    const secondEpisode = await repository.confirmTopic(channel.channel_id, topics[1].topic_id);
    const parallelA = manager.submit("GENERATE_RESEARCH", channel.channel_id, episode.episode_id);
    const parallelB = manager.submit("GENERATE_RESEARCH", channel.channel_id, secondEpisode.episode_id);
    await waitFor(() => manager.get(parallelA.task_id).status === "COMPLETED");
    await waitFor(() => manager.get(parallelB.task_id).status === "COMPLETED");
    expect(fake.maxActiveTurns).toBeGreaterThanOrEqual(2);
  });

  it("runs audio in its own pool without creating Codex turns", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-audio-tasks-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Audio Tasks", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `audio_task_topic_${index}`, channel_id: channel.channel_id, title: `Audio Task Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const firstEpisode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    const secondEpisode = await repository.confirmTopic(channel.channel_id, topics[1].topic_id);
    for (const episode of [firstEpisode, secondEpisode]) await repository.saveScenes(channel.channel_id, episode.episode_id, [{ scene_id: `${episode.episode_id}_scene_1`, episode_id: episode.episode_id, scene_number: 1, duration_seconds: 6, dialogue: "Narrate this line", visual_prompt: "A documentary shot", transition_note: "", continuity_note: "", audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null }]);
    const logger = new StudioLogger(root);
    await logger.init();
    const fake = new FakeCodex();
    let activeAudio = 0;
    let maxActiveAudio = 0;
    const providerFactory = (target: { channelId: string; episodeId: string; sceneNumber: number }): AudioProvider => ({
      async generateDialogue(): Promise<{ asset_path: string }> {
        activeAudio += 1;
        maxActiveAudio = Math.max(maxActiveAudio, activeAudio);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const assetPath = await repository.writeSceneAudio(target.channelId, target.episodeId, target.sceneNumber, fakeWav());
        activeAudio -= 1;
        return { asset_path: assetPath };
      },
    });
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), fake as never, 1, 8, logger, { provider: "chatterbox", service_url: "http://127.0.0.1:8890", exaggeration: 0.5, cfg_weight: 0.5, max_concurrent_tasks: 2 }, providerFactory);
    await manager.load();
    const first = manager.submit("GENERATE_AUDIO", channel.channel_id, firstEpisode.episode_id, 1);
    const second = manager.submit("GENERATE_AUDIO", channel.channel_id, secondEpisode.episode_id, 1);
    await waitFor(() => manager.get(first.task_id).status === "COMPLETED");
    await waitFor(() => manager.get(second.task_id).status === "COMPLETED");
    expect(maxActiveAudio).toBe(2);
    expect(fake.activeTurns).toBe(0);
    expect(manager.get(first.task_id).codex_thread_id).toBeNull();
    expect((await repository.readScenes(channel.channel_id, firstEpisode.episode_id))[0].audio_duration_seconds).toBe(2);
  });

  it("keeps automatic cleanup off until a manual sweep is requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-thread-cleanup-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const logger = new StudioLogger(root);
    await logger.init();
    const fake = new FakeCodex();
    const task = {
      task_id: "task_old_thread",
      task_type: "GENERATE_SCRIPT",
      channel_id: "channel_old_thread",
      episode_id: "episode_old_thread",
      status: "COMPLETED",
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: "2026-01-01T00:00:01.000Z",
      completed_at: "2026-01-01T00:01:00.000Z",
      codex_thread_id: "thread_old",
      codex_turn_id: "turn_old",
      error: null,
      output_files: [],
      lock_key: "episode_old_thread",
      queue_position: null,
      progress_message: "Completed",
      scene_number: null,
    };
    await mkdir(path.join(repository.roots.runtime, "tasks"), { recursive: true });
    await writeFile(path.join(repository.roots.runtime, "tasks", "task_old_thread.json"), `${JSON.stringify(task)}\n`, "utf8");
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), fake as never, 1, 8, logger, undefined, undefined, { auto_delete_threads: false, failed_thread_retention_days: 7 });
    await manager.load();
    expect(fake.deletedThreads).toHaveLength(0);
    expect(await manager.cleanupCodexThreads()).toEqual({ removed: 0 });
    expect(await manager.cleanupCodexThreads(true)).toEqual({ removed: 1 });
    expect(manager.get("task_old_thread").codex_thread_id).toBeNull();
    expect(fake.deletedThreads).toEqual(["thread_old"]);
  });

  it("retries a visual bible when continuity bundles are missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-visual-bible-retry-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Visual Retry", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `visual_retry_topic_${index}`, channel_id: channel.channel_id, title: `Visual Retry ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "research.md", "# Research Dossier\n\nC01 verified");
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "treatment.md", "# Documentary Treatment\n\n## Sequence 1\nTime budget and claim C01");
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "script.md", "# Visual Retry 0\n\n<!-- HUMOR_POLICY: v1 -->\n\n1956 C01 evidence.");
    const logger = new StudioLogger(root, true);
    await logger.init();
    const fake = new FakeCodex();
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), fake as never, 1, 8, logger);
    await manager.load();
    const task = manager.submit("GENERATE_VISUAL_BIBLE", channel.channel_id, episode.episode_id);
    await waitFor(() => manager.get(task.task_id).status === "COMPLETED");
    const visualBible = await repository.getEpisodeFile(channel.channel_id, episode.episode_id, "visual_bible.md");
    expect(visualBible.content).toContain("## Continuity bundle CB-05");
    expect(manager.get(task.task_id).progress_message).toBe("Completed");
  });

  it("runs the one-click pipeline and skips artifacts that are already ready", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-pipeline-tasks-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Pipeline Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `pipeline_topic_${index}`, channel_id: channel.channel_id, title: `Pipeline Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    for (const filename of ["research.md", "treatment.md"]) await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, filename, `# ${filename}\nReady artifact`);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "visual_bible.md", "# Episode Visual Bible\n\n## Continuity bundle CB-01 — Ready\n\n- Anchor-frame prompt: A ready continuity anchor.\n- Reference asset slots: anchor");
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "script.md", "# script\n\n<!-- HUMOR_POLICY: v1 -->\nReady artifact");
    await repository.saveScenes(channel.channel_id, episode.episode_id, [{ scene_id: "pipeline_scene_1", episode_id: episode.episode_id, scene_number: 1, duration_seconds: 6, dialogue: "Ready dialogue", visual_prompt: "CAMERA\nReady\nACTION\nReady\nLIGHTING\nReady\nATMOSPHERE\nReady\nCONTINUITY\nReady", transition_note: "", continuity_note: "Ready continuity", sequence_id: "sequence-1", sequence_title: "Sequence 1", shot_id: "shot-1", asset_type: "ai_reconstruction", continuity_bundle_id: "CB-01", reference_asset_ids: [], source_ids: [], reconstruction: true, sound_cue: "", editorial_overlay: { kind: "none" }, audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null }]);
    const narrationPath = await repository.writeNarrationAudio(channel.channel_id, episode.episode_id, new Uint8Array([1, 2, 3]));
    await repository.saveNarrationMetadata(channel.channel_id, episode.episode_id, narrationPath, 10, 1, 20);
    const logger = new StudioLogger(root);
    await logger.init();
    const fake = new FakeCodex();
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), fake as never, 1, 8, logger);
    await manager.load();
    const pipeline = manager.submit("GENERATE_PIPELINE", channel.channel_id, episode.episode_id);
    await waitFor(() => manager.get(pipeline.task_id).status === "COMPLETED");
    expect(manager.get(pipeline.task_id).progress_percent).toBe(100);
    expect(manager.get(pipeline.task_id).progress_message).toBe("Completed");
    expect(fake.activeTurns).toBe(0);
    const pipelineImages = await repository.listBundleImages(channel.channel_id, episode.episode_id);
    expect(pipelineImages).toMatchObject([{ filename: "CB-01.png", bundle_id: "CB-01" }]);
    expect((await repository.readScenes(channel.channel_id, episode.episode_id))[0].reference_asset_ids).toContain(pipelineImages[0].path);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 15));
  if (!predicate()) throw new Error("Timed out waiting for task state");
}
