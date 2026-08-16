import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/context.js";
import { StudioLogger } from "../src/logger.js";
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
});
