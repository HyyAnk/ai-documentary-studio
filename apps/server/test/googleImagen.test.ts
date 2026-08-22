import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleImagenProvider } from "../src/providers/googleImagen.js";
import { RepositoryService } from "../src/repository.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GoogleImagenProvider", () => {
  it("generates an image using imagen-3.0-generate-002 via REST API", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "imagen-test-"));
    roots.push(root);

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");

    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Imagen Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "topic_1", channel_id: channel.channel_id, title: "Topic 1", premise: "P", why_it_fits: "W", hook: "H", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `topic_${index + 2}`, title: `Other ${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, "topic_1");

    const fakePngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        predictions: [{ bytesBase64Encoded: fakePngBase64, mimeType: "image/png" }],
      }),
    } as Response);

    const provider = new GoogleImagenProvider(
      repository,
      { channelId: channel.channel_id, episodeId: episode.episode_id, bundleNumber: 1, variant: 0 },
      "test-api-key",
      "imagen-3.0-generate-002"
    );

    const result = await provider.generateReference("Anchor-frame prompt: High speed bullet train in snow.");

    expect(result.fallback_tier).toBe(1);
    expect(result.degraded).toBe(false);
    expect(result.asset_path).toContain("CB-01.png");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toContain("models/imagen-3.0-generate-002:predict?key=test-api-key");
    expect(JSON.parse(callInit.body as string)).toMatchObject({
      instances: [{ prompt: "High speed bullet train in snow." }],
      parameters: { sampleCount: 1, aspectRatio: "16:9", outputOptions: { mimeType: "image/png" } },
    });
  });

  it("generates an image using gemini-3.1-flash-lite-image via generateContent REST API", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "imagen-flash-test-"));
    roots.push(root);

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");

    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Flash Image Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "topic_1", channel_id: channel.channel_id, title: "Topic 1", premise: "P", why_it_fits: "W", hook: "H", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `topic_${index + 2}`, title: `Other ${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, "topic_1");

    const fakePngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              inlineData: { data: fakePngBase64, mimeType: "image/png" }
            }]
          }
        }],
      }),
    } as Response);

    const provider = new GoogleImagenProvider(
      repository,
      { channelId: channel.channel_id, episodeId: episode.episode_id, bundleNumber: 1, variant: 0 },
      "test-api-key",
      "gemini-3.1-flash-lite-image"
    );

    const result = await provider.generateReference("A futuristic sports car on neon highway.");

    expect(result.fallback_tier).toBe(1);
    expect(result.degraded).toBe(false);
    expect(result.asset_path).toContain("CB-01.png");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toContain("models/gemini-3.1-flash-lite-image:generateContent?key=test-api-key");
    expect(JSON.parse(callInit.body as string)).toMatchObject({
      contents: [{ parts: [{ text: "A futuristic sports car on neon highway., 16:9 aspect ratio, high quality" }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    });
  });

  it("fails fast when Google API key is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "imagen-missing-key-"));
    roots.push(root);
    const repository = new RepositoryService(root);

    const provider = new GoogleImagenProvider(
      repository,
      { channelId: "ch_1", episodeId: "ep_1", bundleNumber: 1 },
      ""
    );

    await expect(provider.generateReference("test prompt")).rejects.toThrow("Google Gemini/Imagen API Key is required");
  });
});
