import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, loadConfig, saveAntigravitySettings, saveCodexSettings } from "../src/config.js";
import { AntigravityClient } from "../src/antigravity.js";
import { buildApp } from "../src/app.js";
import { StudioLogger } from "../src/logger.js";

describe("Antigravity Client", () => {
  let temporaryRoot = "";

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "documentary-studio-agy-"));
  });

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("defaults cleanup settings to off and persists an explicit opt-in", async () => {
    const initial = await loadConfig(temporaryRoot);
    expect(initial.codex.auto_delete_threads).toBe(false);
    expect(initial.antigravity.auto_delete_threads).toBe(false);

    await saveCodexSettings(temporaryRoot, { auto_delete_threads: true });
    await saveAntigravitySettings(temporaryRoot, { auto_delete_threads: true });
    const enabled = await loadConfig(temporaryRoot);
    expect(enabled.codex.auto_delete_threads).toBe(true);
    expect(enabled.antigravity.auto_delete_threads).toBe(true);
  });

  it("handles mock CLI output parsing correctly", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new AntigravityClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const output = [
      "Available Models:",
      "- gemini-2.5-pro (default)",
      "- gemini-2.5-flash",
      "- gemini-2.5-flash-lite",
      "- claude-3-5-sonnet",
    ].join("\n");

    const parsed = client.parseModelListOutput(output);
    expect(parsed).toEqual([
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (default)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
      { id: "claude-3-5-sonnet", label: "Claude 3 5 Sonnet" },
    ]);
  });

  it("executes custom mock CLI command dynamically to retrieve models", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();

    if (process.platform === "win32") {
      const mockScript = path.join(temporaryRoot, "mock-agy.cmd");
      await writeFile(mockScript, `@echo off\r\necho - gemini-2.5-pro (default)\r\necho - gemini-2.5-flash\r\n`, "utf8");

      const client = new AntigravityClient(temporaryRoot, {
        ...DEFAULT_CONFIG,
        antigravity: { ...DEFAULT_CONFIG.antigravity, command: mockScript, model: "gemini-2.5-pro" },
      }, logger);

      const models = await client.getModels();
      expect(models).toEqual([
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (default)" },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      ]);
    }
  });

  it("detects installation status gracefully", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new AntigravityClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const info = await client.detectInstallation();
    expect(info).toBeDefined();
    expect(typeof info.installed).toBe("boolean");
  });

  it("handles multi-step transcripts by ignoring tool results and extracting final PLANNER_RESPONSE", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new AntigravityClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const transcriptLines = [
      JSON.stringify({ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "Prompt" }),
      JSON.stringify({ step_index: 1, source: "SYSTEM", type: "CHECKPOINT", status: "DONE" }),
      JSON.stringify({ step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "search_web", args: {} }] }),
      JSON.stringify({ step_index: 3, source: "MODEL", type: "GENERIC", status: "DONE", content: "Tool search result: found 0 items" }),
      JSON.stringify({ step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "# Research Dossier\n\nC01 https://example.com/1\nC02 https://example.com/2\nC03 https://example.com/3" }),
    ];

    let extracted = "";
    let isDone = false;

    for (const line of transcriptLines) {
      const step = JSON.parse(line) as {
        source?: string;
        type?: string;
        status?: string;
        content?: string;
        tool_calls?: unknown[];
      };
      const isModel = step.source === "MODEL";
      const isPlanner = step.type === "PLANNER_RESPONSE";
      const hasNoToolCalls = !step.tool_calls || step.tool_calls.length === 0;
      const currentContent = typeof step.content === "string" ? step.content : "";

      if (isModel && isPlanner && hasNoToolCalls && currentContent.trim()) {
        extracted = currentContent;
        if (step.status === "DONE") {
          isDone = true;
        }
      }
    }

    expect(isDone).toBe(true);
    expect(extracted).toContain("# Research Dossier");
    expect(extracted).not.toContain("Tool search result");
  });

  it("keeps Antigravity session artifacts until session cleanup is enabled", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new AntigravityClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const testConvId = "11111111-2222-3333-4444-555555555555";
    const userHome = os.homedir();
    const agyBase = path.join(userHome, ".gemini", "antigravity");
    const { mkdir, writeFile, access } = await import("node:fs/promises");
    const { constants } = await import("node:fs");

    const convDb = path.join(agyBase, "conversations", `${testConvId}.db`);
    const convWal = path.join(agyBase, "conversations", `${testConvId}.db-wal`);
    const brainDir = path.join(agyBase, "brain", testConvId);
    const annotDir = path.join(agyBase, "annotations", testConvId);

    await mkdir(path.dirname(convDb), { recursive: true });
    await mkdir(brainDir, { recursive: true });
    await mkdir(annotDir, { recursive: true });

    await writeFile(convDb, "fake-db", "utf8");
    await writeFile(convWal, "fake-wal", "utf8");
    await writeFile(path.join(brainDir, "test.txt"), "hello", "utf8");

    // Map threadId to convId
    (client as unknown as { threadConversations: Map<string, string> }).threadConversations.set("agy_thread_test", testConvId);

    const deleted = await client.deleteThread("agy_thread_test");
    expect(deleted).toBe(false);

    const dbExists = await access(convDb, constants.F_OK).then(() => true).catch(() => false);
    const walExists = await access(convWal, constants.F_OK).then(() => true).catch(() => false);
    const brainExists = await access(brainDir, constants.F_OK).then(() => true).catch(() => false);
    const annotExists = await access(annotDir, constants.F_OK).then(() => true).catch(() => false);

    expect(dbExists).toBe(true);
    expect(walExists).toBe(true);
    expect(brainExists).toBe(true);
    expect(annotExists).toBe(true);

    client.updateConfig({ ...DEFAULT_CONFIG, antigravity: { ...DEFAULT_CONFIG.antigravity, auto_delete_threads: true } });
    expect(await client.deleteThread("agy_thread_test")).toBe(true);
    expect(await access(convDb, constants.F_OK).then(() => true).catch(() => false)).toBe(false);
    expect(await access(convWal, constants.F_OK).then(() => true).catch(() => false)).toBe(false);
    expect(await access(brainDir, constants.F_OK).then(() => true).catch(() => false)).toBe(false);
    expect(await access(annotDir, constants.F_OK).then(() => true).catch(() => false)).toBe(false);
  });

  it("keeps all Antigravity sessions until cleanup is enabled", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new AntigravityClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const userConvId = "22222222-3333-4444-5555-666666666666";
    const toolConvId = "33333333-4444-5555-6666-777777777777";
    const userHome = os.homedir();
    const agyBase = path.join(userHome, ".gemini", "antigravity");
    const { mkdir, writeFile, access } = await import("node:fs/promises");
    const { constants } = await import("node:fs");

    const userConvDb = path.join(agyBase, "conversations", `${userConvId}.db`);
    const toolConvDb = path.join(agyBase, "conversations", `${toolConvId}.db`);

    await mkdir(path.dirname(userConvDb), { recursive: true });
    await writeFile(userConvDb, "user-created-chat with custom code", "utf8");
    await writeFile(toolConvDb, "Task type: GENERATE_SEQUENCE_SCENES\nAuto generated content", "utf8");

    // Only register toolConvId in managedConversations
    (client as unknown as { managedConversations: Set<string> }).managedConversations.add(toolConvId);

    const res = await client.cleanupOldSessions(0);
    expect(res).toEqual({ removed: 0 });

    const userDbStillExists = await access(userConvDb, constants.F_OK).then(() => true).catch(() => false);
    const toolDbExists = await access(toolConvDb, constants.F_OK).then(() => true).catch(() => false);

    expect(userDbStillExists).toBe(true); // User manual session MUST NOT be deleted
    expect(toolDbExists).toBe(true);

    client.updateConfig({ ...DEFAULT_CONFIG, antigravity: { ...DEFAULT_CONFIG.antigravity, auto_delete_threads: true } });
    expect((await client.cleanupOldSessions(0)).removed).toBeGreaterThanOrEqual(1);
    expect(await access(toolConvDb, constants.F_OK).then(() => true).catch(() => false)).toBe(false);

    // Clean up the user-created test conversation.
    await rm(userConvDb, { force: true });
  });

  it("blocks manual Antigravity cleanup while the setting is off", async () => {
    await mkdir(path.join(temporaryRoot, "templates"), { recursive: true });
    await Promise.all([
      writeFile(path.join(temporaryRoot, "templates", "example_channel_dna.md"), "# DNA\n", "utf8"),
      writeFile(path.join(temporaryRoot, "templates", "example_style_guide.md"), "# Style\n", "utf8"),
    ]);
    const app = await buildApp(temporaryRoot);
    try {
      const response = await app.server.inject({ method: "POST", url: "/api/antigravity/cleanup", payload: {} });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ removed: 0 });
    } finally {
      await app.close();
    }
  });

  it("isStudioTaskConversation accurately identifies studio tasks vs user conversations", async () => {
    const logger = new StudioLogger(temporaryRoot);
    await logger.init();
    const client = new AntigravityClient(temporaryRoot, DEFAULT_CONFIG, logger);

    const userConvId = "44444444-5555-6666-7777-888888888888";
    const studioConvId = "55555555-6666-7777-8888-999999999999";
    const userHome = os.homedir();
    const agyBase = path.join(userHome, ".gemini", "antigravity");
    const { mkdir, writeFile } = await import("node:fs/promises");

    const userConvDb = path.join(agyBase, "conversations", `${userConvId}.db`);
    const studioConvDb = path.join(agyBase, "conversations", `${studioConvId}.db`);

    await mkdir(path.dirname(userConvDb), { recursive: true });
    await writeFile(userConvDb, "Hi, please write a React button component for me", "utf8");
    await writeFile(studioConvDb, "Task type: GENERATE_RESEARCH\n# Research Dossier\nC01 https://example.com", "utf8");

    const isStudioUser = await client.isStudioTaskConversation(userConvId);
    const isStudioTask = await client.isStudioTaskConversation(studioConvId);

    expect(isStudioUser).toBe(false);
    expect(isStudioTask).toBe(true);

    await rm(userConvDb, { force: true });
    await rm(studioConvDb, { force: true });
  });
});
