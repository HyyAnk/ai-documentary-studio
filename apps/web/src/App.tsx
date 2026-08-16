import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowClockwise,
  ArrowLeft,
  ArrowUpRight,
  Broadcast,
  Check,
  CheckCircle,
  CaretDown,
  CircleNotch,
  Copy,
  FilmSlate,
  FileText,
  FloppyDisk,
  Gear,
  GitBranch,
  House,
  Lightbulb,
  ListChecks,
  MoonStars,
  PencilSimple,
  Play,
  Plus,
  Sparkle,
  Sun,
  Trash,
  TerminalWindow,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { AppConfig, Channel, CodexSettingsResponse, Episode, Scene, StorageInfo, Task, TaskEvent, TopicCandidate } from "@studio/shared";
import { api, subscribeEvents, type RealtimeStatus } from "./api";

type Page = "dashboard" | "channels" | "topics" | "episodes" | "tasks" | "settings";
type Notice = { tone: "good" | "bad" | "neutral"; message: string } | null;
type Theme = "dark" | "light";

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [git, setGit] = useState<{ branch: string | null; dirty: boolean; changed_files: number }>({ branch: null, dirty: false, changed_files: 0 });
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [codex, setCodex] = useState<CodexSettingsResponse | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [codexStatus, setCodexStatus] = useState("disconnected");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [taskClock, setTaskClock] = useState(() => Date.now());
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem("studio-theme") === "light" ? "light" : "dark");
  const hasRealtimeConnected = useRef(false);

  const upsertTask = useCallback((task: Task) => {
    setTasks((current) => [task, ...current.filter((item) => item.task_id !== task.task_id)].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }, []);

  const refresh = useCallback(async () => {
    const [channelResponse, taskResponse, gitResponse, configResponse, storageResponse, codexResponse] = await Promise.all([api.channels(), api.tasks(), api.git(), api.config(), api.storage(), api.codexSettings()]);
    setChannels(channelResponse.channels);
    setTasks(taskResponse.tasks);
    setCodexStatus(taskResponse.codex_status);
    setGit(gitResponse);
    setAppConfig(configResponse);
    setStorage(storageResponse);
    setCodex(codexResponse);
    setLoading(false);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("studio-theme", theme);
  }, [theme]);

  useEffect(() => {
    void refresh().catch((error: Error) => { setNotice({ tone: "bad", message: error.message }); setLoading(false); });
    return subscribeEvents((event: TaskEvent) => {
      if (event.status) setCodexStatus(event.status);
      if (event.task) upsertTask(event.task);
      if (event.type === "task.updated" && event.task && isTaskTerminal(event.task)) {
        if (event.task.status === "COMPLETED") setNotice({ tone: "good", message: `${formatTaskType(event.task.task_type)} completed` });
        else if (event.task.status === "FAILED") setNotice({ tone: "bad", message: event.task.error || `${formatTaskType(event.task.task_type)} failed` });
        void refresh();
      }
    }, (status) => {
      setRealtimeStatus(status);
      if (status !== "connected") return;
      if (hasRealtimeConnected.current) void refresh();
      else hasRealtimeConnected.current = true;
    });
  }, [refresh, upsertTask]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedChannel = channels.find((channel) => channel.channel_id === selectedChannelId) ?? null;
  const activeTasks = tasks.filter(isTaskActive);

  useEffect(() => {
    if (activeTasks.length === 0) return;
    const timer = window.setInterval(() => setTaskClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeTasks.length]);

  const openChannel = (channelId: string) => {
    setSelectedChannelId(channelId);
    setSelectedEpisodeId(null);
    setPage("channels");
  };
  const openEpisode = (channelId: string, episodeId: string) => {
    setSelectedChannelId(channelId);
    setSelectedEpisodeId(episodeId);
    setPage("episodes");
  };
  const showError = (error: unknown) => setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Something went wrong" });
  const showGood = (message: string) => setNotice({ tone: "good", message });
  const applyStorage = async (nextStorage: StorageInfo) => { setStorage(nextStorage); await refresh(); };
  const saveCodex = async (input: Parameters<typeof api.saveCodexSettings>[0]) => {
    const next = await api.saveCodexSettings(input);
    setCodex(next);
    if (input.transport && input.transport !== codex?.settings.transport) setCodexStatus("disconnected");
    return next;
  };

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={(next) => { setPage(next); if (next !== "channels") setSelectedChannelId(null); if (next !== "episodes") setSelectedEpisodeId(null); }} activeTaskCount={activeTasks.length} />
      <main className="main-column">
        <Topbar channel={selectedChannel} codexStatus={codexStatus} git={git} codex={codex} theme={theme} onThemeToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")} onModelChange={async (model) => { try { await saveCodex({ model }); showGood(model ? `Model: ${model}` : "Using Codex default model"); } catch (error) { showError(error); } }} onReconnect={async () => { try { const result = await api.reconnectCodex(); setCodexStatus(result.status); showGood(result.status === "connected" ? "Codex connected" : "Codex unavailable"); } catch (error) { showError(error); } }} />
        <TaskActivityBar tasks={activeTasks} realtimeStatus={realtimeStatus} now={taskClock} onOpenTasks={() => setPage("tasks")} />
        {loading ? <LoadingState /> : page === "dashboard" ? <DashboardView channels={channels} tasks={tasks} activeTasks={activeTasks} now={taskClock} onCreate={() => setShowCreate(true)} openChannel={openChannel} openTaskList={() => setPage("tasks")} /> : null}
        {!loading && page === "channels" ? <ChannelsView selectedChannel={selectedChannel} channels={channels} tasks={tasks} onTaskSubmitted={upsertTask} openChannel={openChannel} onCreate={() => setShowCreate(true)} onRefresh={refresh} onNotice={setNotice} openEpisode={openEpisode} /> : null}
        {!loading && page === "topics" ? <TopicsView channels={channels} openChannel={openChannel} onNotice={setNotice} /> : null}
        {!loading && page === "episodes" ? <EpisodesView channel={selectedChannel} episodeId={selectedEpisodeId} tasks={tasks} onTaskSubmitted={upsertTask} openChannel={openChannel} openEpisode={openEpisode} maxDuration={appConfig?.video_generation.max_scene_duration_seconds ?? 8} onNotice={setNotice} /> : null}
        {!loading && page === "tasks" ? <TasksView tasks={tasks} now={taskClock} onRefresh={refresh} onNotice={setNotice} /> : null}
        {!loading && page === "settings" ? <SettingsView codex={codex} codexStatus={codexStatus} git={git} storage={storage} onStorageSaved={applyStorage} onCodexSaved={setCodex} onNotice={setNotice} /> : null}
      </main>
      {storage && !storage.configured ? <StorageSetupModal storage={storage} onSaved={async (next) => { await applyStorage(next); showGood("Content storage is ready"); }} onError={showError} /> : null}
      {showCreate ? <CreateChannelModal onClose={() => setShowCreate(false)} onCreated={async (channelId, message, task) => { if (task) upsertTask(task); setShowCreate(false); await refresh(); openChannel(channelId); setNotice({ tone: "good", message }); }} onError={showError} /> : null}
      {notice ? <NoticeBanner notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}

function Sidebar({ page, setPage, activeTaskCount }: { page: Page; setPage: (page: Page) => void; activeTaskCount: number }) {
  const items: Array<{ page: Page; label: string; icon: typeof House }> = [
    { page: "dashboard", label: "Dashboard", icon: House },
    { page: "channels", label: "Channels", icon: Broadcast },
    { page: "topics", label: "Topics", icon: Lightbulb },
    { page: "episodes", label: "Episodes", icon: FilmSlate },
    { page: "tasks", label: "Tasks", icon: ListChecks },
  ];
  return <aside className="sidebar">
    <div className="brand-lockup"><div className="brand-mark">AD</div><div><span className="brand-name">Documentary</span><span className="brand-subtitle">Studio</span></div></div>
    <div className="sidebar-rule" />
    <nav className="primary-nav" aria-label="Primary navigation">
      {items.map(({ page: itemPage, label, icon: Icon }) => <button key={itemPage} className={`nav-item ${page === itemPage ? "is-active" : ""}`} onClick={() => setPage(itemPage)}><Icon size={18} weight={page === itemPage ? "fill" : "regular"} /><span>{label}</span>{itemPage === "tasks" && activeTaskCount > 0 ? <span className="nav-count">{activeTaskCount}</span> : null}</button>)}
    </nav>
    <div className="sidebar-bottom"><button className={`nav-item ${page === "settings" ? "is-active" : ""}`} onClick={() => setPage("settings")}><Gear size={18} /><span>Settings</span></button><div className="local-badge"><span className="status-dot" />Local workspace</div></div>
  </aside>;
}

function Topbar({ channel, codexStatus, git, codex, theme, onThemeToggle, onModelChange, onReconnect }: { channel: Channel | null; codexStatus: string; git: { branch: string | null; dirty: boolean; changed_files: number }; codex: CodexSettingsResponse | null; theme: Theme; onThemeToggle: () => void; onModelChange: (model: string) => Promise<void>; onReconnect: () => void }) {
  return <header className="topbar"><div className="context-trail"><span className="context-kicker">Workspace</span><span className="context-title">{channel?.display_name ?? "Overview"}</span></div><div className="topbar-meta"><label className="model-select"><span>Model</span><CaretDown size={13} /><select aria-label="Codex model" value={codex?.settings.model ?? ""} onChange={(event) => void onModelChange(event.target.value)} disabled={!codex}><option value="">Codex default</option>{codex?.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><span className={`codex-pill ${codexStatus === "connected" ? "is-connected" : ""}`}><span className="status-dot" />{codexStatus === "connected" ? "Ready" : codexStatus === "connecting" ? "Connecting" : "Unavailable"}</span>{codexStatus !== "connected" ? <button className="link-button" onClick={onReconnect}>Reconnect</button> : null}<span className="git-readout"><GitBranch size={14} />{git.branch ?? "No Git"}{git.dirty ? <span className="dirty-dot" title={`${git.changed_files} changed files`} /> : null}</span><button className="icon-button theme-toggle" title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={onThemeToggle}>{theme === "dark" ? <Sun size={16} /> : <MoonStars size={16} />}</button></div></header>;
}

function DashboardView({ channels, tasks, activeTasks, now, onCreate, openChannel, openTaskList }: { channels: Channel[]; tasks: Task[]; activeTasks: Task[]; now: number; onCreate: () => void; openChannel: (id: string) => void; openTaskList: () => void }) {
  const reviewCount = tasks.filter((task) => task.status === "WAITING_APPROVAL").length;
  const completedCount = tasks.filter((task) => task.status === "COMPLETED").length;
  return <section className="page-wrap">
    <div className="hero-row"><div><p className="eyebrow">Workspace</p><h1>Dashboard</h1></div><button className="primary-button hero-action" onClick={onCreate}><Plus size={18} />New channel</button></div>
    <div className="metric-grid"><Metric label="Channels" value={channels.length} note="Total" /><Metric label="Episodes" value={channels.reduce((total, channel) => total + channel.episode_count, 0)} note="Confirmed" /><Metric label="Running" value={activeTasks.length} note="Tasks" /><Metric label="Review" value={reviewCount} note={reviewCount ? "Required" : `${completedCount} done`} /></div>
    <div className="section-heading"><div><p className="eyebrow">Library</p><h2>Channels</h2></div></div>
    {channels.length === 0 ? <EmptyState icon={<Broadcast size={26} />} title="No channels" copy="Create a channel to begin." action="Create channel" onAction={onCreate} /> : <div className="channel-grid">{channels.map((channel, index) => <ChannelCard key={channel.channel_id} index={index + 1} channel={channel} onOpen={() => openChannel(channel.channel_id)} />)}</div>}
    <div className="section-heading activity-heading"><div><p className="eyebrow">Tasks</p><h2>Recent activity</h2></div><button className="text-button" onClick={openTaskList}>View all <ArrowUpRight size={15} /></button></div>
    {tasks.length === 0 ? <div className="activity-empty"><CheckCircle size={19} />No tasks yet.</div> : <div className="activity-list">{tasks.slice(0, 4).map((task) => <TaskRow key={task.task_id} task={task} now={now} />)}</div>}
  </section>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) { return <div className="metric"><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note}</span></div>; }

function ChannelsView({ selectedChannel, channels, tasks, onTaskSubmitted, openChannel, onCreate, onRefresh, onNotice, openEpisode }: { selectedChannel: Channel | null; channels: Channel[]; tasks: Task[]; onTaskSubmitted: (task: Task) => void; openChannel: (id: string) => void; onCreate: () => void; onRefresh: () => Promise<void>; onNotice: (notice: Notice) => void; openEpisode: (channelId: string, episodeId: string) => void }) {
  if (selectedChannel) return <ChannelDetail channel={selectedChannel} channels={channels} tasks={tasks} onTaskSubmitted={onTaskSubmitted} onBack={() => openChannel("")} onRefresh={onRefresh} onNotice={onNotice} openEpisode={openEpisode} />;
  return <section className="page-wrap"><PageTitle eyebrow="Library" title="Channels" action={<button className="primary-button" onClick={onCreate}><Plus size={17} />New channel</button>} />{channels.length === 0 ? <EmptyState icon={<Broadcast size={26} />} title="No channels yet" copy="Create a channel to begin." action="Create channel" onAction={onCreate} /> : <div className="channel-grid channel-grid-wide">{channels.map((channel, index) => <ChannelCard key={channel.channel_id} index={index + 1} channel={channel} onOpen={() => openChannel(channel.channel_id)} />)}</div>}</section>;
}

function ChannelDetail({ channel, channels, tasks, onTaskSubmitted, onBack, onRefresh, onNotice, openEpisode }: { channel: Channel; channels: Channel[]; tasks: Task[]; onTaskSubmitted: (task: Task) => void; onBack: () => void; onRefresh: () => Promise<void>; onNotice: (notice: Notice) => void; openEpisode: (channelId: string, episodeId: string) => void }) {
  const [dna, setDna] = useState<{ content: string; path: string; modified_at: string } | null>(null);
  const [topics, setTopics] = useState<TopicCandidate[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [editingDna, setEditingDna] = useState(false);
  const [dnaDraft, setDnaDraft] = useState("");
  const [showDna, setShowDna] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const channelTasks = tasks.filter((task) => task.channel_id === channel.channel_id);
  const topicTask = latestTask(channelTasks, ["SUGGEST_TOPICS"]);
  const dnaTask = latestTask(channelTasks, ["GENERATE_DNA"]);
  const topicTaskActive = Boolean(topicTask && isTaskActive(topicTask));
  const [topicClock, setTopicClock] = useState(() => Date.now());
  const observedTerminalTasks = useRef(new Set<string>());
  const load = useCallback(async () => { const [dnaResponse, topicResponse, episodeResponse] = await Promise.all([api.dna(channel.channel_id), api.topics(channel.channel_id), api.episodes(channel.channel_id)]); setDna(dnaResponse); setDnaDraft(dnaResponse.content); setTopics(topicResponse.topics); setEpisodes(episodeResponse.episodes); }, [channel.channel_id]);
  useEffect(() => { void load().catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [load, onNotice]);
  useEffect(() => {
    observedTerminalTasks.current = new Set(channelTasks.filter(isTaskTerminal).map((task) => task.task_id));
  }, [channel.channel_id]);
  useEffect(() => {
    if (!channelTasks.some(isTaskActive)) return;
    const timer = window.setInterval(() => setTopicClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [channelTasks.some(isTaskActive)]);
  useEffect(() => {
    const newlyTerminal = channelTasks.filter((task) => isTaskTerminal(task) && !observedTerminalTasks.current.has(task.task_id));
    if (newlyTerminal.length === 0) return;
    newlyTerminal.forEach((task) => observedTerminalTasks.current.add(task.task_id));
    void load().then(onRefresh).catch((error: Error) => onNotice({ tone: "bad", message: error.message }));
  }, [channelTasks.map((task) => `${task.task_id}:${task.status}`).join("|"), load, onNotice, onRefresh]);
  const suggest = async () => { if (topicTaskActive) return; setBusy("topics"); try { const result = await api.suggestTopics(channel.channel_id); onTaskSubmitted(result.task); onNotice({ tone: "good", message: "Generating 5 lightweight topic ideas…" }); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const confirmTopic = async (topic: TopicCandidate) => { setBusy(topic.topic_id); try { const result = await api.confirmTopic(channel.channel_id, topic.topic_id); onNotice({ tone: "good", message: `Episode created: ${result.episode.topic.title}` }); await load(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const saveDna = async () => { setBusy("dna"); try { await api.saveDna(channel.channel_id, dnaDraft); setEditingDna(false); onNotice({ tone: "good", message: "Channel DNA saved to the repository" }); await load(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const archive = async () => { try { await api.updateChannel(channel.channel_id, { status: channel.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" }); onNotice({ tone: "good", message: channel.status === "ARCHIVED" ? "Channel restored" : "Channel archived" }); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } };
  const remove = async () => { if (!window.confirm(`Delete ${channel.display_name} and its repository folder?`)) return; try { await api.deleteChannel(channel.channel_id); onNotice({ tone: "good", message: "Channel deleted" }); onBack(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } };
  return <section className="page-wrap detail-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} />All channels</button><div className="detail-header"><div><p className="eyebrow">Channel workspace</p><h1>{channel.display_name}</h1><p className="detail-copy">{channel.description || "No description yet. Your DNA is the source of truth for this channel."}</p></div><div className="detail-actions"><StatusBadge status={channel.status} /><button className="quiet-button" onClick={() => void archive()}><Archive size={16} />{channel.status === "ARCHIVED" ? "Restore" : "Archive"}</button><button className="icon-button danger" title="Delete channel" onClick={() => void remove()}><Trash size={17} /></button></div></div>
    <div className="detail-grid"><section className={`panel dna-panel ${showDna ? "is-open" : ""}`}><div className="panel-heading"><div><p className="eyebrow">Identity file</p><h2>Channel DNA</h2></div><div className="panel-actions">{editingDna ? <><button className="quiet-button compact" onClick={() => { setEditingDna(false); setDnaDraft(dna?.content ?? ""); }}><X size={15} />Cancel</button><button className="primary-button compact" disabled={busy === "dna"} onClick={() => void saveDna()}>{busy === "dna" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}Save</button></> : <><button className="quiet-button compact dna-toggle" aria-expanded={showDna} aria-controls="channel-dna-content" onClick={() => setShowDna((current) => !current)}>{showDna ? "Hide DNA" : "View DNA"}<CaretDown size={14} /></button>{showDna ? <button className="quiet-button compact" onClick={() => setEditingDna(true)}><PencilSimple size={15} />Edit DNA</button> : null}</>}</div></div>{dnaTask ? <TaskProgressPanel task={dnaTask} title="Channel DNA" activeLabel="Generating channel DNA" completionLabel="Channel DNA ready" now={topicClock} compact /> : null}{showDna ? <div id="channel-dna-content" className="dna-content">{editingDna ? <textarea className="markdown-editor" value={dnaDraft} onChange={(event) => setDnaDraft(event.target.value)} spellCheck={false} /> : <pre className="markdown-preview">{dna?.content || "Loading DNA…"}</pre>}<div className="file-meta"><FileText size={14} />{dna?.path ?? `channels/${channel.slug}/channel_dna.md`}<span>{dna?.modified_at ? `Updated ${formatDate(dna.modified_at)}` : ""}</span></div></div> : null}</section>
      <section className="panel status-panel"><div className="panel-heading"><div><h2>Production status</h2></div></div><div className="status-stack"><StatusLine label="Channel status" value={channel.status} /><StatusLine label="Episodes" value={String(episodes.length)} /><StatusLine label="Language" value={channel.language || "Not set"} /><StatusLine label="Market" value={channel.market || "Not set"} /></div></section></div>
     <div className="section-heading topic-heading"><div><p className="eyebrow">Ideas</p><h2>Topic suggestions</h2></div><button className="primary-button" disabled={busy === "topics" || topicTaskActive || channel.status === "ARCHIVED"} onClick={() => void suggest()}>{busy === "topics" || topicTaskActive ? <CircleNotch className="spin" size={17} /> : <Sparkle size={17} />}{topicTaskActive ? "Generating…" : "Suggest topics"}</button></div>
     {topicTask ? <TopicProgress task={topicTask} now={topicClock} /> : null}
     {topics.length === 0 ? <EmptyState compact icon={<Lightbulb size={23} />} title="No topic candidates yet" copy="Ideas stay lightweight until one earns its place as an episode." action="Suggest topics" disabled={topicTaskActive} busy={topicTaskActive} busyLabel="Generating topics…" onAction={() => void suggest()} /> : <div className="topic-grid">{topics.slice(0, 5).map((topic) => <TopicCard key={topic.topic_id} topic={topic} busy={busy === topic.topic_id} onConfirm={() => void confirmTopic(topic)} />)}</div>}
    <div className="section-heading episode-heading"><div><p className="eyebrow">Confirmed work</p><h2>Episodes</h2></div><span className="count-note">{episodes.length} {episodes.length === 1 ? "episode" : "episodes"}</span></div>{episodes.length === 0 ? <div className="activity-empty"><FilmSlate size={19} />Confirmed topics will become episodes here.</div> : <div className="episode-list">{episodes.map((episode) => <button className="episode-row" key={episode.episode_id} onClick={() => openEpisode(channel.channel_id, episode.episode_id)}><div className="episode-index">{String(episodes.indexOf(episode) + 1).padStart(2, "0")}</div><div className="episode-info"><strong>{episode.topic.title}</strong><span>{episode.topic.premise}</span></div><StageBadge stage={episode.stage} /><ArrowUpRight size={17} /></button>)}</div>}
  </section>;
}

function TopicsView({ channels, openChannel, onNotice }: { channels: Channel[]; openChannel: (id: string) => void; onNotice: (notice: Notice) => void }) { return <section className="page-wrap"><PageTitle eyebrow="Ideas" title="Topics" />{channels.length === 0 ? <EmptyState icon={<Lightbulb size={26} />} title="No channel context yet" copy="Create a channel first." action="Browse channels" onAction={() => onNotice({ tone: "neutral", message: "Create a channel first" })} /> : <div className="topic-channel-list">{channels.map((channel) => <button className="topic-channel-row" key={channel.channel_id} onClick={() => openChannel(channel.channel_id)}><div className="channel-avatar">{initials(channel.display_name)}</div><div><strong>{channel.display_name}</strong><span>Open topics</span></div><ArrowUpRight size={17} /></button>)}</div>}</section>; }

function EpisodesView({ channel, episodeId, tasks, onTaskSubmitted, openChannel, openEpisode, maxDuration, onNotice }: { channel: Channel | null; episodeId: string | null; tasks: Task[]; onTaskSubmitted: (task: Task) => void; openChannel: (id: string) => void; openEpisode: (channelId: string, episodeId: string) => void; maxDuration: number; onNotice: (notice: Notice) => void }) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const terminalTaskKey = tasks.filter((task) => task.channel_id === channel?.channel_id && isTaskTerminal(task)).map((task) => `${task.task_id}:${task.status}`).join("|");
  useEffect(() => { if (channel) void api.episodes(channel.channel_id).then((response) => setEpisodes(response.episodes)).catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [channel?.channel_id, terminalTaskKey, onNotice]);
  if (!channel) return <section className="page-wrap"><PageTitle eyebrow="Episodes" title="Choose a channel" />{<div className="topic-channel-list">{episodes.length === 0 && <EmptyState compact icon={<FilmSlate size={23} />} title="Select a channel" copy="Open a channel to see episodes." action="Browse channels" onAction={() => onNotice({ tone: "neutral", message: "Choose a channel first" })} />}</div>}</section>;
  if (episodeId) return <EpisodeDetail channel={channel} episodeId={episodeId} tasks={tasks} onTaskSubmitted={onTaskSubmitted} maxDuration={maxDuration} onBack={() => openChannel(channel.channel_id)} onNotice={onNotice} />;
  return <section className="page-wrap"><button className="back-button" onClick={() => openChannel(channel.channel_id)}><ArrowLeft size={16} />Channel</button><PageTitle eyebrow={channel.display_name} title="Episodes" />{episodes.length === 0 ? <EmptyState icon={<FilmSlate size={26} />} title="No episodes yet" copy="Choose a topic to create one." action="Open channel" onAction={() => openChannel(channel.channel_id)} /> : <div className="episode-list">{episodes.map((episode, index) => <button className="episode-row" key={episode.episode_id} onClick={() => openEpisode(channel.channel_id, episode.episode_id)}><div className="episode-index">{String(index + 1).padStart(2, "0")}</div><div className="episode-info"><strong>{episode.topic.title}</strong><span>{episode.topic.premise}</span></div><StageBadge stage={episode.stage} /><ArrowUpRight size={17} /></button>)}</div>}</section>;
}

function EpisodeDetail({ channel, episodeId, tasks, onTaskSubmitted, maxDuration, onBack, onNotice }: { channel: Channel; episodeId: string; tasks: Task[]; onTaskSubmitted: (task: Task) => void; maxDuration: number; onBack: () => void; onNotice: (notice: Notice) => void }) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [script, setScript] = useState("");
  const [scriptEditing, setScriptEditing] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [episodeClock, setEpisodeClock] = useState(() => Date.now());
  const episodeTasks = tasks.filter((task) => task.episode_id === episodeId);
  const scriptTask = latestTask(episodeTasks, ["GENERATE_SCRIPT"]);
  const sceneTask = latestTask(episodeTasks, ["GENERATE_SCENES"]);
  const scriptTaskActive = Boolean(scriptTask && isTaskActive(scriptTask));
  const sceneTaskActive = Boolean(sceneTask && isTaskActive(sceneTask));
  const observedTerminalTasks = useRef(new Set<string>());
  const load = useCallback(async () => { const [episodesResponse, scriptResponse, scenesResponse] = await Promise.all([api.episodes(channel.channel_id), api.file(channel.channel_id, episodeId, "script.md"), api.scenes(channel.channel_id, episodeId)]); setEpisode(episodesResponse.episodes.find((item) => item.episode_id === episodeId) ?? null); setScript(scriptResponse.content); setScenes(scenesResponse.scenes); }, [channel.channel_id, episodeId]);
  useEffect(() => { void load().catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [load, onNotice]);
  useEffect(() => {
    observedTerminalTasks.current = new Set(episodeTasks.filter(isTaskTerminal).map((task) => task.task_id));
  }, [episodeId]);
  useEffect(() => {
    if (!episodeTasks.some(isTaskActive)) return;
    const timer = window.setInterval(() => setEpisodeClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [episodeTasks.some(isTaskActive)]);
  useEffect(() => {
    const newlyTerminal = episodeTasks.filter((task) => isTaskTerminal(task) && !observedTerminalTasks.current.has(task.task_id));
    if (newlyTerminal.length === 0) return;
    newlyTerminal.forEach((task) => observedTerminalTasks.current.add(task.task_id));
    void load().catch((error: Error) => onNotice({ tone: "bad", message: error.message }));
  }, [episodeTasks.map((task) => `${task.task_id}:${task.status}`).join("|"), load, onNotice]);
  const createTask = async (taskType: Task["task_type"], sceneNumber?: number) => { const taskKey = taskType + (sceneNumber ?? ""); setBusy(taskKey); try { const result = await api.createTask({ task_type: taskType, channel_id: channel.channel_id, episode_id: episodeId, scene_number: sceneNumber }); onTaskSubmitted(result.task); onNotice({ tone: "good", message: taskType === "GENERATE_SCENES" ? "Scene breakdown queued" : taskType === "GENERATE_SCRIPT" ? "Script generation queued" : `Scene ${sceneNumber} regeneration queued` }); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const saveScript = async () => { setBusy("script"); try { await api.saveFile(channel.channel_id, episodeId, "script.md", script); setScriptEditing(false); onNotice({ tone: "good", message: "Script saved to the repository" }); await load(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const saveScenes = async () => { setBusy("scenes"); try { await api.saveScenes(channel.channel_id, episodeId, scenes); onNotice({ tone: "good", message: "Scene edits saved" }); await load(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const copy = async (key: string, value: string) => { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(null), 1300); };
  if (!episode) return <section className="page-wrap"><LoadingState /></section>;
  return <section className="page-wrap detail-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} />{channel.display_name}</button><div className="detail-header episode-detail-header"><div><p className="eyebrow">Episode workspace</p><h1>{episode.topic.title}</h1><p className="detail-copy">{episode.topic.premise}</p></div><div className="detail-actions"><StageBadge stage={episode.stage} /><button className="primary-button" disabled={busy === "GENERATE_SCRIPT" || scriptTaskActive || scriptEditing} onClick={() => void createTask("GENERATE_SCRIPT")}>{busy === "GENERATE_SCRIPT" || scriptTaskActive ? <CircleNotch className="spin" size={16} /> : <Play size={16} />}{scriptTaskActive ? "Generating script…" : "Create script"}</button></div></div>
    <section className="panel script-panel"><div className="panel-heading"><div><p className="eyebrow">Narrative</p><h2>Script</h2></div><div className="panel-actions">{scriptEditing ? <><button className="quiet-button" onClick={() => { setScriptEditing(false); void load(); }}><X size={15} />Cancel</button><button className="primary-button compact" disabled={busy === "script"} onClick={() => void saveScript()}>{busy === "script" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}{busy === "script" ? "Saving…" : "Save"}</button></> : <button className="quiet-button" disabled={scriptTaskActive} onClick={() => setScriptEditing(true)}><PencilSimple size={15} />Edit</button>}</div></div>{scriptTask ? <TaskProgressPanel task={scriptTask} title="Script generation" activeLabel="Generating script" completionLabel="Script ready" now={episodeClock} compact /> : null}{scriptEditing ? <textarea className="markdown-editor script-editor" value={script} onChange={(event) => setScript(event.target.value)} spellCheck={false} /> : <pre className="markdown-preview script-preview">{script || "Script generation has not started."}</pre>}</section>
    <div className="section-heading scene-heading"><div><p className="eyebrow">Paired visual plan</p><h2>Scene breakdown</h2><p className="section-copy">Dialogue and video prompt stay paired, with one coherent shot per scene.</p></div><button className="primary-button" disabled={busy === "GENERATE_SCENES" || sceneTaskActive || scriptTaskActive} onClick={() => void createTask("GENERATE_SCENES")}>{busy === "GENERATE_SCENES" || sceneTaskActive ? <CircleNotch className="spin" size={17} /> : <Sparkle size={17} />}{sceneTaskActive ? "Generating scenes…" : "Create scene breakdown"}</button></div>
    {sceneTask ? <TaskProgressPanel task={sceneTask} title="Scene generation" activeLabel="Building scene breakdown" completionLabel="Scene breakdown ready" now={episodeClock} /> : null}
    {scenes.length === 0 ? <EmptyState compact icon={<FilmSlate size={23} />} title="No scenes yet" copy="Generate a breakdown after the script is ready." action="Create scene breakdown" disabled={sceneTaskActive || scriptTaskActive} busy={sceneTaskActive} busyLabel="Generating scenes…" onAction={() => void createTask("GENERATE_SCENES")} /> : <div className="scene-list">{scenes.map((scene) => <SceneCard key={scene.scene_id} scene={scene} task={latestTask(episodeTasks, ["REGENERATE_DIALOGUE", "REGENERATE_PROMPT", "REGENERATE_BOTH"], scene.scene_number)} now={episodeClock} maxDuration={maxDuration} copied={copied} busy={busy} onCopy={copy} onChange={(next) => setScenes((current) => current.map((item) => item.scene_id === scene.scene_id ? next : item))} onRegenerate={(type) => void createTask(type, scene.scene_number)} />)}<div className="scene-save-row"><span>Manual edits do not call Codex.</span><button className="primary-button compact" disabled={busy === "scenes" || episodeTasks.some(isTaskActive)} onClick={() => void saveScenes()}>{busy === "scenes" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}{busy === "scenes" ? "Saving…" : "Save scene edits"}</button></div></div>}
  </section>;
}

function SceneCard({ scene, task, now, maxDuration, copied, busy, onCopy, onChange, onRegenerate }: { scene: Scene; task: Task | null; now: number; maxDuration: number; copied: string | null; busy: string | null; onCopy: (key: string, value: string) => Promise<void>; onChange: (scene: Scene) => void; onRegenerate: (type: Task["task_type"]) => void }) {
  const regenerating = Boolean(task && isTaskActive(task));
  const submitting = busy === `REGENERATE_BOTH${scene.scene_number}`;
  return <article className={`scene-card ${regenerating ? "is-processing" : ""}`}><div className="scene-card-header"><div className="scene-number">Scene {String(scene.scene_number).padStart(2, "0")}</div><label className="duration-input">Duration <input type="number" min="1" max={maxDuration} step="0.5" value={scene.duration_seconds} disabled={regenerating} onChange={(event) => onChange({ ...scene, duration_seconds: Math.min(maxDuration, Number(event.target.value)) })} /> sec</label><div className="scene-tools"><button className="quiet-button compact" onClick={() => onRegenerate("REGENERATE_BOTH")} disabled={submitting || regenerating}>{submitting || regenerating ? <CircleNotch className="spin" size={14} /> : <ArrowClockwise size={14} />}{regenerating ? "Regenerating…" : "Regenerate"}</button></div></div>{task ? <InlineTaskState task={task} now={now} /> : null}<div className="scene-columns"><div className="scene-block"><div className="block-heading"><span>Dialogue / Narration</span><button className="copy-button" onClick={() => void onCopy(`${scene.scene_id}-dialogue`, scene.dialogue)}>{copied === `${scene.scene_id}-dialogue` ? <Check size={14} /> : <Copy size={14} />} {copied === `${scene.scene_id}-dialogue` ? "Copied" : "Copy"}</button></div><textarea value={scene.dialogue} disabled={regenerating} onChange={(event) => onChange({ ...scene, dialogue: event.target.value })} /></div><div className="scene-block prompt-block"><div className="block-heading"><span>Video generation prompt</span><button className="copy-button" onClick={() => void onCopy(`${scene.scene_id}-prompt`, scene.visual_prompt)}>{copied === `${scene.scene_id}-prompt` ? <Check size={14} /> : <Copy size={14} />} {copied === `${scene.scene_id}-prompt` ? "Copied" : "Copy"}</button></div><textarea value={scene.visual_prompt} disabled={regenerating} onChange={(event) => onChange({ ...scene, visual_prompt: event.target.value })} /></div></div><div className="scene-notes"><input aria-label="Transition note" placeholder="Transition note" value={scene.transition_note} disabled={regenerating} onChange={(event) => onChange({ ...scene, transition_note: event.target.value })} /><input aria-label="Continuity note" placeholder="Continuity note" value={scene.continuity_note} disabled={regenerating} onChange={(event) => onChange({ ...scene, continuity_note: event.target.value })} /></div></article>;
}

function TasksView({ tasks, now, onRefresh, onNotice }: { tasks: Task[]; now: number; onRefresh: () => Promise<void>; onNotice: (notice: Notice) => void }) { const cancel = async (task: Task) => { try { await api.cancelTask(task.task_id); onNotice({ tone: "good", message: "Task cancelled" }); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } }; return <section className="page-wrap"><PageTitle eyebrow="Operations" title="Tasks" action={<button className="quiet-button" onClick={() => void onRefresh()}><ArrowClockwise size={16} />Refresh</button>} />{tasks.length === 0 ? <EmptyState icon={<ListChecks size={26} />} title="No tasks yet" copy="Generated work will appear here." action="Refresh" onAction={() => void onRefresh()} /> : <div className="task-table">{tasks.map((task) => <TaskTableRow key={task.task_id} task={task} now={now} onCancel={() => void cancel(task)} />)}</div>}</section>; }

function SettingsView({ codex, codexStatus, git, storage, onStorageSaved, onCodexSaved, onNotice }: { codex: CodexSettingsResponse | null; codexStatus: string; git: { branch: string | null; dirty: boolean; changed_files: number }; storage: StorageInfo | null; onStorageSaved: (storage: StorageInfo) => void | Promise<void>; onCodexSaved: (response: CodexSettingsResponse) => void; onNotice: (notice: Notice) => void }) {
  const [storagePath, setStoragePath] = useState(storage?.path ?? "");
  const [transport, setTransport] = useState(codex?.settings.transport ?? "app_server");
  const [baseUrl, setBaseUrl] = useState(codex?.settings.api_base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [savingStorage, setSavingStorage] = useState(false);
  const [savingCodex, setSavingCodex] = useState(false);
  useEffect(() => { setStoragePath(storage?.path ?? ""); }, [storage?.path]);
  useEffect(() => { setTransport(codex?.settings.transport ?? "app_server"); setBaseUrl(codex?.settings.api_base_url ?? ""); }, [codex]);
  const saveStorage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!storagePath.trim()) return;
    setSavingStorage(true);
    try {
      const next = await api.setStorage(storagePath);
      await onStorageSaved(next);
      onNotice({ tone: "good", message: "Storage folder saved" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update storage" });
    } finally {
      setSavingStorage(false);
    }
  };
  const saveCodex = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingCodex(true);
    try {
      const next = await api.saveCodexSettings({ transport, api_base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) });
      onCodexSaved(next);
      setApiKey("");
      onNotice({ tone: "good", message: "Codex settings saved locally" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save Codex settings" });
    } finally {
      setSavingCodex(false);
    }
  };
  return <section className="page-wrap"><PageTitle eyebrow="Workspace" title="Settings" /><div className="settings-grid"><section className="panel codex-settings-panel"><div className="panel-heading"><div><p className="eyebrow">Connection</p><h2>Codex</h2></div><TerminalWindow size={22} /></div><StatusLine label="Status" value={codexStatus} /><StatusLine label="Transport" value={codex?.settings.transport === "openai_compatible" ? "Cockpit API" : "App Server"} /><StatusLine label="Selected model" value={codex?.settings.model || "Codex default"} /><form className="codex-form" onSubmit={(event) => void saveCodex(event)}><label>Transport<select value={transport} onChange={(event) => setTransport(event.target.value as "app_server" | "openai_compatible")}><option value="app_server">Local Codex App Server</option><option value="openai_compatible">Cockpit API Service</option></select></label>{transport === "openai_compatible" ? <><label>Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:PORT/v1" /></label><label>API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={codex?.settings.has_api_key ? "Saved locally — leave blank to keep" : "Paste Cockpit API key"} autoComplete="off" /></label><p className="storage-hint">Key stays on this computer.</p></> : null}<button className="primary-button" disabled={savingCodex}>{savingCodex ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save Codex</button></form></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Git</p><h2>Repository</h2></div><GitBranch size={22} /></div><StatusLine label="Branch" value={git.branch ?? "Not a Git repository"} /><StatusLine label="Working tree" value={git.dirty ? `${git.changed_files} changed files` : "Clean"} /></section><section className="panel storage-panel"><div className="panel-heading"><div><p className="eyebrow">Local content</p><h2>Storage folder</h2></div><FileText size={22} /></div><StatusLine label="Status" value={storage?.configured ? "Configured" : "Using project folder"} /><div className="storage-location"><span>Channel data folder</span><code>{storage?.channel_path ?? "Loading…"}</code></div><form className="storage-form" onSubmit={(event) => void saveStorage(event)}><label>Parent folder<input aria-label="Content storage folder" value={storagePath} onChange={(event) => setStoragePath(event.target.value)} placeholder="D:\\Documentary Studio Data" /></label><button className="primary-button" disabled={savingStorage || !storagePath.trim()}>{savingStorage ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save folder</button></form><p className="storage-hint">Channel and episode files stay here and are excluded from Git.</p></section></div></section>;
}

function StorageSetupModal({ storage, onSaved, onError }: { storage: StorageInfo; onSaved: (storage: StorageInfo) => void | Promise<void>; onError: (error: unknown) => void }) {
  const [storagePath, setStoragePath] = useState(storage.default_path);
  const [busy, setBusy] = useState(false);
  const save = async (path: string) => {
    setBusy(true);
    try {
      await onSaved(await api.setStorage(path));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" role="presentation"><form className="modal storage-setup-modal" onSubmit={(event) => { event.preventDefault(); void save(storagePath); }}><div className="modal-heading"><div><p className="eyebrow">First launch</p><h2>Choose storage</h2></div></div><p className="modal-copy">Channel files stay here and out of Git.</p><label>Parent folder<input aria-label="First launch storage folder" autoFocus value={storagePath} onChange={(event) => setStoragePath(event.target.value)} placeholder="D:\\Documentary Studio Data" /></label><p className="storage-hint">A <code>channels/</code> folder will be created here.</p><div className="modal-actions"><button type="button" className="quiet-button" disabled={busy} onClick={() => void save(storage.default_path)}>Use project folder</button><button className="primary-button" disabled={busy || !storagePath.trim()}>{busy ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save folder</button></div></form></div>;
}

type CreateChannelForm = {
  name: string;
  description: string;
  target_audience: string;
  language: string;
  market: string;
  dna_mode: "example" | "ai" | "upload";
  dna_content: string;
};

function CreateChannelModal({ onClose, onCreated, onError }: { onClose: () => void; onCreated: (channelId: string, message: string, task: Task | null) => Promise<void>; onError: (error: unknown) => void }) {
  const [form, setForm] = useState<CreateChannelForm>({ name: "", description: "", target_audience: "", language: "English", market: "", dna_mode: "example", dna_content: "" });
  const [dnaFileName, setDnaFileName] = useState("");
  const [busy, setBusy] = useState(false);

  const selectMode = (dna_mode: CreateChannelForm["dna_mode"]) => setForm((current) => ({ ...current, dna_mode }));
  const handleDnaUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      event.target.value = "";
      onError(new Error("Choose a Markdown file (.md) for channel DNA."));
      return;
    }
    try {
      const content = await file.text();
      if (!content.trim()) throw new Error("The selected channel DNA file is empty.");
      setForm((current) => ({ ...current, dna_mode: "upload", dna_content: content }));
      setDnaFileName(file.name);
    } catch (error) {
      event.target.value = "";
      onError(error);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.dna_mode === "upload" && !form.dna_content.trim()) {
      onError(new Error("Choose a channel_dna.md file before creating the channel."));
      return;
    }
    setBusy(true);
    try {
      const result = await api.createChannel(form);
      const message = result.task ? "Channel created and DNA generation queued" : form.dna_mode === "upload" ? "Channel created from uploaded DNA" : "Channel created with example DNA";
      await onCreated(result.channel.channel_id, message, result.task);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={(event) => void submit(event)}><div className="modal-heading"><div><p className="eyebrow">New workspace</p><h2>Create channel</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>Channel name<input required autoFocus value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Your channel name" /></label><label>Concept or description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe the documentary territory in one sentence." /></label><div className="form-grid"><label>Audience<input value={form.target_audience} onChange={(event) => setForm((current) => ({ ...current, target_audience: event.target.value }))} placeholder="Curious generalists" /></label><label>Market<input value={form.market} onChange={(event) => setForm((current) => ({ ...current, market: event.target.value }))} placeholder="Global" /></label></div><div className="dna-choice"><span className="field-label">Starting DNA</span><div className="choice-row dna-choice-row">{([["example", "Use example"], ["ai", "Create with AI"], ["upload", "Upload DNA"]] as const).map(([value, label]) => <button type="button" key={value} className={`choice ${form.dna_mode === value ? "is-selected" : ""}`} onClick={() => selectMode(value)}><span className="choice-radio" />{label}</button>)}</div>{form.dna_mode === "upload" ? <div className="dna-upload"><label className="dna-upload-button"> <FileText size={15} />{dnaFileName || "Choose channel_dna.md"}<input aria-label="Channel DNA file" type="file" accept=".md,text/markdown" onChange={(event) => void handleDnaUpload(event)} /></label>{dnaFileName ? <span className="dna-file-name">{dnaFileName}</span> : <span className="dna-upload-hint">Markdown only</span>}</div> : null}</div><div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || (form.dna_mode === "upload" && !form.dna_content.trim())}>{busy ? <CircleNotch className="spin" size={16} /> : <Plus size={16} />}Create channel</button></div></form></div>;
}

function PageTitle({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: React.ReactNode }) { return <div className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{copy ? <p className="page-copy">{copy}</p> : null}</div>{action ? <div>{action}</div> : null}</div>; }
function ChannelCard({ channel, index, onOpen }: { channel: Channel; index: number; onOpen: () => void }) { return <button className="channel-card" onClick={onOpen}><div className="card-top"><div className="card-identity"><span className="channel-index">{String(index).padStart(2, "0")}</span><div className="channel-avatar">{initials(channel.display_name)}</div></div><StatusBadge status={channel.status} /></div><h3>{channel.display_name}</h3><p>{channel.description || "Channel DNA ready."}</p><div className="card-bottom"><span>{channel.episode_count} {channel.episode_count === 1 ? "episode" : "episodes"}</span><ArrowUpRight size={16} /></div></button>; }
function TaskActivityBar({ tasks, realtimeStatus, now, onOpenTasks }: { tasks: Task[]; realtimeStatus: RealtimeStatus; now: number; onOpenTasks: () => void }) {
  if (tasks.length === 0 && realtimeStatus === "connected") return null;
  const task = tasks[0] ?? null;
  const reconnecting = realtimeStatus !== "connected";
  return <div className={`task-activity-bar ${reconnecting ? "is-reconnecting" : ""}`} role="status"><div className="task-activity-signal"><span className="live-pulse" /><span>{reconnecting ? "Reconnecting live updates" : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} active`}</span></div>{task ? <><div className="task-activity-copy"><strong>{formatTaskType(task.task_type)}</strong><span>{task.progress_message || task.status}</span></div><span className="task-activity-time">{formatTaskElapsed(task, now)}</span><div className="task-activity-track" role="progressbar" aria-label="Active task progress" aria-valuetext={task.progress_message || task.status}><span /></div></> : <div className="task-activity-copy"><strong>Restoring connection</strong><span>Results will sync automatically when the connection returns.</span></div>}<button className="text-button" onClick={onOpenTasks}>View tasks <ArrowUpRight size={14} /></button></div>;
}

function TaskProgressPanel({ task, title, activeLabel, completionLabel, now, compact = false, progressLabel = `${title} progress` }: { task: Task; title: string; activeLabel: string; completionLabel: string; now: number; compact?: boolean; progressLabel?: string }) {
  const active = isTaskActive(task);
  const completed = task.status === "COMPLETED";
  const failed = task.status === "FAILED";
  const cancelled = task.status === "CANCELLED";
  const label = completed ? completionLabel : failed ? `${title} failed` : cancelled ? `${title} cancelled` : task.status === "WAITING_APPROVAL" ? "Waiting for approval" : activeLabel;
  const progressMessage = task.error || task.progress_message || task.status;
  return <div className={`task-progress-panel ${task.status.toLowerCase()} ${compact ? "is-compact" : ""}`} role="status"><div className="task-progress-head"><div className="task-progress-title"><span className="eyebrow">{title}</span><strong>{label}</strong></div><span className="task-progress-time">{formatTaskElapsed(task, now)}</span></div><div className="task-progress-track" role="progressbar" aria-label={progressLabel} aria-valuetext={completed ? "Complete" : failed ? "Failed" : cancelled ? "Cancelled" : progressMessage}><span className="task-progress-fill" /></div><p className="task-progress-copy">{progressMessage}{active ? " — updates appear here automatically" : ""}</p></div>;
}

function TopicProgress({ task, now }: { task: Task; now: number }) { return <TaskProgressPanel task={task} title="Topic generation" activeLabel="Generating 5 topics" completionLabel="5 topics ready" progressLabel="Topic generation progress" now={now} />; }

function InlineTaskState({ task, now }: { task: Task; now: number }) { return <div className={`inline-task-state ${task.status.toLowerCase()}`} role="status"><span className="task-status-dot" /><strong>{task.status === "COMPLETED" ? "Updated" : task.status === "FAILED" ? "Failed" : task.status === "CANCELLED" ? "Cancelled" : task.progress_message || "Working"}</strong><span>{task.error || task.progress_message}</span><time>{formatTaskElapsed(task, now)}</time>{isTaskActive(task) ? <div className="inline-task-track"><span /></div> : null}</div>; }

function TopicCard({ topic, onConfirm, busy }: { topic: TopicCandidate; onConfirm: () => void; busy: boolean }) { return <article className="topic-card"><div className="topic-number">Topic candidate</div><h3>{topic.title}</h3><p className="topic-premise">{topic.premise}</p><div className="topic-detail"><span>Why it fits</span><p>{topic.why_it_fits}</p></div><div className="topic-detail"><span>Hook</span><p>{topic.hook}</p></div><div className="topic-footer"><span>{topic.estimated_potential}</span><button className="text-button" disabled={busy} onClick={onConfirm}>{busy ? <CircleNotch className="spin" size={15} /> : <Play size={14} />}Use this topic</button></div></article>; }
function TaskRow({ task, now }: { task: Task; now: number }) { return <div className={`activity-row ${isTaskActive(task) ? "is-processing" : ""}`}><div className={`task-status-dot ${task.status.toLowerCase()}`} /><div><strong>{formatTaskType(task.task_type)}</strong><span>{task.error || task.progress_message || task.status}</span></div><span className="task-elapsed">{formatTaskElapsed(task, now)}</span><span className="activity-status">{task.status}</span></div>; }
function TaskTableRow({ task, now, onCancel }: { task: Task; now: number; onCancel: () => void }) { const active = isTaskActive(task); return <div className={`task-row ${active ? "is-processing" : ""}`}><div className={`task-status-dot ${task.status.toLowerCase()}`} /><div className="task-main"><strong>{formatTaskType(task.task_type)}{task.scene_number ? ` · Scene ${task.scene_number}` : ""}</strong><span>{task.error || task.progress_message || task.status}</span>{active ? <div className="task-row-progress" role="progressbar" aria-label={`${formatTaskType(task.task_type)} progress`} aria-valuetext={task.progress_message || task.status}><span /></div> : null}</div><span className="task-elapsed">{formatTaskElapsed(task, now)}</span><span className="task-status-label">{task.status}</span>{task.queue_position !== null ? <span className="queue-label">Queue {task.queue_position + 1}</span> : null}{active ? <button className="icon-button" title="Cancel task" onClick={onCancel}><X size={16} /></button> : <span className="task-time">{task.completed_at ? formatDate(task.completed_at) : ""}</span>}</div>; }
function StatusLine({ label, value }: { label: string; value: string }) { return <div className="status-line"><span>{label}</span><strong>{value}</strong></div>; }
function StatusBadge({ status }: { status: string }) { return <span className={`status-badge ${status.toLowerCase()}`}>{status.toLowerCase()}</span>; }
function StageBadge({ stage }: { stage: string }) { return <span className="stage-badge">{stage.replaceAll("_", " ").toLowerCase()}</span>; }
function EmptyState({ icon, title, copy, action, onAction, compact = false, disabled = false, busy = false, busyLabel }: { icon: React.ReactNode; title: string; copy: string; action: string; onAction: () => void; compact?: boolean; disabled?: boolean; busy?: boolean; busyLabel?: string }) { return <div className={`empty-state ${compact ? "is-compact" : ""}`}><div className="empty-icon">{busy ? <CircleNotch className="spin" size={24} /> : icon}</div><h3>{title}</h3><p>{copy}</p><button className="quiet-button" disabled={disabled || busy} onClick={onAction}>{busy ? <CircleNotch className="spin" size={15} /> : null}{busy ? busyLabel || "Working…" : action}{busy ? null : <ArrowUpRight size={15} />}</button></div>; }
function LoadingState() { return <section className="page-wrap"><div className="loading-state"><CircleNotch className="spin" size={22} /><span>Loading workspace</span></div></section>; }
function NoticeBanner({ notice, onClose }: { notice: NonNullable<Notice>; onClose: () => void }) { return <div className={`notice-banner ${notice.tone}`}><span>{notice.tone === "good" ? <CheckCircle size={18} /> : notice.tone === "bad" ? <WarningCircle size={18} /> : <Sparkle size={18} />}</span><span>{notice.message}</span><button onClick={onClose}><X size={15} /></button></div>; }
function formatTaskType(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase()); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatElapsed(start: string, end: number): string { const seconds = Math.max(0, Math.floor((end - new Date(start).getTime()) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function formatTaskElapsed(task: Task, now: number): string { return formatElapsed(task.started_at || task.created_at, task.completed_at ? new Date(task.completed_at).getTime() : now); }
function isTaskActive(task: Task): boolean { return ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status); }
function isTaskTerminal(task: Task): boolean { return ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status); }
function latestTask(tasks: Task[], types: Task["task_type"][], sceneNumber?: number): Task | null { return tasks.filter((task) => types.includes(task.task_type) && (sceneNumber === undefined || task.scene_number === sceneNumber)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null; }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CH"; }
