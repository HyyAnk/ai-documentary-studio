import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("scene merge route", () => {
  it("merges adjacent scenes, clears audio, and renumbers the remainder", async () => {
    const root = await createTestRoot();
    const app = await buildApp(root);
    try {
      const { channel, episodeId } = await createEpisode(app.repository);
      await app.repository.saveScenes(channel.channel_id, episodeId, [
        scene(episodeId, 1, 3, "First line", "first.wav"),
        scene(episodeId, 2, 2, "Second line", "second.wav"),
        scene(episodeId, 3, 1, "Third line", null),
      ]);

      const response = await app.server.inject({ method: "POST", url: `/api/channels/${channel.channel_id}/episodes/${episodeId}/scenes/1/merge-next`, payload: {} });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { scenes: Array<{ scene_number: number; duration_seconds: number; dialogue: string; visual_prompt: string; audio_asset_path: string | null }> };
      expect(body.scenes).toHaveLength(2);
      expect(body.scenes[0]).toMatchObject({ scene_number: 1, duration_seconds: 5, dialogue: "First line Second line", audio_asset_path: null });
      expect(body.scenes[0].visual_prompt).toContain("5.0s total");
      expect(body.scenes[0].visual_prompt).toContain("3.0s HARD CUT");
      expect(body.scenes[1].scene_number).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("rejects a merge that exceeds the configured limit", async () => {
    const root = await createTestRoot();
    const app = await buildApp(root);
    try {
      const { channel, episodeId } = await createEpisode(app.repository);
      await app.repository.saveScenes(channel.channel_id, episodeId, [scene(episodeId, 1, 6, "First line", null), scene(episodeId, 2, 3, "Second line", null)]);
      const response = await app.server.inject({ method: "POST", url: `/api/channels/${channel.channel_id}/episodes/${episodeId}/scenes/1/merge-next`, payload: {} });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "Merged duration would exceed the 8s scene limit." });
    } finally {
      await app.close();
    }
  });
});

async function createTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "documentary-merge-route-"));
  roots.push(root);
  await mkdir(path.join(root, "templates"), { recursive: true });
  await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
  await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
  return root;
}

async function createEpisode(repository: Awaited<ReturnType<typeof buildApp>>["repository"]) {
  const channel = await repository.createChannel({ name: "Merge Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
  const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `merge_topic_${index}`, channel_id: channel.channel_id, title: `Merge Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
  await repository.saveTopicRun(channel.channel_id, topics);
  const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
  return { channel, episodeId: episode.episode_id };
}

function scene(episodeId: string, sceneNumber: number, duration: number, dialogue: string, audio: string | null) {
  return {
    scene_id: `${episodeId}_scene_${sceneNumber}`,
    episode_id: episodeId,
    scene_number: sceneNumber,
    duration_seconds: duration,
    dialogue,
    visual_prompt: `Shot ${sceneNumber}`,
    transition_note: "",
    continuity_note: "Same continuity",
    audio_asset_path: audio,
    audio_generated_at: audio ? new Date().toISOString() : null,
    audio_duration_seconds: audio ? duration : null,
  };
}
