import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { deriveQuizV2FromScenes } from "../src/quiz/domain/quiz.js";
import { planQuizAssets } from "../src/quiz/assets/assetPlanner.js";
import { assetFingerprint } from "../src/quiz/assets/assetFingerprint.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";
import { runQa } from "../src/quiz/pipeline/orchestrator.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Quiz V2 route workflow", () => {
  it("generates and persists the canonical artifact chain without a second queue", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-v2-route-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "quiz_channel_dna.md"), "# Quiz DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const app = await buildApp(root);
    try {
      const channel = await app.repository.createChannel({ name: "Quiz Route", description: "", target_audience: "", language: "English", market: "", dna_mode: "example", group_id: "quiz" });
      const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: "topic-" + index, channel_id: channel.channel_id, title: "Topic " + index, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false, quiz_format: "multiple_choice" as const, question_count: 3, age_band: "7-9" as const }));
      await app.repository.saveTopicRun(channel.channel_id, topics);
      const episode = await app.repository.confirmTopic(channel.channel_id, topics[0].topic_id);
      await app.repository.saveScenes(channel.channel_id, episode.episode_id, [1, 2, 3].map((number) => ({
        scene_id: "scene-" + number,
        episode_id: episode.episode_id,
        scene_number: number,
        duration_seconds: 6,
        dialogue: "Question " + number,
        visual_prompt: "Question card",
        transition_note: "",
        continuity_note: "",
        quiz: { phase: "question" as const, question_number: number, question: "Which animal has stripes?", choices: ["Tiger", "Dolphin", "Elephant"], answer: "Tiger", explanation: "Tigers have stripes.", image_prompt: "" },
      })));
      const base = "/api/channels/" + channel.channel_id + "/episodes/" + episode.episode_id + "/quiz-v2";
      expect((await app.server.inject({ method: "POST", url: base + "/generate", payload: {} })).statusCode).toBe(200);
      expect((await app.server.inject({ method: "POST", url: base + "/director/generate", payload: {} })).statusCode).toBe(200);
      expect((await app.server.inject({ method: "POST", url: base + "/assets/plan", payload: {} })).statusCode).toBe(200);
      expect((await app.server.inject({ method: "POST", url: base + "/voice/plan", payload: {} })).statusCode).toBe(200);
      expect((await app.server.inject({ method: "POST", url: base + "/timeline/compile", payload: {} })).statusCode).toBe(200);
      const qa = await app.server.inject({ method: "POST", url: base + "/qa", payload: {} });
      expect(qa.statusCode).toBe(200);
      expect(qa.json().assessment.issues.some((issue: { code: string }) => issue.code === "voice_measurement_missing")).toBe(true);
      const blockedRender = await app.server.inject({ method: "POST", url: base + "/render", payload: {} });
      expect(blockedRender.statusCode).toBe(400);
      expect(blockedRender.json().error).toContain("preflight blocked");
      const legacyNarration = await app.server.inject({ method: "POST", url: `/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/narration/assemble`, payload: {} });
      expect(legacyNarration.statusCode).toBe(400);
      expect(legacyNarration.json().error).toContain("Quiz V2 voice generation");
      const state = await app.server.inject({ method: "GET", url: base });
      expect(state.statusCode).toBe(200);
      expect(state.json().stages).toMatchObject({ questions: "ready", director: "ready", assets: "ready", voice: "ready", timeline: "ready", qa: "failed" });
    } finally {
      await app.close();
    }
  });

  it("queues the real GENERATE_VIDEO task when the V2 preflight is ready", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-v2-render-route-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "quiz_channel_dna.md"), "# Quiz DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const app = await buildApp(root);
    try {
      const channel = await app.repository.createChannel({ name: "Quiz Render Route", description: "", target_audience: "", language: "English", market: "Global", dna_mode: "example", group_id: "quiz" });
      const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: "render-topic-" + index, channel_id: channel.channel_id, title: "Render Topic " + index, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false, quiz_format: "multiple_choice" as const, question_count: 3, age_band: "7-9" as const }));
      await app.repository.saveTopicRun(channel.channel_id, topics);
      const episode = await app.repository.confirmTopic(channel.channel_id, topics[0].topic_id);
      const scenes = [{
        scene_id: "render-scene-1", episode_id: episode.episode_id, scene_number: 1, duration_seconds: 6,
        dialogue: "Which animal has stripes?", visual_prompt: "Question card", transition_note: "", continuity_note: "",
        source_ids: ["C01"], quiz: { phase: "question" as const, question_number: 1, question: "Which animal has stripes?", choices: ["Tiger", "Dolphin"], answer: "Tiger", explanation: "Tigers have stripes.", image_prompt: "A friendly tiger illustration" },
      }];
      await app.repository.saveScenes(channel.channel_id, episode.episode_id, scenes);
      const quiz = deriveQuizV2FromScenes({ episodeId: episode.episode_id, language: channel.language, ageBand: episode.quiz_config.age_band, format: episode.quiz_config.quiz_format, scenes: await app.repository.readScenes(channel.channel_id, episode.episode_id) });
      const director = createDefaultDirectorPlan(quiz);
      const assetPlan = planQuizAssets(quiz, director);
      const asset = assetPlan.assets[0]!;
      const fingerprint = assetFingerprint(asset);
      const assetPath = await app.repository.writeQuizImageAsset(channel.channel_id, episode.episode_id, asset.asset_id, fingerprint, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAAI/9B+f9AAAAABJRU5ErkJggg==", "base64"));
      const voice = buildQuizVoicePlan(quiz);
      const measuredVoice = { ...voice, segments: voice.segments.map((segment) => ({ ...segment, duration_seconds: 4 })) };
      const timeline = compileQuizTimeline({ quiz, director, voicePlan: measuredVoice });
      await app.repository.writeQuiz(channel.channel_id, episode.episode_id, quiz);
      await app.repository.writeDirectorPlan(channel.channel_id, episode.episode_id, director);
      await app.repository.writeAssetPlan(channel.channel_id, episode.episode_id, assetPlan);
      await app.repository.writeQuizAssetResolution(channel.channel_id, episode.episode_id, { schema_version: 2, episode_id: episode.episode_id, template_id: "candy_arcade", assets: [{ ...asset, fingerprint, path: assetPath, source: "cache" }] });
      await app.repository.writeVoicePlan(channel.channel_id, episode.episode_id, measuredVoice);
      await app.repository.writeQuizTimeline(channel.channel_id, episode.episode_id, timeline);
      await runQa({ repository: app.repository, config: { audio_generation: (await import("../src/config.js")).DEFAULT_CONFIG.audio_generation }, channelId: channel.channel_id, episodeId: episode.episode_id });
      const narrationPath = await app.repository.writeQuizNarrationAudio(channel.channel_id, episode.episode_id, new Uint8Array([1, 2, 3]));
      await app.repository.saveNarrationMetadata(channel.channel_id, episode.episode_id, narrationPath, timeline.duration_seconds, measuredVoice.segments.length, 20);

      vi.spyOn(app.tasks, "submit").mockReturnValue({ task_id: "render-task", task_type: "GENERATE_VIDEO", channel_id: channel.channel_id, episode_id: episode.episode_id, status: "QUEUED", created_at: new Date().toISOString(), started_at: null, completed_at: null, codex_thread_id: null, codex_turn_id: null, error: null, output_files: [], lock_key: episode.episode_id, queue_position: 1, progress_message: "Queued", scene_number: null } as never);
      const response = await app.server.inject({ method: "POST", url: `/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/quiz-v2/render`, payload: {} });
      expect(response.statusCode).toBe(202);
      expect(response.json().task.task_type).toBe("GENERATE_VIDEO");
    } finally {
      await app.close();
    }
  });
});
