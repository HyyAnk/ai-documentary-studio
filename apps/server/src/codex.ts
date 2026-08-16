import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import path from "node:path";
import type { AppConfig } from "@studio/shared";
import { StudioLogger } from "./logger.js";

type RpcMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
const execFileAsync = promisify(execFile);

export type CodexServerRequest = { id: number; method: string; params: Record<string, unknown> };

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

  constructor(private readonly rootDirectory: string, private readonly config: AppConfig, private readonly logger: StudioLogger) {
    super();
  }

  get isConnected(): boolean {
    return this.connected && this.initialized;
  }

  async detectInstallation(): Promise<{ installed: boolean; command: string; version: string | null; error?: string }> {
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
    const endpoint = this.config.codex.app_server_endpoint;
    if (endpoint === "off") throw new CodexUnavailableError("Codex App Server is disabled");
    try {
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
    const params: Record<string, unknown> = { cwd: this.rootDirectory };
    if (this.config.codex.model) params.model = this.config.codex.model;
    const result = await this.request("thread/start", params) as { thread?: { id?: string } };
    const threadId = result.thread?.id;
    if (!threadId) throw new Error("Codex did not return a thread id");
    return threadId;
  }

  async resumeThread(threadId: string): Promise<string> {
    await this.ensureConnected();
    const result = await this.request("thread/resume", { threadId }) as { thread?: { id?: string } };
    return result.thread?.id ?? threadId;
  }

  async startTurn(threadId: string, prompt: string): Promise<string> {
    await this.ensureConnected();
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
    await this.request("turn/interrupt", { threadId, turnId });
  }

  respond(requestId: number, result: unknown): void {
    this.send({ id: requestId, result });
  }

  rejectRequest(requestId: number, message: string): void {
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
