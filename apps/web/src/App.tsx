import { useCallback, useEffect, useState } from "react";
import type { AppConfig, Channel, CodexSettingsResponse, AntigravitySettingsResponse, StorageInfo, Task } from "@studio/shared";
import { api } from "./api";
import { useChannels } from "./hooks/useChannels";
import { useTasks } from "./hooks/useTasks";
import { DashboardView, type ChannelGroupId } from "./components/ChannelList";
import { ChannelsView, CreateChannelModal, DeleteChannelModal } from "./components/ChannelView";
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
  const [activeEngine, setActiveEngine] = useState<"codex" | "antigravity">("codex");
  const [currentModel, setCurrentModel] = useState<string>("");
  const [currentImageModel, setCurrentImageModel] = useState<string>("gpt-image-2");
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [codex, setCodex] = useState<CodexSettingsResponse | null>(null);
  const [antigravity, setAntigravity] = useState<AntigravitySettingsResponse | null>(null);
  const [antigravityStatus, setAntigravityStatus] = useState("ready");
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState<ChannelGroupId | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem("studio-theme") === "light" ? "light" : "dark");
  const { channels, setChannels, refresh: refreshChannels } = useChannels();
  const handleTerminalTask = useCallback((task: Task) => {
    if (task.status === "COMPLETED") setNotice({ tone: "good", message: `${formatTaskType(task.task_type)} completed` });
    else if (task.status === "FAILED") setNotice({ tone: "bad", message: task.error || `${formatTaskType(task.task_type)} failed` });
  }, []);
  const taskStore = useTasks(handleTerminalTask);
  const { tasks, activeTasks, now: taskClock, codexStatus, realtimeStatus, upsertTask, setCodexStatus, refresh: refreshTasks } = taskStore;

  const loadModelsForEngine = useCallback(async (engine: "codex" | "antigravity") => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      if (engine === "antigravity") {
        const res = await api.antigravityModels();
        setModels(res.models);
      } else {
        const res = await api.codexModels();
        setModels(res.models);
      }
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "Failed to load models");
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const refreshPeripheralState = useCallback(async () => {
    const [gitResult, codexResult, agyResult, engineResult] = await Promise.allSettled([
      api.git(),
      api.codexSettings(),
      api.antigravitySettings(),
      api.engine(),
    ]);
    if (gitResult.status === "fulfilled") setGit(gitResult.value);
    if (codexResult.status === "fulfilled") setCodex(codexResult.value);
    if (agyResult.status === "fulfilled") setAntigravity(agyResult.value);
    if (engineResult.status === "fulfilled") {
      const eng = engineResult.value;
      setActiveEngine(eng.active_engine);
      setCurrentModel(eng.model ?? "");
      setAntigravityStatus(eng.antigravity?.status ?? "ready");
      if (eng.active_engine === "antigravity") {
        setModels(eng.antigravity?.models ?? []);
      } else {
        setModels(eng.codex?.models ?? []);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    void refreshPeripheralState();
    const [configResponse, storageResponse] = await Promise.all([api.config(), api.storage()]);
    await Promise.all([refreshChannels(), refreshTasks()]);
    setAppConfig(configResponse);
    if (configResponse.image_generation?.model) {
      setCurrentImageModel(configResponse.image_generation.model);
    }
    setStorage(storageResponse);
    setLoading(false);
  }, [refreshChannels, refreshPeripheralState, refreshTasks]);

  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("studio-theme", theme); }, [theme]);
  useEffect(() => { void refresh().catch((error: Error) => { setNotice({ tone: "bad", message: error.message }); setLoading(false); }); }, [refresh]);

  const selectedChannel = channels.find((channel) => channel.channel_id === selectedChannelId) ?? null;
  const openChannel = (channelId: string) => { setSelectedChannelId(channelId); setSelectedEpisodeId(null); setPage("channels"); };
  const openEpisode = (channelId: string, episodeId: string) => { setSelectedChannelId(channelId); setSelectedEpisodeId(episodeId); setPage("channels"); };
  const showError = (error: unknown) => setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Something went wrong" });
  const showGood = (message: string) => setNotice({ tone: "good", message });
  const requestDeleteChannel = (channel: Channel) => setDeleteTarget(channel);
  const requestCreateChannel = (groupId: ChannelGroupId = "quiz") => setShowCreate(groupId);

  const handleChannelDeleted = async (channel: Channel) => {
    setDeleteTarget(null);
    setChannels((current) => current.filter((item) => item.channel_id !== channel.channel_id));
    if (selectedChannelId === channel.channel_id) {
      setSelectedChannelId(null);
      setSelectedEpisodeId(null);
      setPage("channels");
    }
    await refresh();
    showGood(`Channel deleted: ${channel.display_name}`);
  };

  const applyStorage = async (nextStorage: StorageInfo) => { setStorage(nextStorage); await refresh(); };
  const saveCodex = async (input: Parameters<typeof api.saveCodexSettings>[0]) => {
    const next = await api.saveCodexSettings(input);
    setCodex(next);
    if (input.transport && input.transport !== codex?.settings.transport) setCodexStatus("disconnected");
    return next;
  };

  const handleEngineToggle = async (targetEngine: "codex" | "antigravity") => {
    if (targetEngine === activeEngine) return;
    try {
      const res = await api.setEngine(targetEngine);
      setActiveEngine(res.active_engine);
      setCurrentModel(res.model);
      showGood(`Switched engine to ${targetEngine === "antigravity" ? "Google Antigravity" : "OpenAI Codex"}`);
      await loadModelsForEngine(targetEngine);
    } catch (error) {
      showError(error);
    }
  };

  const handleModelChange = async (model: string) => {
    try {
      if (activeEngine === "antigravity") {
        const next = await api.saveAntigravitySettings({ model });
        setAntigravity(next);
        setCurrentModel(model);
      } else {
        const next = await saveCodex({ model });
        setCodex(next);
        setCurrentModel(model);
      }
      showGood(model ? `Model: ${model}` : `Using ${activeEngine === "antigravity" ? "Antigravity" : "Codex"} default model`);
    } catch (error) {
      showError(error);
    }
  };

  const handleImageModelChange = async (model: string) => {
    try {
      const next = await api.saveImageSettings({ model });
      setCurrentImageModel(model);
      setAppConfig((current) => current ? { ...current, image_generation: next.image_generation } : current);
      showGood(`Image Model: ${model}`);
    } catch (error) {
      showError(error);
    }
  };

  const stopDashboard = async () => {
    if (!window.confirm("Stop the dashboard and its local services? Your channel files will remain untouched.")) return;
    try {
      await api.shutdown();
      setStopped(true);
    } catch (error) {
      showError(error);
    }
  };

  const navigate = (next: Page) => { setPage(next); if (next !== "channels") { setSelectedChannelId(null); setSelectedEpisodeId(null); } };
  if (stopped) return <main className="shutdown-screen"><div className="shutdown-card"><Power size={24} weight="bold" /><p className="eyebrow">Local workspace</p><h1>Dashboard stopped</h1><p>Run <strong>run dashboard.bat</strong> to start it again. Your channel files are still on this computer.</p></div></main>;

  const currentEngineStatus = activeEngine === "antigravity" ? antigravityStatus : codexStatus;

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={navigate} activeTaskCount={activeTasks.length} />
      <main className="main-column">
        <Topbar
          channel={selectedChannel}
          channels={channels}
          onSelectChannel={openChannel}
          activeEngine={activeEngine}
          engineStatus={currentEngineStatus}
          git={git}
          currentModel={currentModel}
          models={models}
          loadingModels={loadingModels}
          modelsError={modelsError}
          currentImageModel={currentImageModel}
          hasImageApiKey={Boolean(appConfig?.image_generation?.has_api_key || appConfig?.image_generation?.api_key)}
          theme={theme}
          onEngineToggle={handleEngineToggle}
          onThemeToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          onModelChange={handleModelChange}
          onImageModelChange={handleImageModelChange}
          onOpenImageSettings={() => navigate("settings")}
          onReconnect={async () => {
            try {
              if (activeEngine === "antigravity") {
                await loadModelsForEngine("antigravity");
                setAntigravityStatus("ready");
                showGood("Antigravity checked");
              } else {
                const result = await api.reconnectCodex();
                setCodexStatus(result.status);
                if (result.status === "connected") showGood("Codex connected");
                else showError(new Error(result.message || "Codex unavailable"));
              }
            } catch (error) {
              showError(error);
            }
          }}
          onShutdown={() => void stopDashboard()}
        />
        <TaskActivityBar tasks={activeTasks} realtimeStatus={realtimeStatus} now={taskClock} onOpenTasks={() => navigate("tasks")} />
        {loading ? <LoadingState /> : page === "dashboard" ? (
          <DashboardView
            channels={channels}
            tasks={tasks}
            activeTasks={activeTasks}
            now={taskClock}
            onCreate={(groupId) => requestCreateChannel(groupId || "quiz")}
            openChannel={openChannel}
            onDelete={requestDeleteChannel}
            openTaskList={() => navigate("tasks")}
            openChannelsList={() => navigate("channels")}
          />
        ) : null}
        {!loading && page === "channels" ? (
          <ChannelsView
            selectedChannel={selectedChannel}
            selectedEpisodeId={selectedEpisodeId}
            channels={channels}
            tasks={tasks}
            onTaskSubmitted={upsertTask}
            openChannel={openChannel}
            onCreate={requestCreateChannel}
            onRefresh={refresh}
            onNotice={setNotice}
            onDelete={requestDeleteChannel}
            openEpisode={openEpisode}
            maxDuration={appConfig?.video_generation.max_scene_duration_seconds ?? 8}
            narrationWordsPerSecond={appConfig?.video_generation.narration_words_per_second ?? 2.3}
            imageGenerationEnabled={appConfig?.image_generation?.enabled ?? true}
            imagesPerBundle={appConfig?.image_generation?.images_per_bundle ?? 1}
          />
        ) : null}
        {!loading && page === "tasks" ? <TasksView tasks={tasks} now={taskClock} onRefresh={refresh} onNotice={setNotice} /> : null}
        {!loading && page === "settings" ? (
          <SettingsView
            channels={channels}
            appConfig={appConfig}
            codex={codex}
            codexStatus={codexStatus}
            antigravity={antigravity}
            antigravityStatus={antigravityStatus}
            git={git}
            storage={storage}
            onStorageSaved={applyStorage}
            onCodexSaved={setCodex}
            onAntigravitySaved={setAntigravity}
            onAudioSaved={(audio) => setAppConfig((current) => current ? { ...current, audio_generation: audio } : current)}
            onVideoSaved={(video) => setAppConfig((current) => current ? { ...current, video_generation: video } : current)}
            onImageSaved={(image) => setAppConfig((current) => current ? { ...current, image_generation: image } : current)}
            onChannelUpdated={(channel) => setChannels((current) => current.map((item) => item.channel_id === channel.channel_id ? channel : item))}
            onNotice={setNotice}
          />
        ) : null}
        <footer className="app-credit">
          <span className="app-credit-full">Develop - Design - Deliver by HyyAnk | Dư Ngọc Minh Hoàng</span>
          <span className="app-credit-mobile">HyyAnk | Dư Ngọc Minh Hoàng</span>
        </footer>
      </main>
      {storage && !storage.configured ? <StorageSetupModal storage={storage} onSaved={async (next) => { await applyStorage(next); showGood("Content storage is ready"); }} onError={showError} /> : null}
      {showCreate ? <CreateChannelModal initialGroupId={showCreate} onClose={() => setShowCreate(null)} onCreated={async (channelId, message, task) => { if (task) upsertTask(task); setShowCreate(null); await refresh(); openChannel(channelId); setNotice({ tone: "good", message }); }} onError={showError} /> : null}
      {deleteTarget ? <DeleteChannelModal channel={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={handleChannelDeleted} onError={showError} /> : null}
      {notice ? <NoticeBanner notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}
