import { Archive, ArrowLeft, ArrowUpRight, CaretDown, CircleNotch, FileText, FilmSlate, FloppyDisk, Lightbulb, PencilSimple, Plus, Play, Sparkle, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Channel, Episode, Task, TopicCandidate } from "@studio/shared";
import { api } from "../api";
import { formatDate, isTaskActive, isTaskTerminal, latestTask } from "../lib/utils";
import { EmptyState } from "./EmptyState";
import { ChannelCard, ChannelsListView, type ChannelGroupId } from "./ChannelList";
import { PageTitle, StageBadge, StatusBadge, StatusLine } from "./AppChrome";
import { TaskProgressPanel, TopicProgress } from "./TaskProgressPanel";
import { EpisodeDetail } from "./EpisodeView";
import type { Notice } from "./types";

export function ChannelsView({ selectedChannel, selectedEpisodeId, channels, tasks, onTaskSubmitted, openChannel, onCreate, onRefresh, onNotice, onDelete, openEpisode, maxDuration, narrationWordsPerSecond, imageGenerationEnabled, imagesPerBundle }: { selectedChannel: Channel | null; selectedEpisodeId: string | null; channels: Channel[]; tasks: Task[]; onTaskSubmitted: (task: Task) => void; openChannel: (id: string) => void; onCreate: (groupId?: ChannelGroupId) => void; onRefresh: () => Promise<void>; onNotice: (notice: NonNullable<Notice>) => void; onDelete: (channel: Channel) => void; openEpisode: (channelId: string, episodeId: string) => void; maxDuration: number; narrationWordsPerSecond: number; imageGenerationEnabled: boolean; imagesPerBundle: number }) {
  const [activeGroup, setActiveGroup] = useState<ChannelGroupId>("quiz");
  useEffect(() => {
    if (selectedChannel) setActiveGroup(selectedChannel.engine === "quiz" ? "quiz" : "documentary");
  }, [selectedChannel]);
  if (selectedChannel && selectedEpisodeId) return <EpisodeDetail channel={selectedChannel} episodeId={selectedEpisodeId} tasks={tasks} onTaskSubmitted={onTaskSubmitted} maxDuration={maxDuration} narrationWordsPerSecond={narrationWordsPerSecond} imageGenerationEnabled={imageGenerationEnabled} imagesPerBundle={imagesPerBundle} onBack={() => openChannel(selectedChannel.channel_id)} onNotice={onNotice} />;
  if (selectedChannel) return <ChannelDetail channel={selectedChannel} channels={channels} tasks={tasks} onTaskSubmitted={onTaskSubmitted} onBack={() => openChannel("")} onRefresh={onRefresh} onNotice={onNotice} onDelete={onDelete} openEpisode={openEpisode} />;
  return <ChannelsListView channels={channels} activeGroup={activeGroup} onActiveGroupChange={setActiveGroup} onCreate={(groupId) => onCreate(groupId)} openChannel={openChannel} onDelete={onDelete} />;
}

export function DeleteChannelModal({ channel, onClose, onDeleted, onError }: { channel: Channel; onClose: () => void; onDeleted: (channel: Channel) => Promise<void>; onError: (error: unknown) => void }) {
  const [step, setStep] = useState<"choice" | "type">("choice");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (confirmation !== "Yes" || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteChannel(channel.channel_id);
      await onDeleted(channel);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete channel");
      onError(reason);
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" role="presentation"><section className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-channel-title" aria-describedby="delete-channel-copy">
    <div className="modal-heading"><div><p className="eyebrow">Delete channel</p><h2 id="delete-channel-title">{step === "choice" ? "Delete this channel" : "Type Yes to confirm"}</h2></div><button type="button" className="icon-button" aria-label="Close delete dialog" onClick={onClose} disabled={busy}><X size={18} /></button></div>
    {step === "choice" ? <><p id="delete-channel-copy" className="modal-copy">This permanently removes <strong>{channel.display_name}</strong> and its repository folder.</p><div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>No</button><button type="button" className="primary-button danger-confirm" onClick={() => setStep("type")}>Yes</button></div></> : <><p id="delete-channel-copy" className="modal-copy">Enter the exact word <strong>Yes</strong> to permanently delete this channel.</p><label>Confirmation<input autoFocus aria-label="Type Yes to confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Yes" autoComplete="off" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button type="button" className="quiet-button" onClick={() => { setStep("choice"); setConfirmation(""); setError(""); }} disabled={busy}>Back</button><button type="button" className="primary-button danger-confirm" disabled={busy || confirmation !== "Yes"} onClick={() => void submit()}>{busy ? <CircleNotch className="spin" size={16} /> : <Trash size={16} />}Delete channel</button></div></>}
  </section></div>;
}

export function TopicCard({ topic, onConfirm, busy }: { topic: TopicCandidate; onConfirm: () => void; busy: boolean }) { return <article className="topic-card"><div className="topic-number">Topic candidate</div><h3>{topic.title}</h3><p className="topic-premise">{topic.premise}</p><div className="topic-detail"><span>Why it fits</span><p>{topic.why_it_fits}</p></div><div className="topic-detail"><span>Hook</span><p>{topic.hook}</p></div><div className="topic-footer"><span>{topic.estimated_potential}</span><button className="text-button" disabled={busy} onClick={onConfirm}>{busy ? <CircleNotch className="spin" size={15} /> : <Play size={14} />}Use this topic</button></div></article>; }

export function ChannelDetail({ channel, channels, tasks, onTaskSubmitted, onBack, onRefresh, onNotice, onDelete, openEpisode }: { channel: Channel; channels: Channel[]; tasks: Task[]; onTaskSubmitted: (task: Task) => void; onBack: () => void; onRefresh: () => Promise<void>; onNotice: (notice: NonNullable<Notice>) => void; onDelete: (channel: Channel) => void; openEpisode: (channelId: string, episodeId: string) => void }) {
  const [dna, setDna] = useState<{ content: string; path: string; modified_at: string } | null>(null);
  const [topics, setTopics] = useState<TopicCandidate[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [editingDna, setEditingDna] = useState(false);
  const [dnaDraft, setDnaDraft] = useState("");
  const [showDna, setShowDna] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingChannel, setLoadingChannel] = useState(true);
  const channelTasks = tasks.filter((task) => task.channel_id === channel.channel_id);
  const topicTask = latestTask(channelTasks, ["SUGGEST_TOPICS"]);
  const dnaTask = latestTask(channelTasks, ["GENERATE_DNA"]);
  const topicTaskActive = Boolean(topicTask && isTaskActive(topicTask));
  const [topicClock, setTopicClock] = useState(() => Date.now());
  const observedTerminalTasks = useRef(new Set<string>());
  const loadVersion = useRef(0);
  const load = useCallback(async (showLoading = false) => {
    const version = ++loadVersion.current;
    if (showLoading) setLoadingChannel(true);
    try {
      const [dnaResponse, topicResponse, episodeResponse] = await Promise.all([api.dna(channel.channel_id), api.topics(channel.channel_id), api.episodes(channel.channel_id)]);
      if (version !== loadVersion.current) return;
      setDna(dnaResponse);
      setDnaDraft(dnaResponse.content);
      setTopics(topicResponse.topics);
      setEpisodes(episodeResponse.episodes);
    } finally {
      if (showLoading && version === loadVersion.current) setLoadingChannel(false);
    }
  }, [channel.channel_id]);
  useEffect(() => {
    void load(true).catch((error: Error) => onNotice({ tone: "bad", message: error.message }));
    return () => { loadVersion.current += 1; };
  }, [load, onNotice]);
  useEffect(() => { observedTerminalTasks.current = new Set(channelTasks.filter(isTaskTerminal).map((task) => task.task_id)); }, [channel.channel_id]);
  useEffect(() => { if (!channelTasks.some(isTaskActive)) return; const timer = window.setInterval(() => setTopicClock(Date.now()), 1000); return () => window.clearInterval(timer); }, [channelTasks.some(isTaskActive)]);
  useEffect(() => { const newlyTerminal = channelTasks.filter((task) => isTaskTerminal(task) && !observedTerminalTasks.current.has(task.task_id)); if (newlyTerminal.length === 0) return; newlyTerminal.forEach((task) => observedTerminalTasks.current.add(task.task_id)); void load().then(onRefresh).catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [channelTasks.map((task) => `${task.task_id}:${task.status}`).join("|"), load, onNotice, onRefresh]);
  const suggest = async () => { if (topicTaskActive) return; setBusy("topics"); try { const result = await api.suggestTopics(channel.channel_id); onTaskSubmitted(result.task); onNotice({ tone: "good", message: "Generating 5 lightweight topic ideas..." }); } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not generate topics" }); } finally { setBusy(null); } };
  const confirmTopic = async (topic: TopicCandidate) => { setBusy(topic.topic_id); try { const result = await api.confirmTopic(channel.channel_id, topic.topic_id); onNotice({ tone: "good", message: `Episode created: ${result.episode.topic.title}` }); await load(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not create episode" }); } finally { setBusy(null); } };
  const saveDna = async () => { setBusy("dna"); try { await api.saveDna(channel.channel_id, dnaDraft); setEditingDna(false); onNotice({ tone: "good", message: "Channel DNA saved to the repository" }); await load(); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save Channel DNA" }); } finally { setBusy(null); } };
  const archive = async () => { try { await api.updateChannel(channel.channel_id, { status: channel.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" }); onNotice({ tone: "good", message: channel.status === "ARCHIVED" ? "Channel restored" : "Channel archived" }); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update channel" }); } };
  if (loadingChannel) return <ChannelLoadingState channel={channel} onBack={onBack} />;
  return <section className="page-wrap detail-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} />All channels</button><div className="detail-header"><div><p className="eyebrow">Channel workspace</p><h1>{channel.display_name}</h1><p className="detail-copy">{channel.description || "No description yet. Your DNA is the source of truth for this channel."}</p></div><div className="detail-actions"><StatusBadge status={channel.status} /><button className="quiet-button" onClick={() => void archive()}><Archive size={16} />{channel.status === "ARCHIVED" ? "Restore" : "Archive"}</button><button className="icon-button danger" title="Delete channel" aria-label={`Delete ${channel.display_name}`} onClick={() => onDelete(channel)}><Trash size={17} /></button></div></div><div className="detail-grid"><section className={`panel dna-panel ${showDna ? "is-open" : ""}`}><div className="panel-heading"><div><p className="eyebrow">Identity file</p><h2>Channel DNA</h2></div><div className="panel-actions">{editingDna ? <><button className="quiet-button compact" onClick={() => { setEditingDna(false); setDnaDraft(dna?.content ?? ""); }}><X size={15} />Cancel</button><button className="primary-button compact" disabled={busy === "dna"} onClick={() => void saveDna()}>{busy === "dna" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}Save</button></> : <><button className="quiet-button compact dna-toggle" aria-expanded={showDna} aria-controls="channel-dna-content" onClick={() => setShowDna((current) => !current)}>{showDna ? "Hide DNA" : "View DNA"}<CaretDown size={14} /></button>{showDna ? <button className="quiet-button compact" onClick={() => setEditingDna(true)}><PencilSimple size={15} />Edit DNA</button> : null}</>}</div></div>{dnaTask ? <TaskProgressPanel task={dnaTask} title="Channel DNA" activeLabel="Generating channel DNA" completionLabel="Channel DNA ready" now={topicClock} compact /> : null}{showDna ? <div id="channel-dna-content" className="dna-content">{editingDna ? <textarea className="markdown-editor" value={dnaDraft} onChange={(event) => setDnaDraft(event.target.value)} spellCheck={false} /> : <pre className="markdown-preview">{dna?.content || "Loading DNA..."}</pre>}<div className="file-meta"><FileText size={14} />{dna?.path ?? `channels/${channel.slug}/channel_dna.md`}<span>{dna?.modified_at ? `Updated ${formatDate(dna.modified_at)}` : ""}</span></div></div> : null}</section><section className="panel status-panel"><div className="panel-heading"><div><h2>Production status</h2></div></div><div className="status-stack"><StatusLine label="Channel status" value={channel.status} /><StatusLine label="Episodes" value={String(episodes.length)} /><StatusLine label="Language" value={channel.language || "Not set"} /><StatusLine label="Market" value={channel.market || "Not set"} /></div></section></div><div className="section-heading topic-heading"><div><p className="eyebrow">Ideas</p><h2>Topic suggestions</h2></div><button className="primary-button" disabled={busy === "topics" || topicTaskActive || channel.status === "ARCHIVED"} onClick={() => void suggest()}>{busy === "topics" || topicTaskActive ? <CircleNotch className="spin" size={17} /> : <Sparkle size={17} />}{topicTaskActive ? "Generating…" : "Suggest topics"}</button></div>{topicTask ? <TopicProgress task={topicTask} now={topicClock} /> : null}{topics.length === 0 ? <EmptyState compact icon={<Lightbulb size={23} />} title="No topic candidates yet" copy="Ideas stay lightweight until one earns its place as an episode." action="Suggest topics" disabled={topicTaskActive} busy={topicTaskActive} busyLabel="Generating topics…" onAction={() => void suggest()} /> : <div className="topic-grid">{topics.slice(0, 5).map((topic) => <TopicCard key={topic.topic_id} topic={topic} busy={busy === topic.topic_id} onConfirm={() => void confirmTopic(topic)} />)}</div>}<div className="section-heading episode-heading"><div><p className="eyebrow">Confirmed work</p><h2>Episodes</h2></div><span className="count-note">{episodes.length} {episodes.length === 1 ? "episode" : "episodes"}</span></div>{episodes.length === 0 ? <div className="activity-empty"><FilmSlate size={19} />Confirmed topics will become episodes here.</div> : <div className="episode-list">{episodes.map((episode, index) => <button className="episode-row" key={episode.episode_id} onClick={() => openEpisode(channel.channel_id, episode.episode_id)}><div className="episode-index">{String(index + 1).padStart(2, "0")}</div><div className="episode-info"><strong>{episode.topic.title}</strong><span>{episode.topic.premise}</span></div><StageBadge stage={episode.stage} /><ArrowUpRight size={17} /></button>)}</div>}</section>;
}

function ChannelLoadingState({ channel, onBack }: { channel: Channel; onBack: () => void }) {
  return <section className="page-wrap detail-page"><button className="back-button" onClick={onBack}><ArrowLeft size={16} />All channels</button><div className="detail-header"><div><p className="eyebrow">Channel workspace</p><h1>{channel.display_name}</h1></div></div><div className="channel-loading" role="status" aria-label="Loading channel"><span>Loading channel</span><div className="channel-loading-grid" aria-hidden="true"><div className="channel-skeleton channel-skeleton-large" /><div className="channel-skeleton" /><div className="channel-skeleton channel-skeleton-wide" /></div></div></section>;
}

type CreateChannelForm = { name: string; description: string; target_audience: string; language: string; market: string; group_id: ChannelGroupId; dna_mode: "example" | "ai" | "upload"; dna_content: string };

export function CreateChannelModal({ initialGroupId = "quiz", onClose, onCreated, onError }: { initialGroupId?: ChannelGroupId; onClose: () => void; onCreated: (channelId: string, message: string, task: Task | null) => Promise<void>; onError: (error: unknown) => void }) {
  const [form, setForm] = useState<CreateChannelForm>({ name: "", description: "", target_audience: initialGroupId === "quiz" ? "Children and families" : "Curious viewers", language: "English", market: "Global", group_id: initialGroupId, dna_mode: "example", dna_content: "" });
  const [dnaFileName, setDnaFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const handleDnaUpload = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (!file.name.toLowerCase().endsWith(".md")) { event.target.value = ""; onError(new Error("Choose a Markdown file (.md) for channel DNA.")); return; } try { const content = await file.text(); if (!content.trim()) throw new Error("The selected channel DNA file is empty."); setForm((current) => ({ ...current, dna_mode: "upload", dna_content: content })); setDnaFileName(file.name); } catch (error) { event.target.value = ""; onError(error); } };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (form.dna_mode === "upload" && !form.dna_content.trim()) { onError(new Error("Choose a channel_dna.md file before creating the channel.")); return; } setBusy(true); try { const result = await api.createChannel(form); const message = result.task ? "Channel created and DNA generation queued" : form.dna_mode === "upload" ? "Channel created from uploaded DNA" : "Channel created with example DNA"; await onCreated(result.channel.channel_id, message, result.task); } catch (error) { onError(error); } finally { setBusy(false); } };
  const quiz = form.group_id === "quiz";
  return <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={(event) => void submit(event)}><div className="modal-heading"><div><p className="eyebrow">{quiz ? "Quiz Channels" : "Documentary Channels"}</p><h2>Create channel</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="selected-group-field"><span>Channel group</span><div className="group-picker" role="group" aria-label="Channel group"><button type="button" className={`group-picker-option ${quiz ? "is-selected" : ""}`} onClick={() => setForm((current) => ({ ...current, group_id: "quiz", target_audience: current.target_audience === "Curious viewers" ? "Children and families" : current.target_audience }))}>Quiz Channels</button><button type="button" className={`group-picker-option ${!quiz ? "is-selected" : ""}`} onClick={() => setForm((current) => ({ ...current, group_id: "documentary", target_audience: current.target_audience === "Children and families" ? "Curious viewers" : current.target_audience }))}>Documentary Channels</button></div><small>{quiz ? "Quiz Engine is the active production template" : "Documentary Engine keeps the existing research-to-video workflow"}</small></div><label>Channel name<input required autoFocus value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={quiz ? "World Wonder Quiz" : "Future Systems"} /></label><label>Concept or description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={quiz ? "What should children discover?" : "What should this documentary channel explore?"} /></label><div className="form-grid"><label>Audience<input value={form.target_audience} onChange={(event) => setForm((current) => ({ ...current, target_audience: event.target.value }))} placeholder={quiz ? "Children and families" : "Curious viewers"} /></label><label>Market<input value={form.market} onChange={(event) => setForm((current) => ({ ...current, market: event.target.value }))} placeholder="Global" /></label></div><div className="dna-choice"><span className="field-label">Starting DNA</span><div className="choice-row dna-choice-row">{(["example", "ai", "upload"] as const).map((value) => <button type="button" key={value} className={`choice ${form.dna_mode === value ? "is-selected" : ""}`} onClick={() => setForm((current) => ({ ...current, dna_mode: value }))}><span className="choice-radio" />{value === "example" ? quiz ? "Use Quiz DNA" : "Use Documentary DNA" : value === "ai" ? "Create with AI" : "Upload DNA"}</button>)}</div>{form.dna_mode === "upload" ? <div className="dna-upload"><label className="dna-upload-button"><FileText size={15} />{dnaFileName || "Choose channel_dna.md"}<input aria-label="Channel DNA file" type="file" accept=".md,text/markdown" onChange={(event) => void handleDnaUpload(event)} /></label>{dnaFileName ? <span className="dna-file-name">{dnaFileName}</span> : <span className="dna-upload-hint">Markdown only</span>}</div> : null}</div><div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || (form.dna_mode === "upload" && !form.dna_content.trim())}>{busy ? <CircleNotch className="spin" size={16} /> : <Plus size={16} />}Create channel</button></div></form></div>;
}
