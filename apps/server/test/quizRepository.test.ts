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
});
