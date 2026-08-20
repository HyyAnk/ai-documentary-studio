import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QuizV2Schema } from "@studio/shared";
import { RepositoryService } from "../src/repository.js";

const roots: string[] = [];

async function fixture(): Promise<{ repository: RepositoryService; channelId: string; episodeId: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quiz-v2-repository-"));
  roots.push(root);
  await mkdir(path.join(root, "templates"), { recursive: true });
  await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# Channel DNA\n", "utf8");
  await writeFile(path.join(root, "templates", "quiz_channel_dna.md"), "# Quiz Channel DNA\n", "utf8");
  await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style Guide\n", "utf8");
  const repository = new RepositoryService(root);
  const channel = await repository.createChannel({ name: "Quiz V2", description: "", target_audience: "", language: "English", market: "", dna_mode: "example", group_id: "quiz" });
  const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: "topic-" + index, channel_id: channel.channel_id, title: "Topic " + index, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
  await repository.saveTopicRun(channel.channel_id, topics);
  const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
  return { repository, channelId: channel.channel_id, episodeId: episode.episode_id };
}

const quiz = (episodeId: string) => QuizV2Schema.parse({
  schema_version: 2,
  episode_id: episodeId,
  age_band: "7-9",
  language: "English",
  questions: [{
    id: "question-01",
    number: 1,
    format: "multiple_choice",
    difficulty: 1,
    question: "Which animal has stripes?",
    choices: [{ id: "choice-a", text: "Tiger" }, { id: "choice-b", text: "Dolphin" }],
    correct_choice_id: "choice-a",
    explanation: "A tiger has stripes.",
    fun_fact: "",
    source_ids: ["C01"],
    visual_opportunity: "",
    validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
  }],
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Quiz V2 repository artifacts", () => {
  it("writes and reads versioned artifacts through fixed safe paths", async () => {
    const { repository, channelId, episodeId } = await fixture();
    const value = quiz(episodeId);
    const artifactPath = await repository.writeQuiz(channelId, episodeId, value);
    expect(artifactPath).toContain("/quiz/quiz-v2.json");
    expect(await repository.readQuiz(channelId, episodeId)).toEqual(value);
    const stored = repository.resolvePath("channels", (await repository.getChannel(channelId)).slug, "episodes", (await repository.getEpisode(channelId, episodeId)).slug, "quiz", "quiz-v2.json");
    expect(JSON.parse(await readFile(stored, "utf8"))).toEqual(value);
  });

  it("fails closed on malformed artifacts instead of silently upgrading them", async () => {
    const { repository, channelId, episodeId } = await fixture();
    const channel = await repository.getChannel(channelId);
    const episode = await repository.getEpisode(channelId, episodeId);
    const artifact = repository.resolvePath("channels", channel.slug, "episodes", episode.slug, "quiz", "quiz-v2.json");
    await mkdir(path.dirname(artifact), { recursive: true });
    await writeFile(artifact, JSON.stringify({ schema_version: 1, questions: [] }), "utf8");
    await expect(repository.readQuiz(channelId, episodeId)).rejects.toThrow("malformed");
  });

  it("removes only downstream artifacts during invalidation", async () => {
    const { repository, channelId, episodeId } = await fixture();
    const value = quiz(episodeId);
    await repository.writeQuiz(channelId, episodeId, value);
    await repository.writeQuiz(channelId, episodeId, value);
    const removed = await repository.invalidateQuizArtifacts(channelId, episodeId, ["director", "timeline", "qa"]);
    expect(removed).toHaveLength(3);
    expect(await repository.readQuiz(channelId, episodeId)).toEqual(value);
  });

  it("invalidates V2 artifacts from source files, settings, and changed scenes", async () => {
    const { repository, channelId, episodeId } = await fixture();
    const value = quiz(episodeId);

    await repository.writeQuiz(channelId, episodeId, value);
    await repository.saveEpisodeFile(channelId, episodeId, "research.md", "# Research\n\nC01 updated");
    expect(await repository.readQuiz(channelId, episodeId)).toBeNull();

    await repository.writeQuiz(channelId, episodeId, value);
    await repository.updateEpisodeSettings(channelId, episodeId, { question_count: 9 }, 2.3);
    expect(await repository.readQuiz(channelId, episodeId)).toBeNull();

    const scene = {
      scene_id: "scene-1", episode_id: episodeId, scene_number: 1, duration_seconds: 6,
      dialogue: "Original question", visual_prompt: "Question card", transition_note: "", continuity_note: "",
      source_ids: ["C01"], quiz: { phase: "question" as const, question_number: 1, question: "Which animal has stripes?", choices: ["Tiger", "Dolphin"], answer: "Tiger", explanation: "Tigers have stripes.", image_prompt: "" },
    };
    await repository.saveScenes(channelId, episodeId, [scene]);
    await repository.writeQuiz(channelId, episodeId, value);
    await repository.saveScenes(channelId, episodeId, [{ ...scene, dialogue: "Edited question" }]);
    expect(await repository.readQuiz(channelId, episodeId)).toBeNull();
  });

  it("clears stale V2 renders but preserves a legacy render with no V2 artifact", async () => {
    const { repository, channelId, episodeId } = await fixture();
    const value = quiz(episodeId);
    await repository.writeQuiz(channelId, episodeId, value);
    const v2Video = await repository.writeVideoArtifact(channelId, episodeId, new Uint8Array([1, 2, 3]));
    const manifest = await repository.writeRenderManifest(channelId, episodeId, "{\"quiz_engine_version\":2}");
    await repository.saveVideoMetadata(channelId, episodeId, v2Video, 10, manifest);
    await repository.invalidateQuizArtifacts(channelId, episodeId, ["render"]);
    expect((await repository.getEpisode(channelId, episodeId)).video_asset_path).toBeNull();
    await expect(repository.getEpisodeVideoFile(channelId, episodeId)).rejects.toThrow("not found");

    const channel = await repository.getChannel(channelId);
    const topics = await repository.listTopics(channelId);
    const legacyEpisode = await repository.confirmTopic(channelId, topics[1]!.topic_id);
    const legacyVideo = await repository.writeVideoArtifact(channelId, legacyEpisode.episode_id, new Uint8Array([4, 5, 6]));
    const legacyManifest = await repository.writeRenderManifest(channelId, legacyEpisode.episode_id, "{\"quiz_engine_version\":1}");
    await repository.saveVideoMetadata(channelId, legacyEpisode.episode_id, legacyVideo, 10, legacyManifest);
    await repository.invalidateQuizArtifacts(channelId, legacyEpisode.episode_id, ["render"]);
    expect((await repository.getEpisode(channelId, legacyEpisode.episode_id)).video_asset_path).toBe(legacyVideo);
    expect(channel.engine).toBe("quiz");
  });
});
