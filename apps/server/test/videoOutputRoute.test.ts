import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("video output routes", () => {
  it("streams the finished video and opens only its verified local folder", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "video-output-route-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8"),
      writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8"),
    ]);
    const revealed: string[] = [];
    const app = await buildApp(root, { revealFile: async (filePath) => { revealed.push(filePath); } });
    try {
      const channel = await app.repository.createChannel({ name: "Video output", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
      const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `video-topic-${index}`, channel_id: channel.channel_id, title: `Video topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
      await app.repository.saveTopicRun(channel.channel_id, topics);
      const episode = await app.repository.confirmTopic(channel.channel_id, topics[0].topic_id);
      await app.repository.writeVideoArtifact(channel.channel_id, episode.episode_id, new Uint8Array([1, 2, 3, 4]));
      const base = `/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/video`;

      const stream = await app.server.inject({ method: "GET", url: base, headers: { range: "bytes=1-2" } });
      expect(stream.statusCode).toBe(206);
      expect(stream.headers["content-range"]).toBe("bytes 1-2/4");
      expect(stream.rawPayload).toEqual(Buffer.from([2, 3]));

      const open = await app.server.inject({ method: "POST", url: `${base}/open-folder`, payload: {} });
      expect(open.statusCode).toBe(200);
      expect(open.json()).toMatchObject({ opened: true, folder_path: expect.stringMatching(/\/assets$/) });
      expect(revealed).toEqual([path.join(root, "channels", channel.slug, "episodes", episode.slug, "assets", "quiz-video.mp4")]);
    } finally {
      await app.close();
    }
  });
});
