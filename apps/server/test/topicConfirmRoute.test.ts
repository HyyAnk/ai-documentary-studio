import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("topic confirmation", () => {
  it("uses the selected question count for the new episode and selected topic record", async () => {
    const root = await createTestRoot();
    const app = await buildApp(root);
    try {
      const channel = await app.repository.createChannel({ name: "Question count", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
      const topics = Array.from({ length: 5 }, (_, index) => ({
        topic_id: `question-count-${index}`,
        channel_id: channel.channel_id,
        title: `Question count topic ${index}`,
        premise: "Premise",
        why_it_fits: "Fits",
        hook: "Hook",
        estimated_potential: "High",
        generated_at: new Date().toISOString(),
        selected: false,
        question_count: 8,
      }));
      await app.repository.saveTopicRun(channel.channel_id, topics);

      const response = await app.server.inject({
        method: "POST",
        url: `/api/channels/${channel.channel_id}/topics/${topics[0].topic_id}/confirm`,
        payload: { topic_id: "ignored-by-route", question_count: 12 },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().episode).toMatchObject({
        quiz_config: { question_count: 12 },
        target_duration_minutes: 7,
        target_word_count: 918,
      });
      expect((await app.repository.listTopics(channel.channel_id)).find((topic) => topic.topic_id === topics[0].topic_id)).toMatchObject({ selected: true, question_count: 12 });
    } finally {
      await app.close();
    }
  });

  it("accepts 50 questions and rejects values above the product limit", async () => {
    const root = await createTestRoot();
    const app = await buildApp(root);
    try {
      const channel = await app.repository.createChannel({ name: "Question limit", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
      const topics = Array.from({ length: 5 }, (_, index) => ({
        topic_id: `question-limit-${index}`,
        channel_id: channel.channel_id,
        title: `Question limit topic ${index}`,
        premise: "Premise",
        why_it_fits: "Fits",
        hook: "Hook",
        estimated_potential: "High",
        generated_at: new Date().toISOString(),
        selected: false,
        question_count: 8,
      }));
      await app.repository.saveTopicRun(channel.channel_id, topics);

      const accepted = await app.server.inject({
        method: "POST",
        url: `/api/channels/${channel.channel_id}/topics/${topics[0].topic_id}/confirm`,
        payload: { question_count: 50 },
      });
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json().episode).toMatchObject({ quiz_config: { question_count: 50 }, target_duration_minutes: 28 });

      const rejected = await app.server.inject({
        method: "POST",
        url: `/api/channels/${channel.channel_id}/topics/${topics[1].topic_id}/confirm`,
        payload: { question_count: 51 },
      });
      expect(rejected.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

async function createTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "documentary-topic-confirm-"));
  roots.push(root);
  await mkdir(path.join(root, "templates"), { recursive: true });
  await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
  await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
  return root;
}
