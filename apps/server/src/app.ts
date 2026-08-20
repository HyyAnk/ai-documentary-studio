import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import {
  ApprovalDecisionSchema,
  AssignVoiceInputSchema,
  AudioSettingsInputSchema,
  CodexSettingsInputSchema,
  CreateVoiceInputSchema,
  CreateChannelInputSchema,
  GenerateAllAudioInputSchema,
  GenerateAllBundleImagesInputSchema,
  EpisodeSettingsInputSchema,
  SaveTextInputSchema,
  SceneSchema,
  TopicConfirmInputSchema,
  UpdateChannelInputSchema,
  StoragePathInputSchema,
  VoiceReferenceUploadSchema,
  VideoSettingsInputSchema,
  ImageSettingsInputSchema,
  type AppConfig,
  type StorageInfo,
  type TaskEvent,
  type Task,
  type TaskType,
} from "@studio/shared";
import { loadConfig, loadStorageRoot, saveAudioSettings, saveCodexSettings, saveImageSettings, saveStorageRoot, saveVideoSettings } from "./config.js";
import { CodexAppServerClient } from "./codex.js";
import { ContextEngine } from "./context.js";
import { StudioLogger } from "./logger.js";
import { RepositoryError, RepositoryService } from "./repository.js";
import { TaskManager } from "./tasks.js";
import { synthesizeWav } from "./providers/chatterbox.js";
import { createStoredZip } from "./zip.js";
import { composeMergedVisualPrompt, mergeEditorialOverlays, optimizeShortScenes } from "./sceneTiming.js";
import { assessProduction, countWords, extractNarration, extractNarrationChunks, extractNarrationSections } from "./production.js";
import { parseContinuityBundles } from "./visualBundles.js";
import { loadServerEnv } from "./env.js";
import { assertQuizRenderReady, compileTimeline, generateDirector, generateQuiz, generateVoice, planAssets, planVoice, readQuizArtifacts, resolveAssets, runQa } from "./quiz/pipeline/orchestrator.js";

const VOICE_PREVIEW_TEXT = "This is a preview of this narrator voice for AI Documentary Studio.";

async function createVoiceWithPreview(repository: RepositoryService, name: string, reference: Uint8Array, audioConfig: AppConfig["audio_generation"]) {
  let profile: Awaited<ReturnType<RepositoryService["createVoiceProfile"]>> | null = null;
  try {
    profile = await repository.createVoiceProfile(name, reference, new Uint8Array());
    const sample = await synthesizeWav(audioConfig, VOICE_PREVIEW_TEXT, repository.resolveContextPath(profile.reference_path));
    await repository.updateVoiceSample(profile.voice_id, sample);
    return repository.getVoice(profile.voice_id);
  } catch (error) {
    if (profile) await repository.deleteVoiceProfile(profile.voice_id).catch(() => undefined);
    throw error;
  }
}

export type StudioApp = {
  server: FastifyInstance;
  repository: RepositoryService;
  tasks: TaskManager;
  logger: StudioLogger;
  close: () => Promise<void>;
};

export type BuildAppOptions = {
  /** Keep credentials outside isolated episode/demo storage roots. */
  environmentRoot?: string;
  /** Allows test hosts to replace the local file explorer integration. */
  revealFile?: (filePath: string) => Promise<void>;
};

export async function buildApp(rootDirectory = process.env.STUDIO_ROOT ?? process.cwd(), options: BuildAppOptions = {}): Promise<StudioApp> {
  await loadServerEnv(options.environmentRoot ?? rootDirectory);
  const revealFile = options.revealFile ?? revealFileInSystem;
  const configuredStorageRoot = await loadStorageRoot(rootDirectory);
  const logger = new StudioLogger(rootDirectory, process.env.STUDIO_DEBUG === "1");
  logger.setRuntimeRoot(path.join(configuredStorageRoot ?? rootDirectory, ".documentary-studio"));
  await logger.init();
  let storageConfigured = Boolean(configuredStorageRoot);
  const repository = new RepositoryService(rootDirectory, configuredStorageRoot ?? rootDirectory);
  await repository.ensureBootstrap();
  let config = await loadConfig(rootDirectory);
  const codex = new CodexAppServerClient(rootDirectory, config, logger);
  const contextEngine = new ContextEngine(repository, logger);
  const tasks = new TaskManager(repository, contextEngine, codex, config.codex.max_concurrent_tasks, config.video_generation, logger, config.audio_generation, undefined, config.codex, config.image_generation);
  await tasks.load();
  const getStorageInfo = (): StorageInfo => ({
    path: repository.storageRoot,
    default_path: path.resolve(rootDirectory),
    channel_path: repository.roots.channels,
    configured: storageConfigured,
  });
  const server = Fastify({ logger: false });
  const clients = new Set<{ send: (payload: string) => void; readyState: number; OPEN: number }>();

  await server.register(cors, { origin: true });
  await server.register(websocket);
  const frontendDirectory = path.join(rootDirectory, "apps", "web", "dist");
  try {
    await access(frontendDirectory);
    await server.register(fastifyStatic, { root: frontendDirectory, prefix: "/", index: false });
    server.get("/", async (_request, reply) => reply.sendFile("index.html"));
  } catch {
    // Vite serves the web app during development.
  }

  tasks.on("event", (event: TaskEvent) => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  server.get("/api/health", async () => ({ ok: true, service: "ai-documentary-studio", codex_status: tasks.getStatus() }));
  server.post("/api/shutdown", async (_request, reply) => {
    if (process.platform === "win32") {
      const script = path.join(rootDirectory, "scripts", "stop-dashboard.ps1");
      spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProjectRoot", rootDirectory, "-DelayMilliseconds", "900"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    }

    await reply.code(202).send({ ok: true });
    setTimeout(() => {
      void codex.close().catch(() => undefined).finally(() => {
        void server.close().finally(() => process.exit(0));
      });
    }, 500);
  });
  server.get("/api/git", async () => repository.getGitInfo());
  server.get("/api/config", async () => ({ ...config, codex: { ...config.codex, api_key: "" } }));
  server.get("/api/storage", async () => getStorageInfo());
  server.post("/api/storage", async (request) => {
    const { path: requestedPath } = StoragePathInputSchema.parse(request.body);
    if (tasks.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing storage", "STORAGE_BUSY");
    const nextStorageRoot = path.resolve(rootDirectory, requestedPath);
    const gitDirectory = path.resolve(rootDirectory, ".git");
    if (nextStorageRoot === gitDirectory || nextStorageRoot.startsWith(`${gitDirectory}${path.sep}`)) {
      throw new RepositoryError("Storage folder cannot be inside .git", "INVALID_STORAGE_PATH");
    }
    await mkdir(nextStorageRoot, { recursive: true });
    repository.setStorageRoot(nextStorageRoot);
    await repository.ensureBootstrap();
    logger.setRuntimeRoot(repository.roots.runtime);
    await tasks.reload();
    await saveStorageRoot(rootDirectory, nextStorageRoot);
    storageConfigured = true;
    logger.ok("Content storage folder updated", { step: "storage" });
    return getStorageInfo();
  });
  server.get("/api/codex/info", async () => codex.detectInstallation());
  server.get("/api/codex/settings", async () => ({
    settings: {
      transport: config.codex.transport,
      model: config.codex.model,
      api_base_url: config.codex.api_base_url,
      has_api_key: Boolean(config.codex.api_key),
      app_server_endpoint: config.codex.app_server_endpoint,
      command: config.codex.command,
      auto_delete_threads: config.codex.auto_delete_threads,
      failed_thread_retention_days: config.codex.failed_thread_retention_days,
    },
    models: await codex.getModels(),
    installation: await codex.detectInstallation(),
  }));
  server.get("/api/codex/models", async () => ({ models: await codex.getModels() }));
  server.post("/api/codex/settings", async (request) => {
    const input = CodexSettingsInputSchema.parse(request.body);
    if (tasks.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing Codex settings", "CODEX_SETTINGS_BUSY");
    const wasConnected = codex.isConnected;
    if (wasConnected) await codex.close();
    config = await saveCodexSettings(rootDirectory, input);
    codex.updateConfig(config);
    tasks.updateCodexConfig(config.codex);
    if (wasConnected) await codex.connect().catch(() => undefined);
    return {
      settings: {
        transport: config.codex.transport,
        model: config.codex.model,
        api_base_url: config.codex.api_base_url,
        has_api_key: Boolean(config.codex.api_key),
        app_server_endpoint: config.codex.app_server_endpoint,
        command: config.codex.command,
        auto_delete_threads: config.codex.auto_delete_threads,
        failed_thread_retention_days: config.codex.failed_thread_retention_days,
      },
      models: await codex.getModels(),
      installation: await codex.detectInstallation(),
    };
  });
  server.post("/api/codex/cleanup", async () => tasks.cleanupCodexThreads(true));
  server.post("/api/audio/settings", async (request) => {
    const input = AudioSettingsInputSchema.parse(request.body);
    if (tasks.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing audio settings", "AUDIO_SETTINGS_BUSY");
    config = await saveAudioSettings(rootDirectory, input);
    tasks.updateAudioConfig(config.audio_generation);
    return { audio_generation: config.audio_generation };
  });
  server.post("/api/video/settings", async (request) => {
    const input = VideoSettingsInputSchema.parse(request.body);
    if (tasks.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing video settings", "VIDEO_SETTINGS_BUSY");
    config = await saveVideoSettings(rootDirectory, input);
    tasks.updateVideoConfig(config.video_generation);
    return { video_generation: config.video_generation };
  });
  server.post("/api/image/settings", async (request) => {
    const input = ImageSettingsInputSchema.parse(request.body);
    if (tasks.hasActiveWork()) throw new RepositoryError("Finish active tasks before changing image settings", "IMAGE_SETTINGS_BUSY");
    config = await saveImageSettings(rootDirectory, input);
    tasks.updateImageConfig(config.image_generation);
    return { image_generation: config.image_generation };
  });
  server.get("/api/voices", async () => ({ voices: await repository.listVoices() }));
  server.get("/api/voices/:voiceId/sample", async (request, reply) => {
    const file = await repository.getVoiceSampleFile((request.params as { voiceId: string }).voiceId);
    return reply.headers({ "content-type": "audio/wav", "content-length": file.size, "cache-control": "no-store" }).send(createReadStream(file.absolutePath));
  });
  server.post("/api/voices", async (request) => {
    const input = CreateVoiceInputSchema.parse(request.body);
    const audio = Buffer.from(input.data, "base64");
    if (audio.length < 12 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
      throw new RepositoryError("Voice reference must be a WAV file", "INVALID_AUDIO");
    }
    return createVoiceWithPreview(repository, input.name, audio, config.audio_generation);
  });
  server.delete("/api/voices/:voiceId", async (request) => {
    await repository.deleteVoiceProfile((request.params as { voiceId: string }).voiceId);
    return { ok: true };
  });
  server.get("/api/channels", async (request) => {
    const query = request.query as { includeArchived?: string };
    return { channels: await repository.listChannels(query.includeArchived !== "false") };
  });
  server.post("/api/channels", async (request, reply) => {
    const input = CreateChannelInputSchema.parse(request.body);
    const channel = await repository.createChannel(input);
    const task = input.dna_mode === "ai" ? tasks.submit("GENERATE_DNA", channel.channel_id, null) : null;
    return reply.code(201).send({ channel, task });
  });
  server.patch("/api/channels/:channelId", async (request) => {
    const params = request.params as { channelId: string };
    const patch = UpdateChannelInputSchema.parse(request.body);
    return repository.updateChannel(params.channelId, patch);
  });
  server.put("/api/channels/:channelId/voice", async (request) => {
    const channelId = (request.params as { channelId: string }).channelId;
    const { voice_id: voiceId } = AssignVoiceInputSchema.parse(request.body);
    return repository.assignVoice(channelId, voiceId);
  });
  server.put("/api/channels/:channelId/voice-reference", async (request) => {
    const { data } = VoiceReferenceUploadSchema.parse(request.body);
    const audio = Buffer.from(data, "base64");
    if (audio.length < 12 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
      throw new RepositoryError("Voice reference must be a WAV file", "INVALID_AUDIO");
    }
    const channelId = (request.params as { channelId: string }).channelId;
    const channel = await repository.getChannel(channelId);
    const voice = await createVoiceWithPreview(repository, `${channel.display_name} (uploaded)`, audio, config.audio_generation);
    const assigned = await repository.assignVoice(channelId, voice.voice_id);
    return { path: assigned.voice_reference_path, modified_at: new Date().toISOString(), voice, channel: assigned };
  });
  server.delete("/api/channels/:channelId", async (request) => {
    const params = request.params as { channelId: string };
    const query = request.query as { confirm?: string };
    await repository.deleteChannel(params.channelId, query.confirm === "true");
    return { ok: true };
  });
  server.get("/api/channels/:channelId/dna", async (request) => repository.getChannelDna((request.params as { channelId: string }).channelId));
  server.put("/api/channels/:channelId/dna", async (request) => {
    const { content } = SaveTextInputSchema.parse(request.body);
    return repository.saveChannelDna((request.params as { channelId: string }).channelId, content);
  });
  server.get("/api/channels/:channelId/topics", async (request) => ({ topics: await repository.listTopics((request.params as { channelId: string }).channelId) }));
  server.post("/api/channels/:channelId/topics/suggest", async (request, reply) => {
    const channelId = (request.params as { channelId: string }).channelId;
    const task = tasks.submit("SUGGEST_TOPICS", channelId, null);
    return reply.code(202).send({ task });
  });
  server.post("/api/channels/:channelId/topics/:topicId/confirm", async (request, reply) => {
    const params = request.params as { channelId: string; topicId: string };
    const payload = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body : {};
    const input = TopicConfirmInputSchema.parse({ ...payload, topic_id: params.topicId });
    return reply.code(201).send({ episode: await repository.confirmTopic(params.channelId, input.topic_id, input.question_count) });
  });
  server.get("/api/channels/:channelId/episodes", async (request) => ({ episodes: await repository.listEpisodes((request.params as { channelId: string }).channelId) }));
  server.delete("/api/channels/:channelId/episodes/:episodeId", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const query = request.query as { confirm?: string };
    await repository.deleteEpisode(params.channelId, params.episodeId, query.confirm === "true");
    return { ok: true };
  });
  server.patch("/api/channels/:channelId/episodes/:episodeId", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const input = EpisodeSettingsInputSchema.parse(request.body);
    return repository.updateEpisodeSettings(params.channelId, params.episodeId, input, config.video_generation.narration_words_per_second);
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/file/:filename", async (request) => {
    const params = request.params as { channelId: string; episodeId: string; filename: string };
    return repository.getEpisodeFile(params.channelId, params.episodeId, params.filename);
  });
  server.put("/api/channels/:channelId/episodes/:episodeId/file/:filename", async (request) => {
    const params = request.params as { channelId: string; episodeId: string; filename: string };
    const { content } = SaveTextInputSchema.parse(request.body);
    return repository.saveEpisodeFile(params.channelId, params.episodeId, params.filename, content);
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/scenes", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return { scenes: await repository.readScenes(params.channelId, params.episodeId) };
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/quiz-v2", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const episode = await repository.getEpisode(params.channelId, params.episodeId);
    const { quiz, director_plan: directorPlan, asset_plan: assetPlan, asset_resolution: assetResolution, voice_plan: voicePlan, timeline, assessment } = await readQuizArtifacts({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
    const active = tasks.list().find((task) => task.episode_id === params.episodeId && ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status));
    return {
      quiz,
      director_plan: directorPlan,
      asset_plan: assetPlan,
      asset_resolution: assetResolution,
      voice_plan: voicePlan,
      timeline,
      assessment,
      stages: {
        research: ["RESEARCH_READY", "TREATMENT", "TREATMENT_READY", "SCRIPT", "SCRIPT_READY", "VISUAL_BIBLE", "VISUAL_BIBLE_READY", "SCENE_BREAKDOWN", "SCENE_READY", "NARRATION_READY", "READY_FOR_GENERATION", "VIDEO_RENDERING", "VIDEO_READY"].includes(episode.stage) ? "ready" : "not_started",
        questions: quiz ? "ready" : "not_started",
        director: directorPlan ? "ready" : "not_started",
        assets: assetPlan ? "ready" : "not_started",
        voice: voicePlan ? "ready" : "not_started",
        timeline: timeline ? "ready" : "not_started",
        qa: assessment ? assessment.issues.some((issue) => issue.severity === "blocker") ? "failed" : "ready" : "not_started",
        render: active?.task_type === "GENERATE_VIDEO" ? "running" : episode.video_asset_path ? "ready" : "not_started",
      },
    };
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/generate", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return generateQuiz({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/director/generate", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return generateDirector({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/assets/plan", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return planAssets({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/assets/resolve", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return resolveAssets({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/voice/plan", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return planVoice({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/voice/generate", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return generateVoice({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/timeline/compile", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return compileTimeline({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/qa", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return runQa({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/quiz-v2/render", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string };
    const channel = await repository.getChannel(params.channelId);
    if (channel.engine !== "quiz") throw new RepositoryError("Quiz V2 rendering is only available for Quiz channels", "QUIZ_CHANNEL_REQUIRED");
    await assertQuizRenderReady({ repository, config, channelId: params.channelId, episodeId: params.episodeId });
    const task = tasks.submit("GENERATE_VIDEO", params.channelId, params.episodeId);
    return reply.code(202).send({ task });
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/visual-bible/images", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    return { images: await repository.listBundleImages(params.channelId, params.episodeId) };
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/visual-bible/bundles/:bundleNumber/image", async (request, reply) => {
    if (!config.image_generation.enabled) throw new RepositoryError("Image generation is disabled in Settings", "IMAGE_GENERATION_DISABLED");
    const params = request.params as { channelId: string; episodeId: string; bundleNumber: string };
    const bundleNumber = Number(params.bundleNumber);
    const visualBible = await repository.getEpisodeFile(params.channelId, params.episodeId, "visual_bible.md");
    if (!parseContinuityBundles(visualBible.content).some((bundle) => bundle.bundle_number === bundleNumber)) throw new RepositoryError("Continuity bundle was not found", "BUNDLE_NOT_FOUND");
    const task = tasks.submit("GENERATE_BUNDLE_IMAGE", params.channelId, params.episodeId, bundleNumber);
    return reply.code(202).send({ task });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/visual-bible/images/generate-all", async (request, reply) => {
    if (!config.image_generation.enabled) throw new RepositoryError("Image generation is disabled in Settings", "IMAGE_GENERATION_DISABLED");
    const params = request.params as { channelId: string; episodeId: string };
    const { force } = GenerateAllBundleImagesInputSchema.parse(request.body ?? {});
    const visualBible = await repository.getEpisodeFile(params.channelId, params.episodeId, "visual_bible.md");
    const bundles = parseContinuityBundles(visualBible.content);
    const existing = await repository.listBundleImages(params.channelId, params.episodeId);
    const active = tasks.list().filter((task) => task.episode_id === params.episodeId && task.task_type === "GENERATE_BUNDLE_IMAGE" && ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status));
    const created: Task[] = [];
    for (const bundle of bundles) {
      if (active.some((task) => task.scene_number === bundle.bundle_number)) continue;
      if (force) await repository.clearBundleImages(params.channelId, params.episodeId, bundle.bundle_number);
      const current = force ? [] : existing.filter((image) => image.bundle_number === bundle.bundle_number);
      for (let variant = 0; variant < config.image_generation.images_per_bundle; variant += 1) {
        if (current.some((image) => image.variant === variant)) continue;
        created.push(tasks.submit("GENERATE_BUNDLE_IMAGE", params.channelId, params.episodeId, bundle.bundle_number, variant));
      }
    }
    return reply.code(202).send({ tasks: created, bundle_count: bundles.length });
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/visual-bible/images/download", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string };
    const episode = await repository.getEpisode(params.channelId, params.episodeId);
    const images = await repository.listBundleImages(params.channelId, params.episodeId);
    if (images.length === 0) throw new RepositoryError("No reference images have been generated", "IMAGE_NOT_FOUND");
    const zip = createStoredZip(await Promise.all(images.map(async (image) => ({ name: image.filename, data: await readFile(image.absolutePath) }))));
    return reply.headers({ "content-type": "application/zip", "content-disposition": `attachment; filename="${episode.slug}-reference-images.zip"` }).send(zip);
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/visual-bible/images/:filename", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string; filename: string };
    const file = await repository.getBundleImageFile(params.channelId, params.episodeId, params.filename);
    return reply.headers({ "content-type": "image/png", "content-length": file.size, "last-modified": file.modified_at, "cache-control": "no-store", "content-disposition": `inline; filename="${file.filename}"` }).send(createReadStream(file.absolutePath));
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/production-assessment", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const [episode, research, treatment, visualBible, script, scenes] = await Promise.all([
      repository.getEpisode(params.channelId, params.episodeId),
      repository.getEpisodeFile(params.channelId, params.episodeId, "research.md"),
      repository.getEpisodeFile(params.channelId, params.episodeId, "treatment.md"),
      repository.getEpisodeFile(params.channelId, params.episodeId, "visual_bible.md"),
      repository.getEpisodeFile(params.channelId, params.episodeId, "script.md"),
      repository.readScenes(params.channelId, params.episodeId),
    ]);
    return { assessment: assessProduction({ episode, research: research.content, treatment: treatment.content, visualBible: visualBible.content, script: script.content, scenes, fallbackWordsPerSecond: config.video_generation.narration_words_per_second }) };
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/shots/generate", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string };
    const script = await repository.getEpisodeFile(params.channelId, params.episodeId, "script.md");
    const sequenceCount = extractNarrationSections(script.content).length;
    if (sequenceCount < 1) throw new RepositoryError("A completed script is required", "SCRIPT_REQUIRED");
    await repository.backupEpisodeFile(params.channelId, params.episodeId, "scene_plan.md");
    await repository.clearSequenceDrafts(params.episodeId);
    const created = Array.from({ length: sequenceCount }, (_, index) => tasks.submit("GENERATE_SEQUENCE_SCENES", params.channelId, params.episodeId, index + 1));
    return reply.code(202).send({ tasks: created, sequence_count: sequenceCount });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/shots/optimize", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const scenes = await repository.readScenes(params.channelId, params.episodeId);
    const optimized = optimizeShortScenes(scenes, config.video_generation.max_scene_duration_seconds, params.episodeId);
    await repository.saveScenes(params.channelId, params.episodeId, optimized);
    return { scenes: await repository.readScenes(params.channelId, params.episodeId), merged: scenes.length - optimized.length };
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/narration/assemble", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const channel = await repository.getChannel(params.channelId);
    if (channel.engine === "quiz") throw new RepositoryError("Quiz channels use Quiz V2 voice generation", "QUIZ_V2_REQUIRED");
    const [episode, script] = await Promise.all([
      repository.getEpisode(params.channelId, params.episodeId),
      repository.getEpisodeFile(params.channelId, params.episodeId, "script.md"),
    ]);
    const chunks = extractNarrationChunks(script.content, 60, true).filter((chunk) => countWords(chunk.text) >= 3);
    const paths: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      paths.push((await repository.getEpisodeAudioFile(params.channelId, params.episodeId, `narration-${String(index + 1).padStart(2, "0")}.wav`)).absolutePath);
    }
    let response: Response;
    try {
      response = await fetch(`${config.audio_generation.service_url.replace(/\/$/, "")}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths, gap_ms: config.audio_generation.merge_gap_ms, ...(config.audio_generation.match_target_duration ? { target_duration_seconds: episode.target_duration_minutes * 60 } : {}) }),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
    } catch {
      throw new RepositoryError("Audio service unavailable", "AUDIO_SERVICE_UNAVAILABLE");
    }
    if (!response.ok) throw new RepositoryError(`Narration assembly failed: ${(await response.text()).slice(0, 240)}`, "AUDIO_MERGE_FAILED");
    const audio = new Uint8Array(await response.arrayBuffer());
    const assetPath = await repository.writeNarrationAudio(params.channelId, params.episodeId, audio);
    const duration = wavDurationSeconds(audio);
    const updated = await repository.saveNarrationMetadata(params.channelId, params.episodeId, assetPath, duration, chunks.length, countWords(extractNarration(script.content)));
    return { episode: updated, asset_path: assetPath };
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/scenes/:sceneNumber/audio", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string; sceneNumber: string };
    const sceneNumber = Number(params.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) throw new RepositoryError("Scene number is required", "SCENE_REQUIRED");
    const task = tasks.submit("GENERATE_AUDIO", params.channelId, params.episodeId, sceneNumber);
    return reply.code(202).send({ task });
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/scenes/:sceneNumber/merge-next", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string; sceneNumber: string };
    const sceneNumber = Number(params.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) throw new RepositoryError("Scene number is required", "SCENE_REQUIRED");

    const scenes = await repository.readScenes(params.channelId, params.episodeId);
    const index = scenes.findIndex((scene) => scene.scene_number === sceneNumber);
    const next = index < 0 ? null : scenes[index + 1];
    if (index < 0 || !next) return reply.code(409).send({ error: "There is no next scene to combine" });

    const current = scenes[index];
    const mergedDuration = current.duration_seconds + next.duration_seconds;
    const maxDuration = config.video_generation.max_scene_duration_seconds;
    if (mergedDuration > maxDuration) {
      return reply.code(409).send({ error: `Merged duration would exceed the ${maxDuration}s scene limit.` });
    }

    const merged = {
      ...current,
      duration_seconds: mergedDuration,
      dialogue: `${current.dialogue.trim()} ${next.dialogue.trim()}`.trim(),
      visual_prompt: composeMergedVisualPrompt(current, next),
      transition_note: next.transition_note,
      continuity_note: current.continuity_note,
      editorial_overlay: mergeEditorialOverlays(current.editorial_overlay, next.editorial_overlay),
      audio_asset_path: null,
      audio_generated_at: null,
      audio_duration_seconds: null,
    };
    await repository.saveScenes(params.channelId, params.episodeId, [...scenes.slice(0, index), merged, ...scenes.slice(index + 2)]);
    return { scenes: await repository.readScenes(params.channelId, params.episodeId) };
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/audio/generate-all", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string };
    const { force } = GenerateAllAudioInputSchema.parse(request.body ?? {});
    const scenes = await repository.readScenes(params.channelId, params.episodeId);
    const created = scenes
      .filter((scene) => force || !scene.audio_asset_path)
      .map((scene) => tasks.submit("GENERATE_AUDIO", params.channelId, params.episodeId, scene.scene_number));
    return reply.code(202).send({ tasks: created });
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/audio/download", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string };
    const mode = (request.query as { mode?: string }).mode ?? "separate";
    if (mode !== "separate" && mode !== "merged") throw new RepositoryError("Download mode must be separate or merged", "INVALID_DOWNLOAD_MODE");
    const episode = await repository.getEpisode(params.channelId, params.episodeId);
    const scenes = (await repository.readScenes(params.channelId, params.episodeId)).sort((a, b) => a.scene_number - b.scene_number);
    const assets: Array<{ sceneNumber: number; absolutePath: string; filename: string }> = [];
    const missing: number[] = [];
    for (const scene of scenes) {
      if (!scene.audio_asset_path) {
        missing.push(scene.scene_number);
        continue;
      }
      try {
        const filename = path.basename(scene.audio_asset_path);
        const file = await repository.getSceneAudioFile(params.channelId, params.episodeId, filename);
        assets.push({ sceneNumber: scene.scene_number, absolutePath: file.absolutePath, filename });
      } catch {
        missing.push(scene.scene_number);
      }
    }
    if (mode === "separate") {
      const zip = createStoredZip(await Promise.all(assets.map(async (asset) => ({ name: `scene-${String(asset.sceneNumber).padStart(2, "0")}.wav`, data: await readFile(asset.absolutePath) }))));
      return reply.headers({ "content-type": "application/zip", "content-disposition": `attachment; filename="${episode.slug}-audio-scenes.zip"` }).send(zip);
    }
    if (scenes.length === 0) {
      return reply.code(409).send({ error: "This episode has no scenes", missing_scene_numbers: [] });
    }
    if (missing.length > 0) {
      return reply.code(409).send({ error: `Scenes ${missing.join(", ")} have no audio yet`, missing_scene_numbers: missing });
    }
    let response: Response;
    try {
      response = await fetch(`${config.audio_generation.service_url.replace(/\/$/, "")}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: assets.map((asset) => asset.absolutePath), gap_ms: config.audio_generation.merge_gap_ms }),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
    } catch {
      throw new RepositoryError("Audio service unavailable", "AUDIO_SERVICE_UNAVAILABLE");
    }
    if (!response.ok) throw new RepositoryError("Audio merge failed", "AUDIO_MERGE_FAILED");
    const merged = Buffer.from(await response.arrayBuffer());
    return reply.headers({ "content-type": "audio/wav", "content-length": merged.length, "content-disposition": `attachment; filename="${episode.slug}-audio-full.wav"` }).send(merged);
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/assets/:filename", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string; filename: string };
    const file = await repository.getEpisodeAudioFile(params.channelId, params.episodeId, params.filename);
    const range = request.headers.range;
    const baseHeaders = { "content-type": "audio/wav", "accept-ranges": "bytes", "last-modified": file.modified_at };
    if (!range) return reply.headers({ ...baseHeaders, "content-length": file.size }).send(createReadStream(file.absolutePath));
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return reply.code(416).header("content-range", `bytes */${file.size}`).send();
    const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2] || 0));
    const requestedEnd = match[2] ? Number(match[2]) : file.size - 1;
    const end = Math.min(file.size - 1, requestedEnd);
    if (start < 0 || start > end || start >= file.size) return reply.code(416).header("content-range", `bytes */${file.size}`).send();
    return reply.code(206).headers({ ...baseHeaders, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${file.size}` }).send(createReadStream(file.absolutePath, { start, end }));
  });
  server.get("/api/channels/:channelId/episodes/:episodeId/video", async (request, reply) => {
    const params = request.params as { channelId: string; episodeId: string };
    const file = await repository.getEpisodeVideoFile(params.channelId, params.episodeId);
    const range = request.headers.range;
    const baseHeaders = { "content-type": "video/mp4", "accept-ranges": "bytes", "content-disposition": `inline; filename="quiz-video.mp4"`, "last-modified": file.modified_at };
    if (!range) return reply.headers({ ...baseHeaders, "content-length": file.size }).send(createReadStream(file.absolutePath));
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return reply.code(416).header("content-range", `bytes */${file.size}`).send();
    const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2] || 0));
    const requestedEnd = match[2] ? Number(match[2]) : file.size - 1;
    const end = Math.min(file.size - 1, requestedEnd);
    if (start < 0 || start > end || start >= file.size) return reply.code(416).header("content-range", `bytes */${file.size}`).send();
    return reply.code(206).headers({ ...baseHeaders, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${file.size}` }).send(createReadStream(file.absolutePath, { start, end }));
  });
  server.post("/api/channels/:channelId/episodes/:episodeId/video/open-folder", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const file = await repository.getEpisodeVideoFile(params.channelId, params.episodeId);
    await revealFile(file.absolutePath);
    return { opened: true, folder_path: path.dirname(file.path) };
  });
  server.put("/api/channels/:channelId/episodes/:episodeId/scenes", async (request) => {
    const params = request.params as { channelId: string; episodeId: string };
    const scenes = SceneSchema.array().parse(request.body);
    await repository.saveScenes(params.channelId, params.episodeId, scenes);
    return { scenes };
  });
  server.get("/api/tasks", async () => ({ tasks: tasks.list(), codex_status: tasks.getStatus() }));
  server.post("/api/tasks", async (request, reply) => {
    const body = request.body as { task_type?: TaskType; channel_id?: string; episode_id?: string | null; scene_number?: number };
    if (!body.task_type || !body.channel_id) throw new RepositoryError("Task type and channel are required", "INVALID_TASK");
    const task = tasks.submit(body.task_type, body.channel_id, body.episode_id ?? null, body.scene_number);
    return reply.code(202).send({ task });
  });
  server.post("/api/tasks/:taskId/cancel", async (request) => tasks.cancel((request.params as { taskId: string }).taskId));
  server.post("/api/tasks/:taskId/approval", async (request) => {
    const params = request.params as { taskId: string };
    const body = request.body as { request_id?: number; decision?: string };
    const parsed = ApprovalDecisionSchema.parse({ decision: body.decision });
    if (typeof body.request_id !== "number") throw new RepositoryError("Approval request id is required", "INVALID_APPROVAL");
    return tasks.decideApproval(params.taskId, body.request_id, parsed.decision);
  });
  server.post("/api/codex/reconnect", async () => {
    await codex.close();
    try {
      await codex.connect();
      return { status: "connected" };
    } catch {
      return { status: "unavailable", message: "Codex App Server unavailable" };
    }
  });
  server.get("/api/events", { websocket: true }, (socket) => {
    const client = socket as unknown as { send: (payload: string) => void; readyState: number; OPEN: number };
    clients.add(client);
    client.send(JSON.stringify({ type: "codex.status", status: tasks.getStatus() } satisfies TaskEvent));
    for (const task of tasks.list().filter((item) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(item.status))) {
      client.send(JSON.stringify({ type: "task.updated", task } satisfies TaskEvent));
    }
    socket.on("close", () => clients.delete(client));
  });

  server.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Request failed";
    const statusCode = error instanceof RepositoryError && error.code.endsWith("NOT_FOUND") ? 404 : error instanceof RepositoryError && error.code === "CONFIRMATION_REQUIRED" ? 400 : 400;
    logger.warn(`Request failed: ${message}`, { step: "http" });
    void reply.code(statusCode).send({ error: message, detail: process.env.STUDIO_DEBUG === "1" && error instanceof Error ? error.stack : undefined });
  });

  return {
    server,
    repository,
    tasks,
    logger,
    close: async () => {
      await codex.close();
      await server.close();
    },
  };
}

function wavDurationSeconds(buffer: Uint8Array): number {
  if (buffer.length < 44) throw new RepositoryError("Narration WAV is incomplete", "INVALID_AUDIO");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
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
  if (!byteRate || !dataSize) throw new RepositoryError("Narration WAV has no duration metadata", "INVALID_AUDIO");
  return Number((dataSize / byteRate).toFixed(3));
}

async function revealFileInSystem(filePath: string): Promise<void> {
  const launch = process.platform === "win32"
    ? { command: "explorer.exe", args: ["/select,", filePath], windowsHide: false }
    : process.platform === "darwin"
      ? { command: "open", args: ["-R", filePath], windowsHide: true }
      : { command: "xdg-open", args: [path.dirname(filePath)], windowsHide: true };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, { detached: true, stdio: "ignore", windowsHide: launch.windowsHide });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
