import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/context.js";
import { StudioLogger } from "../src/logger.js";
import { RepositoryService } from "../src/repository.js";
import { TaskManager } from "../src/tasks.js";

const roots: string[] = [];

class FakeCodex extends EventEmitter {
  private turnNumber = 0;
  activeTurns = 0;
  maxActiveTurns = 0;
  async connect(): Promise<void> { this.emit("status", "connected"); }
  async startThread(): Promise<string> { return `thread_${this.turnNumber + 1}`; }
  async resumeThread(threadId: string): Promise<string> { return threadId; }
  async startTurn(threadId: string): Promise<string> {
    const turnId = `turn_${++this.turnNumber}`;
    this.activeTurns += 1;
    this.maxActiveTurns = Math.max(this.maxActiveTurns, this.activeTurns);
    setTimeout(() => {
      this.emit("notification", { method: "item/agentMessage/delta", params: { threadId, turnId, delta: "# Script\n\nA generated script." } });
      this.emit("notification", { method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
      this.activeTurns -= 1;
    }, 30);
    return turnId;
  }
  async interruptTurn(): Promise<void> { /* deterministic fake */ }
  respond(): void { /* deterministic fake */ }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TaskManager locks", () => {
  it("serializes two tasks targeting the same episode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "documentary-tasks-"));
    roots.push(root);
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
    await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
    await writeFile(path.join(root, "shared", "script_rules.md"), "# Script\n", "utf8");
    const repository = new RepositoryService(root);
    const channel = await repository.createChannel({ name: "Task Channel", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" });
    const topics = Array.from({ length: 5 }, (_, index) => ({ topic_id: `topic_${index}`, channel_id: channel.channel_id, title: `Topic ${index}`, premise: "Premise", why_it_fits: "Fits", hook: "Hook", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false }));
    await repository.saveTopicRun(channel.channel_id, topics);
    const episode = await repository.confirmTopic(channel.channel_id, topics[0].topic_id);
    const logger = new StudioLogger(root);
    await logger.init();
    const fake = new FakeCodex();
    const manager = new TaskManager(repository, new ContextEngine(repository, logger), fake as never, 3, 8, logger);
    await manager.load();
    const first = manager.submit("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
    const second = manager.submit("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
    expect(second.status).toBe("QUEUED");
    await waitFor(() => manager.get(first.task_id).status === "COMPLETED");
    await waitFor(() => manager.get(second.task_id).status === "COMPLETED");
    expect(manager.get(first.task_id).status).toBe("COMPLETED");
    expect(manager.get(second.task_id).status).toBe("COMPLETED");
    const secondEpisode = await repository.confirmTopic(channel.channel_id, topics[1].topic_id);
    const parallelA = manager.submit("GENERATE_SCRIPT", channel.channel_id, episode.episode_id);
    const parallelB = manager.submit("GENERATE_SCRIPT", channel.channel_id, secondEpisode.episode_id);
    await waitFor(() => manager.get(parallelA.task_id).status === "COMPLETED");
    await waitFor(() => manager.get(parallelB.task_id).status === "COMPLETED");
    expect(fake.maxActiveTurns).toBeGreaterThanOrEqual(2);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 15));
  if (!predicate()) throw new Error("Timed out waiting for task state");
}
