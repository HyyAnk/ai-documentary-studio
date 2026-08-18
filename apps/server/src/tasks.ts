import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
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
  makeId,
  nowIso,
} from "@studio/shared";
import { ContextEngine } from "./context.js";
import { CodexAppServerClient, type CodexServerRequest } from "./codex.js";
import { StudioLogger } from "./logger.js";
import { RepositoryError, RepositoryService } from "./repository.js";
import { ChatterboxProvider, synthesizeWav, type ChatterboxTarget } from "./providers/chatterbox.js";
import { CodexImageProvider } from "./providers/codexImage.js";
import { ShopAiKeyImageProvider } from "./providers/shopAiKeyImage.js";
import type { AudioProvider } from "./providers/index.js";
import { optimizeShortScenes, packBeatsIntoScenes, rebalanceEditorialOverlays, type Beat } from "./sceneTiming.js";
import { calibratedScriptTargetWords, countWords, extractNarration, extractNarrationChunks, extractNarrationSections, hasHumorPolicyMarker, scriptWordBounds } from "./production.js";
import { stripEditorialOverlayInstructions } from "./visualPrompt.js";
import { parseContinuityBundles } from "./visualBundles.js";

type ActiveRun = { task: Task; threadId: string; turnId: string; output: string; manifest: ContextManifest; scriptAttempts: number; visualBibleAttempts: number };
type CodexCleanupConfig = { auto_delete_threads: boolean; failed_thread_retention_days: number };
type PipelineRun = { cancelled: boolean; children: Set<string> };

const channelTaskTypes = new Set<TaskType>(["GENERATE_DNA", "SUGGEST_TOPICS"]);
const audioTaskTypes = new Set<TaskType>(["GENERATE_AUDIO", "GENERATE_NARRATION"]);

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
  private runningCount = 0;
  private runningAudioCount = 0;
  private readonly activeAudio = new Set<string>();
  private audioConfig: AppConfig["audio_generation"];
  private imageConfig: AppConfig["image_generation"];
  private videoConfig: Pick<AppConfig["video_generation"], "max_scene_duration_seconds" | "narration_words_per_second">;
  private readonly audioProviderFactory: (target: ChatterboxTarget, config: AppConfig["audio_generation"]) => AudioProvider;
  private codexCleanupConfig: CodexCleanupConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private connectionStatus: "connected" | "disconnected" | "unavailable" | "connecting" = "disconnected";

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
    codexConfig: CodexCleanupConfig = { auto_delete_threads: true, failed_thread_retention_days: 7 },
    imageConfig: AppConfig["image_generation"] = { enabled: true, images_per_bundle: 1 },
  ) {
    super();
    this.videoConfig = typeof videoConfigOrMaxSceneDuration === "number"
      ? { max_scene_duration_seconds: videoConfigOrMaxSceneDuration, narration_words_per_second: 2.3 }
      : videoConfigOrMaxSceneDuration;
    this.audioConfig = audioConfig;
    this.imageConfig = imageConfig;
    this.audioProviderFactory = audioProviderFactory ?? ((target, config) => new ChatterboxProvider(repository, config, target));
    this.codexCleanupConfig = { auto_delete_threads: codexConfig.auto_delete_threads, failed_thread_retention_days: codexConfig.failed_thread_retention_days };
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
    this.startCleanupTimer();
    void this.cleanupCodexThreads();
  }

  async reload(): Promise<void> {
    if (this.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing storage", "STORAGE_BUSY");
    this.tasks.clear();
    this.imageVariants.clear();
    this.activeImageControllers.clear();
    this.approvalRequests.clear();
    this.locks.clear();
    this.connectionStatus = this.codex.isConnected ? "connected" : "disconnected";
    await this.load();
  }

  updateAudioConfig(config: AppConfig["audio_generation"]): void {
    this.audioConfig = config;
  }

  updateVideoConfig(config: AppConfig["video_generation"]): void {
    this.videoConfig = {
      max_scene_duration_seconds: config.max_scene_duration_seconds,
      narration_words_per_second: config.narration_words_per_second,
    };
  }

  updateImageConfig(config: AppConfig["image_generation"]): void {
    this.imageConfig = config;
  }

  updateCodexConfig(config: AppConfig["codex"]): void {
    this.codexCleanupConfig = { auto_delete_threads: config.auto_delete_threads, failed_thread_retention_days: config.failed_thread_retention_days };
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
    return this.active.size > 0 || this.activeAudio.size > 0 || this.pipelineRuns.size > 0 || this.runningCount > 0 || this.runningAudioCount > 0 || this.list().some((task) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status));
  }

  submit(taskType: TaskType, channelId: string, episodeId: string | null, sceneNumber?: number, requestedImageVariant?: number): Task {
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
    if (taskType === "GENERATE_BUNDLE_IMAGE") this.imageVariants.set(task.task_id, imageVariant);
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
    while (this.runningCount < this.maxConcurrent) {
      const next = this.list().reverse().find((task) => task.status === "QUEUED" && !audioTaskTypes.has(task.task_type) && !this.locks.has(task.lock_key));
      if (!next) break;
      this.locks.add(next.lock_key);
      const isPipeline = next.task_type === "GENERATE_PIPELINE";
      if (!isPipeline) this.runningCount += 1;
      void this.run(next).finally(() => {
        this.locks.delete(next.lock_key);
        if (!isPipeline) this.runningCount -= 1;
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
    if (task.task_type === "GENERATE_BUNDLE_IMAGE" && ShopAiKeyImageProvider.isConfigured()) {
      await this.runShopAiKeyImageTask(task);
      return;
    }
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_task" };
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing scoped context" });
      const manifest = await this.contextEngine.build(task.task_type, task.channel_id, task.episode_id, this.findSceneNumber(task.task_id), this.imageVariants.get(task.task_id) ?? 0);
      await this.update(task.task_id, { progress_message: "Connecting to Codex" });
      await this.codex.connect();
      const threadId = task.codex_thread_id ? await this.codex.resumeThread(task.codex_thread_id) : await this.codex.startThread();
      await this.update(task.task_id, { codex_thread_id: threadId, progress_message: "Generating" });
      const turnId = await this.codex.startTurn(threadId, manifest.prompt);
      await this.update(task.task_id, { codex_turn_id: turnId });
      this.active.set(task.task_id, { task: this.get(task.task_id), threadId, turnId, output: "", manifest, scriptAttempts: 0, visualBibleAttempts: 0 });
      await new Promise<void>((resolve) => this.completionWaiters.set(task.task_id, resolve));
      this.logger.step("Codex turn started", context);
    } catch (error) {
      await this.finish(task.task_id, "FAILED", error instanceof Error ? error.message : "Task failed");
      this.logger.error("Codex task failed", { ...context, step: "run_task" });
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
      const image = await new ShopAiKeyImageProvider(this.repository, {
        channelId: task.channel_id,
        episodeId: task.episode_id,
        bundleNumber,
        variant: this.imageVariants.get(task.task_id) ?? 0,
      }).generateReference(manifest.prompt, controller.signal);
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
      const researchChanged = await step("Research · verifying sources", 5, "GENERATE_RESEARCH", async () => !(await this.hasReadyArtifact(task.channel_id, episodeId, "research.md")));
      const treatmentChanged = await step("Treatment · structuring the story", 20, "GENERATE_TREATMENT", async () => !(await this.hasReadyArtifact(task.channel_id, episodeId, "treatment.md")));
      const scriptChanged = await step("Narration script · writing the argument", 35, "GENERATE_SCRIPT", async () => !(await this.hasReadyScript(task.channel_id, episodeId)));
      const visualBibleChanged = await step("Visual bible · locking continuity", 50, "GENERATE_VISUAL_BIBLE", async () => !(await this.hasReadyArtifact(task.channel_id, episodeId, "visual_bible.md")));
      const upstreamChanged = researchChanged || treatmentChanged || scriptChanged || visualBibleChanged;

      await this.generatePipelineBundleImages(task, run);

      const scenes = await this.repository.readScenes(task.channel_id, episodeId);
      if (run.cancelled) throw new Error("Pipeline cancelled");
      const shotPlanFresh = await this.isShotPlanFresh(task.channel_id, episodeId);
      const regenerateShots = scenes.length === 0 || upstreamChanged || !shotPlanFresh;
      await this.update(task.task_id, { progress_message: regenerateShots ? "Shot plan · generating sequences" : "Shot plan · already ready", progress_percent: 65 });
      if (regenerateShots) {
        const script = await this.repository.getEpisodeFile(task.channel_id, episodeId, "script.md");
        const sections = extractNarrationSections(script.content);
        if (sections.length === 0) throw new Error("Shot plan failed: a completed script is required");
        await this.repository.backupEpisodeFile(task.channel_id, episodeId, "scene_plan.md");
        await this.repository.clearSequenceDrafts(episodeId);
        const children = sections.map((_, index) => this.submit("GENERATE_SEQUENCE_SCENES", task.channel_id, episodeId, index + 1));
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

      await this.attachPipelineBundleImages(task.channel_id, episodeId);
      const balancedScenes = rebalanceEditorialOverlays(await this.repository.readScenes(task.channel_id, episodeId));
      await this.repository.saveScenes(task.channel_id, episodeId, balancedScenes);

      if (run.cancelled) throw new Error("Pipeline cancelled");
      await this.update(task.task_id, { progress_message: "Narration · generating the master voice track", progress_percent: 88 });
      const episode = await this.repository.getEpisode(task.channel_id, episodeId);
      if (upstreamChanged || !episode.narration_asset_path) {
        const child = this.submit("GENERATE_NARRATION", task.channel_id, episodeId);
        run.children.add(child.task_id);
        try {
          const completed = await this.waitForTaskTerminal(child.task_id, run);
          if (completed.status !== "COMPLETED") throw new Error(`Narration failed: ${completed.error ?? completed.status}`);
        } finally {
          run.children.delete(child.task_id);
        }
      }
      await this.finish(task.task_id, "COMPLETED", null, []);
    } catch (error) {
      const cancelled = run.cancelled || (error instanceof Error && error.message === "Pipeline cancelled");
      await this.finish(task.task_id, cancelled ? "CANCELLED" : "FAILED", cancelled ? "Cancelled by user" : error instanceof Error ? error.message : "Production pipeline failed");
    } finally {
      this.pipelineRuns.delete(task.task_id);
    }
  }

  private async hasReadyArtifact(channelId: string, episodeId: string, filename: string): Promise<boolean> {
    const file = await this.repository.getEpisodeFile(channelId, episodeId, filename);
    return !isPlaceholderArtifact(file.content);
  }

  private async generatePipelineBundleImages(task: Task, run: PipelineRun): Promise<void> {
    if (!this.imageConfig.enabled) return;
    const visualBible = await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "visual_bible.md");
    const bundles = parseContinuityBundles(visualBible.content);
    if (bundles.length === 0) return;

    const existing = await this.repository.listBundleImages(task.channel_id, task.episode_id!);
    const missing = bundles.flatMap((bundle) => Array.from({ length: this.imageConfig.images_per_bundle }, (_, variant) => ({ bundle, variant })))
      .filter(({ bundle, variant }) => !existing.some((image) => image.bundle_id === bundle.bundle_id && image.variant === variant));
    if (missing.length === 0) {
      await this.update(task.task_id, { progress_message: "Style anchors · already ready", progress_percent: 58 });
      return;
    }

    await this.update(task.task_id, { progress_message: `Style anchors · generating ${missing.length} continuity image${missing.length === 1 ? "" : "s"}`, progress_percent: 58 });
    const children = missing.map(({ bundle, variant }) => this.submit("GENERATE_BUNDLE_IMAGE", task.channel_id, task.episode_id!, bundle.bundle_number, variant));
    children.forEach((child) => run.children.add(child.task_id));
    try {
      for (const [index, child] of children.entries()) {
        const completed = await this.waitForTaskTerminal(child.task_id, run);
        if (completed.status !== "COMPLETED") throw new Error(`Style anchor ${index + 1}/${children.length} failed: ${completed.error ?? completed.status}`);
        await this.update(task.task_id, { progress_message: `Style anchors · ${index + 1}/${children.length} ready`, progress_percent: 58 + Math.round(((index + 1) / children.length) * 5) });
      }
    } catch (error) {
      await Promise.all(children.filter((child) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(this.get(child.task_id).status)).map((child) => this.cancel(child.task_id).catch(() => undefined)));
      throw error;
    } finally {
      children.forEach((child) => run.children.delete(child.task_id));
    }
  }

  private async attachPipelineBundleImages(channelId: string, episodeId: string): Promise<void> {
    const images = await this.repository.listBundleImages(channelId, episodeId);
    for (const image of images) await this.repository.attachBundleReference(channelId, episodeId, image.bundle_id, image.path);
  }

  private async hasReadyScript(channelId: string, episodeId: string): Promise<boolean> {
    const file = await this.repository.getEpisodeFile(channelId, episodeId, "script.md");
    return !isPlaceholderArtifact(file.content) && hasHumorPolicyMarker(file.content);
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
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  private async runAudioTask(task: Task): Promise<void> {
    const context = { profileId: task.channel_id, workerId: task.task_id, step: "run_audio" };
    this.activeAudio.add(task.task_id);
    try {
      await this.update(task.task_id, { status: "RUNNING", started_at: nowIso(), queue_position: null, progress_message: "Preparing audio", progress_percent: 0 });
      if (!task.episode_id) throw new RepositoryError("Episode is required", "EPISODE_REQUIRED");
      if (task.task_type === "GENERATE_NARRATION") {
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
    const script = await this.repository.getEpisodeFile(task.channel_id, task.episode_id, "script.md");
    const sections = extractNarrationChunks(script.content, 60, true).filter((section) => countWords(section.text) >= 3);
    if (sections.length === 0) throw new RepositoryError("A completed script is required before narration", "SCRIPT_REQUIRED");
    const channel = await this.repository.getChannel(task.channel_id);
    const episode = await this.repository.getEpisode(task.channel_id, task.episode_id);
    const voice = channel.voice_reference_path ? this.repository.resolveContextPath(channel.voice_reference_path) : "default";
    const segmentPaths: string[] = [];
    for (const [index, section] of sections.entries()) {
      await this.update(task.task_id, {
        progress_message: `Narrating ${section.title}`,
        progress_percent: Math.round((index / sections.length) * 78),
      });
      const audio = await synthesizeWav(this.audioConfig, section.text, voice);
      const audioDuration = parseWavDuration(audio);
      const expectedDuration = countWords(section.text) / Math.max(0.1, this.videoConfig.narration_words_per_second);
      if (audioDuration < expectedDuration * 0.4) throw new Error(`Narration segment ${index + 1} appears truncated (${audioDuration.toFixed(1)}s for ${countWords(section.text)} words)`);
      const assetPath = await this.repository.writeNarrationAudio(task.channel_id, task.episode_id, audio, index + 1);
      segmentPaths.push((await this.repository.getEpisodeAudioFile(task.channel_id, task.episode_id, path.basename(assetPath))).absolutePath);
    }
    await this.update(task.task_id, { progress_message: "Assembling narration", progress_percent: 82 });
    const merged = sections.length === 1 && !this.audioConfig.match_target_duration
      ? await readFile(segmentPaths[0])
      : await this.mergeNarrationSegments(segmentPaths, this.audioConfig.match_target_duration ? episode.target_duration_minutes * 60 : undefined);
    const assetPath = await this.repository.writeNarrationAudio(task.channel_id, task.episode_id, merged);
    const duration = parseWavDuration(merged);
    const narrationWordCount = countWords(extractNarration(script.content));
    await this.repository.saveNarrationMetadata(task.channel_id, task.episode_id, assetPath, duration, sections.length, narrationWordCount);
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
    const active = [...this.active.values()].find((run) => (threadId ? run.threadId === threadId : true) && (turnId ? run.turnId === turnId : true));
    if (!active) return;
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
      let outputFiles: string[] = [];
      if (task.task_type === "GENERATE_DNA") {
        await this.repository.saveChannelDna(task.channel_id, extractMarkdown(output, "# Channel DNA"));
        outputFiles = [`channels/${(await this.repository.getChannel(task.channel_id)).slug}/channel_dna.md`];
      } else if (task.task_type === "SUGGEST_TOPICS") {
        const candidates = parseTopicCandidates(output, task.channel_id);
        await this.repository.saveTopicRun(task.channel_id, candidates);
        outputFiles = [`channels/${(await this.repository.getChannel(task.channel_id)).slug}/topics/`];
      } else if (task.task_type === "GENERATE_RESEARCH") {
        const research = extractMarkdown(output, "# Research Dossier");
        validateResearch(research);
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "research.md", research);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "RESEARCH_READY");
        outputFiles = [(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "research.md")).path];
      } else if (task.task_type === "GENERATE_TREATMENT") {
        const treatment = extractMarkdown(output, "# Documentary Treatment");
        validateTreatment(treatment);
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "treatment.md", treatment);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "TREATMENT_READY");
        outputFiles = [(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "treatment.md")).path];
      } else if (task.task_type === "GENERATE_SCRIPT") {
        const episode = await this.repository.getEpisode(task.channel_id, task.episode_id!);
        const script = extractScriptMarkdown(output, episode.topic.title);
        validateScript(script, calibratedScriptTargetWords(episode, this.videoConfig.narration_words_per_second));
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "script.md", script);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "SCRIPT_READY");
        outputFiles = [`${(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "script.md")).path}`];
      } else if (task.task_type === "GENERATE_VISUAL_BIBLE") {
        const visualBible = extractMarkdown(output, "# Episode Visual Bible");
        validateVisualBible(visualBible);
        await this.repository.saveEpisodeFile(task.channel_id, task.episode_id!, "visual_bible.md", visualBible);
        await this.repository.updateEpisodeStage(task.channel_id, task.episode_id!, "VISUAL_BIBLE_READY");
        outputFiles = [(await this.repository.getEpisodeFile(task.channel_id, task.episode_id!, "visual_bible.md")).path];
      } else if (task.task_type === "GENERATE_BUNDLE_IMAGE") {
        if (!this.imageConfig.enabled) throw new Error("Image generation is disabled in Settings");
        const bundleNumber = this.findSceneNumber(task.task_id);
        if (!bundleNumber) throw new Error("Bundle number is required");
        const imageTarget = {
          channelId: task.channel_id,
          episodeId: task.episode_id!,
          bundleNumber,
          variant: this.imageVariants.get(task.task_id) ?? 0,
        };
        const image = ShopAiKeyImageProvider.isConfigured()
          ? await new ShopAiKeyImageProvider(this.repository, imageTarget).generateReference(active.manifest.prompt)
          : await new CodexImageProvider(this.repository, imageTarget, output).generateReference(active.manifest.prompt);
        const bundleId = `CB-${String(bundleNumber).padStart(2, "0")}`;
        await this.repository.attachBundleReference(task.channel_id, task.episode_id!, bundleId, image.asset_path);
        outputFiles = [image.asset_path];
      } else if (task.task_type === "GENERATE_SEQUENCE_SCENES") {
        const sequenceNumber = this.findSceneNumber(task.task_id);
        if (!sequenceNumber) throw new Error("Sequence number is required");
        const beats = parseBeatsOutput(output);
        validateBeatOutput(beats, 1);
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
        const beats = parseBeatsOutput(output);
        validateBeatOutput(beats);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not persist Codex output";
      if (active.task.task_type === "GENERATE_SCRIPT" && active.scriptAttempts < 1 && message.startsWith("Script quality gate failed")) {
        try {
          await this.retryScript(active, message);
          return;
        } catch (retryError) {
          await this.finish(active.task.task_id, "FAILED", retryError instanceof Error ? retryError.message : message);
          return;
        }
      }
      if (active.task.task_type === "GENERATE_VISUAL_BIBLE" && active.visualBibleAttempts < 1 && message.startsWith("Visual bible quality gate failed")) {
        try {
          await this.retryVisualBible(active, message);
          return;
        } catch (retryError) {
          await this.finish(active.task.task_id, "FAILED", retryError instanceof Error ? retryError.message : message);
          return;
        }
      }
      await this.finish(active.task.task_id, "FAILED", message);
    }
  }

  private async retryScript(active: ActiveRun, reason: string): Promise<void> {
    const episode = await this.repository.getEpisode(active.task.channel_id, active.task.episode_id!);
    const targetWords = calibratedScriptTargetWords(episode, this.videoConfig.narration_words_per_second);
    const bounds = scriptWordBounds(targetWords);
    const previousThreadId = active.threadId;
    const threadId = await this.codex.startThread();
    const turnId = await this.codex.startTurn(threadId, `${active.manifest.prompt}\n\nSTRICT RETRY: The previous response failed validation (${reason}). Start over in a fresh response. Return only one Markdown narration script, with no planning, reasoning, research dossier, treatment, tool output, JSON, or explanation. Keep spoken narration between ${bounds.lower} and ${bounds.upper} words for the ${episode.target_duration_minutes}-minute target; aim for approximately ${targetWords} words. Do not echo any scoped files. Preserve the HUMOR_POLICY marker and restrained AUDIO_CUE comments.`);
    active.threadId = threadId;
    active.turnId = turnId;
    active.output = "";
    active.scriptAttempts += 1;
    await this.update(active.task.task_id, { codex_thread_id: threadId, codex_turn_id: turnId, progress_message: "Retrying script with strict word budget" });
    if (previousThreadId !== threadId) void this.codex.deleteThread(previousThreadId).catch(() => undefined);
  }

  private async retryVisualBible(active: ActiveRun, reason: string): Promise<void> {
    const previousThreadId = active.threadId;
    const threadId = await this.codex.startThread();
    const turnId = await this.codex.startTurn(threadId, `${active.manifest.prompt}\n\nSTRICT RETRY: The previous Visual Bible failed validation (${reason}). Start over in a fresh response. Return only the Markdown Episode Visual Bible, with no reasoning, research, treatment, tool output, JSON, or explanation. Include at least five stable bundles using exact second-level headings \`## Continuity bundle CB-01 — Title\`, \`CB-02\`, and so on. Every bundle must include Era, Location, Subjects, Palette, Lighting, Anchor-frame prompt, and Reference asset slots. Do not use alternative heading names. Do not omit bundle IDs.`);
    active.threadId = threadId;
    active.turnId = turnId;
    active.output = "";
    active.visualBibleAttempts += 1;
    await this.update(active.task.task_id, { codex_thread_id: threadId, codex_turn_id: turnId, progress_message: "Retrying visual bible with strict continuity schema" });
    if (previousThreadId !== threadId) void this.codex.deleteThread(previousThreadId).catch(() => undefined);
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
    const shouldDelete = Boolean(threadId && this.codexCleanupConfig.auto_delete_threads && (status === "COMPLETED" || ((status === "FAILED" || status === "CANCELLED") && this.codexCleanupConfig.failed_thread_retention_days === 0)));
    if (shouldDelete && threadId && await this.tryDeleteThread(threadId)) await this.update(taskId, { codex_thread_id: null });
  }

  async cleanupCodexThreads(force = false): Promise<{ removed: number }> {
    if (!force && !this.codexCleanupConfig.auto_delete_threads) return { removed: 0 };
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
      if (!task.codex_thread_id || !(await this.tryDeleteThread(task.codex_thread_id))) continue;
      await this.update(task.task_id, { codex_thread_id: null });
      removed += 1;
    }
    return { removed };
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => void this.cleanupCodexThreads(), 3 * 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  private async tryDeleteThread(threadId: string): Promise<boolean> {
    const client = this.codex as unknown as { deleteThread?: (id: string) => Promise<boolean> };
    if (!client.deleteThread) return false;
    try {
      return await client.deleteThread.call(this.codex, threadId);
    } catch (error) {
      this.logger.debug(`Codex thread cleanup skipped: ${error instanceof Error ? error.message : "unknown error"}`, { step: "codex_thread_cleanup" });
      return false;
    }
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
  let value = fenced || output.trim();
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

export function parseBeatsOutput(output: string): Beat[] {
  const raw = parseJson(output);
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

function validateResearch(markdown: string): void {
  const sourceCount = new Set(markdown.match(/https?:\/\/[^\s)>\]]+/g) ?? []).size;
  const claimCount = new Set(markdown.match(/\bC\d{2,}\b/g) ?? []).size;
  if (sourceCount < 5) throw new Error(`Research quality gate failed: found ${sourceCount} source URLs; at least 5 are required`);
  if (claimCount < 5) throw new Error(`Research quality gate failed: found ${claimCount} claim IDs; at least 5 are required`);
}

function validateTreatment(markdown: string): void {
  const sequenceCount = Math.max(
    new Set(markdown.match(/\bSequence\s+\d+\b/gi) ?? []).size,
    (markdown.match(/\bTime budget\b/gi) ?? []).length,
    (markdown.match(/^##+\s+\d+[.):-]\s+/gim) ?? []).length,
  );
  if (sequenceCount < 5) throw new Error(`Treatment quality gate failed: found ${sequenceCount} sequences; at least 5 are required`);
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

function validateVisualBible(markdown: string): void {
  const bundles = Math.max(
    new Set(markdown.match(/\bCB[-_ ]?\d{1,2}\b/gi) ?? []).size,
    new Set([...markdown.matchAll(/Bundle ID:\s*([^\r\n]+)/gi)].map((match) => match[1].trim().toLowerCase())).size,
    (markdown.match(/^##+\s+Continuity bundle\b/gim) ?? []).length,
  );
  if (!/continuity bundle/i.test(markdown) || bundles < 5) throw new Error(`Visual bible quality gate failed: found ${bundles} stable continuity bundle IDs; at least 5 are required`);
  for (const required of ["palette", "lighting", "reference asset", "anchor-frame"]) {
    if (!markdown.toLowerCase().includes(required)) throw new Error(`Visual bible quality gate failed: missing ${required}`);
  }
}

function validateBeatOutput(beats: Beat[], minimumSequences = 5): void {
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
