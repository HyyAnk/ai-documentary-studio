import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { homedir } from "node:os";
import path from "node:path";
import { makeId, type AppConfig, type CodexModel } from "@studio/shared";
import { StudioLogger } from "./logger.js";

type RpcMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
const execFileAsync = promisify(execFile);

export type CodexServerRequest = { id: number; method: string; params: Record<string, unknown> };

export const DEFAULT_CODEX_MODELS: CodexModel[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
];

export class CodexUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexUnavailableError";
  }
}

export class CodexAppServerClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<number, Pending>();
  private requestId = 1;
  private connected = false;
  private initialized = false;
  private resolvedCommand: string | null = null;
  private readonly apiControllers = new Map<string, AbortController>();

  constructor(private readonly rootDirectory: string, private config: AppConfig, private readonly logger: StudioLogger) {
    super();
  }

  get isConnected(): boolean {
    return this.connected && this.initialized;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.resolvedCommand = null;
  }

  async getModels(): Promise<CodexModel[]> {
    if (this.config.codex.transport !== "openai_compatible") {
      const catalogModels = await this.getLocalCatalogModels();
      return this.withCurrentModel(catalogModels.length ? catalogModels : DEFAULT_CODEX_MODELS);
    }
    try {
      const response = await this.apiRequest("/models");
      if (!response.ok) return this.withCurrentModel(DEFAULT_CODEX_MODELS);
      const payload = await response.json() as { data?: unknown[] };
      const models = (payload.data ?? [])
        .map((model) => this.normalizeModel(model))
        .filter((model): model is CodexModel => Boolean(model));
      return this.withCurrentModel(models.length ? models : DEFAULT_CODEX_MODELS);
    } catch {
      return this.withCurrentModel(DEFAULT_CODEX_MODELS);
    }
  }

  async detectInstallation(): Promise<{ installed: boolean; command: string; version: string | null; error?: string }> {
    if (this.config.codex.transport === "openai_compatible") {
      const configured = Boolean(this.config.codex.api_base_url.trim() && this.config.codex.api_key.trim());
      return configured
        ? { installed: true, command: "Cockpit API", version: "OpenAI-compatible Responses API" }
        : { installed: false, command: "Cockpit API", version: null, error: "Set the Cockpit Base URL and API key in Settings" };
    }
    try {
      const command = await this.resolveCommand();
      const result = await execFileAsync(command, ["--version"], { cwd: this.rootDirectory, timeout: 5_000, windowsHide: true });
      const version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).find(Boolean) ?? null;
      return { installed: true, command, version };
    } catch (error) {
      return { installed: false, command: this.config.codex.command || "codex", version: null, error: error instanceof Error ? error.message : "Codex command could not be executed" };
    }
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    this.emit("status", "connecting");
    try {
      if (this.config.codex.transport === "openai_compatible") {
        await this.connectOpenAiCompatible();
        this.emit("status", "connected");
        return;
      }
      const endpoint = this.config.codex.app_server_endpoint;
      if (endpoint === "off") throw new CodexUnavailableError("Codex App Server is disabled");
      if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) await this.connectWebSocket(endpoint);
      else await this.connectStdio();
      await this.initialize();
      this.emit("status", "connected");
    } catch (error) {
      await this.close();
      this.emit("status", "unavailable");
      const message = error instanceof Error ? error.message : "Unknown Codex connection error";
      throw new CodexUnavailableError(`Codex App Server unavailable: ${message}`);
    }
  }

  async startThread(): Promise<string> {
    await this.ensureConnected();
    if (this.config.codex.transport === "openai_compatible") return makeId("thread");
    const params: Record<string, unknown> = { cwd: this.rootDirectory };
    if (this.config.codex.model) params.model = this.config.codex.model;
    const result = await this.request("thread/start", params) as { thread?: { id?: string } };
    const threadId = result.thread?.id;
    if (!threadId) throw new Error("Codex did not return a thread id");
    return threadId;
  }

  async resumeThread(threadId: string): Promise<string> {
    await this.ensureConnected();
    if (this.config.codex.transport === "openai_compatible") return threadId;
    const result = await this.request("thread/resume", { threadId }) as { thread?: { id?: string } };
    return result.thread?.id ?? threadId;
  }

  async startTurn(threadId: string, prompt: string): Promise<string> {
    await this.ensureConnected();
    if (this.config.codex.transport === "openai_compatible") {
      const turnId = makeId("turn");
      setTimeout(() => void this.runOpenAiTurn(threadId, turnId, prompt), 0);
      return turnId;
    }
    const result = await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      ...(this.config.codex.model ? { model: this.config.codex.model } : {}),
    }) as { turn?: { id?: string } };
    const turnId = result.turn?.id;
    if (!turnId) throw new Error("Codex did not return a turn id");
    return turnId;
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    if (!this.isConnected) return;
    if (this.config.codex.transport === "openai_compatible") {
      this.apiControllers.get(turnId)?.abort();
      this.apiControllers.delete(turnId);
      this.emit("notification", { method: "turn/completed", params: { threadId, turnId, turn: { id: turnId, threadId, status: "interrupted" } } });
      return;
    }
    await this.request("turn/interrupt", { threadId, turnId });
  }

  respond(requestId: number, result: unknown): void {
    if (this.config.codex.transport === "openai_compatible") return;
    this.send({ id: requestId, result });
  }

  rejectRequest(requestId: number, message: string): void {
    if (this.config.codex.transport === "openai_compatible") return;
    this.send({ id: requestId, error: { code: -32000, message } });
  }

  async close(): Promise<void> {
    this.connected = false;
    this.initialized = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new CodexUnavailableError("Codex connection closed"));
      this.pending.delete(id);
    }
    this.socket?.close();
    this.socket = null;
    for (const controller of this.apiControllers.values()) controller.abort();
    this.apiControllers.clear();
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
  }

  private async connectStdio(): Promise<void> {
    const command = await this.resolveCommand();
    await new Promise<void>((resolve, reject) => {
      try {
        const child = spawn(command, ["app-server", "--listen", "stdio://"], {
          cwd: this.rootDirectory,
          stdio: ["pipe", "pipe", "pipe"],
          shell: /\.(cmd|bat)$/i.test(command),
          windowsHide: true,
        });
        this.process = child;
        const rl = readline.createInterface({ input: child.stdout });
        rl.on("line", (line) => {
          if (!line.trim()) return;
          try {
            this.handleMessage(JSON.parse(line) as RpcMessage);
          } catch {
            this.logger.warn("Codex emitted a non-JSON line", { step: "codex_stream" });
          }
        });
        child.stderr.on("data", (chunk: Buffer) => {
          this.logger.debug(`Codex stderr: ${chunk.toString().trim()}`, { step: "codex_stderr" });
        });
        child.once("error", reject);
        child.once("spawn", () => {
          this.connected = true;
          resolve();
        });
        child.once("exit", (code) => {
          this.connected = false;
          this.initialized = false;
          this.rejectPending(new CodexUnavailableError(`Codex App Server exited${code === null ? "" : ` with code ${code}`}`));
          this.emit("status", "unavailable");
          this.emit("exit", code);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async connectOpenAiCompatible(): Promise<void> {
    if (!this.config.codex.api_base_url.trim()) throw new CodexUnavailableError("Cockpit Base URL is not configured");
    if (!this.config.codex.api_key.trim()) throw new CodexUnavailableError("Cockpit API key is not configured");
    const response = await this.apiRequest("/models");
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      const detail = await response.text().catch(() => "");
      throw new CodexUnavailableError(`Cockpit API rejected the connection (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    this.connected = true;
    this.initialized = true;
  }

  private async runOpenAiTurn(threadId: string, turnId: string, prompt: string): Promise<void> {
    const controller = new AbortController();
    this.apiControllers.set(turnId, controller);
    try {
      const response = await this.apiRequest("/responses", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.codex.model || (await this.getModels())[0]?.id || DEFAULT_CODEX_MODELS[0].id,
          input: prompt,
          stream: false,
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`Cockpit API request failed (${response.status}): ${body.slice(0, 400)}`);
      const output = extractOpenAiOutput(JSON.parse(body) as Record<string, unknown>);
      this.emit("notification", { method: "item/agentMessage/delta", params: { threadId, turnId, delta: output } });
      this.emit("notification", { method: "turn/completed", params: { threadId, turnId, turn: { id: turnId, threadId, status: "completed" } } });
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit("notification", { method: "turn/completed", params: { threadId, turnId, turn: { id: turnId, threadId, status: "interrupted" } } });
      } else {
        const message = error instanceof Error ? error.message : "Cockpit API request failed";
        this.emit("notification", { method: "error", params: { threadId, turnId, error: { message } } });
        this.emit("notification", { method: "turn/completed", params: { threadId, turnId, turn: { id: turnId, threadId, status: "failed", error: { message } } } });
      }
    } finally {
      this.apiControllers.delete(turnId);
    }
  }

  private async connectWebSocket(endpoint: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint);
      this.socket = socket;
      socket.once("open", () => {
        this.connected = true;
        resolve();
      });
      socket.on("message", (data) => {
        try {
          this.handleMessage(JSON.parse(data.toString()) as RpcMessage);
        } catch {
          this.logger.warn("Codex WebSocket emitted invalid JSON", { step: "codex_stream" });
        }
      });
      socket.once("error", reject);
      socket.once("close", () => {
        this.connected = false;
        this.initialized = false;
        this.rejectPending(new CodexUnavailableError("Codex WebSocket closed"));
        this.emit("status", "unavailable");
      });
    });
  }

  private async initialize(): Promise<void> {
    const result = await this.request("initialize", {
      clientInfo: { name: "ai_documentary_studio", title: "AI Documentary Studio", version: "0.1.0" },
      capabilities: {
        ...(this.config.codex.experimental_api ? { experimentalApi: true } : {}),
        mcpServerOpenaiFormElicitation: true,
      },
    });
    this.send({ method: "initialized", params: {} });
    this.initialized = Boolean(result);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) await this.connect();
  }

  private async resolveCommand(): Promise<string> {
    if (this.resolvedCommand) return this.resolvedCommand;
    const configured = this.config.codex.command || "codex";
    if (await this.canExecute(configured)) {
      this.resolvedCommand = configured;
      return configured;
    }
    if (process.platform === "win32" && configured === "codex") {
      const located = await execFileAsync("where.exe", [configured], { cwd: this.rootDirectory, timeout: 5_000, windowsHide: true }).catch(() => ({ stdout: "" }));
      const packageRoot = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "WindowsApps");
      const packageNames = await readdir(packageRoot).catch(() => [] as string[]);
      const packageCandidates = packageNames
        .filter((name) => /^OpenAI\.Codex_/i.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(packageRoot, name, "app", "resources", "codex.exe"));
      const candidates = [
        ...located.stdout.split(/\r?\n/).map((value) => value.trim()).filter((value) => value.toLowerCase().endsWith("codex.exe")),
        ...packageCandidates,
      ];
      for (const source of candidates) {
        const sourceStats = await stat(source).catch(() => null);
        if (!sourceStats) continue;
        const cacheDirectory = path.join(this.rootDirectory, ".documentary-studio", "codex");
        const cached = path.join(cacheDirectory, "codex.exe");
        await mkdir(cacheDirectory, { recursive: true });
        const cachedStats = await stat(cached).catch(() => null);
        if (!cachedStats || sourceStats.mtimeMs > cachedStats.mtimeMs || sourceStats.size !== cachedStats.size) await copyFile(source, cached);
        if (await this.canExecute(cached)) {
          this.resolvedCommand = cached;
          this.logger.info("Using a local Codex binary copied from the Windows package", { step: "codex_resolve" });
          return cached;
        }
      }
    }
    throw new CodexUnavailableError(`Codex command could not be executed: ${configured}`);
  }

  private async canExecute(command: string): Promise<boolean> {
    try {
      await execFileAsync(command, ["--version"], { cwd: this.rootDirectory, timeout: 5_000, windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  private withCurrentModel(models: CodexModel[]): CodexModel[] {
    if (!this.config.codex.model || models.some((model) => model.id === this.config.codex.model)) return models;
    return [{ id: this.config.codex.model, label: this.config.codex.model }, ...models];
  }

  private async getLocalCatalogModels(): Promise<CodexModel[]> {
    const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
    const configText = await readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
    const catalogReference = configText.match(/^\s*model_catalog_json\s*=\s*["']([^"']+)["']/m)?.[1];
    if (!catalogReference) return [];

    const catalogPath = path.isAbsolute(catalogReference) ? catalogReference : path.resolve(codexHome, catalogReference);
    try {
      const payload = JSON.parse(await readFile(catalogPath, "utf8")) as { models?: unknown };
      if (!Array.isArray(payload.models)) return [];
      return payload.models
        .map((model) => this.normalizeCatalogModel(model))
        .filter((model): model is CodexModel => Boolean(model));
    } catch {
      return [];
    }
  }

  private normalizeCatalogModel(value: unknown): CodexModel | null {
    if (!value || typeof value !== "object") return null;
    const model = value as Record<string, unknown>;
    if (model.visibility === "hide") return null;
    const id = typeof model.slug === "string" ? model.slug.trim() : "";
    if (!id || this.isNonTextModel(id)) return null;
    const displayName = typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : undefined;
    return { id, label: this.modelLabel(id, displayName) };
  }

  private normalizeModel(value: unknown): CodexModel | null {
    if (!value || typeof value !== "object") return null;
    const model = value as Record<string, unknown>;
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id || model.visibility === "hide" || this.isNonTextModel(id)) return null;
    const displayName = [model.name, model.display_name].find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()))?.trim();
    return { id, label: this.modelLabel(id, displayName) };
  }

  private isNonTextModel(id: string): boolean {
    return /(^|[-_])(audio|embedding|image|moderation|realtime|transcri(?:be|ption)?|tts|whisper)([-_]|$)/i.test(id);
  }

  private modelLabel(id: string, fallback?: string): string {
    const labels: Record<string, string> = {
      "gpt-5.6-sol": "GPT-5.6 Sol",
      "gpt-5.6-terra": "GPT-5.6 Terra",
      "gpt-5.6-luna": "GPT-5.6 Luna",
      "gpt-5.5": "GPT-5.5",
      "gpt-5.4": "GPT-5.4",
      "gpt-5.4-mini": "GPT-5.4 Mini",
      "gpt-5.3-codex": "GPT-5.3 Codex",
      "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
    };
    return labels[id.toLowerCase()] ?? fallback ?? id;
  }

  private apiBaseUrl(): string {
    const base = this.config.codex.api_base_url.trim().replace(/\/+$/, "");
    if (!base) throw new CodexUnavailableError("Cockpit Base URL is not configured");
    return /\/v1$/i.test(base) ? base : `${base}/v1`;
  }

  private apiRequest(endpoint: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("authorization", `Bearer ${this.config.codex.api_key.trim()}`);
    return fetch(`${this.apiBaseUrl()}${endpoint}`, { ...init, headers });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ method, id, params });
    });
  }

  private send(message: RpcMessage): void {
    const payload = JSON.stringify(message);
    if (this.socket) {
      this.socket.send(payload);
      return;
    }
    if (this.process?.stdin.writable) {
      this.process.stdin.write(`${payload}\n`);
      return;
    }
    throw new CodexUnavailableError("No Codex transport is connected");
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private handleMessage(message: RpcMessage): void {
    if (typeof message.id === "number" && message.method) {
      this.emit("serverRequest", { id: message.id, method: message.method, params: message.params ?? {} } satisfies CodexServerRequest);
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? "Codex request failed"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.emit("notification", { method: message.method, params: message.params ?? {} });
  }
}

function extractOpenAiOutput(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = payload.output;
  if (Array.isArray(output)) {
    const text = output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const value = (part as { text?: unknown }).text;
        return typeof value === "string" ? [value] : [];
      });
    });
    if (text.length) return text.join("");
  }
  const choices = payload.choices;
  if (Array.isArray(choices)) {
    const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
    if (typeof content === "string") return content;
  }
  throw new Error("Cockpit API returned no text output");
}
