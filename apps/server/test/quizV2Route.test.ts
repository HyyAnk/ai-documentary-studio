import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

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
      const state = await app.server.inject({ method: "GET", url: base });
      expect(state.statusCode).toBe(200);
      expect(state.json().stages).toMatchObject({ questions: "ready", director: "ready", assets: "ready", voice: "ready", timeline: "ready", qa: "failed" });
    } finally {
      await app.close();
    }
  });
});
