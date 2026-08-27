import { copyFile, readFile, readdir, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  EditorialOverlaySchema,
  TaskSchema,
  type AppConfig,
  type ContextManifest,
  type Scene,
  type Task,
  type TaskEvent,
  type TaskStatus,
  type TaskType,
  QUIZ_MAX_QUESTION_COUNT,
  QUIZ_MIN_QUESTION_COUNT,
  QUIZ_MAX_CHOICES_PER_QUESTION,
  makeId,
  nowIso,
} from "@studio/shared";
import { ContextEngine } from "./context.js";
import { CodexAppServerClient, type CodexServerRequest } from "./codex.js";
import { AntigravityClient } from "./antigravity.js";
import { DEFAULT_CONFIG } from "./config.js";
import { StudioLogger } from "./logger.js";
import { RepositoryError, RepositoryService } from "./repository.js";
import { ChatterboxProvider, synthesizeWav, type ChatterboxTarget } from "./providers/chatterbox.js";
import { CodexImageProvider } from "./providers/codexImage.js";
import { ShopAiKeyImageProvider } from "./providers/shopAiKeyImage.js";
import { AntigravityImageChainProvider } from "./providers/antigravityImageChain.js";
import { Gpti2ImageProvider } from "./providers/gpti2Image.js";
import type { AudioProvider } from "./providers/index.js";
import { optimizeShortScenes, packBeatsIntoScenes, rebalanceEditorialOverlays, type Beat } from "./sceneTiming.js";
import { calibratedScriptTargetWords, countWords, extractNarration, extractNarrationChunks, extractNarrationSections, hasHumorPolicyMarker, scriptWordBounds } from "./production.js";
import { stripEditorialOverlayInstructions } from "./visualPrompt.js";
import { parseContinuityBundles, replaceBundleAnchorPrompt } from "./visualBundles.js";
import { isContentFilterError, extractFilterReason, sanitizeImagePromptWithLLM } from "./utils/promptSanitizer.js";
import { extractArtifactSectionNumbers, formatArtifactSectionNumbers, missingArtifactSectionNumbers, contiguousArtifactNumbers } from "./artifactSections.js";
import { runConcurrent } from "./utils/concurrency.js";
import { buildQuizComposition } from "./quiz/render/buildComposition.js";
import { HyperframesRenderer } from "./quiz/render/hyperframesRenderer.js";
import { preflightQuizRender } from "./quiz/qa/preflight.js";
import { inspectRenderedVideo } from "./quiz/qa/postRenderQa.js";
import { formatHyperframesCheckFailure, hasHyperframesContrastIssue, parseHyperframesCheckReport } from "./quiz/qa/hyperframesQuality.js";
import { healCompositionContrast } from "./quiz/qa/contrastHealer.js";
import { isQuizAssetResolutionComplete, resolveQuizAssets } from "./quiz/assets/resolveQuizAssets.js";
import { compileTimeline, generateDirector, generateQuiz, generateVoice, planAssets, readQuizArtifacts, resolveAssets, runQa } from "./quiz/pipeline/orchestrator.js";
import { quizVoicePlanNeedsRegeneration, quizVoiceTargetWordsPerSecond } from "./quiz/audio/voicePolicy.js";
import { healQuizVoicePacingWithLLM } from "./quiz/audio/voicePacingHealer.js";
import type { QuizVoicePacingClamp } from "./quiz/audio/voiceSynthesis.js";
import { canonicalizeVisibleQuizAnswer, resolveVisibleQuizChoice, stripQuizChoiceLabel } from "./quiz/domain/quiz.js";
import { validateQuizResearchCopyright, validateQuizScriptCopyright } from "./quiz/qa/copyrightValidator.js";

export { buildQuizComposition };

type ActiveRun = { task: Task; threadId: string; turnId: string; output: string; manifest: ContextManifest; researchAttempts: number; scriptAttempts: number; visualBibleAttempts: number; sequenceAttempts: number };
type CodexCleanupConfig = { auto_delete_threads: boolean; failed_thread_retention_days: number };
type PipelineRun = { cancelled: boolean; children: Set<string> };
type SequenceDraftSnapshot = { sequenceNumber: number; modified_at: string };
type NarrationCheckpoint = {
  schema_version: 1;
  script_modified_at: string;
  segments: Record<string, { fingerprint: string; asset_path: string; duration_seconds: number }>;
};
type RenderCheckpoint = {
  schema_version: 2;
  source_fingerprint: string;
  check: { status: "passed" };
  render?: { status: "passed" };
};

const channelTaskTypes = new Set<TaskType>(["GENERATE_DNA", "SUGGEST_TOPICS"]);
const audioTaskTypes = new Set<TaskType>(["GENERATE_AUDIO", "GENERATE_NARRATION"]);
const imageTaskTypes = new Set<TaskType>(["GENERATE_BUNDLE_IMAGE"]);
const videoTaskTypes = new Set<TaskType>(["GENERATE_VIDEO"]);
const pipelineTaskTypes = new Set<TaskType>(["GENERATE_PIPELINE"]);
const execFileAsync = promisify(execFile);
const npxCommand = process.platform === "win32" ? process.execPath : "npx";
const quizRenderer = new HyperframesRenderer();

export class TaskManager extends EventEmitter {
  private readonly tasks = new Map<string, Task>();
  private readonly active = new Map<string, ActiveRun>();
  private readonly approvalRequests = new Map<number, { taskId: string; request: CodexServerRequest }>();
  private readonly completionWaiters = new Map<string, () => void>();
  private readonly pipelineRuns = new Map<string, PipelineRun>();
  private readonly locks = new Set<string>();
  private readonly assemblingEpisodes = new Set<string>();
  private readonly activeImageControllers = new Map<string, AbortController>();
  private readonly imageVariants = new Map<string, number>();
  private readonly topicHints = new Map<string, string>();
  private runningCount = 0;
  private runningAudioCount = 0;
  private runningImageCount = 0;
  private runningVideoCount = 0;
  private runningPipelineCount = 0;
  private readonly activeAudio = new Set<string>();
  private audioConfig: AppConfig["audio_generation"];
  private imageConfig: AppConfig["image_generation"];
  private videoConfig: AppConfig["video_generation"];
  private readonly audioProviderFactory: (target: ChatterboxTarget, config: AppConfig["audio_generation"]) => AudioProvider;
  private codexCleanupConfig: CodexCleanupConfig;
  private antigravityCleanupConfig: CodexCleanupConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private connectionStatus: "connected" | "disconnected" | "unavailable" | "connecting" = "disconnected";
  private antigravityStatus: "connected" | "disconnected" | "unavailable" | "connecting" = "disconnected";
  private activeEngine: "codex" | "antigravity" = "codex";

  constructor(
    private readonly repository: RepositoryService,
    private readonly contextEngine: ContextEngine,
    private readonly codex: CodexAppServerClient,
    private readonly maxConcurrent: number,
    videoConfigOrMaxSceneDuration: AppConfig["video_generation"] | number,
    private readonly logger: StudioLogger,
    audioConfig: AppConfig["audio_generation"] = {
      provider: "chatterbox",
      service_url: "http://127.0.0.1:8890",
      exaggeration: 0.5,
      cfg_weight: 0.5,
      max_concurrent_tasks: 2,
      merge_gap_ms: 300,
      match_target_duration: true,
    },
    audioProviderFactory?: (target: ChatterboxTarget, config: AppConfig["audio_generation"]) => AudioProvider,
    codexConfig: CodexCleanupConfig = { auto_delete_threads: false, failed_thread_retention_days: 7 },
    imageConfig: AppConfig["image_generation"] = DEFAULT_CONFIG.image_generation,
    private readonly antigravity?: AntigravityClient,
    activeEngine: "codex" | "antigravity" = "codex",
  ) {
    super();
    this.activeEngine = activeEngine;
    this.videoConfig = typeof videoConfigOrMaxSceneDuration === "number"
      ? { ...DEFAULT_CONFIG.video_generation, max_scene_duration_seconds: videoConfigOrMaxSceneDuration }
      : videoConfigOrMaxSceneDuration;
    this.audioConfig = audioConfig;
    this.imageConfig = imageConfig;
    this.audioProviderFactory = audioProviderFactory ?? ((target, config) => new ChatterboxProvider(repository, config, target));
    this.codexCleanupConfig = { auto_delete_threads: codexConfig.auto_delete_threads, failed_thread_retention_days: codexConfig.failed_thread_retention_days };
    this.antigravityCleanupConfig = { auto_delete_threads: false, failed_thread_retention_days: 0 };
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
    if (antigravity) {
      antigravity.on("status", (status: typeof this.antigravityStatus) => {
        this.antigravityStatus = status;
        this.emitEvent({ type: "antigravity.status", status });
      });
      antigravity.on("notification", (event: { method: string; params: Record<string, unknown> }) => this.handleNotification(event.method, event.params));
    }
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
    this.startCleanupTimer();
    void this.cleanupCodexThreads();
    void this.cleanupAntigravityThreads();
  }

  async reload(): Promise<void> {
    if (this.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing storage", "STORAGE_BUSY");
    this.tasks.clear();
    this.imageVariants.clear();
    this.topicHints.clear();
    this.activeImageControllers.clear();
    this.approvalRequests.clear();
    this.locks.clear();
    this.runningCount = 0;
    this.runningAudioCount = 0;
    this.runningImageCount = 0;
    this.runningVideoCount = 0;
    this.runningPipelineCount = 0;
    this.connectionStatus = this.codex.isConnected ? "connected" : "disconnected";
    await this.load();
  }

  updateAudioConfig(config: AppConfig["audio_generation"]): void {
    this.audioConfig = config;
    void this.pump();
  }

  updateVideoConfig(config: AppConfig["video_generation"]): void {
    this.videoConfig = config;
    void this.pump();
  }

  updateImageConfig(config: AppConfig["image_generation"]): void {
    this.imageConfig = config;
    void this.pump();
  }

  updateCodexConfig(config: AppConfig["codex"]): void {
    this.codexCleanupConfig = { auto_delete_threads: config.auto_delete_threads, failed_thread_retention_days: config.failed_thread_retention_days };
  }

  updateAntigravityConfig(config: AppConfig["antigravity"]): void {
    this.antigravityCleanupConfig = { auto_delete_threads: config.auto_delete_threads, failed_thread_retention_days: config.failed_thread_retention_days };
    if (this.antigravity) {
      this.antigravity.updateConfig({ ...DEFAULT_CONFIG, antigravity: config });
    }
  }

  setActiveEngine(engine: "codex" | "antigravity"): void {
    this.activeEngine = engine;
    this.emitEvent({ type: "engine.status", engine, status: this.getStatus() });
  }

  getActiveEngine(): "codex" | "antigravity" {
    return this.activeEngine;
  }

  getStatus(): typeof this.connectionStatus {
    return this.activeEngine === "antigravity" ? this.antigravityStatus : this.connectionStatus;
  }

  getCodexStatus(): typeof this.connectionStatus {
    return this.connectionStatus;
  }

  getAntigravityStatus(): typeof this.antigravityStatus {
    return this.antigravityStatus;
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new RepositoryError("Task not found", "TASK_NOT_FOUND");
    return task;
  }

  hasActiveWork(): boolean {
    return this.active.size > 0 ||
      this.activeAudio.size > 0 ||
      this.activeImageControllers.size > 0 ||
      this.pipelineRuns.size > 0 ||
      this.runningCount > 0 ||
      this.runningAudioCount > 0 ||
      this.runningImageCount > 0 ||
      this.runningVideoCount > 0 ||
      this.runningPipelineCount > 0 ||
      this.list().some((task) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status));
  }

  submit(taskType: TaskType, channelId: string, episodeId: string | null, sceneNumber?: number, requestedImageVariant?: number, topicHint?: string): Task {
    if (taskType === "GENERATE_BUNDLE_IMAGE" && !this.imageConfig.enabled) throw new RepositoryError("Image generation is disabled in Settings", "IMAGE_GENERATION_DISABLED");
    const imageVariant = taskType === "GENERATE_BUNDLE_IMAGE" && episodeId && sceneNumber
      ? requestedImageVariant ?? this.list().filter((item) => item.task_type === "GENERATE_BUNDLE_IMAGE" && item.episode_id === episodeId && item.scene_number === sceneNumber && ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(item.status)).length % Math.max(1, this.imageConfig.images_per_bundle)
      : 0;
    const lockKey = taskType === "GENERATE_PIPELINE" && episodeId
      ? `${episodeId}:pipeline`
      : taskType === "GENERATE_SEQUENCE_SCENES" && episodeId && sceneNumber
      ? `${episodeId}:sequence:${sceneNumber}`
      : taskType === "GENERATE_BUNDLE_IMAGE" && episodeId && sceneNumber
      ? `${episodeId}:bundle:${sceneNumber}:variant:${imageVariant}`
      : channelTaskTypes.has(taskType) ? channelId : episodeId;
    if (!lockKey) throw new RepositoryError("Episode is required for this task", "EPISODE_REQUIRED");
    if (taskType === "GENERATE_PIPELINE" && this.list().some((item) => item.lock_key === lockKey && ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(item.status))) {
      throw new RepositoryError("Production pipeline is already running for this episode", "PIPELINE_ACTIVE");
    }
    const existingQueue = this.list().filter((task) => task.lock_key === lockKey && task.status === "QUEUED").length;

    // When retrying or restarting a pipeline or task, accumulate duration from previous attempts
    const previousMatchingTasks = this.list().filter((item) =>
      item.lock_key === lockKey &&
      item.channel_id === channelId &&
      item.episode_id === episodeId &&
      item.task_type === taskType &&
      item.scene_number === (sceneNumber ?? null) &&
      ["FAILED", "CANCELLED", "COMPLETED"].includes(item.status)
    );

    const latestPreviousTask = previousMatchingTasks.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    let accumulatedDuration = 0;
    if (latestPreviousTask) {
      const start = latestPreviousTask.started_at || latestPreviousTask.created_at;
      const end = latestPreviousTask.completed_at || nowIso();
      const elapsed = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
      accumulatedDuration = (latestPreviousTask.accumulated_duration_seconds || 0) + elapsed;
    }

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
      accumulated_duration_seconds: accumulatedDuration,
    });
    if (taskType === "GENERATE_BUNDLE_IMAGE") this.imageVariants.set(task.task_id, imageVariant);
    if (taskType === "SUGGEST_TOPICS" && topicHint?.trim()) this.topicHints.set(task.task_id, topicHint.trim());
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
      this.imageVariants.delete(taskId);
      this.topicHints.delete(taskId);
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
    } else if (this.activeImageControllers.has(taskId)) {
      await this.update(taskId, { status: "CANCELLED", progress_message: "Interrupting image generation" });
      this.activeImageControllers.get(taskId)?.abort();
      await this.finish(taskId, "CANCELLED", "Cancelled by user");
    } else {
      const pipeline = this.pipelineRuns.get(taskId);
      if (pipeline) {
        pipeline.cancelled = true;
        await Promise.all([...pipeline.children].map((childId) => this.cancel(childId).catch(() => undefined)));
      }
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
    const maxVideoConcurrent = this.videoConfig.max_concurrent_tasks ?? 2;

    while (this.runningVideoCount < maxVideoConcurrent) {
      const next = this.list().reverse().find((task) => task.status === "QUEUED" && task.task_type === "GENERATE_VIDEO" && !this.locks.has(task.lock_key));
      if (!next) break;
      this.locks.add(next.lock_key);
      this.runningVideoCount += 1;
      void this.run(next).finally(() => {
        this.locks.delete(next.lock_key);
        this.runningVideoCount -= 1;
        void this.pump();
      });
    }

    while (this.runningPipelineCount < maxVideoConcurrent) {
      const next = this.list().reverse().find((task) => task.status === "QUEUED" && task.task_type === "GENERATE_PIPELINE" && !this.locks.has(task.lock_key));
      if (!next) break;
      this.locks.add(next.lock_key);
      this.runningPipelineCount += 1;
      void this.run(next).finally(() => {
        this.locks.delete(next.lock_key);
        this.runningPipelineCount -= 1;
        void this.pump();
      });
    }

    while (this.runningCount < this.maxConcurrent) {
      const next = this.list().reverse().find((task) =>
        task.status === "QUEUED" &&
        !audioTaskTypes.has(task.task_type) &&
        !imageTaskTypes.has(task.task_type) &&
        !videoTaskTypes.has(task.task_type) &&
        !pipelineTaskTypes.has(task.task_type) &&
        !this.locks.has(task.lock_key)
      );
      if (!next) break;
      this.locks.add(next.lock_key);
      this.runningCount += 1;
      void this.run(next).finally(() => {
        this.locks.delete(next.lock_key);
        this.runningCount -= 1;
        void this.pump();
      });
    }
    const maxImageConcurrent = this.imageConfig.max_concurrent_tasks ?? 3;
    while (this.runningImageCount < maxImageConcurrent) {
      const next = this.list().reverse().find((task) => task.status === "QUEUED" && imageTaskTypes.has(task.task_type) && !this.locks.has(task.lock_key));
      if (!next) break;
      this.locks.add(next.lock_key);
      this.runningImageCount += 1;
      void this.run(next).finally(() => {
        this.locks.delete(next.lock_key);
        this.runningImageCount -= 1;
        void this.pump();
      });
    }
    while (this.runningAudioCount < this.audioConfig.max_concurrent_tasks) {
      const next = this.list().reverse().find((task) => task.status === "QUEUED" && audioTaskTypes.has(task.task_type) && !this.locks.has(task.lock_key));
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
    if (task.task_type === "GENERATE_PIPELINE") {
      await this.runPipelineTask(task);
      return;
    }
    if (task.task_type === "GENERATE_VIDEO") {
      await this.runVideoTask(task);
      return;
    }
    if (task.task_type === "GENERATE_BUNDLE_IMAGE") {
      if (Gpti2ImageProvider.isConfigured(this.imageConfig.api_key)) {
        await this.runGpti2BundleImageTask(task);
        return;
      }
      if (this.activeEngine === "antigravity") {
        await this.runAntigravityBundleImageTask(task);
        return;
      }
      if (ShopAiKeyImageProvider.isConfigured()) {
        await this.runShopAiKeyImageTask(task);
        return;
      }
    }
    const context = { profileId: task.channel_id, workerId: task.task_id, step: `run_task:${task.task_type}` };
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing scoped context" });
      const topicHint = this.topicHints.get(task.task_id);
      const manifest = await this.contextEngine.build(task.task_type, task.channel_id, task.episode_id, this.findSceneNumber(task.task_id), this.imageVariants.get(task.task_id) ?? 0, topicHint);
      const isAntigravity = this.activeEngine === "antigravity" && Boolean(this.antigravity);
      const client = isAntigravity ? this.antigravity! : this.codex;
      const engineName = isAntigravity ? "Antigravity" : "Codex";
      await this.update(task.task_id, { progress_message: `Connecting to ${engineName}` });
      await client.connect();
      const threadId = task.codex_thread_id ? await client.resumeThread(task.codex_thread_id) : await client.startThread();
      const completionPromise = new Promise<void>((resolve) => this.completionWaiters.set(task.task_id, resolve));
      const activeRecord: ActiveRun = { task: this.get(task.task_id), threadId, turnId: "", output: "", manifest, researchAttempts: 0, scriptAttempts: 0, visualBibleAttempts: 0, sequenceAttempts: 0 };
      this.active.set(task.task_id, activeRecord);
      const turnId = await client.startTurn(threadId, manifest.prompt);
      activeRecord.turnId = turnId;
      if (this.get(task.task_id).status === "RUNNING") {
        void this.update(task.task_id, { codex_thread_id: threadId, codex_turn_id: turnId, progress_message: "Generating" });
      }
      this.logger.step(`${engineName} turn started`, context);
      await completionPromise;
    } catch (error) {
      await this.finish(task.task_id, "FAILED", error instanceof Error ? error.message : "Task failed");
      this.logger.error(`${this.activeEngine === "antigravity" ? "Antigravity" : "Codex"} task failed`, context);
    }
  }

  private async generateBundleImageWithSafetyRetry(
    task: Task,
    imageTarget: { channelId: string; episodeId: string; bundleNumber: number; variant: number; theme?: string },
    initialPrompt: string,
    signal?: AbortSignal,
    output?: string,
    visualBibleContent?: string,
  ): Promise<{ image: { asset_path: string }; updatedPrompt?: string }> {
    let currentPrompt = initialPrompt;
    const maxAttempts = 2;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        const image = Gpti2ImageProvider.isConfigured(this.imageConfig.api_key)
          ? await new Gpti2ImageProvider(this.repository, imageTarget, {
              apiKey: this.imageConfig.api_key,
              model: this.imageConfig.model,
            }).generateReference(currentPrompt, signal)
          : this.activeEngine === "antigravity"
          ? await new AntigravityImageChainProvider(this.repository, imageTarget, this.antigravity, { allowTier3Fallback: false }).generateReference(currentPrompt, signal)
          : ShopAiKeyImageProvider.isConfigured()
          ? await new ShopAiKeyImageProvider(this.repository, imageTarget).generateReference(currentPrompt, signal)
          : await new CodexImageProvider(this.repository, imageTarget, output ?? "").generateReference(currentPrompt);
        return { image, updatedPrompt: currentPrompt !== initialPrompt ? currentPrompt : undefined };
      } catch (err) {
        lastError = err;
        if (signal?.aborted || this.get(task.task_id).status === "CANCELLED") throw err;
        if (isContentFilterError(err) && attempt < maxAttempts) {
          const reason = extractFilterReason(err);
          const client = this.activeEngine === "antigravity" && this.antigravity ? this.antigravity : this.codex;
          const engineLabel = this.activeEngine === "antigravity" ? "Antigravity" : "Codex";
          this.logger.warn(`Style anchor ${imageTarget.bundleNumber} prompt rejected by content filter (${reason}). Auto-rephrasing with ${engineLabel} (attempt ${attempt + 1}/${maxAttempts})...`, {
            profileId: imageTarget.channelId,
            step: "image_safety_rephrase",
          });
          await this.update(task.task_id, {
            progress_message: `Prompt rejected by safety filter. Auto-rephrasing with ${engineLabel} (${attempt + 1}/${maxAttempts})...`,
          });
          const rephrased = await sanitizeImagePromptWithLLM({
            client,
            originalPrompt: currentPrompt,
            rejectionReason: reason,
            context: `Style anchor continuity bundle CB-${String(imageTarget.bundleNumber).padStart(2, "0")}`,
            signal,
          });
          if (rephrased && rephrased !== currentPrompt) {
            currentPrompt = rephrased;
            if (visualBibleContent) {
              const updated = replaceBundleAnchorPrompt(visualBibleContent, imageTarget.bundleNumber, rephrased);
              if (updated !== visualBibleContent) {
                await this.repository.saveEpisodeFile(imageTarget.channelId, imageTarget.episodeId, "visual_bible.md", updated).catch(() => undefined);
                visualBibleContent = updated;
              }
            }
            await this.update(task.task_id, {
              progress_message: `Retrying continuity image with sanitized prompt (${attempt + 1}/${maxAttempts})`,
              progress_percent: 45,
            });
            continue;
          }
        }
        throw err;
      }
    }
    throw lastError ?? new Error("Failed to generate continuity image");
  }

  private async runGpti2BundleImageTask(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_gpti2_image" };
    const controller = new AbortController();
    this.activeImageControllers.set(task.task_id, controller);
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing continuity context", progress_percent: 10 });
      if (!task.episode_id) throw new RepositoryError("Episode is required", "EPISODE_REQUIRED");
      const bundleNumber = this.findSceneNumber(task.task_id);
      if (!bundleNumber) throw new RepositoryError("Bundle number is required", "BUNDLE_REQUIRED");
      const manifest = await this.contextEngine.build(task.task_type, task.channel_id, task.episode_id, bundleNumber, this.imageVariants.get(task.task_id) ?? 0);
      const imageModel = this.imageConfig.model || "gpt-image-2";
      await this.update(task.task_id, { progress_message: `Generating continuity image (${imageModel})`, progress_percent: 35 });
      const visualBible = await this.repository.getEpisodeFile(task.channel_id, task.episode_id, "visual_bible.md").catch(() => null);
      let promptToUse = manifest.prompt;
      if (visualBible?.content) {
        const bundles = parseContinuityBundles(visualBible.content);
        const bundle = bundles.find((b) => b.bundle_number === bundleNumber);
        if (bundle?.anchor_prompt) {
          promptToUse = bundle.anchor_prompt;
        }
      }
      const imageTarget = {
        channelId: task.channel_id,
        episodeId: task.episode_id,
        bundleNumber,
        variant: this.imageVariants.get(task.task_id) ?? 0,
      };
      const { image } = await this.generateBundleImageWithSafetyRetry(task, imageTarget, promptToUse, controller.signal, undefined, visualBible?.content);
      const bundleId = `CB-${String(bundleNumber).padStart(2, "0")}`;
      await this.repository.attachBundleReference(task.channel_id, task.episode_id, bundleId, image.asset_path);
      await this.update(task.task_id, { progress_message: "Saving continuity image", progress_percent: 90 });
      await this.finish(task.task_id, "COMPLETED", null, [image.asset_path]);
    } catch (error) {
      if (this.get(task.task_id).status === "CANCELLED") return;
      const message = error instanceof Error ? error.message : "Image generation failed";
      await this.finish(task.task_id, "FAILED", message);
      this.logger.error(message, { ...context, step: "run_gpti2_image" });
    } finally {
      this.activeImageControllers.delete(task.task_id);
    }
  }

  private async runAntigravityBundleImageTask(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_antigravity_image" };
    const controller = new AbortController();
    this.activeImageControllers.set(task.task_id, controller);
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing continuity context", progress_percent: 10 });
      if (!task.episode_id) throw new RepositoryError("Episode is required", "EPISODE_REQUIRED");
      const bundleNumber = this.findSceneNumber(task.task_id);
      if (!bundleNumber) throw new RepositoryError("Bundle number is required", "BUNDLE_REQUIRED");
      const episode = await this.repository.getEpisode(task.channel_id, task.episode_id);
      const manifest = await this.contextEngine.build(task.task_type, task.channel_id, task.episode_id, bundleNumber, this.imageVariants.get(task.task_id) ?? 0);
      await this.update(task.task_id, { progress_message: "Generating continuity image (3-tier chain)", progress_percent: 35 });
      const visualBible = await this.repository.getEpisodeFile(task.channel_id, task.episode_id, "visual_bible.md").catch(() => null);
      let promptToUse = manifest.prompt;
      if (visualBible?.content) {
        const bundles = parseContinuityBundles(visualBible.content);
        const bundle = bundles.find((b) => b.bundle_number === bundleNumber);
        if (bundle?.anchor_prompt) {
          promptToUse = bundle.anchor_prompt;
        }
      }
      const imageTarget = {
        channelId: task.channel_id,
        episodeId: task.episode_id,
        bundleNumber,
        variant: this.imageVariants.get(task.task_id) ?? 0,
        theme: episode.quiz_config?.visual_theme,
      };
      const { image } = await this.generateBundleImageWithSafetyRetry(task, imageTarget, promptToUse, controller.signal, undefined, visualBible?.content);
      const bundleId = `CB-${String(bundleNumber).padStart(2, "0")}`;
      await this.repository.attachBundleReference(task.channel_id, task.episode_id, bundleId, image.asset_path);
      await this.update(task.task_id, { progress_message: "Saving continuity image", progress_percent: 90 });
      await this.finish(task.task_id, "COMPLETED", null, [image.asset_path]);
    } catch (error) {
      if (this.get(task.task_id).status === "CANCELLED") return;
      const message = error instanceof Error ? error.message : "Image generation failed";
      await this.finish(task.task_id, "FAILED", message);
      this.logger.error(message, { ...context, step: "run_antigravity_image" });
    } finally {
      this.activeImageControllers.delete(task.task_id);
    }
  }

  private async runShopAiKeyImageTask(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_image" };
    const controller = new AbortController();
    this.activeImageControllers.set(task.task_id, controller);
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing continuity context", progress_percent: 10 });
      if (!task.episode_id) throw new RepositoryError("Episode is required", "EPISODE_REQUIRED");
      const bundleNumber = this.findSceneNumber(task.task_id);
      if (!bundleNumber) throw new RepositoryError("Bundle number is required", "BUNDLE_REQUIRED");
      const manifest = await this.contextEngine.build(task.task_type, task.channel_id, task.episode_id, bundleNumber, this.imageVariants.get(task.task_id) ?? 0);
      await this.update(task.task_id, { progress_message: "Generating continuity image", progress_percent: 35 });
      const visualBible = await this.repository.getEpisodeFile(task.channel_id, task.episode_id, "visual_bible.md").catch(() => null);
      let promptToUse = manifest.prompt;
      if (visualBible?.content) {
        const bundles = parseContinuityBundles(visualBible.content);
        const bundle = bundles.find((b) => b.bundle_number === bundleNumber);
        if (bundle?.anchor_prompt) {
          promptToUse = bundle.anchor_prompt;
        }
      }
      const imageTarget = {
        channelId: task.channel_id,
        episodeId: task.episode_id,
        bundleNumber,
        variant: this.imageVariants.get(task.task_id) ?? 0,
      };
      const { image } = await this.generateBundleImageWithSafetyRetry(task, imageTarget, promptToUse, controller.signal, undefined, visualBible?.content);
      const bundleId = `CB-${String(bundleNumber).padStart(2, "0")}`;
      await this.repository.attachBundleReference(task.channel_id, task.episode_id, bundleId, image.asset_path);
      await this.update(task.task_id, { progress_message: "Saving continuity image", progress_percent: 90 });
      await this.finish(task.task_id, "COMPLETED", null, [image.asset_path]);
    } catch (error) {
      if (this.get(task.task_id).status === "CANCELLED") return;
      const message = error instanceof Error ? error.message : "Image generation failed";
      await this.finish(task.task_id, "FAILED", message);
      this.logger.error(message, { ...context, step: "run_image" });
    } finally {
      this.activeImageControllers.delete(task.task_id);
    }
  }


  private async runPipelineTask(task: Task): Promise<void> {
    if (!task.episode_id) {
      await this.finish(task.task_id, "FAILED", "Episode is required for the production pipeline");
      return;
    }
    const run: PipelineRun = { cancelled: false, children: new Set() };
    this.pipelineRuns.set(task.task_id, run);
    const episodeId = task.episode_id;
    const step = async (label: string, percent: number, childType: TaskType, shouldRun: () => Promise<boolean>): Promise<boolean> => {
      if (run.cancelled) throw new Error("Pipeline cancelled");
      await this.update(task.task_id, { progress_message: label, progress_percent: percent });
      if (!(await shouldRun())) return false;
      const child = this.submit(childType, task.channel_id, episodeId);
      run.children.add(child.task_id);
      try {
        const completed = await this.waitForTaskTerminal(child.task_id, run);
        if (completed.status !== "COMPLETED") throw new Error(`${label} failed: ${completed.error ?? completed.status}`);
      } finally {
        run.children.delete(child.task_id);
      }
      return true;
    };
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Starting production pipeline", progress_percent: 0 });
      const researchChanged = await step("Research · verifying sources", 3, "GENERATE_RESEARCH", async () => !(await this.hasReadyArtifact(task.channel_id, episodeId, "research.md")));
      const treatmentChanged = await step("Treatment · structuring the story", 6, "GENERATE_TREATMENT", async () => !(await this.hasReadyArtifact(task.channel_id, episodeId, "treatment.md")));
      const scriptChanged = await step("Narration script · writing the argument", 12, "GENERATE_SCRIPT", async () => !(await this.hasReadyScript(task.channel_id, episodeId)));
      const visualBibleChanged = await step("Visual bible · locking continuity", 18, "GENERATE_VISUAL_BIBLE", async () => !(await this.hasReadyArtifact(task.channel_id, episodeId, "visual_bible.md")));
      const upstreamChanged = researchChanged || treatmentChanged || scriptChanged || visualBibleChanged;

      const scenes = await this.repository.readScenes(task.channel_id, episodeId);
      if (run.cancelled) throw new Error("Pipeline cancelled");
      const shotPlanFresh = await this.isShotPlanFresh(task.channel_id, episodeId);
      const regenerateShots = scenes.length === 0 || upstreamChanged || !shotPlanFresh;
      await this.update(task.task_id, { progress_message: regenerateShots ? "Shot plan · generating sequences" : "Shot plan · already ready", progress_percent: 25 });
      if (regenerateShots) {
        const script = await this.repository.getEpisodeFile(task.channel_id, episodeId, "script.md");
        const sections = extractNarrationSections(script.content);
        if (sections.length === 0) throw new Error("Shot plan failed: a completed script is required");
        await this.repository.backupEpisodeFile(task.channel_id, episodeId, "scene_plan.md");
        const existingDrafts = await this.repository.readSequenceDrafts(episodeId);
        const resumePlan = planSequenceResume(sections.length, existingDrafts, script.modified_at, upstreamChanged);
        if (resumePlan.shouldClearDrafts) await this.repository.clearSequenceDrafts(episodeId);
        await this.update(task.task_id, { progress_message: resumePlan.reusedSequenceNumbers.length ? `Shot plan · resuming ${resumePlan.reusedSequenceNumbers.length}/${sections.length} completed sequences` : "Shot plan · generating sequences", progress_percent: 25 });
        if (resumePlan.pendingSequenceNumbers.length === 0) {
          const committed = await this.repository.commitSequenceDrafts(task.channel_id, episodeId, sections.length);
          if (!committed) throw new Error("Shot plan failed: completed sequence drafts could not be committed");
        }
        const children = resumePlan.pendingSequenceNumbers.map((sequenceNumber) => this.submit("GENERATE_SEQUENCE_SCENES", task.channel_id, episodeId, sequenceNumber));
        children.forEach((child) => run.children.add(child.task_id));
        try {
          await Promise.all(children.map(async (child) => {
            const result = await this.waitForTaskTerminal(child.task_id, run);
            if (result.status !== "COMPLETED") throw new Error(`Shot plan failed: ${result.error ?? result.status}`);
            return result;
          }));
        } catch (error) {
          await Promise.all(children.map((child) => this.cancel(child.task_id).catch(() => undefined)));
          throw error;
        } finally {
          children.forEach((child) => run.children.delete(child.task_id));
        }
      }

      const balancedScenes = rebalanceEditorialOverlays(await this.repository.readScenes(task.channel_id, episodeId));
      await this.repository.saveScenes(task.channel_id, episodeId, balancedScenes);

      if (run.cancelled) throw new Error("Pipeline cancelled");
      await this.runQuizV2Pipeline(task);

      if (run.cancelled) throw new Error("Pipeline cancelled");
      await this.update(task.task_id, { progress_message: "Video · linting Quiz composition", progress_percent: 92 });
      const videoChild = this.submit("GENERATE_VIDEO", task.channel_id, episodeId);
      run.children.add(videoChild.task_id);
      try {
        const completed = await this.waitForTaskTerminal(videoChild.task_id, run);
        if (completed.status !== "COMPLETED") throw new Error(`Video render failed: ${completed.error ?? completed.status}`);
      } finally {
        run.children.delete(videoChild.task_id);
      }
      await this.finish(task.task_id, "COMPLETED", null, []);
    } catch (error) {
      const cancelled = run.cancelled || (error instanceof Error && error.message === "Pipeline cancelled");
      await this.finish(task.task_id, cancelled ? "CANCELLED" : "FAILED", cancelled ? "Cancelled by user" : error instanceof Error ? error.message : "Production pipeline failed");
    } finally {
      this.pipelineRuns.delete(task.task_id);
    }
  }

  private async runVideoTask(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "render_video" };
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing Quiz composition", progress_percent: 5 });
      if (!task.episode_id) throw new RepositoryError("Episode is required", "EPISODE_REQUIRED");
      const episode = await this.repository.getEpisode(task.channel_id, task.episode_id);
      const channel = await this.repository.getChannel(task.channel_id);
      const scenes = await this.repository.readScenes(task.channel_id, task.episode_id);
      if (!(await this.hasValidNarrationAsset(task.channel_id, task.episode_id, episode.narration_asset_path))) throw new RepositoryError("Generate the Chatterbox narration before rendering video", "NARRATION_REQUIRED");
      if (scenes.length === 0) throw new RepositoryError("Generate Quiz scenes before rendering video", "SCENES_REQUIRED");
      const narration = await this.repository.getEpisodeAudioFile(task.channel_id, task.episode_id, path.basename(episode.narration_asset_path!));
      const renderRoot = this.repository.resolvePath("runtime", "hyperframes", episode.episode_id);
      await mkdir(renderRoot, { recursive: true });
      const compositionPath = path.join(renderRoot, "index.html");
      const outputPath = path.join(renderRoot, "quiz-video.mp4");
      const renderAudioPath = path.join(renderRoot, "narration.wav");
      await copyFile(narration.absolutePath, renderAudioPath);
      const quizV2 = await this.repository.readQuiz(task.channel_id, task.episode_id);
      const directorPlan = await this.repository.readDirectorPlan(task.channel_id, task.episode_id);
      const assetPlan = await this.repository.readAssetPlan(task.channel_id, task.episode_id);
      const voicePlan = await this.repository.readVoicePlan(task.channel_id, task.episode_id);
      const timeline = await this.repository.readQuizTimeline(task.channel_id, task.episode_id);
      const completeQuizV2 = quizV2 && directorPlan && assetPlan && voicePlan && timeline
        ? { quiz: quizV2, director: directorPlan, assetPlan, voicePlan, timeline }
        : null;
      if (channel.engine === "quiz" && !completeQuizV2 && !episode.video_asset_path) {
        throw new RepositoryError("Quiz V2 artifacts are required before rendering a new Quiz video", "QUIZ_V2_REQUIRED");
      }
      let assetResolution = await this.repository.readQuizAssetResolution(task.channel_id, task.episode_id);
      if (completeQuizV2 && !assetResolution) {
        await this.update(task.task_id, { progress_message: "Quiz · preparing visual assets", progress_percent: 10 });
        assetResolution = (await resolveQuizAssets({
          repository: this.repository,
          channelId: task.channel_id,
          episodeId: task.episode_id,
          plan: completeQuizV2.assetPlan,
          activeEngine: this.activeEngine,
          antigravityClient: this.antigravity,
          imageConfig: { api_key: this.imageConfig.api_key, model: this.imageConfig.model },
        })).resolution;
      }
      // HyperFrames only discovers local media inside the composition directory.
      // Copy resolved assets into this ephemeral render root instead of exposing
      // absolute repository paths (which would become invalid file:// URLs).
      const renderAssetDirectory = path.join(renderRoot, "quiz-images");
      await mkdir(renderAssetDirectory, { recursive: true });
      const resolvedAssetEntries: Array<readonly [string, string] | null> = await Promise.all((assetResolution?.assets ?? []).map(async (asset) => {
        try {
          const sourcePath = await this.repository.resolveQuizAssetPath(task.channel_id, task.episode_id!, asset.path);
          const extension = path.extname(sourcePath) || ".png";
          const renderFilename = `${asset.asset_id}${extension}`;
          await copyFile(sourcePath, path.join(renderAssetDirectory, renderFilename));
          return [asset.asset_id, `./quiz-images/${renderFilename}`] as const;
        } catch {
          return null;
        }
      }));
      const assetSources: Record<string, string> = Object.fromEntries(resolvedAssetEntries.filter((entry): entry is readonly [string, string] => entry !== null));
      let preflightAssessment: ReturnType<typeof preflightQuizRender>["assessment"] | null = null;
      if (completeQuizV2) {
        const preflight = preflightQuizRender({
          quiz: completeQuizV2.quiz,
          director: completeQuizV2.director,
          assetPlan: completeQuizV2.assetPlan,
          resolvedAssets: assetResolution?.assets ?? [],
          voicePlan: completeQuizV2.voicePlan,
          timeline: completeQuizV2.timeline,
          measuredAudio: episode.narration_duration_seconds !== null,
        });
        preflightAssessment = preflight.assessment;
        await this.repository.writeQuizAssessment(task.channel_id, task.episode_id, preflight.assessment);
        if (!preflight.ok) {
          const blocker = preflight.assessment.issues.find((issue) => issue.severity === "blocker");
          throw new RepositoryError("Quiz V2 preflight blocked render: " + (blocker?.message ?? "Resolve the reported QA blockers before rendering."), "QUIZ_PREFLIGHT_BLOCKED");
        }
      }
      const bgmHistory = await this.repository.readBgmHistory(task.channel_id);
      const preparedQuizRender = completeQuizV2
        ? await quizRenderer.prepare({
            quiz: completeQuizV2.quiz,
            director: completeQuizV2.director,
            timeline: completeQuizV2.timeline,
            scenes,
            audioPath: "./narration.wav",
            theme: episode.quiz_config.visual_theme,
            narrationDurationSeconds: episode.narration_duration_seconds ?? undefined,
            assets: assetSources,
            bgmOptions: {
              recentTrackIds: bgmHistory.map((entry) => entry.track_id),
              seed: episode.episode_id,
            },
          })
        : null;
      const html = preparedQuizRender?.html ?? buildQuizComposition(episode.quiz_config, scenes, "./narration.wav", episode.narration_duration_seconds ?? undefined);
      await writeFile(compositionPath, html, "utf8");
      for (const [relativePath, content] of Object.entries(preparedQuizRender?.compositionFiles ?? {})) {
        const filePath = path.join(renderRoot, relativePath);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf8");
      }
      const sfxTargetDir = path.join(renderRoot, "sfx");
      await mkdir(sfxTargetDir, { recursive: true });
      const sfxFiles = ["ui_pop.wav", "bubble_splash.wav", "lightning_brush.wav", "countdown_tick.wav", "countdown_final.wav", "correct_ding.wav", "correct_triumph.wav", "streak.wav"];
      const sfxCandidates = [
        path.join(this.repository.rootDirectory, "templates", "sfx"),
        path.join(this.repository.rootDirectory, "assets", "audio", "sfx"),
        path.resolve("templates", "sfx"),
        path.resolve("assets", "audio", "sfx"),
      ];
      await Promise.all(sfxFiles.map(async (file) => {
        for (const candidateDir of sfxCandidates) {
          const candidateFile = path.join(candidateDir, file);
          try {
            await copyFile(candidateFile, path.join(sfxTargetDir, file));
            break;
          } catch {
            // try next candidate
          }
        }
      }));
      const bgmTargetDir = path.join(renderRoot, "bgm");
      await mkdir(bgmTargetDir, { recursive: true });
      const bgmCandidates = [
        path.join(this.repository.rootDirectory, "assets", "audio", "bgm", "tracks"),
        path.resolve("assets", "audio", "bgm", "tracks"),
        path.join(this.repository.rootDirectory, "assets", "audio", "bgm"),
        path.resolve("assets", "audio", "bgm"),
      ];
      for (const candidateDir of bgmCandidates) {
        try {
          const entries = await readdir(candidateDir);
          const mp3s = entries.filter((entry) => entry.endsWith(".mp3"));
          if (mp3s.length > 0) {
            await Promise.all(mp3s.map((entry) => copyFile(path.join(candidateDir, entry), path.join(bgmTargetDir, entry))));
            break;
          }
        } catch {
          // try next candidate
        }
      }
      const fontTargetDir = path.join(renderRoot, "fonts");
      await mkdir(fontTargetDir, { recursive: true });
      const fontFiles = [
        "SVN-Hello Headline.otf",
        "Fredoka-VariableFont_wdth,wght.ttf",
        "Baloo2-VariableFont_wght.ttf",
        "Nunito-VariableFont_wght.ttf",
      ];
      const fontCandidates = [
        path.join(this.repository.rootDirectory, "assets", "fonts"),
        path.join(this.repository.rootDirectory, "templates", "fonts"),
        path.resolve("assets", "fonts"),
        path.resolve("templates", "fonts"),
        path.resolve(process.cwd(), "..", "assets", "fonts"),
        path.resolve(process.cwd(), "..", "..", "assets", "fonts"),
      ];
      await Promise.all(fontFiles.map(async (file) => {
        for (const candidateDir of fontCandidates) {
          const candidateFile = path.join(candidateDir, file);
          try {
            await copyFile(candidateFile, path.join(fontTargetDir, file));
            break;
          } catch {
            // try next candidate
          }
        }
      }));

      const sourceFingerprint = renderSourceFingerprint(html, narration.modified_at, narration.size, assetResolution?.assets ?? []);
      const checkpointPath = path.join(renderRoot, "render-checkpoint.json");
      const checkpoint = await readRenderCheckpoint(checkpointPath);
      const layoutReady = checkpoint?.source_fingerprint === sourceFingerprint && checkpoint.check.status === "passed";
      if (layoutReady) {
        await this.update(task.task_id, { progress_message: "Video · layout and media checks already passed", progress_percent: 58 });
      } else {
        await this.update(task.task_id, { progress_message: "Video · checking layout and media", progress_percent: 58 });
        let checkOutput: string = "";
        const maxCheckAttempts = 2;
        const checkTimeoutMs = Number(process.env.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS || "300000");
        const hyperframesEnv = {
          ...process.env,
          PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS: process.env.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS || "300000",
          ...(process.env.HYPERFRAMES_BROWSER_PATH ? { HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH } : {}),
        };

        for (let attempt = 1; attempt <= maxCheckAttempts; attempt++) {
          try {
            ({ stdout: checkOutput } = await execFileAsync(
              npxCommand,
              hyperframesArgs("check", renderRoot, "--json", "--samples", "5", "--timeout", String(checkTimeoutMs)),
              { cwd: this.repository.rootDirectory, timeout: 600_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024, env: hyperframesEnv }
            ));
          } catch (error) {
            const failure = error as Error & { stdout?: string };
            const errorReport = parseHyperframesCheckReport(failure.stdout);
            if (attempt < maxCheckAttempts && hasHyperframesContrastIssue(errorReport)) {
              await this.update(task.task_id, { progress_message: "Video · auto-healing contrast issues...", progress_percent: 60 });
              await healCompositionContrast(renderRoot, errorReport);
              continue;
            }
            throw new RepositoryError(formatHyperframesCheckFailure(errorReport, failure.message), "QUIZ_COMPOSITION_CHECK_FAILED");
          }

          const checkReport = parseHyperframesCheckReport(checkOutput);
          if (hasHyperframesContrastIssue(checkReport)) {
            if (attempt < maxCheckAttempts) {
              await this.update(task.task_id, { progress_message: "Video · auto-healing contrast issues...", progress_percent: 60 });
              await healCompositionContrast(renderRoot, checkReport);
              continue;
            }
            throw new RepositoryError(formatHyperframesCheckFailure(checkReport), "QUIZ_COMPOSITION_CONTRAST_FAILED");
          }

          break;
        }
        await writeRenderCheckpoint(checkpointPath, { schema_version: 2, source_fingerprint: sourceFingerprint, check: { status: "passed" } });
      }
      let reusableRender = layoutReady && checkpoint?.render?.status === "passed" && await hasNonEmptyFile(outputPath);
      if (reusableRender) {
        const existingProbe = await inspectRenderedVideo(outputPath, { width: 1920, height: 1080, fps: this.videoConfig.fps });
        reusableRender = !existingProbe.issues.some((issue) => issue.severity === "blocker");
      }
      if (reusableRender) {
        await this.update(task.task_id, { progress_message: "Video · reusing verified MP4", progress_percent: 85 });
      } else {
        await this.update(task.task_id, { progress_message: "Video · rendering MP4 with narration", progress_percent: 65 });
        const browserTimeout = process.env.HYPERFRAMES_BROWSER_TIMEOUT_SECONDS || "300";
        const renderTimeoutMs = Number(process.env.HYPERFRAMES_RENDER_TIMEOUT_MS) || (120 * 60_000);
        const hyperframesEnv = {
          ...process.env,
          PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS: process.env.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS || "300000",
          PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS: process.env.PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS || "300000",
          PRODUCER_PLAYER_READY_TIMEOUT_MS: process.env.PRODUCER_PLAYER_READY_TIMEOUT_MS || "60000",
          PRODUCER_EXPERIMENTAL_FAST_CAPTURE: process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE || "true",
          ...(process.env.HYPERFRAMES_BROWSER_PATH ? { HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH } : {}),
        };
        await execFileAsync(
          npxCommand,
          hyperframesArgs(
            "render",
            renderRoot,
            "--output",
            outputPath,
            "--fps",
            String(this.videoConfig.fps),
            "--quality",
            this.videoConfig.render_quality,
            "--browser-timeout",
            browserTimeout,
            "--strict",
            "--json"
          ),
          {
            cwd: this.repository.rootDirectory,
            timeout: renderTimeoutMs,
            windowsHide: true,
            maxBuffer: 50 * 1024 * 1024,
            env: hyperframesEnv,
          }
        );
      }
      await this.update(task.task_id, { progress_message: "Video · verifying MP4 and audio track", progress_percent: 95 });
      const probe = await inspectRenderedVideo(outputPath, { width: 1920, height: 1080, fps: this.videoConfig.fps });
      const renderBlocker = probe.issues.find((issue) => issue.severity === "blocker");
      if (renderBlocker) throw new RepositoryError(renderBlocker.message, "QUIZ_RENDER_QA_FAILED");
      await writeRenderCheckpoint(checkpointPath, { schema_version: 2, source_fingerprint: sourceFingerprint, check: { status: "passed" }, render: { status: "passed" } });
      const duration = Number.parseFloat(probe.probe.format?.duration ?? "");
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Rendered MP4 has no readable duration");
      const degradedAssets = (assetResolution?.assets ?? []).filter((a) => a.degraded || a.fallback_tier === 3 || a.source === "fallback");
      const hasDegradedFallback = degradedAssets.length > 0;
      const bgmMatch = html.match(/src=["']\.\/bgm\/([^"']+)["']/);
      const selectedBgmFilename = bgmMatch ? bgmMatch[1] : null;
      const selectedBgmTrackId = selectedBgmFilename ? selectedBgmFilename.replace(/\.mp3$/i, "") : null;
      const manifestPath = await this.repository.writeRenderManifest(task.channel_id, task.episode_id, JSON.stringify({
        engine: "hyperframes",
        quiz_engine_version: completeQuizV2 ? 2 : 1,
        schema_version: completeQuizV2 ? 2 : 1,
        composition: "runtime/hyperframes/" + episode.episode_id + "/index.html",
        source_fingerprints: {},
        question_count: episode.quiz_config.question_count,
        format: episode.quiz_config.quiz_format,
        duration_seconds: Number(duration.toFixed(3)),
        resolution: { width: 1920, height: 1080 },
        fps: this.videoConfig.fps,
        bgm_track_id: selectedBgmTrackId ?? undefined,
        bgm_filename: selectedBgmFilename ?? undefined,
        degraded: hasDegradedFallback,
        fallback_tier: hasDegradedFallback ? 3 : undefined,
        degraded_assets: hasDegradedFallback ? degradedAssets.map((a) => a.asset_id) : undefined,
        preflight: preflightAssessment ? { status: "passed", score: preflightAssessment.score, blockers: preflightAssessment.issues.filter((issue) => issue.severity === "blocker").length } : { status: "legacy_skipped" },
        check: { status: "passed" },
        render: { status: "passed", output: "quiz-video.mp4" },
        post_render: { status: "passed", issues: probe.issues.length, streams: probe.probe.streams?.map((stream) => ({ codec_type: stream.codec_type, width: stream.width, height: stream.height, r_frame_rate: stream.r_frame_rate })) ?? [] },
        generated_at: nowIso(),
      }));
      const videoPath = await this.repository.writeVideoArtifact(task.channel_id, task.episode_id, await readFile(outputPath));
      await this.repository.saveVideoMetadata(task.channel_id, task.episode_id, videoPath, Number(duration.toFixed(3)), manifestPath);
      if (completeQuizV2?.quiz && completeQuizV2.quiz.questions.length > 0) {
        try {
          await this.repository.appendQuestionHistory(task.channel_id, task.episode_id, completeQuizV2.quiz.questions);
        } catch {
          // Ignore non-fatal question history save error
        }
      }
      if (selectedBgmTrackId && selectedBgmFilename) {
        try {
          await this.repository.appendBgmHistory(task.channel_id, task.episode_id, selectedBgmTrackId, selectedBgmFilename);
        } catch {
          // Ignore non-fatal BGM history save error
        }
      }
      await this.update(task.task_id, { progress_message: "Quiz video ready", progress_percent: 100 });
      await this.finish(task.task_id, "COMPLETED", null, [videoPath, manifestPath]);
      this.logger.ok("Quiz video rendered", { ...context, step: "render_video" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video render failed";
      await this.finish(task.task_id, "FAILED", message);
      this.logger.error(message, context);
    }
  }

  private async hasReadyArtifact(channelId: string, episodeId: string, filename: string): Promise<boolean> {
    const file = await this.repository.getEpisodeFile(channelId, episodeId, filename);
    if (isPlaceholderArtifact(file.content)) return false;
    if (filename !== "visual_bible.md") return true;
    const channel = await this.repository.getChannel(channelId);
    const treatment = await this.repository.getEpisodeFile(channelId, episodeId, "treatment.md");
    const requiredBundles = channel.engine === "quiz"
      ? extractArtifactSectionNumbers(treatment.content, "question").length > 0
        ? Array.from({ length: (await this.repository.getEpisode(channelId, episodeId)).quiz_config.question_count }, (_, index) => index + 1)
        : []
      : extractArtifactSectionNumbers(treatment.content, "sequence");
    if (requiredBundles.length === 0) return true;
    try {
      if (channel.engine === "quiz") validateQuizVisualBible(file.content, requiredBundles);
      else validateVisualBible(file.content, requiredBundles);
      return true;
    } catch {
      return false;
    }
  }

  private async generatePipelineBundleImages(task: Task, run: PipelineRun): Promise<void> {
    if (!this.imageConfig.enabled) return;
    const visualBible = await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "visual_bible.md");
    const bundles = parseContinuityBundles(visualBible.content);
    if (bundles.length === 0) return;

    const existing = await this.repository.listBundleImages(task.channel_id, task.episode_id!);
    const reusableImages = new Set<string>();
    for (const image of existing) if (await isValidPngFile(image.absolutePath)) reusableImages.add(`${image.bundle_id}:${image.variant}`);
    const missing = bundles.flatMap((bundle) => Array.from({ length: this.imageConfig.images_per_bundle }, (_, variant) => ({ bundle, variant })))
      .filter(({ bundle, variant }) => !reusableImages.has(`${bundle.bundle_id}:${variant}`));
    if (missing.length === 0) {
      await this.update(task.task_id, { progress_message: "Style anchors · already ready", progress_percent: 28 });
      return;
    }

    await this.update(task.task_id, { progress_message: `Style anchors · generating ${missing.length} continuity image${missing.length === 1 ? "" : "s"}`, progress_percent: 28 });
    const children = missing.map(({ bundle, variant }) => this.submit("GENERATE_BUNDLE_IMAGE", task.channel_id, task.episode_id!, bundle.bundle_number, variant));
    children.forEach((child) => run.children.add(child.task_id));
    try {
      for (const [index, child] of children.entries()) {
        const completed = await this.waitForTaskTerminal(child.task_id, run);
        if (completed.status !== "COMPLETED") throw new Error(`Style anchor ${index + 1}/${children.length} failed: ${completed.error ?? completed.status}`);
        await this.update(task.task_id, { progress_message: `Style anchors · ${index + 1}/${children.length} ready`, progress_percent: 28 + Math.round(((index + 1) / children.length) * 6) });
      }
    } catch (error) {
      await Promise.all(children.filter((child) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(this.get(child.task_id).status)).map((child) => this.cancel(child.task_id).catch(() => undefined)));
      throw error;
    } finally {
      children.forEach((child) => run.children.delete(child.task_id));
    }
  }

  private async runQuizV2Pipeline(task: Task): Promise<void> {
    const input = {
      repository: this.repository,
      config: { audio_generation: this.audioConfig, image_generation: this.imageConfig },
      channelId: task.channel_id,
      episodeId: task.episode_id!,
      activeEngine: this.activeEngine,
      antigravityClient: this.antigravity,
      onAssetProgress: async ({ completed, total, reused }: { completed: number; total: number; reused: boolean }) => {
        await this.update(task.task_id, { progress_message: `Quiz · resolving assets ${completed}/${total}${reused ? " · reused" : ""}`, progress_percent: 36 + Math.round((completed / Math.max(1, total)) * 9) });
      },
      onVoiceProgress: async ({ completed, total, reused }: { completed: number; total: number; reused: boolean }) => {
        await this.update(task.task_id, { progress_message: `Quiz · ${reused ? "reusing" : "generating"} voice ${completed}/${total}`, progress_percent: 46 + Math.round((completed / Math.max(1, total)) * 7) });
      },
      onVoicePacingClamp: (details: QuizVoicePacingClamp) => {
        this.logger.warn(`Quiz voice pacing clamp hit ${JSON.stringify(details)}`, { profileId: task.channel_id, workerId: task.task_id, step: "voice_pacing_clamp" });
      },
    };
    let artifacts = await readQuizArtifacts(input);
    let episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
    if (!artifacts.quiz) {
      await this.update(task.task_id, { progress_message: "Quiz · locking question facts", progress_percent: 33 });
      await generateQuiz(input);
      artifacts = await readQuizArtifacts(input);
    }
    if (!artifacts.director_plan) {
      await this.update(task.task_id, { progress_message: "Quiz · directing question presentation", progress_percent: 34 });
      await generateDirector(input);
      artifacts = await readQuizArtifacts(input);
    }
    if (!artifacts.asset_plan) {
      await this.update(task.task_id, { progress_message: "Quiz · planning semantic assets", progress_percent: 35 });
      await planAssets(input);
      artifacts = await readQuizArtifacts(input);
    }
    if (!artifacts.asset_resolution || !artifacts.asset_plan || !(await isQuizAssetResolutionComplete({ repository: this.repository, channelId: task.channel_id, episodeId: task.episode_id!, plan: artifacts.asset_plan, resolution: artifacts.asset_resolution, activeEngine: this.activeEngine }))) {
      await this.update(task.task_id, { progress_message: "Quiz · resolving semantic assets", progress_percent: 36 });
      await resolveAssets(input);
      artifacts = await readQuizArtifacts(input);
    }
    const voicePaceNeedsRegeneration = artifacts.quiz
      ? quizVoicePlanNeedsRegeneration({
        voicePlan: artifacts.voice_plan,
        ageBand: artifacts.quiz.age_band,
        assessmentIssueCodes: artifacts.assessment?.issues.map((issue) => issue.code),
      })
      : false;
    if (!artifacts.voice_plan || voicePaceNeedsRegeneration || !(await this.hasValidNarrationAsset(task.channel_id, task.episode_id!, episode.narration_asset_path)) || artifacts.voice_plan.segments.some((segment) => segment.duration_seconds === null)) {
      await this.update(task.task_id, { progress_message: "Quiz · generating per-question voice", progress_percent: 46 });
      await generateVoice(input);
      artifacts = await readQuizArtifacts(input);
      episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
    }
    if (!artifacts.timeline) {
      await this.update(task.task_id, { progress_message: "Quiz · compiling deterministic timeline", progress_percent: 53 });
      await compileTimeline(input);
      artifacts = await readQuizArtifacts(input);
    }
    const maxHealingCycles = 3;
    for (let cycle = 1; cycle <= maxHealingCycles; cycle++) {
      if (!artifacts.assessment) {
        await this.update(task.task_id, { progress_message: "Quiz · running pre-render QA", progress_percent: 54 });
        await runQa(input);
        artifacts = await readQuizArtifacts(input);
      }
      const blockers = artifacts.assessment?.issues.filter((issue) => issue.severity === "blocker") ?? [];
      if (blockers.length === 0) {
        break;
      }

      const hasUnresolvedAssetBlockers = blockers.some((issue) => issue.code === "asset_required_unresolved" || issue.code === "asset_generation_failed");
      const hasVoicePaceBlockers = blockers.some((issue) => issue.code === "voice_pace_unsafe" || issue.code === "voice_pace_fast");

      if (cycle < maxHealingCycles && (hasUnresolvedAssetBlockers || hasVoicePaceBlockers)) {
        if (hasUnresolvedAssetBlockers) {
          this.logger.warn(`Auto-healing unresolved visual assets (attempt ${cycle}/${maxHealingCycles})...`, { profileId: task.channel_id, workerId: task.task_id, step: "auto_heal_assets" });
          await this.update(task.task_id, { progress_message: `Quiz · auto-retrying unresolved assets (${cycle}/${maxHealingCycles})`, progress_percent: 80 });
          await resolveAssets(input);
          await this.repository.invalidateQuizArtifacts(task.channel_id, task.episode_id!, ["assessment"]);
          artifacts = await readQuizArtifacts(input);
        }

        if (hasVoicePaceBlockers && artifacts.quiz && artifacts.voice_plan) {
          this.logger.warn(`Auto-healing voice pacing with LLM (attempt ${cycle}/${maxHealingCycles})...`, { profileId: task.channel_id, workerId: task.task_id, step: "auto_heal_voice" });
          await this.update(task.task_id, { progress_message: `Quiz · auto-adjusting voice pacing with AI (${cycle}/${maxHealingCycles})`, progress_percent: 84 });
          const client = this.antigravity ?? (this.activeEngine === "codex" ? this.codex : undefined);
          const healResult = await healQuizVoicePacingWithLLM({
            voicePlan: artifacts.voice_plan,
            ageBand: artifacts.quiz.age_band,
            targetWordsPerSecond: quizVoiceTargetWordsPerSecond(artifacts.quiz.age_band),
            client,
            logger: this.logger,
            channelId: task.channel_id,
            episodeId: task.episode_id!,
          });
          if (healResult.healed) {
            await this.repository.writeVoicePlan(task.channel_id, task.episode_id!, healResult.voicePlan);
            await this.repository.invalidateQuizArtifacts(task.channel_id, task.episode_id!, ["timeline", "assessment"]);
            await generateVoice(input);
            artifacts = await readQuizArtifacts(input);
            episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
          }
        }

        await runQa(input);
        artifacts = await readQuizArtifacts(input);
        continue;
      }

      const blocker = blockers[0]!;
      throw new RepositoryError(`Quiz V2 QA blocked production: ${blocker.message}`, "QUIZ_QA_BLOCKED");
    }
  }

  private async attachPipelineBundleImages(channelId: string, episodeId: string): Promise<void> {
    const images = await this.repository.listBundleImages(channelId, episodeId);
    for (const image of images) await this.repository.attachBundleReference(channelId, episodeId, image.bundle_id, image.path);
  }

  private async hasReadyScript(channelId: string, episodeId: string): Promise<boolean> {
    const file = await this.repository.getEpisodeFile(channelId, episodeId, "script.md");
    if (isPlaceholderArtifact(file.content) || !hasHumorPolicyMarker(file.content)) return false;
    const treatment = await this.repository.getEpisodeFile(channelId, episodeId, "treatment.md");
    const expectedSequences = extractArtifactSectionNumbers(treatment.content, "sequence");
    const actualSequences = extractArtifactSectionNumbers(file.content, "sequence");
    return expectedSequences.length === 0 || actualSequences.length === 0 || missingArtifactSectionNumbers(file.content, expectedSequences, "sequence").length === 0;
  }

  private async hasValidNarrationAsset(channelId: string, episodeId: string, assetPath: string | null): Promise<boolean> {
    if (!assetPath) return false;
    try {
      const audio = await this.repository.getEpisodeAudioFile(channelId, episodeId, path.basename(assetPath));
      return parseWavDuration(new Uint8Array(await readFile(audio.absolutePath))) > 0;
    } catch {
      return false;
    }
  }

  private async isShotPlanFresh(channelId: string, episodeId: string): Promise<boolean> {
    const [script, scenePlan] = await Promise.all([
      this.repository.getEpisodeFile(channelId, episodeId, "script.md"),
      this.repository.getEpisodeFile(channelId, episodeId, "scene_plan.md"),
    ]);
    if (!script.modified_at || !scenePlan.modified_at) return false;
    return Date.parse(scenePlan.modified_at) >= Date.parse(script.modified_at);
  }

  private async waitForTaskTerminal(taskId: string, run: PipelineRun): Promise<Task> {
    while (true) {
      if (run.cancelled) throw new Error("Pipeline cancelled");
      const task = this.get(taskId);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return task;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  private async runAudioTask(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_audio" };
    this.activeAudio.add(task.task_id);
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing audio", progress_percent: 0 });
      if (!task.episode_id) throw new RepositoryError("Episode is required", "EPISODE_REQUIRED");
      if (task.task_type === "GENERATE_NARRATION") {
        const channel = await this.repository.getChannel(task.channel_id);
        if (channel.engine === "quiz") throw new RepositoryError("Quiz channels use Quiz V2 voice generation", "QUIZ_V2_REQUIRED");
        await this.runNarrationTask(task);
        return;
      }
      const sceneNumber = this.findSceneNumber(task.task_id);
      if (!sceneNumber) throw new RepositoryError("Audio scene is required", "SCENE_REQUIRED");
      const scenes = await this.repository.readScenes(task.channel_id, task.episode_id);
      const scene = scenes.find((item) => item.scene_number === sceneNumber);
      if (!scene) throw new RepositoryError("Audio target scene not found", "SCENE_NOT_FOUND");
      const channel = await this.repository.getChannel(task.channel_id);
      const voice = channel.voice_reference_path ? this.repository.resolveContextPath(channel.voice_reference_path) : "default";
      await this.update(task.task_id, { progress_message: "Synthesizing dialogue", progress_percent: 25 });
      const provider = this.audioProviderFactory({ channelId: task.channel_id, episodeId: task.episode_id, sceneNumber }, this.audioConfig);
      const result = await provider.generateDialogue(scene.dialogue, voice);
      if (this.get(task.task_id).status === "CANCELLED") return;
      const audioFile = await this.repository.getSceneAudioFile(task.channel_id, task.episode_id, path.basename(result.asset_path));
      const audioBuffer = await readFile(audioFile.absolutePath);
      await this.repository.saveSceneAudio(task.channel_id, task.episode_id, sceneNumber, result.asset_path, parseWavDuration(audioBuffer));
      await this.update(task.task_id, { progress_message: "Saving dialogue", progress_percent: 90 });
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

  private async runNarrationTask(task: Task): Promise<void> {
    if (!task.episode_id) throw new RepositoryError("Episode is required", "EPISODE_REQUIRED");
    const episodeId = task.episode_id;
    const channelId = task.channel_id;
    const script = await this.repository.getEpisodeFile(channelId, episodeId, "script.md");
    const sections = extractNarrationChunks(script.content, 60, true).filter((section) => countWords(section.text) >= 3);
    if (sections.length === 0) throw new RepositoryError("A completed script is required before narration", "SCRIPT_REQUIRED");
    const channel = await this.repository.getChannel(channelId);
    const episode = await this.repository.getEpisode(channelId, episodeId);
    const voice = channel.voice_reference_path ? this.repository.resolveContextPath(channel.voice_reference_path) : "default";
    const checkpointPath = this.repository.resolvePath("runtime", "narration-checkpoints", episodeId, "segments.json");
    const checkpoint = await readNarrationCheckpoint(checkpointPath);
    const nextCheckpoint: NarrationCheckpoint = { schema_version: 1, script_modified_at: script.modified_at, segments: {} };
    const segmentPaths: string[] = [];
    const concurrency = Math.max(1, Math.min(3, this.audioConfig.max_concurrent_tasks || 2));
    let completed = 0;
    const segmentResults = await runConcurrent(sections, concurrency, async (section, index) => {
      const segmentNumber = index + 1;
      const fingerprint = narrationSegmentFingerprint(section.text, voice, script.modified_at, this.audioConfig, this.videoConfig.narration_words_per_second);
      let audio: Uint8Array | null = null;
      let assetPath: string | null = null;
      let isReused = false;
      const saved = checkpoint?.script_modified_at === script.modified_at ? checkpoint.segments[String(segmentNumber)] : undefined;
      if (saved?.fingerprint === fingerprint) {
        try {
          const existing = await this.repository.getEpisodeAudioFile(channelId, episodeId, path.basename(saved.asset_path));
          const existingAudio = new Uint8Array(await readFile(existing.absolutePath));
          const existingDuration = parseWavDuration(existingAudio);
          validateNarrationSegmentDuration(existingDuration, section.text, this.videoConfig.narration_words_per_second, segmentNumber);
          audio = existingAudio;
          assetPath = existing.path;
          isReused = true;
        } catch {
          // A checkpoint is advisory; missing, stale, or corrupt audio is regenerated below.
        }
      }
      if (!audio || !assetPath) {
        audio = await synthesizeWav(this.audioConfig, section.text, voice);
        const audioDuration = parseWavDuration(audio);
        validateNarrationSegmentDuration(audioDuration, section.text, this.videoConfig.narration_words_per_second, segmentNumber);
        assetPath = await this.repository.writeNarrationAudio(channelId, episodeId, audio, segmentNumber);
      }
      completed++;
      await this.update(task.task_id, {
        progress_message: `Narration · ${isReused ? "reusing" : "generating"} ${section.title} (${completed}/${sections.length})`,
        progress_percent: Math.round((completed / sections.length) * 78),
      });
      const audioDuration = parseWavDuration(audio);
      const audioFile = await this.repository.getEpisodeAudioFile(channelId, episodeId, path.basename(assetPath));
      return {
        segmentNumber,
        fingerprint,
        assetPath,
        durationSeconds: audioDuration,
        absolutePath: audioFile.absolutePath,
      };
    });

    for (const result of segmentResults) {
      nextCheckpoint.segments[String(result.segmentNumber)] = {
        fingerprint: result.fingerprint,
        asset_path: result.assetPath,
        duration_seconds: result.durationSeconds,
      };
      segmentPaths.push(result.absolutePath);
    }
    await writeNarrationCheckpoint(checkpointPath, nextCheckpoint);
    await this.update(task.task_id, { progress_message: "Assembling narration", progress_percent: 82 });
    const merged = sections.length === 1 && !this.audioConfig.match_target_duration
      ? await readFile(segmentPaths[0])
      : await this.mergeNarrationSegments(segmentPaths, this.audioConfig.match_target_duration ? episode.target_duration_minutes * 60 : undefined);
    const assetPath = await this.repository.writeNarrationAudio(channelId, episodeId, merged);
    const duration = parseWavDuration(merged);
    const narrationWordCount = countWords(extractNarration(script.content));
    await this.repository.saveNarrationMetadata(channelId, episodeId, assetPath, duration, sections.length, narrationWordCount);
    await this.update(task.task_id, { progress_message: "Narration ready", progress_percent: 100 });
    await this.finish(task.task_id, "COMPLETED", null, [assetPath]);
  }

  private async mergeNarrationSegments(paths: string[], targetDurationSeconds?: number): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(`${this.audioConfig.service_url.replace(/\/$/, "")}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths, gap_ms: this.audioConfig.merge_gap_ms, ...(targetDurationSeconds ? { target_duration_seconds: targetDurationSeconds } : {}) }),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
    } catch {
      throw new RepositoryError("Audio service unavailable", "AUDIO_SERVICE_UNAVAILABLE");
    }
    if (!response.ok) throw new RepositoryError("Narration assembly failed", "AUDIO_MERGE_FAILED");
    return new Uint8Array(await response.arrayBuffer());
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    const threadId = typeof params.threadId === "string" ? params.threadId : typeof (params.turn as { threadId?: unknown } | undefined)?.threadId === "string" ? (params.turn as { threadId: string }).threadId : null;
    const turnId = typeof params.turnId === "string" ? params.turnId : typeof (params.turn as { id?: unknown } | undefined)?.id === "string" ? (params.turn as { id: string }).id : null;
    const active = [...this.active.values()].find((run) => (threadId ? run.threadId === threadId : true) && (!run.turnId || !turnId || run.turnId === turnId));
    if (!active) return;
    if (turnId && !active.turnId) active.turnId = turnId;
    if (method === "item/agentMessage/delta") {
      const delta = typeof params.delta === "string" ? params.delta : params.delta && typeof params.delta === "object" ? JSON.stringify(params.delta) : "";
      active.output += delta;
      void this.update(active.task.task_id, { progress_message: "Receiving output" });
    } else if (active.task.task_type === "GENERATE_BUNDLE_IMAGE" && /^item\/(?:image|file|media|attachment|output)/i.test(method)) {
      const media = JSON.stringify(params);
      if (/(?:data:image|b64_json|base64|\.(?:png|jpe?g|webp)\b)/i.test(media)) {
        active.output += media;
        void this.update(active.task.task_id, { progress_message: "Receiving image output" });
      }
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
      const channel = await this.repository.getChannel(task.channel_id);
      const isQuiz = channel.engine === "quiz";
      let outputFiles: string[] = [];
      if (task.task_type === "GENERATE_DNA") {
        await this.repository.saveChannelDna(task.channel_id, extractMarkdown(output, "# Channel DNA"));
        outputFiles = [`channels/${(await this.repository.getChannel(task.channel_id)).slug}/channel_dna.md`];
      } else if (task.task_type === "SUGGEST_TOPICS") {
        const topicHint = this.topicHints.get(task.task_id);
        const candidates = parseTopicCandidates(output, task.channel_id, topicHint);
        await this.repository.saveTopicRun(task.channel_id, candidates);
        outputFiles = [`channels/${(await this.repository.getChannel(task.channel_id)).slug}/topics/`];
      } else if (task.task_type === "GENERATE_RESEARCH") {
        const research = extractMarkdown(output, "# Research Dossier");
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        if (isQuiz) validateQuizResearch(research, episode.quiz_config.question_count); else validateResearch(research);
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "research.md", research);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "RESEARCH_READY");
        outputFiles = [(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "research.md")).path];
      } else if (task.task_type === "GENERATE_TREATMENT") {
        const treatment = extractMarkdown(output, "# Documentary Treatment");
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        if (isQuiz) validateQuizTreatment(treatment, episode.quiz_config.question_count); else validateTreatment(treatment);
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "treatment.md", treatment);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "TREATMENT_READY");
        outputFiles = [(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "treatment.md")).path];
      } else if (task.task_type === "GENERATE_SCRIPT") {
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const script = extractScriptMarkdown(output, episode.topic.title);
        if (isQuiz) validateQuizScript(script, episode.quiz_config.question_count); else validateScript(script, calibratedScriptTargetWords(episode, this.videoConfig.narration_words_per_second));
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "script.md", script);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "SCRIPT_READY");
        outputFiles = [`${(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "script.md")).path}`];
      } else if (task.task_type === "GENERATE_VISUAL_BIBLE") {
        const visualBible = extractMarkdown(output, "# Episode Visual Bible");
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const treatment = await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "treatment.md");
        const requiredSections = isQuiz
          ? Array.from({ length: episode.quiz_config.question_count }, (_, index) => index + 1)
          : extractArtifactSectionNumbers(treatment.content, "sequence");
        if (isQuiz) validateQuizVisualBible(visualBible, requiredSections); else validateVisualBible(visualBible, requiredSections);
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "visual_bible.md", visualBible);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "VISUAL_BIBLE_READY");
        outputFiles = [(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "visual_bible.md")).path];
      } else if (task.task_type === "GENERATE_BUNDLE_IMAGE") {
        if (!this.imageConfig.enabled) throw new Error("Image generation is disabled in Settings");
        const bundleNumber = this.findSceneNumber(task.task_id);
        if (!bundleNumber) throw new Error("Bundle number is required");
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const imageTarget = {
          channelId: task.channel_id,
          episodeId: task.episode_id!,
          bundleNumber,
          variant: this.imageVariants.get(task.task_id) ?? 0,
          theme: episode.quiz_config?.visual_theme,
        };
        const visualBible = await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "visual_bible.md").catch(() => null);
        let promptToUse = active.manifest.prompt;
        if (visualBible?.content) {
          const bundles = parseContinuityBundles(visualBible.content);
          const bundle = bundles.find((b) => b.bundle_number === bundleNumber);
          if (bundle?.anchor_prompt) {
            promptToUse = bundle.anchor_prompt;
          }
        }
        const { image } = await this.generateBundleImageWithSafetyRetry(
          task,
          imageTarget,
          promptToUse,
          undefined,
          output,
          visualBible?.content,
        );
        const bundleId = `CB-${String(bundleNumber).padStart(2, "0")}`;
        await this.repository.attachBundleReference(task.channel_id, task.episode_id!, bundleId, image.asset_path);
        outputFiles = [image.asset_path];
      } else if (task.task_type === "GENERATE_SEQUENCE_SCENES") {
        const sequenceNumber = this.findSceneNumber(task.task_id);
        if (!sequenceNumber) throw new Error("Sequence number is required");
        const parsedBeats = parseBeatsOutput(output);
        const beats = isQuiz
          ? normalizeQuizBeatMetadata(parsedBeats)
          : parsedBeats.map((beat) => {
              if (beat.source_ids.length === 0 && beat.asset_type !== "transition") {
                return { ...beat, source_ids: [`C${String(sequenceNumber).padStart(2, "0")}`] };
              }
              return beat;
            });
        validateBeatOutput(beats, 1, isQuiz);
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const script = await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "script.md");
        const scriptSections = extractNarrationSections(script.content);
        const section = scriptSections[sequenceNumber - 1];
        if (!section) throw new Error(`Script sequence ${sequenceNumber} was not found`);
        validateNarrationCoverage(section.text, beats, 0.975);
        const scenes = optimizeShortScenes(packBeatsIntoScenes(beats, this.videoConfig.max_scene_duration_seconds, episode.measured_narration_words_per_second ?? this.videoConfig.narration_words_per_second, task.episode_id!), this.videoConfig.max_scene_duration_seconds, task.episode_id!);
        await this.repository.saveSequenceDraft(task.episode_id!, sequenceNumber, scenes);
        outputFiles = [`.documentary-studio/shot-drafts/${task.episode_id}/sequence-${String(sequenceNumber).padStart(2, "0")}.json`];
        if (!this.assemblingEpisodes.has(task.episode_id!)) {
          const drafts = await this.repository.readSequenceDrafts(task.episode_id!);
          if (drafts.length === scriptSections.length && !this.assemblingEpisodes.has(task.episode_id!)) {
            this.assemblingEpisodes.add(task.episode_id!);
            try {
              if (await this.repository.commitSequenceDrafts(task.channel_id, task.episode_id!, scriptSections.length)) {
                const channel = await this.repository.getChannel(task.channel_id);
                outputFiles = [`channels/${channel.slug}/episodes/${episode.slug}/scene_plan.md`];
              }
            } finally { this.assemblingEpisodes.delete(task.episode_id!); }
          }
        }
      } else if (task.task_type === "GENERATE_SCENES") {
        const parsedBeats = parseBeatsOutput(output);
        const beats = isQuiz
          ? normalizeQuizBeatMetadata(parsedBeats)
          : parsedBeats.map((beat, idx) => {
              if (beat.source_ids.length === 0 && beat.asset_type !== "transition") {
                const seqMatch = beat.sequence_id.match(/\d+/);
                const seqNum = seqMatch ? Number(seqMatch[0]) : idx + 1;
                return { ...beat, source_ids: [`C${String(seqNum).padStart(2, "0")}`] };
              }
              return beat;
            });
        validateBeatOutput(beats, 5, isQuiz);
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const script = await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "script.md");
        validateNarrationCoverage(script.content, beats, 0.975);
        const scenes = optimizeShortScenes(packBeatsIntoScenes(
          beats,
          this.videoConfig.max_scene_duration_seconds,
          episode.measured_narration_words_per_second ?? this.videoConfig.narration_words_per_second,
          task.episode_id!,
        ), this.videoConfig.max_scene_duration_seconds, task.episode_id!);
        await this.repository.saveScenes(task.channel_id, task.episode_id!, scenes);
        const persistedEpisode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const channel = await this.repository.getChannel(task.channel_id);
        outputFiles = [
          `channels/${channel.slug}/episodes/${persistedEpisode.slug}/scene_plan.md`,
          `channels/${channel.slug}/episodes/${persistedEpisode.slug}/dialogue_script.md`,
          `channels/${channel.slug}/episodes/${persistedEpisode.slug}/video_prompts.md`,
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
      const isAgy = this.activeEngine === "antigravity";
      const cleanupCfg = isAgy ? this.antigravityCleanupConfig : this.codexCleanupConfig;
      if (cleanupCfg.auto_delete_threads) void this.tryDeleteThread(active.threadId, isAgy ? "antigravity" : "codex");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not persist Codex output";
      if (active.task.task_type === "GENERATE_RESEARCH" && active.researchAttempts < 1 && message.startsWith("Quiz research quality gate failed")) {
        try {
          await this.retryQuizResearch(active, message);
          return;
        } catch (retryError) {
          await this.finish(active.task.task_id, "FAILED", retryError instanceof Error ? retryError.message : message);
          return;
        }
      }
      if (active.task.task_type === "GENERATE_SCRIPT" && active.scriptAttempts < 1 && (message.startsWith("Script quality gate failed") || message.startsWith("Quiz script quality gate failed"))) {
        try {
          await this.retryScript(active, message);
          return;
        } catch (retryError) {
          await this.finish(active.task.task_id, "FAILED", retryError instanceof Error ? retryError.message : message);
          return;
        }
      }
      if (active.task.task_type === "GENERATE_VISUAL_BIBLE" && active.visualBibleAttempts < 1 && (message.startsWith("Visual bible quality gate failed") || message.startsWith("Quiz visual bible quality gate failed"))) {
        try {
          await this.retryVisualBible(active, message);
          return;
        } catch (retryError) {
          await this.finish(active.task.task_id, "FAILED", retryError instanceof Error ? retryError.message : message);
          return;
        }
      }
      if (active.task.task_type === "GENERATE_SEQUENCE_SCENES" && active.sequenceAttempts < 2 && isSequenceOutputFailure(message)) {
        try {
          await this.retrySequenceScenes(active, message);
          return;
        } catch (retryError) {
          await this.finish(active.task.task_id, "FAILED", retryError instanceof Error ? retryError.message : message);
          return;
        }
      }
      await this.finish(active.task.task_id, "FAILED", message);
    }
  }

  private async retryQuizResearch(active: ActiveRun, reason: string): Promise<void> {
    const episode = await this.repository.getEpisode(active.task.channel_id, active.task.episode_id!);
    const questionCount = episode.quiz_config.question_count;
    const lastClaimId = `C${String(questionCount).padStart(2, "0")}`;
    const sourceMinimum = Math.max(3, Math.ceil(questionCount / 2));
    const previousThreadId = active.threadId;
    const client = this.activeEngine === "antigravity" && this.antigravity ? this.antigravity : this.codex;
    const threadId = await client.startThread();
    const turnId = await client.startTurn(threadId, `${active.manifest.prompt}\n\nSTRICT RETRY: The previous Quiz Research response failed validation (${reason}). Start over in a fresh response. The episode has exactly ${questionCount} questions. Return a complete Markdown quiz research dossier with exactly one ledger entry per question and exactly one unique claim ID for each question: C01, C02, ... ${lastClaimId}. Include every ID in order; do not stop at an earlier ID, reuse an ID, or count a source URL as a claim. Every entry must include the question number, canonical answer, child-friendly explanation, direct authoritative URL(s), and ambiguity or safety note. Include at least ${sourceMinimum} distinct direct authoritative URLs. Silently verify the full C01–${lastClaimId} sequence and all ${questionCount} question entries before returning. Return only the dossier, with no planning notes, reasoning, JSON, or explanation outside the Markdown document.`);
    active.threadId = threadId;
    active.turnId = turnId;
    active.output = "";
    active.researchAttempts += 1;
    await this.update(active.task.task_id, { codex_thread_id: threadId, codex_turn_id: turnId, progress_message: "Retrying research with complete claim ledger" });
    if (previousThreadId !== threadId && this.isSessionCleanupEnabled()) void client.deleteThread(previousThreadId).catch(() => undefined);
  }

  private async retryScript(active: ActiveRun, reason: string): Promise<void> {
    const episode = await this.repository.getEpisode(active.task.channel_id, active.task.episode_id!);
    const targetWords = calibratedScriptTargetWords(episode, this.videoConfig.narration_words_per_second);
    const bounds = scriptWordBounds(targetWords);
    const previousThreadId = active.threadId;
    const client = this.activeEngine === "antigravity" && this.antigravity ? this.antigravity : this.codex;
    const threadId = await client.startThread();
    const turnId = await client.startTurn(threadId, `${active.manifest.prompt}\n\nSTRICT RETRY: The previous response failed validation (${reason}). Start over in a fresh response. Return only one Markdown narration script, with no planning, reasoning, research dossier, treatment, tool output, JSON, or explanation. Keep spoken narration between ${bounds.lower} and ${bounds.upper} words for the ${episode.target_duration_minutes}-minute target; aim for approximately ${targetWords} words. Do not echo any scoped files. Preserve the HUMOR_POLICY marker and restrained AUDIO_CUE comments.`);
    active.threadId = threadId;
    active.turnId = turnId;
    active.output = "";
    active.scriptAttempts += 1;
    await this.update(active.task.task_id, { codex_thread_id: threadId, codex_turn_id: turnId, progress_message: active.task.task_type === "GENERATE_SCRIPT" && reason.startsWith("Quiz script quality gate failed") ? "Retrying quiz script with strict question format" : "Retrying script with strict word budget" });
    if (previousThreadId !== threadId && this.isSessionCleanupEnabled()) void client.deleteThread(previousThreadId).catch(() => undefined);
  }

  private async retryVisualBible(active: ActiveRun, reason: string): Promise<void> {
    const channel = await this.repository.getChannel(active.task.channel_id);
    const episode = await this.repository.getEpisode(active.task.channel_id, active.task.episode_id!);
    const isQuiz = channel.engine === "quiz";
    const treatment = await this.repository.getEpisodeFile(active.task.channel_id, active.task.episode_id!, "treatment.md");
    const requiredBundleNumbers = isQuiz
      ? Array.from({ length: episode.quiz_config.question_count }, (_, index) => index + 1)
      : extractArtifactSectionNumbers(treatment.content, "sequence");
    const bundleRequirement = isQuiz
      ? `Create continuity bundles for every question using the exact IDs ${requiredBundleNumbers.map((number) => `CB-${String(number).padStart(2, "0")}`).join(", ")}.`
      : requiredBundleNumbers.length
        ? `Create one continuity bundle for every treatment sequence using the exact IDs ${requiredBundleNumbers.map((number) => `CB-${String(number).padStart(2, "0")}`).join(", ")}.`
        : "Include at least five stable bundles using exact second-level headings `## Continuity bundle CB-01 — Title`, `CB-02`, and so on.";
    const quizMotionRequirement = isQuiz
      ? "Include an explicit second-level section named exactly `## Safe motion` with labeled Allowed motion, Prohibited motion, and Reduced-motion fallback rules. The exact phrase `safe motion` must appear in the returned Markdown."
      : "";
    const previousThreadId = active.threadId;
    const client = this.activeEngine === "antigravity" && this.antigravity ? this.antigravity : this.codex;
    const threadId = await client.startThread();
    const turnId = await client.startTurn(threadId, `${active.manifest.prompt}\n\nSTRICT RETRY: The previous ${isQuiz ? "Quiz " : ""}Visual Bible failed validation (${reason}). Start over in a fresh response. Return only the Markdown ${isQuiz ? "Quiz " : ""}Visual Bible, with no reasoning, research, treatment, tool output, JSON, or explanation. ${bundleRequirement} Every bundle must include Era, Location, Subjects, Palette, Lighting, Anchor-frame prompt, and Reference asset slots. ${quizMotionRequirement} Do not use alternative heading names. Do not omit bundle IDs.`);
    active.threadId = threadId;
    active.turnId = turnId;
    active.output = "";
    active.visualBibleAttempts += 1;
    await this.update(active.task.task_id, { codex_thread_id: threadId, codex_turn_id: turnId, progress_message: isQuiz ? "Retrying Quiz visual bible with safe motion rules" : "Retrying visual bible with strict continuity schema" });
    if (previousThreadId !== threadId && this.isSessionCleanupEnabled()) void client.deleteThread(previousThreadId).catch(() => undefined);
  }

  private async retrySequenceScenes(active: ActiveRun, reason: string): Promise<void> {
    const channel = await this.repository.getChannel(active.task.channel_id);
    const isQuiz = channel.engine === "quiz";
    const episode = active.task.episode_id ? await this.repository.getEpisode(active.task.channel_id, active.task.episode_id).catch(() => null) : null;
    const isTrueFalse = isQuiz && episode?.quiz_config?.quiz_format === "true_false";
    const choiceRequirement = isTrueFalse
      ? "visible choices (strictly exactly 2 choices: True and False only; never add a 3rd option)"
      : "visible choices (strictly maximum 3 choices: A, B, C only; never exceed 3)";
    const sequenceNumber = active.task.scene_number ?? 1;
    const script = await this.repository.getEpisodeFile(active.task.channel_id, active.task.episode_id!, "script.md");
    const section = extractNarrationSections(script.content)[sequenceNumber - 1];
    const exactNarration = section?.text.trim() ?? "";
    const strictContract = isQuiz
      ? `Preserve every quiz field and return only a JSON array. Copy every word from the exact narration below verbatim and in order into one or more dialogue fields. Split only at natural boundaries; never paraphrase, shorten, add, or omit words. The final narration coverage must be at least 97.5%. Every beat must use a non-empty continuity_bundle_id exactly "CB-${String(sequenceNumber).padStart(2, "0")}", a non-empty continuity_note, and a distinct visual_prompt with the exact uppercase sections CAMERA, ACTION, LIGHTING, ATMOSPHERE, and CONTINUITY. Every non-intro/outro beat must repeat the same question, ${choiceRequirement}, canonical answer, and explanation for this question. Set answer to the exact text of one visible choice; do not return a bare mismatched label, invented choice, or a different answer per beat. Every beat must include complete quiz question, choices, answer, and explanation data.`
      : "Return only a JSON array. Copy every word from the exact narration below verbatim and in order into one or more dialogue fields. Split only at natural boundaries; never paraphrase, shorten, add, or omit words. The final narration coverage must be at least 97.5%. Every beat must use a non-empty continuity_bundle_id, a non-empty continuity_note, and a distinct visual_prompt with the exact uppercase sections CAMERA, ACTION, LIGHTING, ATMOSPHERE, and CONTINUITY.";
    const narrationBlock = exactNarration ? `\n\nEXACT NARRATION TO COVER VERBATIM:\n<NARRATION>\n${exactNarration}\n</NARRATION>` : "";
    const previousThreadId = active.threadId;
    const client = this.activeEngine === "antigravity" && this.antigravity ? this.antigravity : this.codex;
    const threadId = await client.startThread();
    const turnId = await client.startTurn(threadId, `${active.manifest.prompt}\n\nSTRICT RETRY: The previous ${isQuiz ? "Quiz " : ""}shot-plan response failed validation (${reason}). Start over in a fresh response. ${strictContract}${narrationBlock}\n\nDo not omit metadata, use empty strings, repeat prompts, add Markdown fences, add commentary, or return anything except the JSON array.`);
    active.threadId = threadId;
    active.turnId = turnId;
    active.output = "";
    active.sequenceAttempts += 1;
    await this.update(active.task.task_id, { codex_thread_id: threadId, codex_turn_id: turnId, progress_message: isQuiz ? "Retrying Quiz shot plan with strict continuity metadata" : "Retrying shot plan with strict structure metadata" });
    if (previousThreadId !== threadId && this.isSessionCleanupEnabled()) void client.deleteThread(previousThreadId).catch(() => undefined);
  }

  private findSceneNumber(taskId: string): number | undefined {
    return this.tasks.get(taskId)?.scene_number ?? undefined;
  }

  private async finish(taskId: string, status: TaskStatus, error: string | null, outputFiles: string[] = []): Promise<void> {
    const threadId = this.get(taskId).codex_thread_id;
    this.active.delete(taskId);
    this.completionWaiters.get(taskId)?.();
    this.completionWaiters.delete(taskId);
    await this.update(taskId, { status, error, completed_at: nowIso(), output_files: outputFiles.length ? outputFiles : this.get(taskId).output_files, progress_message: status === "COMPLETED" ? "Completed" : error ?? status, progress_percent: status === "COMPLETED" ? 100 : this.get(taskId).progress_percent });
    this.imageVariants.delete(taskId);
    this.topicHints.delete(taskId);
    const isAntigravity = this.activeEngine === "antigravity";
    const cleanupConfig = isAntigravity ? this.antigravityCleanupConfig : this.codexCleanupConfig;
    const shouldDelete = Boolean(threadId && cleanupConfig.auto_delete_threads && (status === "COMPLETED" || ((status === "FAILED" || status === "CANCELLED") && cleanupConfig.failed_thread_retention_days === 0)));
    if (shouldDelete && threadId && await this.tryDeleteThread(threadId, isAntigravity ? "antigravity" : "codex")) await this.update(taskId, { codex_thread_id: null });
  }

  async cleanupCodexThreads(force = false): Promise<{ removed: number }> {
    if (!this.codexCleanupConfig.auto_delete_threads) return { removed: 0 };
    const now = Date.now();
    const retentionMs = this.codexCleanupConfig.failed_thread_retention_days * 24 * 60 * 60 * 1000;
    const candidates = this.list().filter((task) => {
      if (!task.codex_thread_id || !["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return false;
      if (force) return true;
      if (task.status !== "FAILED" && task.status !== "CANCELLED") return false;
      return Boolean(task.completed_at && now - Date.parse(task.completed_at) >= retentionMs);
    });
    let removed = 0;
    for (const task of candidates) {
      if (!task.codex_thread_id || !(await this.tryDeleteThread(task.codex_thread_id, "codex"))) continue;
      await this.update(task.task_id, { codex_thread_id: null });
      removed += 1;
    }
    return { removed };
  }

  async cleanupAntigravityThreads(force = false): Promise<{ removed: number }> {
    if (!this.antigravityCleanupConfig.auto_delete_threads) return { removed: 0 };
    if (this.antigravity) {
      return await this.antigravity.cleanupOldSessions(force ? 0 : this.antigravityCleanupConfig.failed_thread_retention_days);
    }
    return { removed: 0 };
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupCodexThreads();
      void this.cleanupAntigravityThreads();
    }, 3 * 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  private async tryDeleteThread(threadId: string, engine?: "codex" | "antigravity"): Promise<boolean> {
    const targetEngine = engine ?? this.activeEngine;
    if (targetEngine === "antigravity") {
      if (!this.antigravityCleanupConfig.auto_delete_threads) return false;
      if (!this.antigravity) return false;
      try {
        return await this.antigravity.deleteThread(threadId);
      } catch (error) {
        this.logger.debug(`Antigravity session cleanup skipped: ${error instanceof Error ? error.message : "unknown error"}`, { step: "antigravity_thread_cleanup" });
        return false;
      }
    }
    const client = this.codex as unknown as { deleteThread?: (id: string) => Promise<boolean> };
    if (!client.deleteThread) return false;
    try {
      return await client.deleteThread.call(this.codex, threadId);
    } catch (error) {
      this.logger.debug(`Codex thread cleanup skipped: ${error instanceof Error ? error.message : "unknown error"}`, { step: "codex_thread_cleanup" });
      return false;
    }
  }

  private isSessionCleanupEnabled(engine = this.activeEngine): boolean {
    return engine === "antigravity" ? this.antigravityCleanupConfig.auto_delete_threads : this.codexCleanupConfig.auto_delete_threads;
  }

  private async update(taskId: string, patch: Partial<Task>): Promise<void> {
    const current = this.get(taskId);
    let effectivePatch = patch;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.status) && patch.status === undefined) {
      const { progress_message, progress_percent, ...rest } = patch;
      if (progress_message !== undefined || progress_percent !== undefined) {
        if (Object.keys(rest).length === 0) return;
        effectivePatch = rest;
      }
    }
    if (current.started_at && patch.started_at && patch.status === "RUNNING") {
      const { started_at, ...rest } = effectivePatch;
      effectivePatch = rest;
    }
    const next = TaskSchema.parse({ ...current, ...effectivePatch });
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

export function planSequenceResume(sectionCount: number, drafts: SequenceDraftSnapshot[], scriptModifiedAt: string, invalidateDrafts: boolean): { shouldClearDrafts: boolean; reusedSequenceNumbers: number[]; pendingSequenceNumbers: number[] } {
  const expected = Array.from({ length: Math.max(0, sectionCount) }, (_, index) => index + 1);
  const scriptTimestamp = Date.parse(scriptModifiedAt);
  const validDrafts = drafts.filter((draft) => expected.includes(draft.sequenceNumber));
  const hasUnexpectedDraft = drafts.some((draft) => !expected.includes(draft.sequenceNumber));
  const hasStaleDraft = validDrafts.some((draft) => {
    const draftTimestamp = Date.parse(draft.modified_at);
    return !Number.isFinite(scriptTimestamp) || !Number.isFinite(draftTimestamp) || draftTimestamp < scriptTimestamp;
  });
  const shouldClearDrafts = invalidateDrafts || hasUnexpectedDraft || hasStaleDraft;
  const reusable = shouldClearDrafts ? [] : [...new Set(validDrafts.map((draft) => draft.sequenceNumber))].sort((a, b) => a - b);
  const reusableSet = new Set(reusable);
  return { shouldClearDrafts, reusedSequenceNumbers: reusable, pendingSequenceNumbers: expected.filter((sequenceNumber) => !reusableSet.has(sequenceNumber)) };
}

function narrationSegmentFingerprint(text: string, voice: string, scriptModifiedAt: string, audioConfig: AppConfig["audio_generation"], narrationWordsPerSecond: number): string {
  return createHash("sha256").update(JSON.stringify({
    version: "narration-segment-v2",
    text: text.trim().replace(/\s+/g, " "),
    voice,
    scriptModifiedAt,
    narrationWordsPerSecond,
    audio: {
      provider: audioConfig.provider,
      service_url: audioConfig.service_url,
      exaggeration: audioConfig.exaggeration,
      cfg_weight: audioConfig.cfg_weight,
      match_target_duration: audioConfig.match_target_duration,
    },
  })).digest("hex");
}

function validateNarrationSegmentDuration(duration: number, text: string, wordsPerSecond: number, segmentNumber: number): void {
  const expectedDuration = countWords(text) / Math.max(0.1, wordsPerSecond);
  if (!Number.isFinite(duration) || duration <= 0 || duration < expectedDuration * 0.4) {
    throw new Error(`Narration segment ${segmentNumber} appears truncated (${Number.isFinite(duration) ? duration.toFixed(1) : "0.0"}s for ${countWords(text)} words)`);
  }
}

async function readNarrationCheckpoint(filePath: string): Promise<NarrationCheckpoint | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<NarrationCheckpoint>;
    if (parsed.schema_version !== 1 || typeof parsed.script_modified_at !== "string" || !parsed.segments || typeof parsed.segments !== "object") return null;
    return parsed as NarrationCheckpoint;
  } catch {
    return null;
  }
}

async function writeNarrationCheckpoint(filePath: string, checkpoint: NarrationCheckpoint): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function renderSourceFingerprint(html: string, narrationModifiedAt: string, narrationSize: number, assets: Array<{ asset_id: string; fingerprint: string; path: string }>): string {
  return createHash("sha256").update(JSON.stringify({ version: "quiz-render-v3", html, narrationModifiedAt, narrationSize, assets: assets.map((asset) => ({ asset_id: asset.asset_id, fingerprint: asset.fingerprint, path: asset.path })) })).digest("hex");
}

async function readRenderCheckpoint(filePath: string): Promise<RenderCheckpoint | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as RenderCheckpoint;
    if (parsed.schema_version !== 2 || typeof parsed.source_fingerprint !== "string" || parsed.check?.status !== "passed") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeRenderCheckpoint(filePath: string, checkpoint: RenderCheckpoint): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function hasNonEmptyFile(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).size > 0; } catch { return false; }
}

async function isValidPngFile(filePath: string): Promise<boolean> {
  try {
    const data = new Uint8Array(await readFile(filePath));
    if (data.length < 24 || !data.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return view.getUint32(16) > 0 && view.getUint32(20) > 0;
  } catch {
    return false;
  }
}

export function extractMarkdown(output: string, fallbackHeading: string): string {
  let value = output.trim();
  const outerFenced = value.match(/^(?:[^\r\n]*\r?\n)?```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```\s*$/i);
  if (outerFenced) {
    value = outerFenced[1].trim();
  }
  const topLevelHeadings = [...value.matchAll(/^#\s+.+$/gm)];
  if (topLevelHeadings.length > 1) {
    const firstTitle = topLevelHeadings[0][0].replace(/^#\s+/, "").trim().toLowerCase();
    const repeated = topLevelHeadings.filter((heading) => heading[0].replace(/^#\s+/, "").trim().toLowerCase() === firstTitle);
    if (repeated.length > 1) value = value.slice(repeated[repeated.length - 1].index).trim();
  }
  value = value.replace(/^(#\s+.+\r?\n)\s*(?:I(?:’|'| a)m\s+(?:drafting|using|switching|building|preparing)[\s\S]*?)(?=^##\s+)/im, "$1\n");
  return value.startsWith("#") ? value : `${fallbackHeading}\n\n${value}`;
}

export function extractScriptMarkdown(output: string, episodeTitle: string): string {
  const value = extractMarkdown(output, "# Script");
  const headings = [...value.matchAll(/^#\s+(.+)$/gm)];
  if (headings.length <= 1) return value;
  const normalizedTitle = episodeTitle.trim().toLowerCase();
  const titleMatch = [...headings].reverse().find((heading) => heading[1].trim().toLowerCase() === normalizedTitle);
  const selected = titleMatch ?? headings.at(-1);
  if (selected?.index === undefined) return value;
  const nextHeading = headings.find((heading) => (heading.index ?? 0) > selected.index!);
  return value.slice(selected.index, nextHeading?.index).trim();
}

function parseJson(output: string, context = "Codex"): unknown {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const value = fenced || output.trim();
  const starts = [value.indexOf("["), value.indexOf("{")].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error("Codex output did not contain JSON");
  const objectStart = Math.min(...starts);
  try {
    return JSON.parse(value.slice(objectStart));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON syntax";
    throw new Error(`${context} JSON output malformed: ${detail}`);
  }
}

function parseTopicCandidates(output: string, channelId: string, topicHint?: string) {
  const raw = parseJson(output);
  const list = Array.isArray(raw) ? raw : (raw as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(list) || list.length !== 5) throw new Error("Codex topic output must contain exactly 5 candidates");
  const formats = ["knowledge", "image_guess", "multiple_choice", "true_false", "odd_one_out"] as const;
  const ages = ["4-6", "7-9", "10-12", "family"] as const;
  return list.map((item, index) => {
    const candidate = item as Record<string, unknown>;
    const rawThemeHint = candidate.theme_hint ? String(candidate.theme_hint).trim() : undefined;
    const themeHint = rawThemeHint || (topicHint && index < 2 ? topicHint : undefined);
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
      quiz_format: formats.includes(String(candidate.quiz_format) as typeof formats[number]) ? String(candidate.quiz_format) as typeof formats[number] : "knowledge",
      question_count: Math.max(QUIZ_MIN_QUESTION_COUNT, Math.min(QUIZ_MAX_QUESTION_COUNT, Number(candidate.question_count) || 8)),
      age_band: ages.includes(String(candidate.age_band) as typeof ages[number]) ? String(candidate.age_band) as typeof ages[number] : "7-9",
      visual_style: "mixed" as const,
      ...(themeHint ? { theme_hint: themeHint } : {}),
    };
  });
}


export function parseBeatsOutput(output: string): Beat[] {
  const raw = parseJson(output, "Shot-plan");
  const list = Array.isArray(raw) ? raw : (raw as { beats?: unknown[] }).beats;
  if (!Array.isArray(list) || list.length === 0) throw new Error("Codex beat output must contain beats");
  return list.map((item, index) => {
    const beat = item as Record<string, unknown>;
    const dialogue = String(beat.dialogue ?? "").trim();
    const visualPrompt = stripEditorialOverlayInstructions(String(beat.visual_prompt ?? beat.video_prompt ?? "").trim());
    if (!dialogue) throw new Error(`Codex beat ${index + 1} is missing dialogue`);
    if (!visualPrompt) throw new Error(`Codex beat ${index + 1} is missing visual_prompt`);
    return {
      dialogue,
      visual_prompt: visualPrompt,
      continuity_key: normalizeContinuityKey(String(beat.continuity_key ?? ""), index),
      transition_note: String(beat.transition_note ?? "").trim(),
      continuity_note: String(beat.continuity_note ?? "").trim(),
      sequence_id: normalizeIdentifier(String(beat.sequence_id ?? "sequence-1"), `sequence-${index + 1}`),
      sequence_title: String(beat.sequence_title ?? "Sequence 1").trim() || "Sequence 1",
      shot_id: normalizeIdentifier(String(beat.shot_id ?? ""), `shot-${index + 1}`),
      asset_type: parseAssetType(beat.asset_type),
      continuity_bundle_id: normalizeIdentifier(String(beat.continuity_bundle_id ?? beat.continuity_key ?? ""), `bundle-${index + 1}`),
      reference_asset_ids: parseStringList(beat.reference_asset_ids),
      source_ids: parseStringList(beat.source_ids),
      reconstruction: typeof beat.reconstruction === "boolean" ? beat.reconstruction : String(beat.asset_type ?? "").toLowerCase() === "ai_reconstruction",
      sound_cue: String(beat.sound_cue ?? "").trim(),
      editorial_overlay: parseEditorialOverlay(beat.editorial_overlay),
      quiz: parseQuizSceneContent(beat.quiz),
    };
  });
}

function normalizeContinuityKey(value: string, index: number): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `beat-${index + 1}`;
}

function normalizeIdentifier(value: string, fallback: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseAssetType(value: unknown): Beat["asset_type"] {
  const candidate = String(value ?? "ai_reconstruction").trim().toLowerCase();
  return ["archive", "document", "map", "diagram", "ai_reconstruction", "contemporary", "transition"].includes(candidate)
    ? candidate as Beat["asset_type"]
    : "ai_reconstruction";
}

function parseRegeneration(output: string): Partial<Scene> {
  const raw = parseJson(output) as Record<string, unknown>;
  return {
    dialogue: typeof raw.dialogue === "string" ? raw.dialogue : undefined,
    visual_prompt: typeof raw.visual_prompt === "string" ? stripEditorialOverlayInstructions(raw.visual_prompt) : typeof raw.video_prompt === "string" ? stripEditorialOverlayInstructions(raw.video_prompt) : undefined,
    transition_note: typeof raw.transition_note === "string" ? raw.transition_note : undefined,
    continuity_note: typeof raw.continuity_note === "string" ? raw.continuity_note : undefined,
    asset_type: raw.asset_type === undefined ? undefined : parseAssetType(raw.asset_type),
    continuity_bundle_id: typeof raw.continuity_bundle_id === "string" ? normalizeIdentifier(raw.continuity_bundle_id, "bundle") : undefined,
    reference_asset_ids: raw.reference_asset_ids === undefined ? undefined : parseStringList(raw.reference_asset_ids),
    source_ids: raw.source_ids === undefined ? undefined : parseStringList(raw.source_ids),
    reconstruction: typeof raw.reconstruction === "boolean" ? raw.reconstruction : undefined,
    sound_cue: typeof raw.sound_cue === "string" ? raw.sound_cue : undefined,
    editorial_overlay: raw.editorial_overlay === undefined ? undefined : parseEditorialOverlay(raw.editorial_overlay),
    quiz: raw.quiz === undefined ? undefined : parseQuizSceneContent(raw.quiz),
  };
}

function parseEditorialOverlay(value: unknown): Beat["editorial_overlay"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EditorialOverlaySchema.parse({});
  const raw = value as Record<string, unknown>;
  const kinds = ["none", "caption", "stat_card", "timeline", "bar_chart", "line_chart", "map_callout", "comparison", "quote"] as const;
  const motions = ["none", "fade_up", "slide_in", "draw_on", "count_up", "highlight"] as const;
  const placements = ["lower_third", "upper_left", "upper_right", "center", "side_panel"] as const;
  const kind = kinds.includes(String(raw.kind ?? "none") as typeof kinds[number]) ? String(raw.kind ?? "none") : "none";
  const motion = motions.includes(String(raw.motion ?? "none") as typeof motions[number]) ? String(raw.motion ?? "none") : "none";
  const placement = placements.includes(String(raw.placement ?? "lower_third") as typeof placements[number]) ? String(raw.placement ?? "lower_third") : "lower_third";
  const data = Array.isArray(raw.data)
    ? raw.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).map((item) => ({ label: String(item.label ?? "").trim(), value: typeof item.value === "number" ? item.value : String(item.value ?? "").trim(), unit: String(item.unit ?? "").trim() })).filter((item) => item.label && item.value !== "")
    : [];
  const duration = typeof raw.duration_seconds === "number" && Number.isFinite(raw.duration_seconds) ? Math.max(0.1, Math.min(20, raw.duration_seconds)) : null;
  return EditorialOverlaySchema.parse({ kind, text: String(raw.text ?? "").trim(), motion, placement, duration_seconds: duration, data, source_ids: parseStringList(raw.source_ids) });
}

function parseQuizSceneContent(value: unknown): Scene["quiz"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const phases = ["intro", "question", "reveal", "explanation", "outro"] as const;
  const phaseValue = String(raw.phase ?? "question") as typeof phases[number];
  const choices = Array.isArray(raw.choices)
    ? raw.choices.map(String).map((item) => stripQuizChoiceLabel(item.trim())).filter(Boolean).slice(0, QUIZ_MAX_CHOICES_PER_QUESTION)
    : [];
  const rawAnswer = String(raw.answer ?? "").trim();
  const canonicalAnswer = canonicalizeVisibleQuizAnswer(choices, rawAnswer);
  return {
    phase: phases.includes(phaseValue) ? phaseValue : "question",
    question_number: Number.isInteger(Number(raw.question_number)) && Number(raw.question_number) > 0 ? Number(raw.question_number) : null,
    question: String(raw.question ?? "").trim(),
    choices,
    answer: canonicalAnswer ?? rawAnswer,
    explanation: String(raw.explanation ?? "").trim(),
    image_prompt: String(raw.image_prompt ?? "").trim(),
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

function hyperframesArgs(...args: string[]): string[] {
  if (process.platform === "win32") return [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"), "--yes", "hyperframes", ...args];
  return ["--yes", "hyperframes", ...args];
}

function validateResearch(markdown: string): void {
  const sourceCount = new Set(markdown.match(/https?:\/\/[^\s)>\]]+/g) ?? []).size;
  const claimCount = new Set(markdown.match(/\bC\d{2,}\b/g) ?? []).size;
  if (sourceCount < 5) throw new Error(`Research quality gate failed: found ${sourceCount} source URLs; at least 5 are required`);
  if (claimCount < 5) throw new Error(`Research quality gate failed: found ${claimCount} claim IDs; at least 5 are required`);
}

function validateQuizResearch(markdown: string, questionCount: number): void {
  const copyrightCheck = validateQuizResearchCopyright(markdown);
  if (copyrightCheck.violated) {
    throw new Error(`Quiz research quality gate failed: ${copyrightCheck.questionNumber ? `Question ${copyrightCheck.questionNumber}` : "Research dossier"} contains prohibited term '${copyrightCheck.term}'. Please regenerate without using copyrighted characters or lion cubs.`);
  }
  const sourceCount = new Set(markdown.match(/https?:\/\/[^\s)>\]]+/g) ?? []).size;
  const claimCount = new Set(markdown.match(/\bC\d{2,}\b/g) ?? []).size;
  if (sourceCount < Math.max(3, Math.ceil(questionCount / 2))) throw new Error(`Quiz research quality gate failed: found ${sourceCount} source URLs`);
  if (claimCount < questionCount) throw new Error(`Quiz research quality gate failed: found ${claimCount} claim IDs for ${questionCount} questions`);
}

function validateQuizTreatment(markdown: string, questionCount: number): void {
  const copyrightCheck = validateQuizScriptCopyright(markdown);
  if (copyrightCheck.violated) {
    throw new Error(`Quiz treatment quality gate failed: ${copyrightCheck.questionNumber ? `Question ${copyrightCheck.questionNumber}` : "Treatment"} contains prohibited term '${copyrightCheck.term}'. Please regenerate without using copyrighted characters or lion cubs.`);
  }
  const headings = new Set(markdown.match(/^#{2,3}\s+Question\s+\d+/gim) ?? []).size;
  if (headings < questionCount) throw new Error(`Quiz treatment quality gate failed: found ${headings} question blocks for ${questionCount} questions`);
  if (!/time budget/i.test(markdown) || !/correct answer/i.test(markdown)) throw new Error("Quiz treatment quality gate failed: each question needs time budget and correct answer");
}

export function validateQuizScript(markdown: string, questionCount: number): void {
  if (!hasHumorPolicyMarker(markdown)) throw new Error("Quiz script quality gate failed: HUMOR_POLICY v1 marker is missing");
  const copyrightCheck = validateQuizScriptCopyright(markdown);
  if (copyrightCheck.violated) {
    throw new Error(`Quiz script quality gate failed: ${copyrightCheck.questionNumber ? `Question ${copyrightCheck.questionNumber}` : "Script"} contains prohibited term '${copyrightCheck.term}'. Please regenerate this question using a safe alternative subject without using copyrighted characters or lion cubs.`);
  }
  const headingNumbers = [...markdown.matchAll(/^#{2,3}\s+Question\s+(\d+)\b/gim)].map((match) => Number(match[1]));
  const listNumbers = [...markdown.matchAll(/(?:^|\n)\s*(?:Question\s*)?(\d+)[.)—:-]\s*/gi)].map((match) => Number(match[1]));
  const questionNumbers = new Set(headingNumbers.length > 0 ? headingNumbers : listNumbers);
  const numbered = questionNumbers.size;
  if (numbered < questionCount) throw new Error(`Quiz script quality gate failed: found ${numbered} numbered question blocks for ${questionCount} questions`);
  if (!Array.from({ length: questionCount }, (_, index) => index + 1).every((number) => questionNumbers.has(number))) throw new Error(`Quiz script quality gate failed: question blocks must be numbered 1-${questionCount}`);
  if (!/answer|correct/i.test(markdown) || !/guess|think/i.test(markdown)) throw new Error("Quiz script quality gate failed: guess and answer beats are required");
}

function validateQuizVisualBible(markdown: string, requiredBundleNumbers: number[]): void {
  const bundles = parseContinuityBundles(markdown);
  const missing = missingArtifactSectionNumbers(markdown, requiredBundleNumbers, "continuity_bundle");
  if (missing.length) throw new Error(`Quiz visual bible quality gate failed: missing continuity bundle${missing.length === 1 ? "" : "s"} ${formatArtifactSectionNumbers(missing)}`);
  if (bundles.length < requiredBundleNumbers.length) throw new Error(`Quiz visual bible quality gate failed: found ${bundles.length} continuity bundles for ${requiredBundleNumbers.length} questions`);
  for (const required of ["safe motion"]) if (!markdown.toLowerCase().includes(required)) throw new Error(`Quiz visual bible quality gate failed: missing ${required}`);
}

function validateTreatment(markdown: string): void {
  const sequenceNumbers = extractArtifactSectionNumbers(markdown, "sequence");
  const sequenceCount = Math.max(
    new Set(sequenceNumbers).size,
    (markdown.match(/\bTime budget\b/gi) ?? []).length,
  );
  if (sequenceCount < 5) throw new Error(`Treatment quality gate failed: found ${sequenceCount} sequences; at least 5 are required`);
  if (sequenceNumbers.length > 0 && (!contiguousArtifactNumbers(sequenceNumbers) || new Set(sequenceNumbers).size !== sequenceNumbers.length)) {
    throw new Error("Treatment quality gate failed: sequence headings must be numbered consecutively from 1");
  }
  if (!/time budget/i.test(markdown) || !/claim/i.test(markdown)) throw new Error("Treatment quality gate failed: time budgets and claim IDs are required");
}

export function validateScript(markdown: string, targetWords: number): void {
  const narration = extractNarration(markdown);
  const words = countWords(narration);
  if (!hasHumorPolicyMarker(markdown)) throw new Error("Script quality gate failed: HUMOR_POLICY v1 marker is missing; regenerate the script with the current documentary humor layer");
  const bounds = scriptWordBounds(targetWords);
  if (words < bounds.lower || words > bounds.upper) throw new Error(`Script quality gate failed: ${words} words is outside ±20% of the calibrated ${targetWords}-word target (${bounds.lower}–${bounds.upper} words)`);
  const anchors = new Set([
    ...(narration.match(/\b(?:18|19|20)\d{2}\b/g) ?? []),
    ...(markdown.match(/\bC\d{2,}\b/g) ?? []),
    ...(narration.match(/\b\d+(?:\.\d+)?\s?(?:%|percent|million|billion|miles?|kilomet(?:er|re)s?)\b/gi) ?? []),
  ]).size;
  if (anchors < 6) throw new Error(`Script quality gate failed: found ${anchors} factual anchors; at least 6 are required`);
}

function validateVisualBible(markdown: string, requiredBundleNumbers: number[] = []): void {
  const bundles = parseContinuityBundles(markdown);
  const bundleNumbers = [...new Set(bundles.map((bundle) => bundle.bundle_number))];
  const missing = missingArtifactSectionNumbers(markdown, requiredBundleNumbers, "continuity_bundle");
  const minimum = requiredBundleNumbers.length > 0 ? requiredBundleNumbers.length : 5;
  if (!/continuity bundle/i.test(markdown) || bundles.length < 5) throw new Error(`Visual bible quality gate failed: found ${bundles.length} stable continuity bundle IDs; at least 5 are required`);
  if (bundles.length < minimum) throw new Error(`Visual bible quality gate failed: found ${bundles.length} stable continuity bundles; ${minimum} are required`);
  if (missing.length) throw new Error(`Visual bible quality gate failed: missing continuity bundle${missing.length === 1 ? "" : "s"} ${formatArtifactSectionNumbers(missing)}`);
  if (bundleNumbers.length > 0 && !contiguousArtifactNumbers(bundleNumbers)) throw new Error("Visual bible quality gate failed: continuity bundle IDs must be numbered consecutively from 1");
  for (const required of ["palette", "lighting", "reference asset", "anchor-frame"]) {
    if (!markdown.toLowerCase().includes(required)) throw new Error(`Visual bible quality gate failed: missing ${required}`);
  }
}

export function isSequenceOutputFailure(message: string): boolean {
  return message.startsWith("Shot-plan quality gate failed")
    || message.startsWith("Quiz scene quality gate failed")
    || message.startsWith("Shot-plan JSON output malformed")
    || message === "Codex output did not contain JSON"
    || message.startsWith("Codex beat ")
    || message.includes("timed out")
    || message.includes("inactivity")
    || message.includes("stream was interrupted");
}

export function normalizeQuizBeatMetadata(beats: Beat[]): Beat[] {
  const canonicalByQuestion = new Map<number, NonNullable<Beat["quiz"]>>();
  for (const beat of beats) {
    const quiz = beat.quiz;
    if (!quiz || ["intro", "outro"].includes(quiz.phase) || !quiz.question_number) continue;
    const canonicalAnswer = canonicalizeVisibleQuizAnswer(quiz.choices, quiz.answer);
    if (!quiz.question.trim() || quiz.choices.length < 2 || !canonicalAnswer) continue;
    if (!canonicalByQuestion.has(quiz.question_number) || (!canonicalByQuestion.get(quiz.question_number)!.image_prompt.trim() && quiz.image_prompt.trim())) {
      canonicalByQuestion.set(quiz.question_number, {
        ...quiz,
        choices: quiz.choices.map(stripQuizChoiceLabel),
        answer: canonicalAnswer,
      });
    }
  }

  return beats.map((beat) => {
    const quiz = beat.quiz;
    const resolvedSourceIds = beat.source_ids.length > 0
      ? beat.source_ids
      : quiz?.question_number
      ? [`C${String(quiz.question_number).padStart(2, "0")}`]
      : beat.continuity_bundle_id && /^cb-(\d+)$/i.test(beat.continuity_bundle_id)
      ? [`C${String(Number(beat.continuity_bundle_id.match(/^cb-(\d+)$/i)![1])).padStart(2, "0")}`]
      : beat.sequence_id && /^sequence-(\d+)$/i.test(beat.sequence_id)
      ? [`C${String(Number(beat.sequence_id.match(/^sequence-(\d+)$/i)![1])).padStart(2, "0")}`]
      : [];

    const beatWithSources = resolvedSourceIds.length > 0 && beat.source_ids.length === 0
      ? { ...beat, source_ids: resolvedSourceIds }
      : beat;

    if (!quiz || ["intro", "outro"].includes(quiz.phase) || !quiz.question_number) return beatWithSources;
    const canonical = canonicalByQuestion.get(quiz.question_number);
    if (!canonical) return beatWithSources;
    const ownAnswer = canonicalizeVisibleQuizAnswer(quiz.choices, quiz.answer);
    if (ownAnswer) {
      return {
        ...beatWithSources,
        quiz: {
          ...quiz,
          choices: quiz.choices.map(stripQuizChoiceLabel),
          answer: ownAnswer,
          image_prompt: quiz.image_prompt.trim() || canonical.image_prompt,
        },
      };
    }
    return {
      ...beatWithSources,
      quiz: {
        ...quiz,
        question: quiz.question.trim() || canonical.question,
        choices: canonical.choices,
        answer: canonical.answer,
        explanation: quiz.explanation.trim() || canonical.explanation,
        image_prompt: quiz.image_prompt.trim() || canonical.image_prompt,
      },
    };
  });
}

function validateBeatOutput(beats: Beat[], minimumSequences = 5, quiz = false): void {
  const sequences = new Set(beats.map((beat) => beat.sequence_id));
  if (sequences.size < minimumSequences) throw new Error(`Shot-plan quality gate failed: found ${sequences.size} sequences; at least ${minimumSequences} are required`);
  const prompts = beats.map((beat) => beat.visual_prompt.replace(/\s+/g, " ").trim().toLowerCase());
  const uniqueRatio = new Set(prompts).size / beats.length;
  if (uniqueRatio < 0.9) throw new Error(`Shot-plan quality gate failed: ${Math.round((1 - uniqueRatio) * 100)}% of prompts are exact duplicates`);
  const incomplete = beats.filter((beat) => !["CAMERA", "ACTION", "LIGHTING", "ATMOSPHERE", "CONTINUITY"].every((label) => beat.visual_prompt.toUpperCase().includes(label)) || !beat.continuity_bundle_id || !beat.continuity_note);
  if (incomplete.length > Math.max(1, Math.floor(beats.length * 0.05))) throw new Error(`Shot-plan quality gate failed: ${incomplete.length} prompts lack structure or continuity metadata`);
  const sourced = beats.filter((beat) => beat.asset_type === "transition" || beat.source_ids.length > 0).length / beats.length;
  if (sourced < 0.75) throw new Error(`Shot-plan quality gate failed: only ${Math.round(sourced * 100)}% of shots carry source IDs`);
  const overlayCoverage = beats.filter((beat) => beat.editorial_overlay.kind !== "none").length / beats.length;
  if (overlayCoverage > 0.45) throw new Error(`Shot-plan quality gate failed: editorial overlays cover ${Math.round(overlayCoverage * 100)}% of beats; keep overlays selective and below 45%`);
  const invalidCharts = beats.filter((beat) => ["bar_chart", "line_chart"].includes(beat.editorial_overlay.kind) && beat.editorial_overlay.data.length < 2);
  if (invalidCharts.length) throw new Error("Shot-plan quality gate failed: charts require at least two sourced data points");
  if (quiz) {
    const incompleteQuiz = beats.filter((beat) => !beat.quiz || (!["intro", "outro"].includes(beat.quiz.phase) && (!beat.quiz.question_number || !beat.quiz.question || !beat.quiz.answer)));
    if (incompleteQuiz.length) throw new Error(`Quiz scene quality gate failed: ${incompleteQuiz.length} beats lack structured question or answer data`);
    const invalidAnswers = beats.flatMap((beat, index) => beat.quiz && !["intro", "outro"].includes(beat.quiz.phase) && resolveVisibleQuizChoice(beat.quiz.choices, beat.quiz.answer) === null ? [index + 1] : []);
    if (invalidAnswers.length) throw new Error(`Quiz scene quality gate failed: ${invalidAnswers.length} beats contain an answer that does not match a visible choice (beats ${invalidAnswers.join(", ")})`);
  }
}

function validateNarrationCoverage(script: string, beats: Beat[], threshold: number): void {
  const expected = (extractNarration(script).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const actual = (beats.map((beat) => beat.dialogue).join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const counts = new Map<string, number>();
  for (const word of actual) counts.set(word, (counts.get(word) ?? 0) + 1);
  let matched = 0;
  for (const word of expected) {
    const available = counts.get(word) ?? 0;
    if (available > 0) { matched += 1; counts.set(word, available - 1); }
  }
  const coverage = expected.length ? matched / expected.length : 0;
  if (coverage < threshold) throw new Error(`Shot-plan quality gate failed: narration coverage is ${(coverage * 100).toFixed(1)}%; at least ${(threshold * 100).toFixed(1)}% is required`);
}

function isPlaceholderArtifact(content: string): boolean {
  const value = content.trim();
  return !value || /(?:has not started|generation has not started|breakdown has not started)/i.test(value);
}
