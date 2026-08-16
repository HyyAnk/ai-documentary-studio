import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RepositoryService, parseScenes, serializeScenes } from "../src/repository.js";

const roots: string[] = [];

async function fixture(): Promise<RepositoryService> {
  const root = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-"));
  roots.push(root);
  await mkdir(path.join(root, "templates"), { recursive: true });
  await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# Channel DNA\n\n## Channel Identity\n\n- Channel name: \n", "utf8");
  await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style Guide\n", "utf8");
  return new RepositoryService(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RepositoryService", () => {
  it("sanitizes names, creates unique channel paths, and persists files", async () => {
    const repository = await fixture();
    await repository.ensureBootstrap();
    const input = { name: "Đời sống & Máy móc", description: "A channel", target_audience: "Curious people", language: "Vietnamese", market: "Global", dna_mode: "example" as const };
    const first = await repository.createChannel(input);
    const second = await repository.createChannel(input);
    expect(first.slug).toBe("doi-song-may-moc");
    expect(second.slug).toBe("doi-song-may-moc-2");
    expect((await repository.listChannels()).length).toBe(2);
    expect((await repository.getChannelDna(first.channel_id)).content).toContain("Channel DNA");
    await repository.saveChannelDna(first.channel_id, "# Updated DNA\n");
    expect(await readFile(path.join(repository.rootDirectory, "channels", first.slug, "channel_dna.md"), "utf8")).toBe("# Updated DNA\n");
  });

  it("keeps channel artifacts in the selected storage root", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-project-"));
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-storage-"));
    roots.push(projectRoot, storageRoot);
    await mkdir(path.join(projectRoot, "templates"), { recursive: true });
    await writeFile(path.join(projectRoot, "templates", "example_channel_dna.md"), "# Channel DNA\n", "utf8");
    await writeFile(path.join(projectRoot, "templates", "example_style_guide.md"), "# Style Guide\n", "utf8");
    const repository = new RepositoryService(projectRoot, storageRoot);
    const channel = await repository.createChannel({ name: "External Storage", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });

    expect(repository.storageRoot).toBe(storageRoot);
    expect(await readFile(path.join(storageRoot, "channels", channel.slug, "channel.json"), "utf8")).toContain(channel.channel_id);
    await expect(readFile(path.join(projectRoot, "channels", channel.slug, "channel.json"), "utf8")).rejects.toThrow();
  });

  it("rejects unsafe path segments and only creates an episode after confirmation", async () => {
    const repository = await fixture();
    const channel = await repository.createChannel({ name: "Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    expect(() => repository.resolvePath("channels", "../outside")).toThrow("Unsafe filesystem path");
    const topics = Array.from({ length: 5 }, (_, index) => ({
      topic_id: `topic_${index}`,
      channel_id: channel.channel_id,
      title: `Topic ${index}`,
      premise: `Premise ${index}`,
      why_it_fits: "Fits the channel",
      hook: "A sharp hook",
      estimated_potential: "High",
      generated_at: new Date().toISOString(),
      selected: false,
    }));
    await repository.saveTopicRun(channel.channel_id, topics);
    expect((await repository.listEpisodes(channel.channel_id)).length).toBe(0);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    expect(episode.stage).toBe("SELECTED");
    expect((await repository.getEpisodeFile(channel.channel_id, episode.episode_id, "brief.md")).content).toContain("Topic 0");
  });
});

describe("scene markdown", () => {
  it("round trips dialogue, prompts, durations, and notes", () => {
    const markdown = serializeScenes([{
      scene_id: "scene_1",
      episode_id: "episode_1",
      scene_number: 1,
      duration_seconds: 6,
      dialogue: "A clear line.",
      visual_prompt: "A specific shot.",
      transition_note: "Cut on motion.",
      continuity_note: "Same room.",
    }]);
    const scenes = parseScenes(markdown, "episode_1");
    expect(scenes[0]).toMatchObject({ duration_seconds: 6, dialogue: "A clear line.", visual_prompt: "A specific shot.", continuity_note: "Same room." });
  });
});
