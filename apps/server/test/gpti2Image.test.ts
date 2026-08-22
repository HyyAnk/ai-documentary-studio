import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateGpti2ImageBytes, Gpti2ImageProvider, Gpti2QuizImageProvider } from "../src/providers/gpti2Image.js";
import { RepositoryService } from "../src/repository.js";

const roots: string[] = [];
const originalFetch = globalThis.fetch;
const originalApiKey = process.env.GPTI2_API_KEY;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GPTI2_API_KEY;
  else process.env.GPTI2_API_KEY = originalApiKey;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("gpti2.store Image Provider", () => {
  it("generates image synchronously for gpt-image-2 with quality low", async () => {
    // 1x1 transparent PNG base64
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ b64_json: fakeBase64 }],
        price_vnd: 50,
        price_breakdown: { images_vnd: 50 },
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const result = await generateGpti2ImageBytes("A scenic mountain at sunrise", {
      apiKey: "sk-test-key",
      model: "gpt-image-2",
    });

    expect(result.price_vnd).toBe(50);
    expect(result.model).toBe("gpt-image-2");
    expect(result.bytes.length).toBeGreaterThan(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gpti2.store/v1/images/generations");
    expect(init.headers["Prefer"]).toBe("respond-async");
    expect(init.headers["Idempotency-Key"]).toBeDefined();
    const body = JSON.parse(init.body as string);
    expect(body.quality).toBe("low");
    expect(body.model).toBe("gpt-image-2");
  });

  it("handles 202 async response with job polling for gpt-image-2", async () => {
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let pollCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/generations")) {
        return Promise.resolve({
          ok: true,
          status: 202,
          text: async () => JSON.stringify({ id: "job_123", price_vnd: 50 }),
        } as unknown as Response);
      }
      if (url.includes("/jobs/job_123")) {
        pollCount += 1;
        if (pollCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ status: "running" }),
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            status: "succeeded",
            data: [{ b64_json: fakeBase64 }],
            price_vnd: 50,
            price_breakdown: { images_vnd: 50 },
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });
    globalThis.fetch = fetchMock;

    const result = await generateGpti2ImageBytes("A bustling retro market", {
      apiKey: "sk-test-key",
      model: "gpt-image-2",
      pollIntervalMs: 10,
    });

    expect(result.price_vnd).toBe(50);
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it("handles nano-banana-2 async polling generation", async () => {
    const fakePngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, -60, -119]);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/nano/generations")) {
        return Promise.resolve({
          ok: true,
          status: 202,
          text: async () => JSON.stringify({ id: "nb_456", price_vnd: 100 }),
        } as unknown as Response);
      }
      if (url.includes("/nano/nb_456")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            status: "succeeded",
            data: [{ url: "https://gpti2.store/download/nb_456.png" }],
            price_vnd: 100,
          }),
        } as unknown as Response);
      }
      if (url.includes("/download/nb_456.png")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: async () => fakePngBytes.buffer,
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });
    globalThis.fetch = fetchMock;

    const result = await generateGpti2ImageBytes("A futuristic city at night", {
      apiKey: "sk-test-key",
      model: "nano-banana-2",
      pollIntervalMs: 10,
    });

    expect(result.price_vnd).toBe(100);
    expect(result.model).toBe("nano-banana-2");
  });

  it("Gpti2ImageProvider persists metadata JSON file alongside the image", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gpti2-repo-test-"));
    roots.push(root);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Gpti2 Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, i) => ({ topic_id: `t${i + 1}`, channel_id: channel.channel_id, title: `T${i + 1}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High" as const, generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, "t1");

    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ b64_json: fakeBase64 }],
        price_vnd: 50,
        price_breakdown: { images_vnd: 50 },
      }),
    } as unknown as Response);

    const provider = new Gpti2ImageProvider(repository, {
      channelId: channel.channel_id,
      episodeId: episode.episode_id,
      bundleNumber: 1,
    }, {
      apiKey: "sk-test",
      model: "gpt-image-2",
    });

    const output = await provider.generateReference("A tranquil forest path");
    expect(output.price_vnd).toBe(50);

    const images = await repository.listBundleImages(channel.channel_id, episode.episode_id);
    expect(images.length).toBe(1);
    expect(images[0].price_vnd).toBe(50);
    expect(images[0].model).toBe("gpt-image-2");
    expect(images[0].aspect_ratio).toBe("16:9");
  });

  it("maps aspect ratios correctly for gpt-image-2 (size) and nano-banana-2 (aspect_ratio)", async () => {
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ b64_json: fakeBase64 }],
        price_vnd: 50,
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    // Test 1:1 square for gpt-image-2
    await generateGpti2ImageBytes("A red apple on white background", {
      apiKey: "sk-test",
      model: "gpt-image-2",
      aspect_ratio: "1:1",
    });
    let requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.size).toBe("1024x1024");

    // Test 9:16 portrait for gpt-image-2
    await generateGpti2ImageBytes("A tall skyscraper", {
      apiKey: "sk-test",
      model: "gpt-image-2",
      aspect_ratio: "9:16",
    });
    requestBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(requestBody.size).toBe("720x1280");

    // Test 4:3 for gpt-image-2
    await generateGpti2ImageBytes("A vintage television", {
      apiKey: "sk-test",
      model: "gpt-image-2",
      aspect_ratio: "4:3",
    });
    requestBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(requestBody.size).toBe("1024x768");

    // Test nano-banana-2 with direct aspect_ratio
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({ id: "nb_square", price_vnd: 100 }),
    } as unknown as Response).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "succeeded",
        data: [{ url: "https://gpti2.store/download/nb_square.png" }],
        price_vnd: 100,
      }),
    } as unknown as Response).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as unknown as Response);

    const nanoResult = await generateGpti2ImageBytes("A square icon", {
      apiKey: "sk-test",
      model: "nano-banana-2",
      aspect_ratio: "1:1",
      pollIntervalMs: 10,
    });
    expect(nanoResult.aspect_ratio).toBe("1:1");
    expect(nanoResult.price_vnd).toBe(100);
    const nanoCallBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    expect(nanoCallBody.aspect_ratio).toBe("1:1");
  });

  it("checks balance successfully via checkGpti2Balance", async () => {
    const { checkGpti2Balance } = await import("../src/providers/gpti2Image.js");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        balance_vnd: 50000,
        rpm: 10,
      }),
    } as unknown as Response);

    const balance = await checkGpti2Balance("sk-valid-key");
    expect(balance.balance_vnd).toBe(50000);
    expect(balance.rpm).toBe(10);
  });
});
