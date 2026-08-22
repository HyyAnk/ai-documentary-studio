import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseContinuityBundles } from "../src/visualBundles.js";
import { RepositoryService } from "../src/repository.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("continuity bundles", () => {
  it("extracts bundle sections and multiline anchor prompts", () => {
    const bundles = parseContinuityBundles(`# Episode Visual Bible\n\n## Continuity bundle CB-01 — The workshop\n\n- Era: 1950s\n- Anchor-frame prompt: A warm workshop at dawn, brass tools on a wooden bench.\n- Reference asset slots: anchor\n\n## Continuity bundle CB-02 — The archive\n\n- Anchor-frame prompt: A cool archive room with tall shelves and dust in window light.\n- Allowed shot variation: lens and camera height`);
    expect(bundles).toMatchObject([
      { bundle_id: "CB-01", bundle_number: 1, title: "The workshop", anchor_prompt: "A warm workshop at dawn, brass tools on a wooden bench." },
      { bundle_id: "CB-02", bundle_number: 2, title: "The archive", anchor_prompt: "A cool archive room with tall shelves and dust in window light." },
    ]);
  });

  it("handles level 3 headings, colon separators, single digits, and nested prompt blocks", () => {
    const markdown = `# Quiz Visual Bible\n\n### Continuity bundle CB-1: Saturn and Moons\n- Era: Contemporary\n- **Anchor-frame prompt**:\n\`\`\`\nCAMERA: Wide shot\nACTION: Saturn rotates\n\`\`\`\n\n## Continuity bundle CB-02 — Neptune Storms\n- Anchor frame prompt: Blue planet with white streaks`;
    const bundles = parseContinuityBundles(markdown);
    expect(bundles).toHaveLength(2);
    expect(bundles[0]).toMatchObject({
      bundle_id: "CB-01",
      bundle_number: 1,
      title: "Saturn and Moons",
    });
    expect(bundles[0].anchor_prompt).toContain("CAMERA: Wide shot");
    expect(bundles[1]).toMatchObject({
      bundle_id: "CB-02",
      bundle_number: 2,
      title: "Neptune Storms",
      anchor_prompt: "Blue planet with white streaks",
    });
  });

  it("writes one image and propagates its reference to every matching scene", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-bundles-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Bundle Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `bundle_topic_${index}`, channel_id: channel.channel_id, title: `Bundle Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    await repository.saveScenes(channel.channel_id, episode.episode_id, [
      scene(episode.episode_id, 1, "First dialogue"),
      scene(episode.episode_id, 2, "Second dialogue"),
      { ...scene(episode.episode_id, 3, "Other bundle"), continuity_bundle_id: "CB-02" },
    ]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const assetPath = await repository.writeBundleImage(channel.channel_id, episode.episode_id, 1, png);
    expect(await repository.attachBundleReference(channel.channel_id, episode.episode_id, "CB-01", assetPath)).toBe(2);
    const scenes = await repository.readScenes(channel.channel_id, episode.episode_id);
    expect(scenes[0].reference_asset_ids).toEqual([assetPath]);
    expect(scenes[1].reference_asset_ids).toEqual([assetPath]);
    expect(scenes[0].dialogue).toBe("First dialogue");
    expect(scenes[0].visual_prompt).toBe("Shot for First dialogue");
    expect((await repository.listBundleImages(channel.channel_id, episode.episode_id))[0]).toMatchObject({ bundle_id: "CB-01", filename: "CB-01.png" });
  });
});

function scene(episodeId: string, sceneNumber: number, dialogue: string) {
  return {
    scene_id: `${episodeId}_scene_${sceneNumber}`,
    episode_id: episodeId,
    scene_number: sceneNumber,
    duration_seconds: 6,
    dialogue,
    visual_prompt: `Shot for ${dialogue}`,
    sequence_id: "sequence-1",
    sequence_title: "Sequence 1",
    continuity_bundle_id: "CB-01",
    transition_note: "",
    continuity_note: "",
    audio_asset_path: null,
    audio_generated_at: null,
    audio_duration_seconds: null,
  };
}
