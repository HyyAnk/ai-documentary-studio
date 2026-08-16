import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowClockwise,
  ArrowLeft,
  ArrowUpRight,
  Broadcast,
  Check,
  CheckCircle,
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
  PencilSimple,
  Play,
  Plus,
  Sparkle,
  Trash,
  TerminalWindow,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { AppConfig, Channel, Episode, Scene, Task, TaskEvent, TopicCandidate } from "@studio/shared";
import { api, subscribeEvents } from "./api";

type Page = "dashboard" | "channels" | "topics" | "episodes" | "tasks" | "settings";
type Notice = { tone: "good" | "bad" | "neutral"; message: string } | null;

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [git, setGit] = useState<{ branch: string | null; dirty: boolean; changed_files: number }>({ branch: null, dirty: false, changed_files: 0 });
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [codexStatus, setCodexStatus] = useState("disconnected");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [channelResponse, taskResponse, gitResponse, configResponse] = await Promise.all([api.channels(), api.tasks(), api.git(), api.config()]);
    setChannels(channelResponse.channels);
    setTasks(taskResponse.tasks);
    setCodexStatus(taskResponse.codex_status);
    setGit(gitResponse);
    setAppConfig(configResponse);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh().catch((error: Error) => { setNotice({ tone: "bad", message: error.message }); setLoading(false); });
    return subscribeEvents((event: TaskEvent) => {
      if (event.status) setCodexStatus(event.status);
      if (event.task) setTasks((current) => [event.task!, ...current.filter((task) => task.task_id !== event.task!.task_id)]);
      if (event.type === "task.updated" && event.task?.status === "COMPLETED") void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedChannel = channels.find((channel) => channel.channel_id === selectedChannelId) ?? null;
  const activeTasks = tasks.filter((task) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status));

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

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={(next) => { setPage(next); if (next !== "channels") setSelectedChannelId(null); if (next !== "episodes") setSelectedEpisodeId(null); }} activeTaskCount={activeTasks.length} />
      <main className="main-column">
        <Topbar channel={selectedChannel} codexStatus={codexStatus} git={git} onReconnect={async () => { try { const result = await api.reconnectCodex(); setCodexStatus(result.status); showGood(result.status === "connected" ? "Codex App Server connected" : "Codex App Server unavailable"); } catch (error) { showError(error); } }} />
        {loading ? <LoadingState /> : page === "dashboard" ? <DashboardView channels={channels} tasks={tasks} activeTasks={activeTasks} onCreate={() => setShowCreate(true)} openChannel={openChannel} openTaskList={() => setPage("tasks")} /> : null}
        {!loading && page === "channels" ? <ChannelsView selectedChannel={selectedChannel} channels={channels} openChannel={openChannel} onCreate={() => setShowCreate(true)} onRefresh={refresh} onNotice={setNotice} openEpisode={openEpisode} /> : null}
        {!loading && page === "topics" ? <TopicsView channels={channels} openChannel={openChannel} onNotice={setNotice} /> : null}
        {!loading && page === "episodes" ? <EpisodesView channel={selectedChannel} episodeId={selectedEpisodeId} openChannel={openChannel} openEpisode={openEpisode} maxDuration={appConfig?.video_generation.max_scene_duration_seconds ?? 8} onNotice={setNotice} /> : null}
        {!loading && page === "tasks" ? <TasksView tasks={tasks} onRefresh={refresh} onNotice={setNotice} /> : null}
        {!loading && page === "settings" ? <SettingsView codexStatus={codexStatus} git={git} /> : null}
      </main>
      {showCreate ? <CreateChannelModal onClose={() => setShowCreate(false)} onCreated={async (channelId, message) => { setShowCreate(false); await refresh(); openChannel(channelId); setNotice({ tone: "good", message }); }} onError={showError} /> : null}
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

function Topbar({ channel, codexStatus, git, onReconnect }: { channel: Channel | null; codexStatus: string; git: { branch: string | null; dirty: boolean; changed_files: number }; onReconnect: () => void }) {
  return <header className="topbar"><div className="context-trail"><span className="context-kicker">Workspace</span><span className="context-title">{channel?.display_name ?? "Production overview"}</span></div><div className="topbar-meta"><span className={`codex-pill ${codexStatus === "connected" ? "is-connected" : ""}`}><span className="status-dot" />{codexStatus === "connected" ? "Codex ready" : codexStatus === "connecting" ? "Connecting" : "Codex unavailable"}</span>{codexStatus !== "connected" ? <button className="link-button" onClick={onReconnect}>Reconnect</button> : null}<span className="git-readout"><GitBranch size={14} />{git.branch ?? "No Git branch"}{git.dirty ? <span className="dirty-dot" title={`${git.changed_files} changed files`} /> : null}</span></div></header>;
}

function DashboardView({ channels, tasks, activeTasks, onCreate, openChannel, openTaskList }: { channels: Channel[]; tasks: Task[]; activeTasks: Task[]; onCreate: () => void; openChannel: (id: string) => void; openTaskList: () => void }) {
  const reviewCount = tasks.filter((task) => task.status === "WAITING_APPROVAL").length;
  const completedCount = tasks.filter((task) => task.status === "COMPLETED").length;
  return <section className="page-wrap">
    <div className="hero-row"><div><p className="eyebrow">Production desk</p><h1>Make the next<br /><em>story</em> inevitable.</h1><p className="hero-copy">A focused workspace for turning channel DNA into documentary episodes, scene by scene.</p></div><button className="primary-button hero-action" onClick={onCreate}><Plus size={18} />New channel</button></div>
    <div className="metric-grid"><Metric label="Channels" value={channels.length} note={channels.length === 0 ? "Ready for your first channel" : "Across this workspace"} /><Metric label="Active episodes" value={channels.reduce((total, channel) => total + channel.episode_count, 0)} note="Confirmed topics" /><Metric label="Running tasks" value={activeTasks.length} note={activeTasks.length ? "Live Codex activity" : "Nothing running"} /><Metric label="Needs review" value={reviewCount} note={reviewCount ? "Approval needed" : `${completedCount} completed tasks`} /></div>
    <div className="section-heading"><div><p className="eyebrow">Your network</p><h2>Channels</h2></div><button className="quiet-button" onClick={onCreate}><Plus size={16} />Add channel</button></div>
    {channels.length === 0 ? <EmptyState icon={<Broadcast size={26} />} title="Your network starts here" copy="Create a channel to give every episode a point of view, a voice, and a visual language." action="Create first channel" onAction={onCreate} /> : <div className="channel-grid">{channels.map((channel) => <ChannelCard key={channel.channel_id} channel={channel} onOpen={() => openChannel(channel.channel_id)} />)}</div>}
    <div className="section-heading activity-heading"><div><p className="eyebrow">Live thread</p><h2>Recent activity</h2></div><button className="text-button" onClick={openTaskList}>View all <ArrowUpRight size={15} /></button></div>
    {activeTasks.length === 0 ? <div className="activity-empty"><CheckCircle size={19} />No active work right now. The next good story is waiting.</div> : <div className="activity-list">{activeTasks.slice(0, 4).map((task) => <TaskRow key={task.task_id} task={task} />)}</div>}
  </section>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) { return <div className="metric"><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note}</span></div>; }

function ChannelsView({ selectedChannel, channels, openChannel, onCreate, onRefresh, onNotice, openEpisode }: { selectedChannel: Channel | null; channels: Channel[]; openChannel: (id: string) => void; onCreate: () => void; onRefresh: () => Promise<void>; onNotice: (notice: Notice) => void; openEpisode: (channelId: string, episodeId: string) => void }) {
  if (selectedChannel) return <ChannelDetail channel={selectedChannel} channels={channels} onBack={() => openChannel("")} onRefresh={onRefresh} onNotice={onNotice} openEpisode={openEpisode} />;
  return <section className="page-wrap"><PageTitle eyebrow="Network" title="Channels" copy="The working identities behind every episode." action={<button className="primary-button" onClick={onCreate}><Plus size={17} />New channel</button>} />{channels.length === 0 ? <EmptyState icon={<Broadcast size={26} />} title="No channels yet" copy="Create a channel and its DNA becomes the context for every future task." action="Create channel" onAction={onCreate} /> : <div className="channel-grid channel-grid-wide">{channels.map((channel) => <ChannelCard key={channel.channel_id} channel={channel} onOpen={() => openChannel(channel.channel_id)} />)}</div>}</section>;
}

function ChannelDetail({ channel, channels, onBack, onRefresh, onNotice, openEpisode }: { channel: Channel; channels: Channel[]; onBack: () => void; onRefresh: () => Promise<void>; onNotice: (notice: Notice) => void; openEpisode: (channelId: string, episodeId: string) => void }) {
  const [dna, setDna] = useState<{ content: string; path: string; modified_at: string } | null>(null);
  const [topics, setTopics] = useState<TopicCandidate[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [editingDna, setEditingDna] = useState(false);
  const [dnaDraft, setDnaDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { const [dnaResponse, topicResponse, episodeResponse] = await Promise.all([api.dna(channel.channel_id), api.topics(channel.channel_id), api.episodes(channel.channel_id)]); setDna(dnaResponse); setDnaDraft(dnaResponse.content); setTopics(topicResponse.topics); setEpisodes(episodeResponse.episodes); }, [channel.channel_id]);
  useEffect(() => { void load().catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [load, onNotice]);
  const suggest = async () => { setBusy("topics"); try { await api.suggestTopics(channel.channel_id); onNotice({ tone: "good", message: "Generating 5 lightweight topic ideas…" }); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const confirmTopic = async (topic: TopicCandidate) => { setBusy(topic.topic_id); try { const result = await api.confirmTopic(channel.channel_id, topic.topic_id); onNotice({ tone: "good", message: `Episode created: ${result.episode.topic.title}` }); await load(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const saveDna = async () => { setBusy("dna"); try { await api.saveDna(channel.channel_id, dnaDraft); setEditingDna(false); onNotice({ tone: "good", message: "Channel DNA saved to the repository" }); await load(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const archive = async () => { try { await api.updateChannel(channel.channel_id, { status: channel.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" }); onNotice({ tone: "good", message: channel.status === "ARCHIVED" ? "Channel restored" : "Channel archived" }); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } };
  const remove = async () => { if (!window.confirm(`Delete ${channel.display_name} and its repository folder?`)) return; try { await api.deleteChannel(channel.channel_id); onNotice({ tone: "good", message: "Channel deleted" }); onBack(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } };
  return <section className="page-wrap detail-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} />All channels</button><div className="detail-header"><div><p className="eyebrow">Channel workspace</p><h1>{channel.display_name}</h1><p className="detail-copy">{channel.description || "No description yet. Your DNA is the source of truth for this channel."}</p></div><div className="detail-actions"><StatusBadge status={channel.status} /><button className="quiet-button" onClick={() => void archive()}><Archive size={16} />{channel.status === "ARCHIVED" ? "Restore" : "Archive"}</button><button className="icon-button danger" title="Delete channel" onClick={() => void remove()}><Trash size={17} /></button></div></div>
    <div className="detail-grid"><section className="panel dna-panel"><div className="panel-heading"><div><p className="eyebrow">Identity file</p><h2>Channel DNA</h2></div><div className="panel-actions">{editingDna ? <><button className="quiet-button" onClick={() => { setEditingDna(false); setDnaDraft(dna?.content ?? ""); }}><X size={15} />Cancel</button><button className="primary-button compact" disabled={busy === "dna"} onClick={() => void saveDna()}>{busy === "dna" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}Save</button></> : <button className="quiet-button" onClick={() => setEditingDna(true)}><PencilSimple size={15} />Edit DNA</button>}</div></div>{editingDna ? <textarea className="markdown-editor" value={dnaDraft} onChange={(event) => setDnaDraft(event.target.value)} spellCheck={false} /> : <pre className="markdown-preview">{dna?.content || "Loading DNA…"}</pre>}<div className="file-meta"><FileText size={14} />{dna?.path ?? `channels/${channel.slug}/channel_dna.md`}<span>{dna?.modified_at ? `Updated ${formatDate(dna.modified_at)}` : ""}</span></div></section>
      <section className="panel status-panel"><div className="panel-heading"><div><p className="eyebrow">Production status</p><h2>At a glance</h2></div></div><div className="status-stack"><StatusLine label="Channel status" value={channel.status} /><StatusLine label="Episodes" value={String(episodes.length)} /><StatusLine label="Language" value={channel.language || "Not set"} /><StatusLine label="Market" value={channel.market || "Not set"} /></div></section></div>
    <div className="section-heading topic-heading"><div><p className="eyebrow">Lightweight preview</p><h2>Topic suggestions</h2><p className="section-copy">Generate five candidates first. Development begins only when you choose one.</p></div><button className="primary-button" disabled={busy === "topics" || channel.status === "ARCHIVED"} onClick={() => void suggest()}>{busy === "topics" ? <CircleNotch className="spin" size={17} /> : <Sparkle size={17} />}Suggest topics</button></div>
    {topics.length === 0 ? <EmptyState compact icon={<Lightbulb size={23} />} title="No topic candidates yet" copy="Ideas stay lightweight until one earns its place as an episode." action="Suggest topics" onAction={() => void suggest()} /> : <div className="topic-grid">{topics.slice(0, 5).map((topic) => <TopicCard key={topic.topic_id} topic={topic} busy={busy === topic.topic_id} onConfirm={() => void confirmTopic(topic)} />)}</div>}
    <div className="section-heading episode-heading"><div><p className="eyebrow">Confirmed work</p><h2>Episodes</h2></div><span className="count-note">{episodes.length} {episodes.length === 1 ? "episode" : "episodes"}</span></div>{episodes.length === 0 ? <div className="activity-empty"><FilmSlate size={19} />Confirmed topics will become episodes here.</div> : <div className="episode-list">{episodes.map((episode) => <button className="episode-row" key={episode.episode_id} onClick={() => openEpisode(channel.channel_id, episode.episode_id)}><div className="episode-index">{String(episodes.indexOf(episode) + 1).padStart(2, "0")}</div><div className="episode-info"><strong>{episode.topic.title}</strong><span>{episode.topic.premise}</span></div><StageBadge stage={episode.stage} /><ArrowUpRight size={17} /></button>)}</div>}
  </section>;
}

function TopicsView({ channels, openChannel, onNotice }: { channels: Channel[]; openChannel: (id: string) => void; onNotice: (notice: Notice) => void }) { return <section className="page-wrap"><PageTitle eyebrow="Ideas" title="Topics" copy="Every candidate stays lightweight until a channel chooses it." />{channels.length === 0 ? <EmptyState icon={<Lightbulb size={26} />} title="No channel context yet" copy="Create a channel first, then topic suggestions will live with its DNA." action="Browse channels" onAction={() => onNotice({ tone: "neutral", message: "Create a channel from the Channels view" })} /> : <div className="topic-channel-list">{channels.map((channel) => <button className="topic-channel-row" key={channel.channel_id} onClick={() => openChannel(channel.channel_id)}><div className="channel-avatar">{initials(channel.display_name)}</div><div><strong>{channel.display_name}</strong><span>Open topic candidates</span></div><ArrowUpRight size={17} /></button>)}</div>}</section>; }

function EpisodesView({ channel, episodeId, openChannel, openEpisode, maxDuration, onNotice }: { channel: Channel | null; episodeId: string | null; openChannel: (id: string) => void; openEpisode: (channelId: string, episodeId: string) => void; maxDuration: number; onNotice: (notice: Notice) => void }) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  useEffect(() => { if (channel) void api.episodes(channel.channel_id).then((response) => setEpisodes(response.episodes)).catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [channel, onNotice]);
  if (!channel) return <section className="page-wrap"><PageTitle eyebrow="Episodes" title="Choose a channel" copy="Episodes keep their context through the channel that owns them." />{<div className="topic-channel-list">{episodes.length === 0 && <EmptyState compact icon={<FilmSlate size={23} />} title="Select a channel" copy="Open a channel to see its confirmed episodes." action="Browse channels" onAction={() => onNotice({ tone: "neutral", message: "Choose a channel from the Channels view" })} />}</div>}</section>;
  if (episodeId) return <EpisodeDetail channel={channel} episodeId={episodeId} maxDuration={maxDuration} onBack={() => openChannel(channel.channel_id)} onNotice={onNotice} />;
  return <section className="page-wrap"><button className="back-button" onClick={() => openChannel(channel.channel_id)}><ArrowLeft size={16} />Channel</button><PageTitle eyebrow={channel.display_name} title="Episodes" copy="Confirmed topics, ready to become scripts and scenes." />{episodes.length === 0 ? <EmptyState icon={<FilmSlate size={26} />} title="No episodes yet" copy="Choose a topic from the channel workspace to create the first episode." action="Open channel" onAction={() => openChannel(channel.channel_id)} /> : <div className="episode-list">{episodes.map((episode, index) => <button className="episode-row" key={episode.episode_id} onClick={() => openEpisode(channel.channel_id, episode.episode_id)}><div className="episode-index">{String(index + 1).padStart(2, "0")}</div><div className="episode-info"><strong>{episode.topic.title}</strong><span>{episode.topic.premise}</span></div><StageBadge stage={episode.stage} /><ArrowUpRight size={17} /></button>)}</div>}</section>;
}

function EpisodeDetail({ channel, episodeId, maxDuration, onBack, onNotice }: { channel: Channel; episodeId: string; maxDuration: number; onBack: () => void; onNotice: (notice: Notice) => void }) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [script, setScript] = useState("");
  const [scriptEditing, setScriptEditing] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(async () => { const [episodesResponse, scriptResponse, scenesResponse] = await Promise.all([api.episodes(channel.channel_id), api.file(channel.channel_id, episodeId, "script.md"), api.scenes(channel.channel_id, episodeId)]); setEpisode(episodesResponse.episodes.find((item) => item.episode_id === episodeId) ?? null); setScript(scriptResponse.content); setScenes(scenesResponse.scenes); }, [channel.channel_id, episodeId]);
  useEffect(() => { void load().catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [load, onNotice]);
  const createTask = async (taskType: string, sceneNumber?: number) => { setBusy(taskType + (sceneNumber ?? "")); try { await api.createTask({ task_type: taskType, channel_id: channel.channel_id, episode_id: episodeId, scene_number: sceneNumber }); onNotice({ tone: "good", message: taskType === "GENERATE_SCENES" ? "Scene breakdown queued" : "Task queued" }); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const saveScript = async () => { setBusy("script"); try { await api.saveFile(channel.channel_id, episodeId, "script.md", script); setScriptEditing(false); onNotice({ tone: "good", message: "Script saved to the repository" }); await load(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const saveScenes = async () => { setBusy("scenes"); try { await api.saveScenes(channel.channel_id, episodeId, scenes); onNotice({ tone: "good", message: "Scene edits saved" }); await load(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } finally { setBusy(null); } };
  const copy = async (key: string, value: string) => { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(null), 1300); };
  if (!episode) return <section className="page-wrap"><LoadingState /></section>;
  return <section className="page-wrap detail-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} />{channel.display_name}</button><div className="detail-header episode-detail-header"><div><p className="eyebrow">Episode workspace</p><h1>{episode.topic.title}</h1><p className="detail-copy">{episode.topic.premise}</p></div><div className="detail-actions"><StageBadge stage={episode.stage} /><button className="primary-button" disabled={busy === "GENERATE_SCRIPT"} onClick={() => void createTask("GENERATE_SCRIPT")}><Play size={16} />Create script</button></div></div>
    <section className="panel script-panel"><div className="panel-heading"><div><p className="eyebrow">Narrative</p><h2>Script</h2></div><div className="panel-actions">{scriptEditing ? <><button className="quiet-button" onClick={() => { setScriptEditing(false); void load(); }}><X size={15} />Cancel</button><button className="primary-button compact" disabled={busy === "script"} onClick={() => void saveScript()}><FloppyDisk size={15} />Save</button></> : <button className="quiet-button" onClick={() => setScriptEditing(true)}><PencilSimple size={15} />Edit</button>}</div></div>{scriptEditing ? <textarea className="markdown-editor script-editor" value={script} onChange={(event) => setScript(event.target.value)} spellCheck={false} /> : <pre className="markdown-preview script-preview">{script || "Script generation has not started."}</pre>}</section>
    <div className="section-heading scene-heading"><div><p className="eyebrow">Paired visual plan</p><h2>Scene breakdown</h2><p className="section-copy">Dialogue and video prompt stay paired, with one coherent shot per scene.</p></div><button className="primary-button" disabled={busy === "GENERATE_SCENES"} onClick={() => void createTask("GENERATE_SCENES")}><Sparkle size={17} />Create scene breakdown</button></div>
    {scenes.length === 0 ? <EmptyState compact icon={<FilmSlate size={23} />} title="No scenes yet" copy="Generate a breakdown after the script is ready." action="Create scene breakdown" onAction={() => void createTask("GENERATE_SCENES")} /> : <div className="scene-list">{scenes.map((scene) => <SceneCard key={scene.scene_id} scene={scene} maxDuration={maxDuration} copied={copied} busy={busy} onCopy={copy} onChange={(next) => setScenes((current) => current.map((item) => item.scene_id === scene.scene_id ? next : item))} onRegenerate={(type) => void createTask(type, scene.scene_number)} />)}<div className="scene-save-row"><span>Manual edits do not call Codex.</span><button className="primary-button compact" disabled={busy === "scenes"} onClick={() => void saveScenes()}><FloppyDisk size={15} />Save scene edits</button></div></div>}
  </section>;
}

function SceneCard({ scene, maxDuration, copied, busy, onCopy, onChange, onRegenerate }: { scene: Scene; maxDuration: number; copied: string | null; busy: string | null; onCopy: (key: string, value: string) => Promise<void>; onChange: (scene: Scene) => void; onRegenerate: (type: string) => void }) {
  return <article className="scene-card"><div className="scene-card-header"><div className="scene-number">Scene {String(scene.scene_number).padStart(2, "0")}</div><label className="duration-input">Duration <input type="number" min="1" max={maxDuration} step="0.5" value={scene.duration_seconds} onChange={(event) => onChange({ ...scene, duration_seconds: Math.min(maxDuration, Number(event.target.value)) })} /> sec</label><div className="scene-tools"><button className="quiet-button compact" onClick={() => onRegenerate("REGENERATE_BOTH")} disabled={busy === `REGENERATE_BOTH${scene.scene_number}`}><ArrowClockwise size={14} />Regenerate</button></div></div><div className="scene-columns"><div className="scene-block"><div className="block-heading"><span>Dialogue / Narration</span><button className="copy-button" onClick={() => void onCopy(`${scene.scene_id}-dialogue`, scene.dialogue)}>{copied === `${scene.scene_id}-dialogue` ? <Check size={14} /> : <Copy size={14} />} {copied === `${scene.scene_id}-dialogue` ? "Copied" : "Copy"}</button></div><textarea value={scene.dialogue} onChange={(event) => onChange({ ...scene, dialogue: event.target.value })} /></div><div className="scene-block prompt-block"><div className="block-heading"><span>Video generation prompt</span><button className="copy-button" onClick={() => void onCopy(`${scene.scene_id}-prompt`, scene.visual_prompt)}>{copied === `${scene.scene_id}-prompt` ? <Check size={14} /> : <Copy size={14} />} {copied === `${scene.scene_id}-prompt` ? "Copied" : "Copy"}</button></div><textarea value={scene.visual_prompt} onChange={(event) => onChange({ ...scene, visual_prompt: event.target.value })} /></div></div><div className="scene-notes"><input aria-label="Transition note" placeholder="Transition note" value={scene.transition_note} onChange={(event) => onChange({ ...scene, transition_note: event.target.value })} /><input aria-label="Continuity note" placeholder="Continuity note" value={scene.continuity_note} onChange={(event) => onChange({ ...scene, continuity_note: event.target.value })} /></div></article>;
}

function TasksView({ tasks, onRefresh, onNotice }: { tasks: Task[]; onRefresh: () => Promise<void>; onNotice: (notice: Notice) => void }) { const cancel = async (task: Task) => { try { await api.cancelTask(task.task_id); onNotice({ tone: "good", message: "Task cancelled" }); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: (error as Error).message }); } }; return <section className="page-wrap"><PageTitle eyebrow="Operations" title="Tasks" copy="A live view of Codex work, approvals, and queue position." action={<button className="quiet-button" onClick={() => void onRefresh()}><ArrowClockwise size={16} />Refresh</button>} />{tasks.length === 0 ? <EmptyState icon={<ListChecks size={26} />} title="No tasks yet" copy="Codex tasks will appear here as you generate DNA, topics, scripts, or scenes." action="Refresh" onAction={() => void onRefresh()} /> : <div className="task-table">{tasks.map((task) => <div className="task-row" key={task.task_id}><div className={`task-status-dot ${task.status.toLowerCase()}`} /><div className="task-main"><strong>{formatTaskType(task.task_type)}</strong><span>{task.progress_message || task.status}</span></div><span className="task-status-label">{task.status}</span>{task.queue_position !== null ? <span className="queue-label">Queue {task.queue_position + 1}</span> : null}{["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status) ? <button className="icon-button" title="Cancel task" onClick={() => void cancel(task)}><X size={16} /></button> : <span className="task-time">{task.completed_at ? formatDate(task.completed_at) : ""}</span>}</div>)}</div>}</section>; }

function SettingsView({ codexStatus, git }: { codexStatus: string; git: { branch: string | null; dirty: boolean; changed_files: number } }) { return <section className="page-wrap"><PageTitle eyebrow="Workspace" title="Settings" copy="Local configuration stays in the repository, close to the work it governs." /><div className="settings-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Connection</p><h2>Codex App Server</h2></div><TerminalWindow size={22} /></div><StatusLine label="Status" value={codexStatus} /><StatusLine label="Transport" value="stdio://" /><p className="panel-footnote">Credentials stay server-side. The browser only receives task status and plain-language errors.</p></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Source of truth</p><h2>Repository</h2></div><GitBranch size={22} /></div><StatusLine label="Branch" value={git.branch ?? "Not a Git repository"} /><StatusLine label="Working tree" value={git.dirty ? `${git.changed_files} changed files` : "Clean"} /><p className="panel-footnote">Artifacts live in channels, templates, shared rules, and .documentary-studio.</p></section></div></section>; }

function CreateChannelModal({ onClose, onCreated, onError }: { onClose: () => void; onCreated: (channelId: string, message: string) => Promise<void>; onError: (error: unknown) => void }) { const [form, setForm] = useState({ name: "", description: "", target_audience: "", language: "English", market: "", dna_mode: "example" }); const [busy, setBusy] = useState(false); const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { const result = await api.createChannel(form); await onCreated(result.channel.channel_id, result.task ? "Channel created and DNA generation queued" : "Channel created with example DNA"); } catch (error) { onError(error); } finally { setBusy(false); } }; return <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={(event) => void submit(event)}><div className="modal-heading"><div><p className="eyebrow">New workspace</p><h2>Create channel</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><label>Channel name<input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Your channel name" /></label><label>Concept or description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the documentary territory in one sentence." /></label><div className="form-grid"><label>Audience<input value={form.target_audience} onChange={(event) => setForm({ ...form, target_audience: event.target.value })} placeholder="Curious generalists" /></label><label>Market<input value={form.market} onChange={(event) => setForm({ ...form, market: event.target.value })} placeholder="Global" /></label></div><div className="dna-choice"><span className="field-label">Starting DNA</span><div className="choice-row">{[["example", "Use example"], ["ai", "Create with AI"]].map(([value, label]) => <button type="button" key={value} className={`choice ${form.dna_mode === value ? "is-selected" : ""}`} onClick={() => setForm({ ...form, dna_mode: value })}><span className="choice-radio" />{label}</button>)}</div></div><div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? <CircleNotch className="spin" size={16} /> : <Plus size={16} />}Create channel</button></div></form></div>; }

function PageTitle({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: React.ReactNode }) { return <div className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{copy ? <p className="page-copy">{copy}</p> : null}</div>{action ? <div>{action}</div> : null}</div>; }
function ChannelCard({ channel, onOpen }: { channel: Channel; onOpen: () => void }) { return <button className="channel-card" onClick={onOpen}><div className="card-top"><div className="channel-avatar">{initials(channel.display_name)}</div><StatusBadge status={channel.status} /></div><h3>{channel.display_name}</h3><p>{channel.description || "Channel DNA ready to shape the next story."}</p><div className="card-bottom"><span>{channel.episode_count} {channel.episode_count === 1 ? "episode" : "episodes"}</span><ArrowUpRight size={16} /></div></button>; }
function TopicCard({ topic, onConfirm, busy }: { topic: TopicCandidate; onConfirm: () => void; busy: boolean }) { return <article className="topic-card"><div className="topic-number">Topic candidate</div><h3>{topic.title}</h3><p className="topic-premise">{topic.premise}</p><div className="topic-detail"><span>Why it fits</span><p>{topic.why_it_fits}</p></div><div className="topic-detail"><span>Hook</span><p>{topic.hook}</p></div><div className="topic-footer"><span>{topic.estimated_potential}</span><button className="text-button" disabled={busy} onClick={onConfirm}>{busy ? <CircleNotch className="spin" size={15} /> : <Play size={14} />}Use this topic</button></div></article>; }
function TaskRow({ task }: { task: Task }) { return <div className="activity-row"><div className={`task-status-dot ${task.status.toLowerCase()}`} /><div><strong>{formatTaskType(task.task_type)}</strong><span>{task.progress_message || task.status}</span></div><span className="activity-status">{task.status}</span></div>; }
function StatusLine({ label, value }: { label: string; value: string }) { return <div className="status-line"><span>{label}</span><strong>{value}</strong></div>; }
function StatusBadge({ status }: { status: string }) { return <span className={`status-badge ${status.toLowerCase()}`}>{status.toLowerCase()}</span>; }
function StageBadge({ stage }: { stage: string }) { return <span className="stage-badge">{stage.replaceAll("_", " ").toLowerCase()}</span>; }
function EmptyState({ icon, title, copy, action, onAction, compact = false }: { icon: React.ReactNode; title: string; copy: string; action: string; onAction: () => void; compact?: boolean }) { return <div className={`empty-state ${compact ? "is-compact" : ""}`}><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{copy}</p><button className="quiet-button" onClick={onAction}>{action}<ArrowUpRight size={15} /></button></div>; }
function LoadingState() { return <section className="page-wrap"><div className="loading-state"><CircleNotch className="spin" size={22} /><span>Loading workspace</span></div></section>; }
function NoticeBanner({ notice, onClose }: { notice: NonNullable<Notice>; onClose: () => void }) { return <div className={`notice-banner ${notice.tone}`}><span>{notice.tone === "good" ? <CheckCircle size={18} /> : notice.tone === "bad" ? <WarningCircle size={18} /> : <Sparkle size={18} />}</span><span>{notice.message}</span><button onClick={onClose}><X size={15} /></button></div>; }
function formatTaskType(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase()); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CH"; }
