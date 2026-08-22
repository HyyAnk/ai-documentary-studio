import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { CodexAppServerClient } from "../src/codex.js";
import { AntigravityClient } from "../src/antigravity.js";
import { StudioLogger } from "../src/logger.js";

describe("Dynamic Model Fetching (Dual-Engine)", () => {
  let temporaryRoot = "";
  const originalCodexHome = process.env.CODEX_HOME;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-models-"));
  });

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  });

  it("Codex dynamically retrieves model list from local catalog without hardcoding", async () => {
    const codexHome = path.join(temporaryRoot, "codex-home");
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.4"\nmodel_catalog_json = "catalog.json"\n', "utf8");
    await writeFile(path.join(codexHome, "catalog.json"), JSON.stringify({
      models: [
        { slug: "custom-codex-v1", display_name: "Custom Codex V1", visibility: "list" },
        { slug: "custom-codex-v2", display_name: "Custom Codex V2", visibility: "list" },
      ],
    }), "utf8");
    process.env.CODEX_HOME = codexHome;

    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new CodexAppServerClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const models = await client.getModels();
    expect(models).toEqual([
      { id: "custom-codex-v1", label: "Custom Codex V1" },
      { id: "custom-codex-v2", label: "Custom Codex V2" },
    ]);
  });

  it("Antigravity dynamically parses model list from CLI output without hardcoded default lists", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new AntigravityClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const cliOutput = JSON.stringify({
      models: [
        { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
        { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
        { name: "models/gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite" },
      ],
    });

    const parsed = client.parseModelListOutput(cliOutput);
    expect(parsed).toEqual([
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    ]);
  });
});
