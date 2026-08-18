import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepositoryService } from "../src/repository.js";
import { ShopAiKeyImageProvider } from "../src/providers/shopAiKeyImage.js";

const roots: string[] = [];
const originalFetch = globalThis.fetch;
const originalEnv = { key: process.env.SHOPAIKEY_API_KEY, base: process.env.SHOPAIKEY_BASE_URL, model: process.env.SHOPAIKEY_IMAGE_MODEL, fallback: process.env.SHOPAIKEY_IMAGE_FALLBACK_MODEL, size: process.env.SHOPAIKEY_IMAGE_SIZE, quality: process.env.SHOPAIKEY_IMAGE_QUALITY };

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries({ SHOPAIKEY_API_KEY: originalEnv.key, SHOPAIKEY_BASE_URL: originalEnv.base, SHOPAIKEY_IMAGE_MODEL: originalEnv.model, SHOPAIKEY_IMAGE_FALLBACK_MODEL: originalEnv.fallback, SHOPAIKEY_IMAGE_SIZE: originalEnv.size, SHOPAIKEY_IMAGE_QUALITY: originalEnv.quality })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("ShopAIKey image provider", () => {
  it("posts to exactly one /v1/images/generations route and persists b64_json PNG output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-shopaikey-image-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "ShopAIKey", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "shopaikey_topic", channel_id: channel.channel_id, title: "Image topic", premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `shopaikey_topic_${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, topic.topic_id);
    process.env.SHOPAIKEY_API_KEY = "test-key";
    process.env.SHOPAIKEY_BASE_URL = "https://direct.shopaikey.com/v1/";
    process.env.SHOPAIKEY_IMAGE_MODEL = "gpt-image-2-test";
    const png = "iVBORw0KGgo=";
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://direct.shopaikey.com/v1/images/generations");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-image-2-test", size: "1536x1024", quality: "low", output_format: "png" });
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const asset = await new ShopAiKeyImageProvider(repository, { channelId: channel.channel_id, episodeId: episode.episode_id, bundleNumber: 1, variant: 0 }).generateReference("Anchor prompt");
    expect(asset.asset_path.endsWith("CB-01.png")).toBe(true);
    expect((await repository.listBundleImages(channel.channel_id, episode.episode_id))).toHaveLength(1);
  });

  it("retries transient provider failures before persisting the image", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-shopaikey-image-retry-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Retry", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "retry_topic", channel_id: channel.channel_id, title: "Retry topic", premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `retry_topic_${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, topic.topic_id);
    process.env.SHOPAIKEY_API_KEY = "test-key";
    const png = "iVBORw0KGgo=";
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "temporary capacity" } }), { status: 503 });
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const asset = await new ShopAiKeyImageProvider(repository, { channelId: channel.channel_id, episodeId: episode.episode_id, bundleNumber: 1, variant: 0 }).generateReference("Anchor prompt");
    expect(calls).toBe(2);
    expect(asset.asset_path.endsWith("CB-01.png")).toBe(true);
  });

  it("falls back to the configured model after primary model timeouts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-shopaikey-fallback-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Fallback", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "fallback_topic", channel_id: channel.channel_id, title: "Fallback topic", premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `fallback_topic_${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, topic.topic_id);
    process.env.SHOPAIKEY_API_KEY = "test-key";
    process.env.SHOPAIKEY_IMAGE_MODEL = "primary-model";
    process.env.SHOPAIKEY_IMAGE_FALLBACK_MODEL = "fallback-model";
    const models: string[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      if (body.model === "primary-model") throw new Error("network timeout");
      return new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] }), { status: 200 });
    });
    const asset = await new ShopAiKeyImageProvider(repository, { channelId: channel.channel_id, episodeId: episode.episode_id, bundleNumber: 1, variant: 0 }).generateReference("Anchor prompt");
    expect(models.filter((model) => model === "primary-model")).toHaveLength(1);
    expect(models.at(-1)).toBe("fallback-model");
    expect(asset.asset_path.endsWith("CB-01.png")).toBe(true);
  });
});
