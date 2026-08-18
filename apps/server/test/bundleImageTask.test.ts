import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/context.js";
import { StudioLogger } from "../src/logger.js";
import { RepositoryService } from "../src/repository.js";
import { TaskManager } from "../src/tasks.js";

const roots: string[] = [];
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

class ImageCodex extends EventEmitter {
  private turnNumber = 0;
  constructor(private readonly mediaOnly = false) { super(); }
  async connect(): Promise<void> { this.emit("status", "connected"); }
  async startThread(): Promise<string> { return "image-thread"; }
  async startTurn(threadId: string): Promise<string> {
    const turnId = `image-turn-${++this.turnNumber}`;
    setTimeout(() => {
      if (this.mediaOnly) this.emit("notification", { method: "item/image", params: { threadId, turnId, data: PNG_DATA_URL } });
      else this.emit("notification", { method: "item/agentMessage/delta", params: { threadId, turnId, delta: PNG_DATA_URL } });
      this.emit("notification", { method: "turn/completed", params: { threadId, turnId, turn: { id: turnId, status: "completed" } } });
    }, 10);
    return turnId;
  }
  async deleteThread(): Promise<boolean> { return true; }
  async interruptTurn(): Promise<void> { return undefined; }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bundle image tasks", () => {
  it("materializes an image and attaches it to every scene in the bundle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-image-task-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n\n## Visual Style\nWarm\n\n## Visual Language\nCinematic\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Image Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `image_topic_${index}`, channel_id: channel.channel_id, title: `Image Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "visual_bible.md", "# Episode Visual Bible\n\n## Continuity bundle CB-01 — Workshop\n\n- Era: 1950s\n- Anchor-frame prompt: A warm workshop with brass tools.\n- Reference asset slots: anchor\n");
    await repository.saveScenes(channel.channel_id, episode.episode_id, [
      scene(episode.episode_id, 1, "First"),
      scene(episode.episode_id, 2, "Second"),
    ]);
    const logger = new StudioLogger(root);
    await logger.init();
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), new ImageCodex() as never, 1, 8, logger, undefined, undefined, undefined, { enabled: true, images_per_bundle: 1 });
    await manager.load();
    const task = manager.submit("GENERATE_BUNDLE_IMAGE", channel.channel_id, episode.episode_id, 1);
    await waitFor(() => manager.get(task.task_id).status === "COMPLETED");
    const image = (await repository.listBundleImages(channel.channel_id, episode.episode_id))[0];
    expect(image).toMatchObject({ filename: "CB-01.png", bundle_id: "CB-01" });
    expect((await repository.readScenes(channel.channel_id, episode.episode_id)).every((scene) => scene.reference_asset_ids.includes(image.path))).toBe(true);
  });

  it("captures a PNG delivered through a media item without contaminating text output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-media-image-task-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n\n## Visual Style\nWarm\n\n## Visual Language\nCinematic\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Media Image Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `media_image_topic_${index}`, channel_id: channel.channel_id, title: `Media Image Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "visual_bible.md", "# Episode Visual Bible\n\n## Continuity bundle CB-01 — Workshop\n\n- Era: 1950s\n- Anchor-frame prompt: A warm workshop with brass tools.\n- Reference asset slots: anchor\n");
    await repository.saveScenes(channel.channel_id, episode.episode_id, [scene(episode.episode_id, 1, "First")]);
    const logger = new StudioLogger(root);
    await logger.init();
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), new ImageCodex(true) as never, 1, 8, logger, undefined, undefined, undefined, { enabled: true, images_per_bundle: 1 });
    await manager.load();
    const task = manager.submit("GENERATE_BUNDLE_IMAGE", channel.channel_id, episode.episode_id, 1);
    await waitFor(() => manager.get(task.task_id).status === "COMPLETED");
    expect((await repository.listBundleImages(channel.channel_id, episode.episode_id))).toMatchObject([{ filename: "CB-01.png", bundle_id: "CB-01" }]);
  });
});

function scene(episodeId: string, sceneNumber: number, dialogue: string) {
  return { scene_id: `${episodeId}_${sceneNumber}`, episode_id: episodeId, scene_number: sceneNumber, duration_seconds: 6, dialogue, visual_prompt: `Shot ${dialogue}`, sequence_id: "sequence-1", sequence_title: "Workshop", continuity_bundle_id: "CB-01", transition_note: "", continuity_note: "", audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  if (!predicate()) throw new Error("Timed out waiting for task");
}
