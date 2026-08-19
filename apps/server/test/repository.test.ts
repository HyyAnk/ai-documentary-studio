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

  it("stores reusable voices, protects assigned voices, and supports reset", async () => {
    const repository = await fixture();
    const channel = await repository.createChannel({ name: "Voice Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const profile = await repository.createVoiceProfile("Documentary narrator", new Uint8Array([1, 2]), new Uint8Array([3, 4]));
    expect((await repository.listVoices()).map((voice) => voice.voice_id)).toContain(profile.voice_id);
    const assigned = await repository.assignVoice(channel.channel_id, profile.voice_id);
    expect(assigned.voice_reference_path).toBe(profile.reference_path);
    await expect(repository.deleteVoiceProfile(profile.voice_id)).rejects.toThrow("Voice is in use by 1 channel(s)");
    const reset = await repository.assignVoice(channel.channel_id, null);
    expect(reset.voice_reference_path).toBeNull();
    await repository.deleteVoiceProfile(profile.voice_id);
    expect(await repository.listVoices()).toHaveLength(0);
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

  it("deletes an episode only after explicit confirmation", async () => {
    const repository = await fixture();
    const channel = await repository.createChannel({ name: "Delete Episode", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `delete_topic_${index}`, channel_id: channel.channel_id, title: `Delete Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    await expect(repository.deleteEpisode(channel.channel_id, episode.episode_id, false)).rejects.toThrow("Delete confirmation is required");
    await repository.deleteEpisode(channel.channel_id, episode.episode_id, true);
    expect(await repository.listEpisodes(channel.channel_id)).toHaveLength(0);
    expect((await repository.getChannel(channel.channel_id)).episode_count).toBe(0);
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
      visual_prompt: "A specific shot. Lower-left label: RECONSTRUCTION — AI VISUALIZATION. Lower-right: FACT — C01.",
      transition_note: "Cut on motion.",
      continuity_note: "Same room.",
      editorial_overlay: { kind: "caption", text: "1939 — Futurama", motion: "fade_up", placement: "lower_third", duration_seconds: 2.5, data: [], source_ids: ["C01"] },
    }]);
    const scenes = parseScenes(markdown, "episode_1");
    expect(scenes[0]).toMatchObject({ duration_seconds: 6, dialogue: "A clear line.", continuity_note: "Same room.", editorial_overlay: { kind: "caption", text: "1939 — Futurama", motion: "fade_up" } });
    expect(scenes[0].visual_prompt).not.toContain("AI VISUALIZATION");
  });

  it("invalidates audio only when dialogue changes", async () => {
    const repository = await fixture();
    const channel = await repository.createChannel({ name: "Audio Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `audio_topic_${index}`, channel_id: channel.channel_id, title: `Audio Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    const audio = { audio_asset_path: "channels/audio-channel/episodes/audio-topic-0/assets/scene-01.wav", audio_generated_at: new Date().toISOString(), audio_duration_seconds: 4.2 };
    await repository.saveScenes(channel.channel_id, episode.episode_id, [{ scene_id: "scene_1", episode_id: episode.episode_id, scene_number: 1, duration_seconds: 6, dialogue: "Original dialogue", visual_prompt: "Original shot", transition_note: "", continuity_note: "", ...audio }]);
    const kept = (await repository.readScenes(channel.channel_id, episode.episode_id))[0];
    await repository.saveScenes(channel.channel_id, episode.episode_id, [{ ...kept, visual_prompt: "New shot" }]);
    expect((await repository.readScenes(channel.channel_id, episode.episode_id))[0]).toMatchObject(audio);
    await repository.saveScenes(channel.channel_id, episode.episode_id, [{ ...kept, dialogue: "Changed dialogue" }]);
    expect((await repository.readScenes(channel.channel_id, episode.episode_id))[0]).toMatchObject({ audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null });
  });
});
