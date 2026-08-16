import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { CodexAppServerClient } from "../src/codex.js";
import { StudioLogger } from "../src/logger.js";

describe("Cockpit OpenAI-compatible transport", () => {
  let server: Server | null = null;
  let temporaryRoot = "";
  const originalCodexHome = process.env.CODEX_HOME;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = null;
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  });

  it("loads visible models from the local Codex catalog", async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-codex-"));
    const codexHome = path.join(temporaryRoot, "codex-home");
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.6-luna"\nmodel_catalog_json = "catalog.json"\n', "utf8");
    await writeFile(path.join(codexHome, "catalog.json"), JSON.stringify({ models: [
      { slug: "gpt-5.6-luna", display_name: "GPT-5.6-Luna", visibility: "list" },
      { slug: "gpt-image-2", display_name: "GPT Image 2", visibility: "hide" },
      { slug: "gpt-5.3-codex", display_name: "gpt-5.3-codex", visibility: "list" },
    ] }), "utf8");
    process.env.CODEX_HOME = codexHome;
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new CodexAppServerClient(temporaryRoot, DEFAULT_CONFIG, logger);

    await expect(client.getModels()).resolves.toEqual([
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    ]);
  });

  it("lists models and bridges a Responses API output into Codex notifications", async () => {
    server = createServer(async (request, response) => {
      if (request.url === "/v1/models") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ data: [{ id: "cockpit-codex", name: "Cockpit Codex" }] }));
        return;
      }
      if (request.url === "/v1/responses") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ output_text: "# Channel DNA\n\nConnected through Cockpit." }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Mock server did not expose a port");

    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-codex-"));
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const config = {
      ...DEFAULT_CONFIG,
      codex: {
        ...DEFAULT_CONFIG.codex,
        transport: "openai_compatible" as const,
        api_base_url: `http://127.0.0.1:${address.port}/v1`,
        api_key: "local-test-key",
        model: "cockpit-codex",
      },
    };
    const client = new CodexAppServerClient(temporaryRoot, config, logger);
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    client.on("notification", (event: { method: string; params: Record<string, unknown> }) => notifications.push(event));

    await client.connect();
    expect(await client.getModels()).toEqual([{ id: "cockpit-codex", label: "Cockpit Codex" }]);
    const threadId = await client.startThread();
    const turnId = await client.startTurn(threadId, "test prompt");
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (notifications.some((event) => event.method === "turn/completed")) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });

    expect(notifications.find((event) => event.method === "item/agentMessage/delta")?.params.delta).toContain("Connected through Cockpit");
    expect(notifications.find((event) => event.method === "turn/completed")?.params.turnId).toBe(turnId);
    await client.close();
  });
});
