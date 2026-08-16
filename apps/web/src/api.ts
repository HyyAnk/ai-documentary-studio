import type { AppConfig, Channel, CodexSettingsInput, CodexSettingsResponse, Episode, Scene, StorageInfo, Task, TaskEvent, TopicCandidate } from "@studio/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "The studio could not complete that action");
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
  confirmTopic: (channelId: string, topicId: string) => request<{ episode: Episode }>(`/api/channels/${channelId}/topics/${topicId}/confirm`, { method: "POST", body: JSON.stringify({ topic_id: topicId }) }),
  episodes: (id: string) => request<{ episodes: Episode[] }>(`/api/channels/${id}/episodes`),
  file: (channelId: string, episodeId: string, filename: string) => request<{ content: string; path: string; modified_at: string }>(`/api/channels/${channelId}/episodes/${episodeId}/file/${filename}`),
  saveFile: (channelId: string, episodeId: string, filename: string, content: string) => request<{ path: string; modified_at: string }>(`/api/channels/${channelId}/episodes/${episodeId}/file/${filename}`, { method: "PUT", body: JSON.stringify({ content }) }),
  scenes: (channelId: string, episodeId: string) => request<{ scenes: Scene[] }>(`/api/channels/${channelId}/episodes/${episodeId}/scenes`),
  saveScenes: (channelId: string, episodeId: string, scenes: Scene[]) => request<{ scenes: Scene[] }>(`/api/channels/${channelId}/episodes/${episodeId}/scenes`, { method: "PUT", body: JSON.stringify(scenes) }),
  tasks: () => request<{ tasks: Task[]; codex_status: string }>("/api/tasks"),
  createTask: (body: unknown) => request<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  cancelTask: (id: string) => request<Task>(`/api/tasks/${id}/cancel`, { method: "POST", body: "{}" }),
  approve: (id: string, requestId: number, decision: string) => request<Task>(`/api/tasks/${id}/approval`, { method: "POST", body: JSON.stringify({ request_id: requestId, decision }) }),
  git: () => request<{ branch: string | null; dirty: boolean; changed_files: number }>("/api/git"),
  config: () => request<AppConfig>("/api/config"),
  codexSettings: () => request<CodexSettingsResponse>("/api/codex/settings"),
  saveCodexSettings: (body: CodexSettingsInput) => request<CodexSettingsResponse>("/api/codex/settings", { method: "POST", body: JSON.stringify(body) }),
  codexModels: () => request<{ models: CodexSettingsResponse["models"] }>("/api/codex/models"),
  storage: () => request<StorageInfo>("/api/storage"),
  setStorage: (path: string) => request<StorageInfo>("/api/storage", { method: "POST", body: JSON.stringify({ path }) }),
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
