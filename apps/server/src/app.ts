import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import {
  ApprovalDecisionSchema,
  CreateChannelInputSchema,
  SaveTextInputSchema,
  SceneSchema,
  TopicConfirmInputSchema,
  UpdateChannelInputSchema,
  StoragePathInputSchema,
  type StorageInfo,
  type TaskEvent,
  type TaskType,
} from "@studio/shared";
import { loadConfig, loadStorageRoot, saveStorageRoot } from "./config.js";
import { CodexAppServerClient } from "./codex.js";
import { ContextEngine } from "./context.js";
import { StudioLogger } from "./logger.js";
import { RepositoryError, RepositoryService } from "./repository.js";
import { TaskManager } from "./tasks.js";

export type StudioApp = {
  server: FastifyInstance;
  repository: RepositoryService;
  tasks: TaskManager;
  logger: StudioLogger;
  close: () => Promise<void>;
};

export async function buildApp(rootDirectory = process.env.STUDIO_ROOT ?? process.cwd()): Promise<StudioApp> {
  const configuredStorageRoot = await loadStorageRoot(rootDirectory);
  const logger = new StudioLogger(rootDirectory, process.env.STUDIO_DEBUG === "1");
  logger.setRuntimeRoot(path.join(configuredStorageRoot ?? rootDirectory, ".documentary-studio"));
  await logger.init();
  let storageConfigured = Boolean(configuredStorageRoot);
  const repository = new RepositoryService(rootDirectory, configuredStorageRoot ?? rootDirectory);
  await repository.ensureBootstrap();
  const config = await loadConfig(rootDirectory);
  const codex = new CodexAppServerClient(rootDirectory, config, logger);
  const contextEngine = new ContextEngine(repository, logger);
  const tasks = new TaskManager(repository, contextEngine, codex, config.codex.max_concurrent_tasks, config.video_generation.max_scene_duration_seconds, logger);
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
  server.get("/api/git", async () => repository.getGitInfo());
  server.get("/api/config", async () => config);
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
    TopicConfirmInputSchema.parse({ topic_id: params.topicId });
    return reply.code(201).send({ episode: await repository.confirmTopic(params.channelId, params.topicId) });
  });
  server.get("/api/channels/:channelId/episodes", async (request) => ({ episodes: await repository.listEpisodes((request.params as { channelId: string }).channelId) }));
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
