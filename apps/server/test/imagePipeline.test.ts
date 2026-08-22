import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RepositoryService } from "../src/repository.js";
import { PngEncoderProvider } from "../src/providers/pngEncoder.js";
import { AntigravityImageChainProvider } from "../src/providers/antigravityImageChain.js";
import { assessQuiz } from "../src/quiz/qa/quizAssessment.js";
import { deriveQuizV2FromScenes } from "../src/quiz/domain/quiz.js";
import { nowIso, type Scene } from "@studio/shared";

const mockScene = (number: number): Scene => ({
  scene_id: "scene-" + number,
  episode_id: "ep1",
  scene_number: number,
  duration_seconds: 6,
  dialogue: "Question " + number,
  visual_prompt: "CAMERA\nCard\nACTION\nShow\nLIGHTING\nSoft\nATMOSPHERE\nPlayful\nCONTINUITY\nSame",
  transition_note: "",
  continuity_note: "Same",
  sequence_id: "sequence-" + number,
  sequence_title: "Question " + number,
  shot_id: "shot-" + number,
  asset_type: "ai_reconstruction",
  continuity_bundle_id: "CB-" + number,
  reference_asset_ids: [],
  source_ids: ["C0" + number],
  reconstruction: true,
  sound_cue: "",
  editorial_overlay: { kind: "none", text: "", motion: "none", placement: "lower_third", duration_seconds: null, data: [], source_ids: [] },
  quiz: { phase: "question", question_number: number, question: "What is the capital?", choices: ["Paris", "Rome"], answer: "Paris", explanation: "Paris is capital.", image_prompt: "" },
  audio_asset_path: null,
  audio_generated_at: null,
  audio_duration_seconds: null,
});

describe("Multi-Tier Image Pipeline", () => {
  let temporaryRoot = "";
  let repository: RepositoryService;
  let channelId = "";
  let episodeId = "";

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-image-"));
    await mkdir(path.join(temporaryRoot, "templates"), { recursive: true });
    await writeFile(path.join(temporaryRoot, "templates", "example_channel_dna.md"), "# Channel DNA\n- Channel name: \n- Primary audience: \n- Market: \n- Language: \n", "utf8");
    await writeFile(path.join(temporaryRoot, "templates", "quiz_channel_dna.md"), "# Quiz DNA\n- Channel name: \n- Primary audience: \n- Market: \n- Language: \n", "utf8");
    await writeFile(path.join(temporaryRoot, "templates", "example_style_guide.md"), "# Style Guide\n", "utf8");

    repository = new RepositoryService(temporaryRoot, temporaryRoot);
    await repository.ensureBootstrap();

    const channel = await repository.createChannel({
      name: "Test Quiz Channel",
      group_id: "quiz",
      language: "English",
      target_audience: "family",
      market: "US",
      dna_mode: "example",
      description: "Test quiz",
    });
    channelId = channel.channel_id;

    const makeCandidate = (num: number) => ({
      topic_id: `top-${num}`,
      channel_id: channelId,
      title: `Retro Arcade Quiz ${num}`,
      premise: "Arcade games",
      hook: "Can you guess?",
      target_audience: "family",
      why_it_fits: "Fits trivia theme",
      estimated_potential: "High",
      estimated_scenes: 5,
      question_count: 5,
      generated_at: nowIso(),
    });

    await repository.saveTopicRun(channelId, [
      makeCandidate(1),
      makeCandidate(2),
      makeCandidate(3),
      makeCandidate(4),
      makeCandidate(5),
    ]);
    const episode = await repository.confirmTopic(channelId, "top-1", 5);
    episodeId = episode.episode_id;
  });

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("PngEncoderProvider generates valid PNG bytes with degraded metadata", async () => {
    const provider = new PngEncoderProvider(repository, { channelId, episodeId, bundleNumber: 1 });
    const result = await provider.generateReference("A futuristic laboratory with glowing cybernetic machines");

    expect(result.fallback_tier).toBe(3);
    expect(result.degraded).toBe(true);
    expect(result.asset_path).toBeDefined();

    const fullPath = repository.resolveContextPath(result.asset_path);
    const buffer = await readFile(fullPath);

    // Verify PNG 8-byte header: 89 50 4E 47 0D 0A 1A 0A
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4E); // N
    expect(buffer[3]).toBe(0x47); // G
    expect(buffer[4]).toBe(0x0D);
    expect(buffer[5]).toBe(0x0A);
    expect(buffer[6]).toBe(0x1A);
    expect(buffer[7]).toBe(0x0A);

    // Verify IHDR width and height (960x540, 16:9 aspect ratio)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    expect(width).toBe(960);
    expect(height).toBe(540);
    expect(width / height).toBeCloseTo(16 / 9, 2);
  });

  it("AntigravityImageChainProvider throws IMAGE_GENERATION_FAILED by default when Tier 1 fails without Tier 2 fallback", async () => {
    const failingClient = {
      startThread: async () => { throw new Error("Antigravity offline"); },
      startTurn: async () => { throw new Error("Antigravity offline"); },
      interruptTurn: async () => {},
      on: () => {},
      off: () => {},
    };
    const provider = new AntigravityImageChainProvider(repository, { channelId, episodeId, bundleNumber: 2 }, failingClient as never);
    
    await expect(provider.generateReference("Neon arcade machine in the 1980s")).rejects.toThrow("Image generation failed");
  });

  it("AntigravityImageChainProvider cascades down to Tier 3 when allowTier3Fallback is true", async () => {
    const failingClient = {
      startThread: async () => { throw new Error("Antigravity offline"); },
      startTurn: async () => { throw new Error("Antigravity offline"); },
      interruptTurn: async () => {},
      on: () => {},
      off: () => {},
    };
    const provider = new AntigravityImageChainProvider(repository, { channelId, episodeId, bundleNumber: 2 }, failingClient as never, { allowTier3Fallback: true });
    const result = await provider.generateReference("Neon arcade machine in the 1980s");

    expect(result.fallback_tier).toBe(3);
    expect(result.degraded).toBe(true);
    expect(result.asset_path).toBeDefined();

    const fullPath = repository.resolveContextPath(result.asset_path);
    const buffer = await readFile(fullPath);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it("AntigravityNativeImageProvider succeeds with Zero API Key when brain image is created", async () => {
    const userHome = os.homedir();
    const fakeBrainDir = path.join(userHome, ".gemini", "antigravity", "brain", "test-img-conv");
    await mkdir(fakeBrainDir, { recursive: true });

    const fakePng = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 3, 192, 0, 0, 2, 28, 8, 6, 0, 0, 0]);
    await writeFile(path.join(fakeBrainDir, "bundle_cb_01_12345.png"), fakePng);

    // Mock client that immediately resolves turn
    const mockClient = {
      startThread: async () => "mock-thread",
      startTurn: async () => "mock-turn",
      deleteThread: async () => true,
      getConversationId: () => "test-img-conv",
      interruptTurn: async () => {},
      on: (event: string, handler: (payload: unknown) => void) => {
        if (event === "notification") {
          setTimeout(() => handler({ method: "turn/completed", params: { turnId: "mock-turn", turn: { id: "mock-turn", status: "completed" } } }), 10);
        }
      },
      off: () => {},
    };

    const provider = new AntigravityImageChainProvider(repository, { channelId, episodeId, bundleNumber: 1 }, mockClient as never);
    const result = await provider.generateReference("A futuristic laboratory with glowing cybernetic machines");

    expect(result.fallback_tier).toBe(1);
    expect(result.degraded).toBe(false);
    expect(result.asset_path).toBeDefined();

    await rm(fakeBrainDir, { recursive: true, force: true }).catch(() => {});
  });

  it("QA assessment flags degraded assets with asset_fallback_degraded warning", () => {
    const quiz = deriveQuizV2FromScenes({
      episodeId,
      language: "English",
      ageBand: "family",
      format: "multiple_choice",
      scenes: [mockScene(1)],
    });

    const assessment = assessQuiz({
      quiz,
      resolvedAssets: [
        {
          asset_id: "asset_q1",
          path: `channels/${channelId}/episodes/${episodeId}/assets/asset_q1.png`,
          source: "fallback",
          degraded: true,
          fallback_tier: 3,
        },
      ],
    });

    const fallbackIssue = assessment.issues.find((issue) => issue.code === "asset_fallback_degraded");
    expect(fallbackIssue).toBeDefined();
    expect(fallbackIssue?.severity).toBe("warning");
  });
});
