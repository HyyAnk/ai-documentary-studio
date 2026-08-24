import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/context.js";
import { StudioLogger } from "../src/logger.js";
import { RepositoryService } from "../src/repository.js";
import { calibratedScriptTargetWords, countWords, extractNarration, scriptWordBounds } from "../src/production.js";
import { extractScriptMarkdown, TaskManager, validateQuizScript, validateScript } from "../src/tasks.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("script quality gates", () => {
  it("accepts calibrated scripts for every target from 3 through 8 minutes", () => {
    for (const minutes of [3, 4, 5, 6, 7, 8]) {
      const target = calibratedScriptTargetWords({ target_duration_minutes: minutes, measured_narration_words_per_second: null }, 2.3);
      const bounds = scriptWordBounds(target);
      const script = scriptWithWordCount(target, `Episode ${minutes}`);

      expect(countWords(extractNarration(script))).toBe(target);
      expect(() => validateScript(script, target)).not.toThrow();
      expect(target).toBe(Math.round(minutes * 60 * 2.3));
      expect(bounds.lower).toBe(Math.floor(target * 0.8));
      expect(bounds.upper).toBe(Math.ceil(target * 1.2));
    }
  });

  it("rejects the reported runaway 13,579-word output for a 5-minute target", () => {
    const target = calibratedScriptTargetWords({ target_duration_minutes: 5, measured_narration_words_per_second: null }, 2.3);
    const script = scriptWithWordCount(13_579, "The Internet Before Google");

    expect(() => validateScript(script, target)).toThrow("13579 words");
  });

  it("keeps only the selected episode section when output contains other H1 sections", () => {
    const output = [
      "# Research Dossier",
      "Internal notes that must not become narration.",
      "# The Internet Before Google",
      "<!-- HUMOR_POLICY: v1 -->",
      "1956 C01 changed the plan. 1960 C02 measured 25 percent. 1964 C03 covered 30 miles. 1971 C04 ended the program. 1987 C05 changed standards. 1997 C06 demonstrated the replacement.",
      "## Sequence 1 — The promise",
      "The argument continues here.",
      "# Assistant Notes",
      "This should be excluded from the persisted script.",
    ].join("\n\n");

    const script = extractScriptMarkdown(output, "The Internet Before Google");
    expect(script).toContain("# The Internet Before Google");
    expect(script).toContain("## Sequence 1 — The promise");
    expect(script).not.toContain("Research Dossier");
    expect(script).not.toContain("Assistant Notes");
  });

  it("counts quiz question headings through the 50-question ceiling", () => {
    const script = ["# Quiz script", "<!-- HUMOR_POLICY: v1 -->", ...Array.from({ length: 50 }, (_, index) => `## Question ${index + 1} — Question ${index + 1}\nGuess now. The correct answer is ready.`)].join("\n\n");
    expect(() => validateQuizScript(script, 15)).not.toThrow();
    expect(() => validateQuizScript(script, 50)).not.toThrow();
  });
});

describe("script task output isolation and retry", () => {
  it("ignores non-agent events and retries once with the calibrated word budget", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-script-quality-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");

    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Script Quality", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topic = { topic_id: "script_quality_topic", channel_id: channel.channel_id, title: "The Internet Before Google", premise: "A test premise", why_it_fits: "Documentary test", hook: "A test hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false };
    await repository.saveTopicRun(channel.channel_id, [topic, ...Array.from({ length: 4 }, (_, index) => ({ ...topic, topic_id: `script_quality_topic_${index + 2}`, title: `Other Topic ${index + 2}` }))]);
    const episode = await repository.confirmTopic(channel.channel_id, topic.topic_id);
    await repository.updateEpisodeSettings(channel.channel_id, episode.episode_id, { target_duration_minutes: 5 }, 2.3);
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "research.md", "# Research Dossier\n\nC01 https://example.com/1\nC02 https://example.com/2");
    await repository.saveEpisodeFile(channel.channel_id, episode.episode_id, "treatment.md", "# Documentary Treatment\n\n## Sequence 1\nTime budget and claim C01");

    const logger = new StudioLogger(root, true);
    await logger.init();
    const codex = new ScriptCodex();
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), codex as never, 1, 8, logger);
    await manager.load();
    const task = manager.submit("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
    await waitFor(() => manager.get(task.task_id).status === "COMPLETED");

    const persisted = await repository.getEpisodeFile(channel.channel_id, episode.episode_id, "script.md");
    expect(manager.get(task.task_id).error).toBeNull();
    expect(persisted.content).toContain("## Question 8");
    expect(persisted.content).not.toContain("reasoning payload");
    expect(codex.prompts).toHaveLength(2);
    expect(codex.prompts[1]).toContain("STRICT RETRY");
  });
});

function scriptWithWordCount(wordCount: number, title: string): string {
  const anchors = "In 1956 C01 changed the plan. In 1960 C02 measured 25 percent. In 1964 C03 covered 30 miles. In 1971 C04 ended the program. In 1987 C05 changed standards. In 1997 C06 demonstrated the replacement.";
  const anchorWords = anchors.match(/\S+/g) ?? [];
  const words = anchorWords.concat(Array.from({ length: Math.max(0, wordCount - anchorWords.length) }, (_, index) => `evidence${index + 1}`)).slice(0, wordCount);
  return `# ${title}\n\n<!-- HUMOR_POLICY: v1 -->\n\n${words.join(" ")}\n\n<!-- AUDIO_CUE: chuckle -->`;
}

function quizScriptWithQuestions(questionCount: number, title: string): string {
  const sections = Array.from({ length: questionCount }, (_, index) => `## Question ${index + 1} — Question ${index + 1}\nWhich planet is red?\n\nA. Mars\nB. Venus\nC. Jupiter\n\nGuess now!\n\nThe answer is A — Mars.\n\nMars is covered in iron oxide.`);
  return `# ${title}\n\n<!-- HUMOR_POLICY: v1 -->\n\n${sections.join("\n\n")}`;
}

class ScriptCodex extends EventEmitter {
  private turnNumber = 0;
  readonly prompts: string[] = [];

  async connect(): Promise<void> {
    this.emit("status", "connected");
  }

  async startThread(): Promise<string> {
    return `thread_${this.turnNumber + 1}`;
  }

  async startTurn(threadId: string, prompt: string): Promise<string> {
    const turnId = `turn_${++this.turnNumber}`;
    this.prompts.push(prompt);
    const output = this.turnNumber === 1
      ? quizScriptWithQuestions(1, "The Internet Before Google")
      : quizScriptWithQuestions(8, "The Internet Before Google");
    setTimeout(() => {
      this.emit("notification", { method: "item/userMessage", params: { threadId, turnId, delta: "reasoning payload " + "context ".repeat(100) } });
      this.emit("notification", { method: "item/reasoning", params: { threadId, turnId, delta: "tool payload " + "context ".repeat(100) } });
      this.emit("notification", { method: "item/agentMessage/delta", params: { threadId, turnId, delta: output } });
      this.emit("notification", { method: "turn/completed", params: { threadId, turnId, turn: { id: turnId, status: "completed" } } });
    }, 5);
    return turnId;
  }

  async interruptTurn(): Promise<void> { /* deterministic fake */ }
  async deleteThread(): Promise<boolean> { return true; }
  respond(): void { /* deterministic fake */ }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!predicate()) throw new Error("Timed out waiting for task state");
}
