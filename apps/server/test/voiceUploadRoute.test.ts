import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createWavBuffer(dataByteLength = 100): Buffer {
  const buffer = Buffer.alloc(44 + dataByteLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(24000, 24); // sample rate
  buffer.writeUInt32LE(48000, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataByteLength, 40);
  return buffer;
}

describe("Voice upload and management routes", () => {
  it("allows uploading a voice WAV file and creates a profile even when Chatterbox is offline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voice-upload-route-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8"),
      writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8"),
    ]);

    const app = await buildApp(root);
    try {
      const wav = createWavBuffer(500);
      const base64Audio = wav.toString("base64");

      // 1. Upload custom voice
      const res = await app.server.inject({
        method: "POST",
        url: "/api/voices",
        payload: {
          name: "Deep Narrator",
          data: base64Audio,
        },
      });

      expect(res.statusCode).toBe(200);
      const voice = res.json();
      expect(voice).toMatchObject({
        voice_id: expect.stringMatching(/^voice_/),
        name: "Deep Narrator",
        reference_path: expect.stringContaining("reference.wav"),
        sample_path: expect.stringContaining("sample.wav"),
      });

      // 2. List voices
      const listRes = await app.server.inject({ method: "GET", url: "/api/voices" });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().voices).toHaveLength(1);
      expect(listRes.json().voices[0].voice_id).toBe(voice.voice_id);

      // 3. Get voice sample audio
      const sampleRes = await app.server.inject({ method: "GET", url: `/api/voices/${voice.voice_id}/sample` });
      expect(sampleRes.statusCode).toBe(200);
      expect(sampleRes.headers["content-type"]).toBe("audio/wav");
      expect(sampleRes.rawPayload.length).toBe(wav.length);

      // 4. Assign voice to channel
      const channel = await app.repository.createChannel({
        name: "Voice Test Channel",
        description: "",
        target_audience: "",
        language: "English",
        market: "",
        dna_mode: "example",
      });

      const assignRes = await app.server.inject({
        method: "PUT",
        url: `/api/channels/${channel.channel_id}/voice`,
        payload: { voice_id: voice.voice_id },
      });
      expect(assignRes.statusCode).toBe(200);
      expect(assignRes.json().voice_reference_path).toBe(voice.reference_path);
    } finally {
      await app.close();
    }
  }, 20000);

  it("accepts WAV payloads larger than 1MB without 413 Payload Too Large error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voice-upload-large-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8"),
      writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8"),
    ]);

    const app = await buildApp(root);
    try {
      // Create a ~2MB WAV file (base64 string will be ~2.7MB, well above default 1MB Fastify limit)
      const largeWav = createWavBuffer(2 * 1024 * 1024);
      const base64Audio = largeWav.toString("base64");

      const res = await app.server.inject({
        method: "POST",
        url: "/api/voices",
        payload: {
          name: "Large Voice Sample",
          data: base64Audio,
        },
      });

      expect(res.statusCode).toBe(200);
      const voice = res.json();
      expect(voice.name).toBe("Large Voice Sample");

      // Verify the uploaded reference binary length on disk matches the 2MB WAV file
      const referenceOnDisk = await readFile(app.repository.resolveContextPath(voice.reference_path));
      expect(referenceOnDisk.length).toBe(largeWav.length);

      // Verify the sample endpoint returns 200 and audio/wav content (either generated preview or reference)
      const sampleRes = await app.server.inject({ method: "GET", url: `/api/voices/${voice.voice_id}/sample` });
      expect(sampleRes.statusCode).toBe(200);
      expect(sampleRes.headers["content-type"]).toBe("audio/wav");
      expect(sampleRes.rawPayload.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  }, 20000);

  it("rejects non-WAV data with INVALID_AUDIO error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voice-upload-invalid-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8"),
      writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8"),
    ]);

    const app = await buildApp(root);
    try {
      const invalidData = Buffer.from("NOT_A_VALID_WAV_FILE_HEADER").toString("base64");

      const res = await app.server.inject({
        method: "POST",
        url: "/api/voices",
        payload: {
          name: "Corrupt Voice",
          data: invalidData,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Voice reference must be a WAV file");
    } finally {
      await app.close();
    }
  }, 20000);
});
