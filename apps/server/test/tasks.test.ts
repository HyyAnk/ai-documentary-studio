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
  async connect(): Promise<void> { this.emit("status", "connected"); }
  async startThread(): Promise<string> { return `thread_${this.turnNumber + 1}`; }
  async resumeThread(threadId: string): Promise<string> { return threadId; }
  async startTurn(threadId: string): Promise<string> {
    const turnId = `turn_${++this.turnNumber}`;
    this.activeTurns += 1;
    this.maxActiveTurns = Math.max(this.maxActiveTurns, this.activeTurns);
    setTimeout(() => {
      this.emit("notification", { method: "item/agentMessage/delta", params: { threadId, turnId, delta: "# Script\n\nA generated script." } });
      this.emit("notification", { method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
      this.activeTurns -= 1;
    }, 30);
    return turnId;
  }
  async interruptTurn(): Promise<void> { /* deterministic fake */ }
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
    const first = manager.submit("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
    const second = manager.submit("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
    expect(second.status).toBe("QUEUED");
    await waitFor(() => manager.get(first.task_id).status === "COMPLETED");
    await waitFor(() => manager.get(second.task_id).status === "COMPLETED");
    expect(manager.get(first.task_id).status).toBe("COMPLETED");
    expect(manager.get(second.task_id).status).toBe("COMPLETED");
    const secondEpisode = await repository.confirmTopic(channel.channel_id, topics[1].topic_id);
    const parallelA = manager.submit("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
    const parallelB = manager.submit("GENERATE_SCRIPT", channel.channel_id, secondEpisode.episode_id);
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
    expect(fake.maxActiveTurns).toBe(0);
    expect(manager.get(first.task_id).codex_thread_id).toBeNull();
    expect((await repository.readScenes(channel.channel_id, firstEpisode.episode_id))[0].audio_duration_seconds).toBe(2);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 15));
  if (!predicate()) throw new Error("Timed out waiting for task state");
}
