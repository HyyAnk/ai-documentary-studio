import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  TaskSchema,
  type AppConfig,
  type ContextManifest,
  type Scene,
  type Task,
  type TaskEvent,
  type TaskStatus,
  type TaskType,
  makeId,
  nowIso,
} from "@studio/shared";
import { ContextEngine } from "./context.js";
import { CodexAppServerClient, type CodexServerRequest } from "./codex.js";
import { StudioLogger } from "./logger.js";
import { RepositoryError, RepositoryService } from "./repository.js";
import { ChatterboxProvider, type ChatterboxTarget } from "./providers/chatterbox.js";
import type { AudioProvider } from "./providers/index.js";

type ActiveRun = { task: Task; threadId: string; turnId: string; output: string; manifest: ContextManifest };

const channelTaskTypes = new Set<TaskType>(["GENERATE_DNA", "SUGGEST_TOPICS"]);

export class TaskManager extends EventEmitter {
  private readonly tasks = new Map<string, Task>();
  private readonly active = new Map<string, ActiveRun>();
  private readonly approvalRequests = new Map<number, { taskId: string; request: CodexServerRequest }>();
  private readonly completionWaiters = new Map<string, () => void>();
  private readonly locks = new Set<string>();
  private runningCount = 0;
  private runningAudioCount = 0;
  private readonly activeAudio = new Set<string>();
  private audioConfig: AppConfig["audio_generation"];
  private readonly audioProviderFactory: (target: ChatterboxTarget, config: AppConfig["audio_generation"]) => AudioProvider;
  private connectionStatus: "connected" | "disconnected" | "unavailable" | "connecting" = "disconnected";

  constructor(
    private readonly repository: RepositoryService,
    private readonly contextEngine: ContextEngine,
    private readonly codex: CodexAppServerClient,
    private readonly maxConcurrent: number,
    private readonly maxSceneDuration: number,
    private readonly logger: StudioLogger,
    audioConfig: AppConfig["audio_generation"] = {
      provider: "chatterbox",
      service_url: "http://127.0.0.1:8890",
      exaggeration: 0.5,
      cfg_weight: 0.5,
      max_concurrent_tasks: 2,
    },
    audioProviderFactory?: (target: ChatterboxTarget, config: AppConfig["audio_generation"]) => AudioProvider,
  ) {
    super();
    this.audioConfig = audioConfig;
    this.audioProviderFactory = audioProviderFactory ?? ((target, config) => new ChatterboxProvider(repository, config, target));
    codex.on("status", (status: typeof this.connectionStatus) => {
      this.connectionStatus = status;
      this.emitEvent({ type: "codex.status", status });
    });
    codex.on("notification", (event: { method: string; params: Record<string, unknown> }) => this.handleNotification(event.method, event.params));
    codex.on("serverRequest", (request: CodexServerRequest) => this.handleServerRequest(request));
    codex.on("exit", () => {
      this.connectionStatus = "unavailable";
      this.emitEvent({ type: "codex.status", status: "unavailable", message: "Codex App Server unavailable" });
    });
  }

  async load(): Promise<void> {
    const directory = path.join(this.repository.roots.runtime, "tasks");
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      try {
        const task = TaskSchema.parse(JSON.parse(await readFile(path.join(directory, entry.name), "utf8")));
        if (task.status === "RUNNING" || task.status === "WAITING_APPROVAL") {
          task.status = "FAILED";
          task.error = "Task interrupted by dashboard restart";
          task.completed_at = nowIso();
        }
        this.tasks.set(task.task_id, task);
      } catch {
        // Ignore a single corrupt operational record; repository artifacts remain safe.
      }
    }
  }

  async reload(): Promise<void> {
    if (this.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing storage", "STORAGE_BUSY");
    this.tasks.clear();
    this.approvalRequests.clear();
    this.locks.clear();
    this.connectionStatus = this.codex.isConnected ? "connected" : "disconnected";
    await this.load();
  }

  updateAudioConfig(config: AppConfig["audio_generation"]): void {
    this.audioConfig = config;
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new RepositoryError("Task not found", "TASK_NOT_FOUND");
    return task;
  }

  getStatus(): typeof this.connectionStatus {
    return this.connectionStatus;
  }

  hasActiveWork(): boolean {
    return this.active.size > 0 || this.activeAudio.size > 0 || this.runningCount > 0 || this.runningAudioCount > 0 || this.list().some((task) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status));
  }

  submit(taskType: TaskType, channelId: string, episodeId: string | null, sceneNumber?: number): Task {
    const lockKey = channelTaskTypes.has(taskType) ? channelId : episodeId;
    if (!lockKey) throw new RepositoryError("Episode is required for this task", "EPISODE_REQUIRED");
    const existingQueue = this.list().filter((task) => task.lock_key === lockKey && task.status === "QUEUED").length;
    const task = TaskSchema.parse({
      task_id: makeId("task"),
      task_type: taskType,
      channel_id: channelId,
      episode_id: episodeId,
      status: "QUEUED",
      created_at: nowIso(),
      started_at: null,
      completed_at: null,
      codex_thread_id: null,
      codex_turn_id: null,
      error: null,
      output_files: [],
      lock_key: lockKey,
      queue_position: existingQueue,
      progress_message: "Queued",
      scene_number: sceneNumber ?? null,
    });
    this.tasks.set(task.task_id, task);
    void this.persist(task);
    this.emitTask(task);
    void this.pump();
    return task;
  }

  async cancel(taskId: string): Promise<Task> {
    const task = this.get(taskId);
    if (task.status === "QUEUED") {
      await this.update(taskId, { status: "CANCELLED", completed_at: nowIso(), progress_message: "Cancelled before start" });
      void this.pump();
      return this.get(taskId);
    }
    const active = this.active.get(taskId);
    if (active) {
      await this.update(taskId, { progress_message: "Interrupting task" });
      await this.codex.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
      await this.finish(taskId, "CANCELLED", "Cancelled by user");
    } else if (this.activeAudio.has(taskId)) {
      await this.finish(taskId, "CANCELLED", "Cancelled by user");
    }
    return this.get(taskId);
  }

  async decideApproval(taskId: string, requestId: number, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<Task> {
    const pending = this.approvalRequests.get(requestId);
    if (!pending || pending.taskId !== taskId) throw new RepositoryError("Approval request not found", "APPROVAL_NOT_FOUND");
    this.approvalRequests.delete(requestId);
    this.codex.respond(requestId, { decision });
    if (decision === "decline" || decision === "cancel") await this.finish(taskId, "CANCELLED", "Approval denied");
    else await this.update(taskId, { status: "RUNNING", progress_message: "Approval granted" });
    return this.get(taskId);
  }

  private async pump(): Promise<void> {
    while (this.runningCount < this.maxConcurrent) {
      const next = this.list().reverse().find((task) => task.status === "QUEUED" && task.task_type !== "GENERATE_AUDIO" && !this.locks.has(task.lock_key));
      if (!next) break;
      this.locks.add(next.lock_key);
      this.runningCount += 1;
      void this.run(next).finally(() => {
        this.locks.delete(next.lock_key);
        this.runningCount -= 1;
        void this.pump();
      });
    }
    while (this.runningAudioCount < this.audioConfig.max_concurrent_tasks) {
      const next = this.list().reverse().find((task) => task.status === "QUEUED" && task.task_type === "GENERATE_AUDIO" && !this.locks.has(task.lock_key));
      if (!next) break;
      this.locks.add(next.lock_key);
      this.runningAudioCount += 1;
      void this.runAudioTask(next).finally(() => {
        this.locks.delete(next.lock_key);
        this.runningAudioCount -= 1;
        void this.pump();
      });
    }
  }

  private async run(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_task" };
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing scoped context" });
      const manifest = await this.contextEngine.build(task.task_type, task.channel_id, task.episode_id, this.findSceneNumber(task.task_id));
      await this.update(task.task_id, { progress_message: "Connecting to Codex" });
      await this.codex.connect();
      const threadId = task.codex_thread_id ? await this.codex.resumeThread(task.codex_thread_id) : await this.codex.startThread();
      await this.update(task.task_id, { codex_thread_id: threadId, progress_message: "Generating" });
      const turnId = await this.codex.startTurn(threadId, manifest.prompt);
      await this.update(task.task_id, { codex_turn_id: turnId });
      this.active.set(task.task_id, { task: this.get(task.task_id), threadId, turnId, output: "", manifest });
      await new Promise<void>((resolve) => this.completionWaiters.set(task.task_id, resolve));
      this.logger.step("Codex turn started", context);
    } catch (error) {
      await this.finish(task.task_id, "FAILED", error instanceof Error ? error.message : "Task failed");
      this.logger.error("Codex task failed", { ...context, step: "run_task" });
    }
  }

  private async runAudioTask(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_audio" };
    this.activeAudio.add(task.task_id);
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing audio" });
      const sceneNumber = this.findSceneNumber(task.task_id);
      if (!task.episode_id || !sceneNumber) throw new RepositoryError("Audio scene is required", "SCENE_REQUIRED");
      const scenes = await this.repository.readScenes(task.channel_id, task.episode_id);
      const scene = scenes.find((item) => item.scene_number === sceneNumber);
      if (!scene) throw new RepositoryError("Audio target scene not found", "SCENE_NOT_FOUND");
      const channel = await this.repository.getChannel(task.channel_id);
      const voice = channel.voice_reference_path ? this.repository.resolveContextPath(channel.voice_reference_path) : "default";
      await this.update(task.task_id, { progress_message: "Synthesizing dialogue" });
      const provider = this.audioProviderFactory({ channelId: task.channel_id, episodeId: task.episode_id, sceneNumber }, this.audioConfig);
      const result = await provider.generateDialogue(scene.dialogue, voice);
      if (this.get(task.task_id).status === "CANCELLED") return;
      const audioFile = await this.repository.getSceneAudioFile(task.channel_id, task.episode_id, path.basename(result.asset_path));
      const audioBuffer = await readFile(audioFile.absolutePath);
      await this.repository.saveSceneAudio(task.channel_id, task.episode_id, sceneNumber, result.asset_path, parseWavDuration(audioBuffer));
      await this.finish(task.task_id, "COMPLETED", null, [result.asset_path]);
    } catch (error) {
      const message = error instanceof Error && "code" in error && (error as { code?: string }).code === "AUDIO_SERVICE_UNAVAILABLE"
        ? "Audio service unavailable"
        : error instanceof Error ? error.message : "Audio generation failed";
      await this.finish(task.task_id, "FAILED", message);
      this.logger.error(message, { ...context, step: "run_audio" });
    } finally {
      this.activeAudio.delete(task.task_id);
    }
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    const threadId = typeof params.threadId === "string" ? params.threadId : typeof (params.turn as { threadId?: unknown } | undefined)?.threadId === "string" ? (params.turn as { threadId: string }).threadId : null;
    const turnId = typeof params.turnId === "string" ? params.turnId : typeof (params.turn as { id?: unknown } | undefined)?.id === "string" ? (params.turn as { id: string }).id : null;
    const active = [...this.active.values()].find((run) => (threadId ? run.threadId === threadId : true) && (turnId ? run.turnId === turnId : true));
    if (!active) return;
    if (method === "item/agentMessage/delta") {
      const delta = typeof params.delta === "string" ? params.delta : "";
      active.output += delta;
      void this.update(active.task.task_id, { progress_message: "Receiving output" });
    } else if (method === "turn/completed") {
      const turn = params.turn as { status?: string; error?: { message?: string } } | undefined;
      if (turn?.status === "failed") void this.finish(active.task.task_id, "FAILED", turn.error?.message ?? "Codex turn failed");
      else if (turn?.status === "interrupted") void this.finish(active.task.task_id, "CANCELLED", "Turn interrupted");
      else void this.completeWithOutput(active);
    } else if (method === "error") {
      const error = params.error as { message?: string } | undefined;
      void this.finish(active.task.task_id, "FAILED", error?.message ?? "Codex error");
    }
  }

  private handleServerRequest(request: CodexServerRequest): void {
    const threadId = typeof request.params.threadId === "string" ? request.params.threadId : null;
    const turnId = typeof request.params.turnId === "string" ? request.params.turnId : null;
    const active = [...this.active.values()].find((run) => run.threadId === threadId && (!turnId || run.turnId === turnId));
    if (!active) {
      this.codex.rejectRequest(request.id, "No active dashboard task owns this request");
      return;
    }
    this.approvalRequests.set(request.id, { taskId: active.task.task_id, request });
    void this.update(active.task.task_id, { status: "WAITING_APPROVAL", progress_message: "Waiting for approval" });
    const approval = {
      kind: request.method,
      reason: typeof request.params.reason === "string" ? request.params.reason : undefined,
      command: typeof request.params.command === "string" ? request.params.command : undefined,
      cwd: typeof request.params.cwd === "string" ? request.params.cwd : undefined,
    };
    this.emitEvent({ type: "approval.requested", task: this.get(active.task.task_id), request_id: request.id, approval });
  }

  private async completeWithOutput(active: ActiveRun): Promise<void> {
    try {
      const output = active.output.trim();
      const task = active.task;
      let outputFiles: string[] = [];
      if (task.task_type === "GENERATE_DNA") {
        await this.repository.saveChannelDna(task.channel_id, extractMarkdown(output, "# Channel DNA"));
        outputFiles = [`channels/${(await this.repository.getChannel(task.channel_id)).slug}/channel_dna.md`];
      } else if (task.task_type === "SUGGEST_TOPICS") {
        const candidates = parseTopicCandidates(output, task.channel_id);
        await this.repository.saveTopicRun(task.channel_id, candidates);
        outputFiles = [`channels/${(await this.repository.getChannel(task.channel_id)).slug}/topics/`];
      } else if (task.task_type === "GENERATE_SCRIPT") {
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "script.md", extractMarkdown(output, "# Script"));
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "SCRIPT_READY");
        outputFiles = [`${(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "script.md")).path}`];
      } else if (task.task_type === "GENERATE_SCENES") {
        const scenes = normalizeSceneDurations(parseScenesOutput(output, task.episode_id!), this.maxSceneDuration);
        await this.repository.saveScenes(task.channel_id, task.episode_id!, scenes);
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const channel = await this.repository.getChannel(task.channel_id);
        outputFiles = [
          `channels/${channel.slug}/episodes/${episode.slug}/scene_plan.md`,
          `channels/${channel.slug}/episodes/${episode.slug}/dialogue_script.md`,
          `channels/${channel.slug}/episodes/${episode.slug}/video_prompts.md`,
        ];
      } else {
        const scenes = await this.repository.readScenes(task.channel_id, task.episode_id!);
        const targetNumber = this.findSceneNumber(task.task_id);
        const current = scenes.find((scene) => scene.scene_number === targetNumber);
        if (!current) throw new Error("Regeneration target scene not found");
        const parsed = parseRegeneration(output);
        const next = scenes.map((scene) => scene.scene_number === targetNumber ? { ...scene, ...parsed } : scene);
        await this.repository.backupEpisodeFile(task.channel_id, task.episode_id!, "scene_plan.md");
        await this.repository.saveScenes(task.channel_id, task.episode_id!, next);
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const channel = await this.repository.getChannel(task.channel_id);
        outputFiles = [`channels/${channel.slug}/episodes/${episode.slug}/scene_plan.md`];
      }
      await this.finish(task.task_id, "COMPLETED", null, outputFiles);
    } catch (error) {
      await this.finish(active.task.task_id, "FAILED", error instanceof Error ? error.message : "Could not persist Codex output");
    }
  }

  private findSceneNumber(taskId: string): number | undefined {
    return this.tasks.get(taskId)?.scene_number ?? undefined;
  }

  private async finish(taskId: string, status: TaskStatus, error: string | null, outputFiles: string[] = []): Promise<void> {
    this.active.delete(taskId);
    this.completionWaiters.get(taskId)?.();
    this.completionWaiters.delete(taskId);
    await this.update(taskId, { status, error, completed_at: nowIso(), output_files: outputFiles.length ? outputFiles : this.get(taskId).output_files, progress_message: status === "COMPLETED" ? "Completed" : error ?? status });
  }

  private async update(taskId: string, patch: Partial<Task>): Promise<void> {
    const current = this.get(taskId);
    const next = TaskSchema.parse({ ...current, ...patch });
    this.tasks.set(taskId, next);
    await this.persist(next);
    this.emitTask(next);
  }

  private async persist(task: Task): Promise<void> {
    const directory = path.join(this.repository.roots.runtime, "tasks");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${task.task_id}.json`), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  }

  private emitTask(task: Task): void {
    this.emitEvent({ type: "task.updated", task });
  }

  private emitEvent(event: TaskEvent): void {
    this.emit("event", event);
  }
}

function extractMarkdown(output: string, fallbackHeading: string): string {
  const fenced = output.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const value = fenced || output.trim();
  return value.startsWith("#") ? value : `${fallbackHeading}\n\n${value}`;
}

function parseJson(output: string): unknown {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const value = fenced || output.trim();
  const starts = [value.indexOf("["), value.indexOf("{")].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error("Codex output did not contain JSON");
  const objectStart = Math.min(...starts);
  return JSON.parse(value.slice(objectStart));
}

function parseTopicCandidates(output: string, channelId: string) {
  const raw = parseJson(output);
  const list = Array.isArray(raw) ? raw : (raw as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(list) || list.length !== 5) throw new Error("Codex topic output must contain exactly 5 candidates");
  return list.map((item, index) => {
    const candidate = item as Record<string, unknown>;
    return {
      topic_id: makeId(`topic${index + 1}`),
      channel_id: channelId,
      title: String(candidate.title ?? "").trim(),
      premise: String(candidate.premise ?? "").trim(),
      why_it_fits: String(candidate.why_it_fits ?? candidate.whyItFits ?? "").trim(),
      hook: String(candidate.hook ?? "").trim(),
      estimated_potential: String(candidate.estimated_potential ?? candidate.estimatedPotential ?? "").trim(),
      generated_at: nowIso(),
      selected: false,
    };
  });
}

function parseScenesOutput(output: string, episodeId: string): Scene[] {
  const raw = parseJson(output);
  const list = Array.isArray(raw) ? raw : (raw as { scenes?: unknown[] }).scenes;
  if (!Array.isArray(list) || list.length === 0) throw new Error("Codex scene output must contain scenes");
  return list.map((item, index) => {
    const scene = item as Record<string, unknown>;
    return {
      scene_id: `${episodeId}_scene_${index + 1}`,
      episode_id: episodeId,
      scene_number: index + 1,
      duration_seconds: Number(scene.duration_seconds ?? scene.duration ?? 6),
      dialogue: String(scene.dialogue ?? "").trim(),
      visual_prompt: String(scene.visual_prompt ?? scene.video_prompt ?? "").trim(),
      transition_note: String(scene.transition_note ?? "").trim(),
      continuity_note: String(scene.continuity_note ?? "").trim(),
      audio_asset_path: null,
      audio_generated_at: null,
      audio_duration_seconds: null,
    };
  });
}

function normalizeSceneDurations(scenes: Scene[], maxDuration: number): Scene[] {
  const normalized: Scene[] = [];
  for (const scene of scenes) {
    if (scene.duration_seconds <= maxDuration) {
      normalized.push({ ...scene, scene_number: normalized.length + 1, scene_id: `${scene.episode_id}_scene_${normalized.length + 1}` });
      continue;
    }
    const chunks = splitDialogue(scene.dialogue, Math.max(1, Math.ceil(scene.duration_seconds / maxDuration)));
    const chunkDuration = Math.min(maxDuration, Math.max(1, scene.duration_seconds / chunks.length));
    chunks.forEach((dialogue, index) => normalized.push({
      ...scene,
      scene_id: `${scene.episode_id}_scene_${normalized.length + 1}`,
      scene_number: normalized.length + 1,
      duration_seconds: chunkDuration,
      dialogue,
      continuity_note: index === 0 ? scene.continuity_note : `Continuation of scene ${scene.scene_number}`,
      transition_note: index === chunks.length - 1 ? scene.transition_note : "Continue into the next shot",
    }));
  }
  return normalized;
}

function splitDialogue(dialogue: string, count: number): string[] {
  const words = dialogue.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || count <= 1) return [dialogue];
  const size = Math.ceil(words.length / count);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += size) chunks.push(words.slice(index, index + size).join(" "));
  return chunks;
}

function parseRegeneration(output: string): Partial<Scene> {
  const raw = parseJson(output) as Record<string, unknown>;
  return {
    dialogue: typeof raw.dialogue === "string" ? raw.dialogue : undefined,
    visual_prompt: typeof raw.visual_prompt === "string" ? raw.visual_prompt : typeof raw.video_prompt === "string" ? raw.video_prompt : undefined,
    transition_note: typeof raw.transition_note === "string" ? raw.transition_note : undefined,
    continuity_note: typeof raw.continuity_note === "string" ? raw.continuity_note : undefined,
  };
}

function parseWavDuration(buffer: Uint8Array): number {
  if (buffer.length < 44) throw new Error("Audio service returned an incomplete WAV file");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (new TextDecoder().decode(buffer.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(buffer.slice(8, 12)) !== "WAVE") {
    throw new Error("Audio service returned an invalid WAV file");
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = new TextDecoder().decode(buffer.slice(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt " && chunkSize >= 16 && offset + 24 <= buffer.length) byteRate = view.getUint32(offset + 16, true);
    if (chunkId === "data") { dataSize = chunkSize; break; }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || !dataSize) throw new Error("Audio service returned a WAV without duration metadata");
  return Number((dataSize / byteRate).toFixed(3));
}
