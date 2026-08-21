import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/context.js";
import { StudioLogger } from "../src/logger.js";
import { calibratedScriptTargetWords, scriptWordBounds } from "../src/production.js";
import { RepositoryService } from "../src/repository.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ContextEngine", () => {
  it("builds topic context from one channel and excludes episode bodies and other channels", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-context-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    await writeFile(path.join(root, "shared", "production_rules.md"), "# Production\n", "utf8");
    await writeFile(path.join(root, "shared", "research_rules.md"), "# Research\n", "utf8");
    await writeFile(path.join(root, "shared", "script_rules.md"), "# Script\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "One Channel", description: "Only this channel", target_audience: "Viewers", language: "English", market: "Global", dna_mode: "example" });
    const other = await repository.createChannel({ name: "Other Channel", description: "SECRET_OTHER_CHANNEL", target_audience: "", language: "English", market: "", dna_mode: "example" });
    await repository.saveChannelDna(other.channel_id, "# SECRET_OTHER_CHANNEL\n");
    const logger = new StudioLogger(root, true);
    await logger.init();
    const context = await new ContextEngine(repository, logger).build("SUGGEST_TOPICS", channel.channel_id, null);
    const paths = context.included_files.map((file) => file.path);
    expect(paths.some((file) => file.includes("one-channel"))).toBe(true);
    expect(paths.some((file) => file.includes("other-channel"))).toBe(false);
    expect(paths.some((file) => file.endsWith("script.md"))).toBe(false);
    expect(context.prompt).not.toContain("SECRET_OTHER_CHANNEL");
    expect(context.excluded_categories).toContain("research/script/scene work for candidates");
  });

  it("uses the Quiz Engine DNA template for AI DNA generation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-quiz-dna-context-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# Documentary DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "quiz_channel_dna.md"), "# Quiz Channel DNA\n\n## Quiz formats\n\n- Knowledge quiz\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Quiz DNA", description: "A quiz test", target_audience: "Children", language: "English", market: "Global", group_id: "quiz", dna_mode: "ai" });
    const logger = new StudioLogger(root, true);
    await logger.init();

    const context = await new ContextEngine(repository, logger).build("GENERATE_DNA", channel.channel_id, null);

    expect(context.included_files.some((file) => file.path === "templates/quiz_channel_dna.md")).toBe(true);
    expect(context.prompt).toContain("Knowledge quiz");
    expect(context.prompt).not.toContain("# Documentary DNA");
  });

  it("writes target-aware script contracts for every 3–8 minute duration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-script-context-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Target Matrix", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "target_matrix_topic", channel_id: channel.channel_id, title: "Target Matrix Topic", premise: "A test premise", why_it_fits: "A test fit", hook: "A test hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `target_matrix_topic_${index + 2}`, title: `Other Target ${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, topic.topic_id);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "research.md", "# Research Dossier\n\nC01 verified source");
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "treatment.md", "# Documentary Treatment\n\n## Sequence 1\nTime budget and claim C01");
    const logger = new StudioLogger(root, true);
    await logger.init();
    const engine = new ContextEngine(repository, logger);

    for (const minutes of [3, 4, 5, 6, 7, 8]) {
      const configured = await repository.updateEpisodeSettings(channel.channel_id, episode.episode_id, { target_duration_minutes: minutes }, 2.3);
      const target = calibratedScriptTargetWords(configured, 2.3);
      const bounds = scriptWordBounds(target);
      const context = await engine.build("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
      expect(context.prompt).toContain(`Target approximately ${target} spoken words for ${minutes} minutes`);
      expect(context.prompt).toContain(`hard acceptable range is ${bounds.lower}–${bounds.upper}`);
      expect(context.prompt).toContain(minutes <= 3 ? "1–2 dry" : minutes <= 5 ? "2–3 dry" : "2–4 dry");
      const treatmentContext = await engine.build("GENERATE_TREATMENT", channel.channel_id, episode.episode_id);
      expect(treatmentContext.prompt).toContain(minutes <= 3 ? "5–6 numbered sequences" : minutes <= 5 ? "6–8 numbered sequences" : "7–10 numbered sequences");
    }
  });

  it("uses the absolute storage path for continuity image output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-image-context-"));
    const storage = await mkdtemp(path.join(os.tmpdir(), "documentary-image-storage-"));
    roots.push(root, storage);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n\n## Visual Style\nWarm\n\n## Visual Language\nCinematic\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    await writeFile(path.join(root, "shared", "visual_bible_rules.md"), "# Visual rules\n", "utf8");
    await writeFile(path.join(root, "shared", "visual_rules.md"), "# Visual rules\n", "utf8");
    const repository = new RepositoryService(root, storage);
    const channel = await repository.createChannel({ name: "Image Context", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "image_context_topic", channel_id: channel.channel_id, title: "Image Context Topic", premise: "A test premise", why_it_fits: "A test fit", hook: "A test hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `image_context_topic_${index + 2}`, title: `Other Image Topic ${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, topic.topic_id);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "visual_bible.md", "# Episode Visual Bible\n\n## Continuity bundle CB-01 — Workshop\n\n- Era: 1950s\n- Anchor-frame prompt: A warm workshop.\n- Reference asset slots: anchor\n");
    const logger = new StudioLogger(root, true);
    await logger.init();
    const context = await new ContextEngine(repository, logger).build("GENERATE_BUNDLE_IMAGE", channel.channel_id, episode.episode_id, 1);
    const target = await repository.getBundleImagePath(channel.channel_id, episode.episode_id, 1);
    expect(context.included_files.some((file) => file.path === target.absolutePath)).toBe(true);
    expect(context.prompt).toContain(target.absolutePath);
  });

  it("keeps sequence shot generation recoverable when a legacy visual bible is missing a later bundle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-sequence-context-recovery-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Sequence Recovery", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "sequence_recovery_topic", channel_id: channel.channel_id, title: "Sequence Recovery Topic", premise: "A test premise", why_it_fits: "A test fit", hook: "A test hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `sequence_recovery_topic_${index + 2}`, title: `Other Recovery Topic ${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, topic.topic_id);
    const sequenceHeadings = Array.from({ length: 6 }, (_, index) => `## Sequence ${index + 1} — Part ${index + 1}\n\nSequence ${index + 1} narration.`).join("\n\n");
    const scriptHeadings = Array.from({ length: 6 }, (_, index) => `## Sequence ${index + 1} — Part ${index + 1}\n\nSequence ${index + 1} narration.`).join("\n\n");
    const bundleHeadings = Array.from({ length: 5 }, (_, index) => `## Continuity bundle CB-${String(index + 1).padStart(2, "0")} — Bundle ${index + 1}\n\n- Anchor-frame prompt: Bundle ${index + 1}.`).join("\n\n");
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "research.md", "# Research Dossier\n\nC01 verified");
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "treatment.md", `# Documentary Treatment\n\n${sequenceHeadings}`);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "script.md", `# Sequence Recovery\n\n<!-- HUMOR_POLICY: v1 -->\n\n${scriptHeadings}`);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "visual_bible.md", `# Episode Visual Bible\n\n${bundleHeadings}`);
    const logger = new StudioLogger(root, true);
    await logger.init();

    const context = await new ContextEngine(repository, logger).build("GENERATE_SEQUENCE_SCENES", channel.channel_id, episode.episode_id, 6);

    expect(context.prompt).toContain("visual bible fallback for requested section 6");
    expect(context.prompt).toContain("CB-05");
    expect(context.prompt).toContain('continuity_bundle_id \\"CB-06\\"');
  });
});
