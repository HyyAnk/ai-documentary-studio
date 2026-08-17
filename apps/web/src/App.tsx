import { useCallback, useEffect, useState } from "react";
import type { AppConfig, CodexSettingsResponse, StorageInfo, Task } from "@studio/shared";
import { api } from "./api";
import { useChannels } from "./hooks/useChannels";
import { useTasks } from "./hooks/useTasks";
import { DashboardView } from "./components/ChannelList";
import { ChannelsView, CreateChannelModal } from "./components/ChannelView";
import { TopicsView } from "./components/TopicPanel";
import { EpisodesView } from "./components/EpisodeView";
import { SettingsView, StorageSetupModal } from "./components/SettingsPanel";
import { Sidebar, Topbar, NoticeBanner } from "./components/AppChrome";
import { TaskActivityBar, TasksView } from "./components/TaskPanel";
import { LoadingState } from "./components/EmptyState";
import type { GitInfo, Notice, Page, Theme } from "./components/types";
import { formatTaskType } from "./lib/utils";
import { Power } from "@phosphor-icons/react";

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [git, setGit] = useState<GitInfo>({ branch: null, dirty: false, changed_files: 0 });
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [codex, setCodex] = useState<CodexSettingsResponse | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem("studio-theme") === "light" ? "light" : "dark");
  const { channels, setChannels, refresh: refreshChannels } = useChannels();
  const handleTerminalTask = useCallback((task: Task) => { if (task.status === "COMPLETED") setNotice({ tone: "good", message: `${formatTaskType(task.task_type)} completed` }); else if (task.status === "FAILED") setNotice({ tone: "bad", message: task.error || `${formatTaskType(task.task_type)} failed` }); }, []);
  const taskStore = useTasks(handleTerminalTask);
  const { tasks, activeTasks, now: taskClock, codexStatus, realtimeStatus, upsertTask, setCodexStatus, refresh: refreshTasks } = taskStore;
  const refresh = useCallback(async () => { const [gitResponse, configResponse, storageResponse, codexResponse] = await Promise.all([api.git(), api.config(), api.storage(), api.codexSettings()]); await Promise.all([refreshChannels(), refreshTasks()]); setGit(gitResponse); setAppConfig(configResponse); setStorage(storageResponse); setCodex(codexResponse); setLoading(false); }, [refreshChannels, refreshTasks]);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("studio-theme", theme); }, [theme]);
  useEffect(() => { void refresh().catch((error: Error) => { setNotice({ tone: "bad", message: error.message }); setLoading(false); }); }, [refresh]);
  const selectedChannel = channels.find((channel) => channel.channel_id === selectedChannelId) ?? null;
  const openChannel = (channelId: string) => { setSelectedChannelId(channelId); setSelectedEpisodeId(null); setPage("channels"); };
  const openEpisode = (channelId: string, episodeId: string) => { setSelectedChannelId(channelId); setSelectedEpisodeId(episodeId); setPage("episodes"); };
  const showError = (error: unknown) => setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Something went wrong" });
  const showGood = (message: string) => setNotice({ tone: "good", message });
  const applyStorage = async (nextStorage: StorageInfo) => { setStorage(nextStorage); await refresh(); };
  const saveCodex = async (input: Parameters<typeof api.saveCodexSettings>[0]) => { const next = await api.saveCodexSettings(input); setCodex(next); if (input.transport && input.transport !== codex?.settings.transport) setCodexStatus("disconnected"); return next; };
  const stopDashboard = async () => {
    if (!window.confirm("Stop the dashboard and its local services? Your channel files will remain untouched.")) return;
    try {
      await api.shutdown();
      setStopped(true);
    } catch (error) {
      showError(error);
    }
  };
  const navigate = (next: Page) => { setPage(next); if (next !== "channels") setSelectedChannelId(null); if (next !== "episodes") setSelectedEpisodeId(null); };
  if (stopped) return <main className="shutdown-screen"><div className="shutdown-card"><Power size={24} weight="bold" /><p className="eyebrow">Local workspace</p><h1>Dashboard stopped</h1><p>Run <strong>run dashboard.bat</strong> to start it again. Your channel files are still on this computer.</p></div></main>;
  return <div className="app-shell"><Sidebar page={page} setPage={navigate} activeTaskCount={activeTasks.length} /><main className="main-column"><Topbar channel={selectedChannel} codexStatus={codexStatus} git={git} codex={codex} theme={theme} onThemeToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")} onModelChange={async (model) => { try { await saveCodex({ model }); showGood(model ? `Model: ${model}` : "Using Codex default model"); } catch (error) { showError(error); } }} onReconnect={async () => { try { const result = await api.reconnectCodex(); setCodexStatus(result.status); showGood(result.status === "connected" ? "Codex connected" : "Codex unavailable"); } catch (error) { showError(error); } }} onShutdown={() => void stopDashboard()} /><TaskActivityBar tasks={activeTasks} realtimeStatus={realtimeStatus} now={taskClock} onOpenTasks={() => navigate("tasks")} />{loading ? <LoadingState /> : page === "dashboard" ? <DashboardView channels={channels} tasks={tasks} activeTasks={activeTasks} now={taskClock} onCreate={() => setShowCreate(true)} openChannel={openChannel} openTaskList={() => navigate("tasks")} /> : null}{!loading && page === "channels" ? <ChannelsView selectedChannel={selectedChannel} channels={channels} tasks={tasks} onTaskSubmitted={upsertTask} openChannel={openChannel} onCreate={() => setShowCreate(true)} onRefresh={refresh} onNotice={setNotice} openEpisode={openEpisode} /> : null}{!loading && page === "topics" ? <TopicsView channels={channels} openChannel={openChannel} onNotice={setNotice} /> : null}{!loading && page === "episodes" ? <EpisodesView channel={selectedChannel} episodeId={selectedEpisodeId} tasks={tasks} onTaskSubmitted={upsertTask} openChannel={openChannel} openEpisode={openEpisode} maxDuration={appConfig?.video_generation.max_scene_duration_seconds ?? 8} onNotice={setNotice} /> : null}{!loading && page === "tasks" ? <TasksView tasks={tasks} now={taskClock} onRefresh={refresh} onNotice={setNotice} /> : null}{!loading && page === "settings" ? <SettingsView channels={channels} appConfig={appConfig} codex={codex} codexStatus={codexStatus} git={git} storage={storage} onStorageSaved={applyStorage} onCodexSaved={setCodex} onAudioSaved={(audio) => setAppConfig((current) => current ? { ...current, audio_generation: audio } : current)} onVideoSaved={(video) => setAppConfig((current) => current ? { ...current, video_generation: video } : current)} onChannelUpdated={(channel) => setChannels((current) => current.map((item) => item.channel_id === channel.channel_id ? channel : item))} onNotice={setNotice} /> : null}</main>{storage && !storage.configured ? <StorageSetupModal storage={storage} onSaved={async (next) => { await applyStorage(next); showGood("Content storage is ready"); }} onError={showError} /> : null}{showCreate ? <CreateChannelModal onClose={() => setShowCreate(false)} onCreated={async (channelId, message, task) => { if (task) upsertTask(task); setShowCreate(false); await refresh(); openChannel(channelId); setNotice({ tone: "good", message }); }} onError={showError} /> : null}{notice ? <NoticeBanner notice={notice} onClose={() => setNotice(null)} /> : null}</div>;
}
