import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QuizV2Schema } from "@studio/shared";
import { SfxRegistry } from "../src/quiz/audio/sfxRegistry.js";
import { assetFingerprint } from "../src/quiz/assets/assetFingerprint.js";
import { AssetResolver, isSafeAssetReference } from "../src/quiz/assets/assetResolver.js";
import { compactQuizAssetSubject, planQuizAssets, QUIZ_ASSET_SUBJECT_MAX_LENGTH } from "../src/quiz/assets/assetPlanner.js";
import { validateResolvedAssets } from "../src/quiz/assets/validateAssets.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { preflightQuizRender } from "../src/quiz/qa/preflight.js";
import { validateRenderProbe } from "../src/quiz/qa/postRenderQa.js";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { quizVoiceFingerprint, quizVoiceTempo } from "../src/quiz/audio/voiceSynthesis.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";

import { isQuizAssetResolutionComplete, resolveQuizAssets } from "../src/quiz/assets/resolveQuizAssets.js";
import { RepositoryService } from "../src/repository.js";

const roots: string[] = [];
const quiz = QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "asset-episode",
  age_band: "7-9",
  language: "English",
  questions: [{
    id: "question-01",
    number: 1,
    format: "image_guess",
    difficulty: 2,
    question: "Which animal is shown?",
    choices: [{ id: "choice-a", text: "Tiger" }, { id: "choice-b", text: "Dolphin" }],
    correct_choice_id: "choice-a",
    explanation: "The stripes identify a tiger.",
    fun_fact: "",
    source_ids: ["C01"],
    visual_opportunity: "A friendly tiger illustration",
    validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
  }],
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Quiz V2 assets and QA", () => {
  it("fingerprints semantic requests deterministically", () => {
    const request = { semantic_key: "question-01:question_illustration", subject: "Tiger", purpose: "question_illustration" as const, style: "cute_illustration" as const, aspect_ratio: "16:9" as const, transparent_background: false };
    expect(assetFingerprint(request)).toBe(assetFingerprint({ ...request, subject: " tiger " }));
    expect(assetFingerprint(request)).not.toBe(assetFingerprint({ ...request, subject: "Dolphin" }));
  });

  it("keeps long visual opportunities within the asset subject contract", () => {
    const longVisualOpportunity = "Safe illustrated dishwasher cutaway with a white rack holding plates, spray arms beneath the rack, sky-blue water jets crossing the plates, and detergent dissolving in the wash water; soft 5600K kitchen-appliance light, rounded forms, clear answer-card space, and no visible text.";
    const longQuiz = QuizV2Schema.parse({ ...quiz, questions: [{ ...quiz.questions[0], format: "multiple_choice", visual_opportunity: longVisualOpportunity }] });
    const plan = planQuizAssets(longQuiz, createDefaultDirectorPlan(longQuiz));
    const hero = plan.assets.find((asset) => asset.purpose === "hero_question_image");
    expect(hero?.subject.length).toBeLessThanOrEqual(QUIZ_ASSET_SUBJECT_MAX_LENGTH);
    expect(hero?.subject).toContain("dishwasher");
    expect(compactQuizAssetSubject("word ".repeat(80), "Fallback subject").length).toBeLessThanOrEqual(QUIZ_ASSET_SUBJECT_MAX_LENGTH);
  });

  it("blocks a semantically incorrect fallback for a required image question", async () => {
    const plan = planQuizAssets(quiz, createDefaultDirectorPlan(quiz));
    const result = await new AssetResolver({ fallback: async () => ({ path: "fallback.png", semantic_key: "wrong-subject" }) }).resolve(plan);
    expect(result.issues.some((issue) => issue.code === "asset_semantic_fallback" && issue.severity === "blocker")).toBe(true);
  });

  it("resolves exact assets in preference order and rejects traversal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-assets-"));
    roots.push(root);
    const file = path.join(root, "tiger.png");
    await writeFile(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAAI/9B+f9AAAAABJRU5ErkJggg==", "base64"));
    const plan = planQuizAssets(quiz, createDefaultDirectorPlan(quiz));
    const result = await new AssetResolver({ explicit_episode: async () => ({ path: file, semantic_key: plan.assets[0].semantic_key }) }).resolve(plan);
    expect(result.assets[0].source).toBe("explicit_episode");
    expect(await validateResolvedAssets(plan.assets, result.assets)).toEqual([]);
    expect(isSafeAssetReference("../outside.png")).toBe(false);
    expect(isSafeAssetReference("https://example.com/file.png")).toBe(false);
  });

  it("creates semantic voice roles and tolerates missing decorative SFX", () => {
    const voice = buildQuizVoicePlan(quiz);
    expect(voice.segments.map((segment) => segment.role)).toEqual(expect.arrayContaining(["question", "choice", "reveal", "explanation", "outro"]));
    expect(voice.segments.some((segment) => segment.role === "thinking_prompt")).toBe(true);
    const registry = new SfxRegistry();
    registry.register({ intent: "ui_pop", path: "ui-pop.wav", decorative: true });
    expect(registry.resolveMany(["ui_pop", "correct_small"]).missing).toEqual(["correct_small"]);
  });

  it("changes the voice cache fingerprint when narration content changes", () => {
    const voice = buildQuizVoicePlan(quiz);
    const segment = voice.segments.find((item) => item.role === "question")!;
    const config = { provider: "chatterbox" as const, service_url: "http://127.0.0.1:8890", exaggeration: 0.5, cfg_weight: 0.5, max_concurrent_tasks: 2, merge_gap_ms: 300, match_target_duration: true };
    expect(quizVoiceFingerprint(segment, quizVoiceTempo(segment.role), "default", config)).not.toBe(quizVoiceFingerprint({ ...segment, text: `${segment.text} changed` }, quizVoiceTempo(segment.role), "default", config));
    expect(quizVoiceFingerprint(segment, quizVoiceTempo(segment.role), "default", config, 1.9)).not.toBe(quizVoiceFingerprint(segment, quizVoiceTempo(segment.role), "default", config, 2.1));
  });

  it("blocks preflight when required assets are unresolved and validates render probe evidence", () => {
    const plainQuiz = QuizV2Schema.parse({ ...quiz, questions: [{ ...quiz.questions[0], format: "multiple_choice", visual_opportunity: "" }] });
    const director = createDefaultDirectorPlan(plainQuiz);
    const voicePlan = buildQuizVoicePlan(plainQuiz);
    const timeline = compileQuizTimeline({ quiz: plainQuiz, director, voicePlan });
    const plan = planQuizAssets(plainQuiz, director);
    const preflight = preflightQuizRender({ quiz: plainQuiz, director, assetPlan: plan, resolvedAssets: [], voicePlan, timeline, measuredAudio: true });
    expect(preflight.ok).toBe(false);
    expect(preflight.assessment.issues.some((issue) => issue.code === "visual_subject_missing")).toBe(true);
    const invalidProbe = validateRenderProbe({ format: { duration: "10" }, streams: [{ codec_type: "video", width: 1280, height: 720, r_frame_rate: "24/1", duration: "10" }] }, { width: 1920, height: 1080, fps: 30 });
    expect(invalidProbe.some((issue) => issue.code === "render_audio_stream_missing")).toBe(true);
    expect(invalidProbe.some((issue) => issue.code === "render_resolution_mismatch")).toBe(true);
  });

  it("automatically bridges and reuses Continuity bundle images for hero question assets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-continuity-bridge-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# Channel DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "quiz_channel_dna.md"), "# Quiz Channel DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style Guide\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Bridge Quiz", description: "", target_audience: "", language: "English", market: "", dna_mode: "example", group_id: "quiz" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: "topic-" + index, channel_id: channel.channel_id, title: "Topic " + index, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);

    // Create a 1x1 valid PNG image in Continuity bundle 1 (CB-01)
    const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAAI/9B+f9AAAAABJRU5ErkJggg==", "base64");
    await repository.writeBundleImage(channel.channel_id, episode.episode_id, 1, pngBytes, 0, { price_vnd: 250, model: "imagen-3" });

    const quizWithVisual = QuizV2Schema.parse({
      schema_version: 2,
      episode_id: episode.episode_id,
      age_band: "7-9",
      language: "English",
      questions: [{
        id: "question-01",
        number: 1,
        format: "multiple_choice",
        difficulty: 1,
        question: "Which ocean is largest?",
        choices: [{ id: "choice-a", text: "Pacific" }, { id: "choice-b", text: "Atlantic" }, { id: "choice-c", text: "Indian" }],
        correct_choice_id: "choice-a",
        explanation: "Pacific is largest.",
        fun_fact: "",
        source_ids: ["C01"],
        visual_opportunity: "Show a clean blue globe",
        validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
      }],
    });

    const director = createDefaultDirectorPlan(quizWithVisual);
    const plan = planQuizAssets(quizWithVisual, director);

    // Resolve assets without any third-party provider configured
    const { resolution } = await resolveQuizAssets({
      repository,
      channelId: channel.channel_id,
      episodeId: episode.episode_id,
      plan,
    });

    const heroAsset = resolution.assets.find((a) => a.asset_id === "asset-question-01-hero");
    expect(heroAsset).toBeDefined();
    expect(heroAsset?.source).toBe("explicit_episode");
    expect(heroAsset?.path).toContain("asset-question-01-hero");
  });

  it("strictly enforces 100% completion in isQuizAssetResolutionComplete and rejects partial resolutions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-completeness-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# Channel DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "quiz_channel_dna.md"), "# Quiz Channel DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style Guide\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Completeness Quiz", description: "", target_audience: "", language: "English", market: "", dna_mode: "example", group_id: "quiz" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: "topic-" + index, channel_id: channel.channel_id, title: "Topic " + index, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);

    const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAAI/9B+f9AAAAABJRU5ErkJggg==", "base64");
    const validFingerprint = "a".repeat(64);
    const assetPath1 = await repository.writeQuizImageAsset(channel.channel_id, episode.episode_id, "asset-question-01-hero", validFingerprint, pngBytes);

    const plan = planQuizAssets(quiz, createDefaultDirectorPlan(quiz));
    expect(plan.assets.length).toBeGreaterThan(1);

    // Partial resolution (e.g. 1 asset out of 3)
    const partialResolution = {
      schema_version: 2 as const,
      episode_id: episode.episode_id,
      template_id: "candy_arcade",
      assets: [{
        ...plan.assets[0],
        fingerprint: validFingerprint,
        path: assetPath1,
        source: "provider" as const,
      }],
    };

    const isCompletePartial = await isQuizAssetResolutionComplete({
      repository,
      channelId: channel.channel_id,
      episodeId: episode.episode_id,
      plan,
      resolution: partialResolution,
    });
    expect(isCompletePartial).toBe(false);
  });
});
