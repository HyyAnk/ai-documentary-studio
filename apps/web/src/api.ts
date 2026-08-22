import type {
  AppConfig,
  Channel,
  CodexSettingsInput,
  CodexSettingsResponse,
  AntigravitySettingsInput,
  AntigravitySettingsResponse,
  DirectorPlan,
  Episode,
  ProductionAssessment,
  QuizAssessment,
  QuizAssetPlan,
  QuizTimeline,
  QuizV2,
  Scene,
  StorageInfo,
  Task,
  TaskEvent,
  TopicCandidate,
  VoiceProfile,
  VoicePlan,
  QuizImageStyle,
} from "@studio/shared";

export type BundleImage = {
  bundle_id: string;
  bundle_number: number;
  variant: number;
  filename: string;
  path: string;
  size: number;
  modified_at: string;
  price_vnd?: number;
  price_breakdown?: Record<string, number>;
  model?: string;
  aspect_ratio?: string;
};
export type QuizV2Stages = Record<"research" | "questions" | "director" | "assets" | "voice" | "timeline" | "qa" | "render", "not_started" | "ready" | "stale" | "running" | "failed">;
export type QuizV2State = { quiz: QuizV2 | null; director_plan: DirectorPlan | null; asset_plan: QuizAssetPlan | null; asset_resolution?: { assets: Array<{ asset_id: string; path: string; source: string }> } | null; voice_plan: VoicePlan | null; timeline: QuizTimeline | null; assessment: QuizAssessment | null; stages: QuizV2Stages };

export type EngineInfoResponse = {
  active_engine: "codex" | "antigravity";
  status: string;
  model: string;
  codex: { status: string; model: string; models: Array<{ id: string; label: string }> };
  antigravity: { status: string; model: string; models: Array<{ id: string; label: string }> };
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined && init.body !== null && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const rawBody = await response.text();
  let body: unknown = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : rawBody.trim() || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  channels: () => request<{ channels: Channel[] }>("/api/channels"),
  createChannel: (body: unknown) => request<{ channel: Channel; task: Task | null }>("/api/channels", { method: "POST", body: JSON.stringify(body) }),
  updateChannel: (id: string, body: unknown) => request<Channel>(`/api/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteChannel: (id: string) => request<{ ok: true }>(`/api/channels/${id}?confirm=true`, { method: "DELETE" }),
  dna: (id: string) => request<{ content: string; path: string; modified_at: string }>(`/api/channels/${id}/dna`),
  saveDna: (id: string, content: string) => request<{ path: string; modified_at: string }>(`/api/channels/${id}/dna`, { method: "PUT", body: JSON.stringify({ content }) }),
  topics: (id: string) => request<{ topics: TopicCandidate[] }>(`/api/channels/${id}/topics`),
  suggestTopics: (id: string) => request<{ task: Task }>(`/api/channels/${id}/topics/suggest`, { method: "POST", body: "{}" }),
  confirmTopic: (channelId: string, topicId: string, questionCount: number, visualStyle?: QuizImageStyle | "mixed") => request<{ episode: Episode }>(`/api/channels/${channelId}/topics/${topicId}/confirm`, { method: "POST", body: JSON.stringify({ topic_id: topicId, question_count: questionCount, visual_style: visualStyle }) }),
  episodes: (id: string) => request<{ episodes: Episode[] }>(`/api/channels/${id}/episodes`),
  deleteEpisode: (channelId: string, episodeId: string) => request<{ ok: true }>(`/api/channels/${channelId}/episodes/${episodeId}?confirm=true`, { method: "DELETE" }),
  updateEpisode: (channelId: string, episodeId: string, body: Partial<Episode["quiz_config"]> & { target_duration_minutes?: number }) => request<Episode>(`/api/channels/${channelId}/episodes/${episodeId}`, { method: "PATCH", body: JSON.stringify(body) }),
  file: (channelId: string, episodeId: string, filename: string) => request<{ content: string; path: string; modified_at: string }>(`/api/channels/${channelId}/episodes/${episodeId}/file/${filename}`),
  saveFile: (channelId: string, episodeId: string, filename: string, content: string) => request<{ path: string; modified_at: string }>(`/api/channels/${channelId}/episodes/${episodeId}/file/${filename}`, { method: "PUT", body: JSON.stringify({ content }) }),
  scenes: (channelId: string, episodeId: string) => request<{ scenes: Scene[] }>(`/api/channels/${channelId}/episodes/${episodeId}/scenes`),
  quizV2: (channelId: string, episodeId: string) => request<QuizV2State>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2`),
  generateQuizV2: (channelId: string, episodeId: string) => request<{ quiz: QuizV2; artifact_path: string; invalidated: string[] }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/generate`, { method: "POST", body: "{}" }),
  generateQuizDirector: (channelId: string, episodeId: string) => request<{ director_plan: DirectorPlan; artifact_path: string; invalidated: string[] }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/director/generate`, { method: "POST", body: "{}" }),
  planQuizAssets: (channelId: string, episodeId: string) => request<{ asset_plan: QuizAssetPlan; artifact_path: string; invalidated: string[] }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/assets/plan`, { method: "POST", body: "{}" }),
  planQuizVoice: (channelId: string, episodeId: string) => request<{ voice_plan: VoicePlan; artifact_path: string; invalidated: string[] }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/voice/plan`, { method: "POST", body: "{}" }),
  synthesizeQuizVoice: (channelId: string, episodeId: string) => request<{ voice_plan: VoicePlan; timeline: QuizTimeline; narration_asset_path: string; narration_duration_seconds: number; artifact_path: string; timeline_path: string; invalidated: string[] }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/voice/generate`, { method: "POST", body: "{}" }),
  compileQuizTimeline: (channelId: string, episodeId: string) => request<{ timeline: QuizTimeline; artifact_path: string; invalidated: string[] }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/timeline/compile`, { method: "POST", body: "{}" }),
  assessQuiz: (channelId: string, episodeId: string) => request<{ assessment: QuizAssessment; artifact_path: string }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/qa`, { method: "POST", body: "{}" }),
  renderQuizVideo: (channelId: string, episodeId: string) => request<{ task: Task }>(`/api/channels/${channelId}/episodes/${episodeId}/quiz-v2/render`, { method: "POST", body: "{}" }),
  bundleImages: (channelId: string, episodeId: string) => request<{ images: BundleImage[] }>(`/api/channels/${channelId}/episodes/${episodeId}/visual-bible/images`),
  generateBundleImage: (channelId: string, episodeId: string, bundleNumber: number) => request<{ task: Task }>(`/api/channels/${channelId}/episodes/${episodeId}/visual-bible/bundles/${bundleNumber}/image`, { method: "POST", body: "{}" }),
  generateAllBundleImages: (channelId: string, episodeId: string, force = false) => request<{ tasks: Task[]; bundle_count: number }>(`/api/channels/${channelId}/episodes/${episodeId}/visual-bible/images/generate-all`, { method: "POST", body: JSON.stringify({ force }) }),
  bundleImageUrl: (channelId: string, episodeId: string, filename: string) => `/api/channels/${channelId}/episodes/${episodeId}/visual-bible/images/${encodeURIComponent(filename)}`,
  downloadBundleImagesUrl: (channelId: string, episodeId: string) => `/api/channels/${channelId}/episodes/${episodeId}/visual-bible/images/download`,
  productionAssessment: (channelId: string, episodeId: string) => request<{ assessment: ProductionAssessment }>(`/api/channels/${channelId}/episodes/${episodeId}/production-assessment`),
  generateShots: (channelId: string, episodeId: string) => request<{ tasks: Task[]; sequence_count: number }>(`/api/channels/${channelId}/episodes/${episodeId}/shots/generate`, { method: "POST", body: "{}" }),
  optimizeShots: (channelId: string, episodeId: string) => request<{ scenes: Scene[]; merged: number }>(`/api/channels/${channelId}/episodes/${episodeId}/shots/optimize`, { method: "POST", body: "{}" }),
  assembleNarration: (channelId: string, episodeId: string) => request<{ episode: Episode; asset_path: string }>(`/api/channels/${channelId}/episodes/${episodeId}/narration/assemble`, { method: "POST", body: "{}" }),
  saveScenes: (channelId: string, episodeId: string, scenes: Scene[]) => request<{ scenes: Scene[] }>(`/api/channels/${channelId}/episodes/${episodeId}/scenes`, { method: "PUT", body: JSON.stringify(scenes) }),
  generateAllAudio: (channelId: string, episodeId: string, force = false) => request<{ tasks: Task[] }>(`/api/channels/${channelId}/episodes/${episodeId}/audio/generate-all`, { method: "POST", body: JSON.stringify({ force }) }),
  downloadAudioUrl: (channelId: string, episodeId: string, mode: "separate" | "merged") => `/api/channels/${channelId}/episodes/${episodeId}/audio/download?mode=${mode}`,
  tasks: () => request<{ tasks: Task[]; codex_status: string }>("/api/tasks"),
  shutdown: () => request<{ ok: true }>("/api/shutdown", { method: "POST", body: "{}" }),
  createTask: (body: unknown) => request<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  cancelTask: (id: string) => request<Task>(`/api/tasks/${id}/cancel`, { method: "POST", body: "{}" }),
  approve: (id: string, requestId: number, decision: string) => request<Task>(`/api/tasks/${id}/approval`, { method: "POST", body: JSON.stringify({ request_id: requestId, decision }) }),
  git: () => request<{ branch: string | null; dirty: boolean; changed_files: number }>("/api/git"),
  config: () => request<AppConfig>("/api/config"),
  engine: () => request<EngineInfoResponse>("/api/engine"),
  setEngine: (active_engine: "codex" | "antigravity", model?: string) => request<{ active_engine: "codex" | "antigravity"; status: string; model: string }>("/api/engine", { method: "POST", body: JSON.stringify({ active_engine, model }) }),
  codexSettings: () => request<CodexSettingsResponse>("/api/codex/settings"),
  saveCodexSettings: (body: CodexSettingsInput) => request<CodexSettingsResponse>("/api/codex/settings", { method: "POST", body: JSON.stringify(body) }),
  cleanupCodex: () => request<{ removed: number }>("/api/codex/cleanup", { method: "POST", body: "{}" }),
  cleanupAntigravity: () => request<{ removed: number }>("/api/antigravity/cleanup", { method: "POST", body: "{}" }),
  antigravitySettings: () => request<AntigravitySettingsResponse>("/api/antigravity/settings"),
  saveAntigravitySettings: (body: AntigravitySettingsInput) => request<AntigravitySettingsResponse>("/api/antigravity/settings", { method: "POST", body: JSON.stringify(body) }),
  antigravityModels: () => request<{ models: AntigravitySettingsResponse["models"] }>("/api/antigravity/models"),
  saveAudioSettings: (body: AppConfig["audio_generation"]) => request<{ audio_generation: AppConfig["audio_generation"] }>("/api/audio/settings", { method: "POST", body: JSON.stringify(body) }),
  saveVideoSettings: (body: Pick<AppConfig["video_generation"], "max_scene_duration_seconds" | "narration_words_per_second">) => request<{ video_generation: AppConfig["video_generation"] }>("/api/video/settings", { method: "POST", body: JSON.stringify(body) }),
  imageSettings: () => request<{ settings: AppConfig["image_generation"] & { has_api_key?: boolean }; models: Array<{ id: string; label: string }> }>("/api/image/settings"),
  imageBalance: () => request<{ balance_vnd: number; rpm?: number }>("/api/image/balance"),
  saveImageSettings: (body: Partial<AppConfig["image_generation"]>) => request<{ image_generation: AppConfig["image_generation"] }>("/api/image/settings", { method: "POST", body: JSON.stringify(body) }),
  codexModels: () => request<{ models: CodexSettingsResponse["models"] }>("/api/codex/models"),
  storage: () => request<StorageInfo>("/api/storage"),
  setStorage: (path: string) => request<StorageInfo>("/api/storage", { method: "POST", body: JSON.stringify({ path }) }),
  saveVoiceReference: (channelId: string, data: string) => request<{ path: string; modified_at: string }>(`/api/channels/${channelId}/voice-reference`, { method: "PUT", body: JSON.stringify({ data }) }),
  voices: () => request<{ voices: VoiceProfile[] }>("/api/voices"),
  createVoice: (name: string, data: string) => request<VoiceProfile>("/api/voices", { method: "POST", body: JSON.stringify({ name, data }) }),
  deleteVoice: (voiceId: string) => request<{ ok: true }>(`/api/voices/${voiceId}`, { method: "DELETE" }),
  assignVoice: (channelId: string, voiceId: string | null) => request<Channel>(`/api/channels/${channelId}/voice`, { method: "PUT", body: JSON.stringify({ voice_id: voiceId }) }),
  voiceSampleUrl: (voiceId: string) => `/api/voices/${voiceId}/sample`,
  narrationAudioUrl: (channelId: string, episodeId: string, filename = "narration.wav") => `/api/channels/${channelId}/episodes/${episodeId}/assets/${encodeURIComponent(filename)}`,
  videoUrl: (channelId: string, episodeId: string) => `/api/channels/${channelId}/episodes/${episodeId}/video`,
  openVideoFolder: (channelId: string, episodeId: string) => request<{ opened: true; folder_path: string }>(`/api/channels/${channelId}/episodes/${episodeId}/video/open-folder`, { method: "POST", body: "{}" }),
  generateAudio: (channelId: string, episodeId: string, sceneNumber: number) => request<{ task: Task }>(`/api/channels/${channelId}/episodes/${episodeId}/scenes/${sceneNumber}/audio`, { method: "POST", body: "{}" }),
  mergeNextScene: (channelId: string, episodeId: string, sceneNumber: number) => request<{ scenes: Scene[] }>(`/api/channels/${channelId}/episodes/${episodeId}/scenes/${sceneNumber}/merge-next`, { method: "POST", body: "{}" }),
  reconnectCodex: () => request<{ status: string; message?: string }>("/api/codex/reconnect", { method: "POST", body: "{}" }),
};

export type RealtimeStatus = "connecting" | "connected" | "reconnecting";

export function subscribeEvents(onEvent: (event: TaskEvent) => void, onStatus: (status: RealtimeStatus) => void = () => undefined): () => void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let retryCount = 0;
  let stopped = false;

  const scheduleReconnect = () => {
    if (stopped || retryTimer !== null) return;
    onStatus("reconnecting");
    const delay = Math.min(1000 * (2 ** retryCount), 10_000);
    retryCount += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };
  const connect = () => {
    if (stopped) return;
    if (retryCount === 0) onStatus("connecting");
    socket = new WebSocket(`${protocol}://${window.location.host}/api/events`);
    socket.addEventListener("open", () => {
      retryCount = 0;
      onStatus("connected");
    });
    socket.addEventListener("message", (event) => {
      try { onEvent(JSON.parse(event.data as string) as TaskEvent); } catch { /* ignore malformed events */ }
    });
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => socket?.close());
  };
  const reconnectWhenOnline = () => {
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    connect();
  };

  window.addEventListener("online", reconnectWhenOnline);
  connect();
  return () => {
    stopped = true;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    window.removeEventListener("online", reconnectWhenOnline);
    socket?.close();
  };
}
