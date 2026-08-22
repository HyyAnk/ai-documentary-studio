import { Archive, ArrowLeft, ArrowUpRight, CaretDown, CircleNotch, FileText, FilmSlate, FloppyDisk, Lightbulb, Palette, PencilSimple, Plus, Play, Sparkle, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ALL_QUIZ_IMAGE_STYLES, QUIZ_IMAGE_STYLE_LABELS, QUIZ_MAX_QUESTION_COUNT, QUIZ_MIN_QUESTION_COUNT, QUIZ_SECONDS_PER_QUESTION, type Channel, type Episode, type QuizImageStyle, type Task, type TopicCandidate } from "@studio/shared";
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

export function DeleteEpisodeModal({ channel, episode, onClose, onDeleted, onError }: { channel: Channel; episode: Episode; onClose: () => void; onDeleted: (episode: Episode) => Promise<void>; onError: (error: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteEpisode(channel.channel_id, episode.episode_id);
      await onDeleted(episode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete episode");
      onError(reason);
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" role="presentation"><section className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-episode-title" aria-describedby="delete-episode-copy">
    <div className="modal-heading"><div><p className="eyebrow">Delete episode</p><h2 id="delete-episode-title">Delete this episode</h2></div><button type="button" className="icon-button" aria-label="Close delete dialog" onClick={onClose} disabled={busy}><X size={18} /></button></div>
    <p id="delete-episode-copy" className="modal-copy">This permanently removes <strong>{episode.topic.title}</strong> and its generated assets.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose} disabled={busy}>No</button><button type="button" className="primary-button danger-confirm" onClick={() => void submit()} disabled={busy}>{busy ? <CircleNotch className="spin" size={16} /> : <Trash size={16} />}{busy ? "Deleting…" : "Yes"}</button></div>
  </section></div>;
}

export const QUIZ_IMAGE_STYLE_DESCRIPTIONS: Record<QuizImageStyle, string> = {
  pixar_3d: "Cinematic 3D animation with expressive eyes, soft cinematic studio lighting, and gentle depth.",
  flat_vector: "Clean 2D flat vector cartoon with bold outlines, bright pastel colors, and crisp geometry.",
  kawaii_chibi: "Japanese Chibi Anime with sparkling sweet eyes, soft lines, and subtle twinkling accents.",
  voxel_lowpoly: "Blocky 3D isometric pixel voxel gaming style with clean cube geometry and volumetric shading.",
  plastic_toy: "Glossy Pop Mart vinyl art toy aesthetic with sleek studio reflections and smooth contact shadows.",
};

export function VisualStylesMenu({ channel, onRefresh, onNotice }: { channel: Channel; onRefresh: () => Promise<void>; onNotice: (notice: NonNullable<Notice>) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialStyles = channel.selected_styles && channel.selected_styles.length > 0 ? channel.selected_styles : ALL_QUIZ_IMAGE_STYLES;
  const [selectedStyles, setSelectedStyles] = useState<QuizImageStyle[]>(initialStyles);
  const [hoveredStyle, setHoveredStyle] = useState<QuizImageStyle>("pixar_3d");

  useEffect(() => {
    if (channel.selected_styles && channel.selected_styles.length > 0) {
      setSelectedStyles(channel.selected_styles);
    } else {
      setSelectedStyles(ALL_QUIZ_IMAGE_STYLES);
    }
  }, [channel.selected_styles]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggleStyle = async (style: QuizImageStyle) => {
    let next: QuizImageStyle[];
    if (selectedStyles.includes(style)) {
      if (selectedStyles.length <= 1) {
        onNotice({ tone: "bad", message: "Channel must have at least 1 visual style enabled" });
        return;
      }
      next = selectedStyles.filter((s) => s !== style);
    } else {
      next = [...selectedStyles, style];
    }
    
    // Optimistic UI update for instant feedback
    setSelectedStyles(next);
    
    try {
      await api.updateChannel(channel.channel_id, { selected_styles: next });
      await onRefresh();
      onNotice({ tone: "good", message: `Updated: ${next.length} visual styles active` });
    } catch (err) {
      // Revert if request failed
      setSelectedStyles(selectedStyles);
      onNotice({ tone: "bad", message: err instanceof Error ? err.message : "Failed to update visual styles" });
    }
  };

  const previewStyle = hoveredStyle || selectedStyles[0] || "pixar_3d";

  return (
    <div className="visual-styles-dropdown-wrap" ref={menuRef}>
      <button
        type="button"
        className={`quiet-button compact visual-styles-btn ${open ? "is-active" : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          if (!open) {
            setHoveredStyle(selectedStyles[0] || "pixar_3d");
          }
        }}
        title="Select visual styles enabled for this channel"
      >
        <Palette size={15} />
        <span>Styles ({selectedStyles.length})</span>
        <CaretDown size={12} />
      </button>
      {open ? (
        <div className="visual-styles-popover visual-styles-popover-wide">
          <div className="visual-styles-content-grid">
            <div className="visual-styles-list-col">
              <div className="popover-header">
                <strong>🎨 Visual Styles ({selectedStyles.length}/{ALL_QUIZ_IMAGE_STYLES.length})</strong>
                <small>Hover to preview art style</small>
              </div>
              <div className="popover-list">
                {ALL_QUIZ_IMAGE_STYLES.map((style) => {
                  const isChecked = selectedStyles.includes(style);
                  const isHovered = previewStyle === style;
                  return (
                    <label
                      key={style}
                      className={`style-checkbox-item ${isChecked ? "is-checked" : ""} ${isHovered ? "is-hovered" : ""}`}
                      onMouseEnter={() => setHoveredStyle(style)}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => void toggleStyle(style)}
                      />
                      <span className="style-label">{QUIZ_IMAGE_STYLE_LABELS[style]}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            
            <div className="visual-styles-preview-col">
              <div className="style-preview-card">
                <div className="style-preview-img-wrap">
                  <img
                    src={`/style-previews/${previewStyle}.png`}
                    alt={QUIZ_IMAGE_STYLE_LABELS[previewStyle]}
                    className="style-preview-img"
                  />
                  <span className="style-preview-tag">{QUIZ_IMAGE_STYLE_LABELS[previewStyle]}</span>
                </div>
                <div className="style-preview-desc">
                  <p>{QUIZ_IMAGE_STYLE_DESCRIPTIONS[previewStyle]}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TopicCard({
  topic,
  channelStyles = ALL_QUIZ_IMAGE_STYLES,
  onConfirm,
  busy,
  disabled,
}: {
  topic: TopicCandidate;
  channelStyles?: QuizImageStyle[];
  onConfirm: (questionCount: number, visualStyle: QuizImageStyle | "mixed") => void;
  busy: boolean;
  disabled: boolean;
}) {
  const [questionCount, setQuestionCount] = useState(topic.question_count);
  const [selectedStyle, setSelectedStyle] = useState<QuizImageStyle | "mixed">(topic.visual_style ?? "mixed");
  const isQuestionCountValid = Number.isInteger(questionCount) && questionCount >= QUIZ_MIN_QUESTION_COUNT && questionCount <= QUIZ_MAX_QUESTION_COUNT;
  const estimatedDurationMinutes = Math.max(3, Math.round((questionCount * QUIZ_SECONDS_PER_QUESTION) / 60));
  const inputId = `topic-question-count-${topic.topic_id}`;
  const styleSelectId = `topic-style-select-${topic.topic_id}`;
  const availableStyles = channelStyles && channelStyles.length > 0 ? channelStyles : ALL_QUIZ_IMAGE_STYLES;

  return <article className="topic-card">
    <div className="topic-number">Topic candidate</div>
    <h3>{topic.title}</h3>
    <p className="topic-premise">{topic.premise}</p>
    <div className="topic-detail"><span>Why it fits</span><p>{topic.why_it_fits}</p></div>
    <div className="topic-detail"><span>Hook</span><p>{topic.hook}</p></div>
    <div className="topic-pickers-row">
      <div className="topic-question-picker">
        <label htmlFor={inputId}>Questions</label>
        <input id={inputId} type="number" min={QUIZ_MIN_QUESTION_COUNT} max={QUIZ_MAX_QUESTION_COUNT} step={1} inputMode="numeric" value={questionCount} aria-label={`Question count for ${topic.title}`} aria-invalid={!isQuestionCountValid} disabled={disabled} onChange={(event) => setQuestionCount(Number(event.target.value))} />
        <span aria-live="polite">{isQuestionCountValid ? `~${estimatedDurationMinutes} min` : `Choose ${QUIZ_MIN_QUESTION_COUNT}-${QUIZ_MAX_QUESTION_COUNT}`}</span>
      </div>
      <div className="topic-style-picker">
        <label htmlFor={styleSelectId}>Visual Style</label>
        <select
          id={styleSelectId}
          value={selectedStyle}
          disabled={disabled}
          onChange={(event) => setSelectedStyle(event.target.value as QuizImageStyle | "mixed")}
        >
          <option value="mixed">🎲 Mixed (Random)</option>
          {availableStyles.map((style) => (
            <option key={style} value={style}>{QUIZ_IMAGE_STYLE_LABELS[style]}</option>
          ))}
        </select>
      </div>
    </div>
    <div className="topic-footer"><span>{topic.estimated_potential}</span><button className="text-button" disabled={disabled || !isQuestionCountValid} onClick={() => onConfirm(questionCount, selectedStyle)}>{busy ? <CircleNotch className="spin" size={15} /> : <Play size={14} />}{busy ? "Creating…" : "Use this topic"}</button></div>
  </article>;
}

export function ChannelDetail({ channel, channels, tasks, onTaskSubmitted, onBack, onRefresh, onNotice, onDelete, openEpisode }: { channel: Channel; channels: Channel[]; tasks: Task[]; onTaskSubmitted: (task: Task) => void; onBack: () => void; onRefresh: () => Promise<void>; onNotice: (notice: NonNullable<Notice>) => void; onDelete: (channel: Channel) => void; openEpisode: (channelId: string, episodeId: string) => void }) {
  const [dna, setDna] = useState<{ content: string; path: string; modified_at: string } | null>(null);
  const [topics, setTopics] = useState<TopicCandidate[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [editingDna, setEditingDna] = useState(false);
  const [dnaDraft, setDnaDraft] = useState("");
  const [showDna, setShowDna] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingTopicId, setConfirmingTopicId] = useState<string | null>(null);
  const [deleteEpisodeTarget, setDeleteEpisodeTarget] = useState<Episode | null>(null);
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [channelTab, setChannelTab] = useState<"episodes" | "topics" | "dna">("episodes");
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

  const suggest = async () => {
    if (topicTaskActive) return;
    setBusy("topics");
    try {
      const result = await api.suggestTopics(channel.channel_id);
      onTaskSubmitted(result.task);
      onNotice({ tone: "good", message: "Generating 5 lightweight topic ideas..." });
      setChannelTab("topics");
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not generate topics" });
    } finally {
      setBusy(null);
    }
  };

  const confirmTopic = async (topic: TopicCandidate, questionCount: number, visualStyle: QuizImageStyle | "mixed" = "mixed") => {
    if (confirmingTopicId) return;
    setConfirmingTopicId(topic.topic_id);
    try {
      const result = await api.confirmTopic(channel.channel_id, topic.topic_id, questionCount, visualStyle);
      onNotice({ tone: "good", message: `Episode created: ${result.episode.topic.title} with ${questionCount} questions` });
      await load();
      await onRefresh();
      setChannelTab("episodes");
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not create episode" });
    } finally {
      setConfirmingTopicId(null);
    }
  };

  const handleEpisodeDeleted = async (episode: Episode) => {
    setDeleteEpisodeTarget(null);
    setEpisodes((current) => current.filter((item) => item.episode_id !== episode.episode_id));
    onNotice({ tone: "good", message: `Episode deleted: ${episode.topic.title}` });
    await onRefresh();
  };

  const saveDna = async () => {
    setBusy("dna");
    try {
      await api.saveDna(channel.channel_id, dnaDraft);
      setEditingDna(false);
      onNotice({ tone: "good", message: "Channel DNA saved to the repository" });
      await load();
      await onRefresh();
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save Channel DNA" });
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    try {
      await api.updateChannel(channel.channel_id, { status: channel.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" });
      onNotice({ tone: "good", message: channel.status === "ARCHIVED" ? "Channel restored" : "Channel archived" });
      await onRefresh();
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update channel" });
    }
  };

  if (loadingChannel) return <ChannelLoadingState channel={channel} onBack={onBack} />;

  return (
    <>
      <section className="page-wrap detail-page">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>All channels</span>
        </button>

        <div className="detail-header">
          <div>
            <p className="eyebrow">{channel.engine === "quiz" ? "Quiz Engine Channel" : "Documentary Channel"}</p>
            <h1>{channel.display_name}</h1>
            <p className="detail-copy">{channel.description || "No description yet. Your DNA is the source of truth for this channel."}</p>
          </div>
          <div className="detail-actions">
            <StatusBadge status={channel.status} />
            <button className="quiet-button" onClick={() => void archive()}>
              <Archive size={16} />
              <span>{channel.status === "ARCHIVED" ? "Restore" : "Archive"}</span>
            </button>
            <button
              className="icon-button danger"
              title="Delete channel"
              aria-label={`Delete ${channel.display_name}`}
              onClick={() => onDelete(channel)}
            >
              <Trash size={17} />
            </button>
          </div>
        </div>

        {/* 3-Tab Navigation Bar */}
        <div className="channel-group-tabs" role="tablist" aria-label="Channel workspace tabs">
          <button
            type="button"
            role="tab"
            aria-selected={channelTab === "episodes"}
            className={`channel-group-tab ${channelTab === "episodes" ? "is-selected" : ""}`}
            onClick={() => setChannelTab("episodes")}
          >
            <FilmSlate size={18} weight={channelTab === "episodes" ? "fill" : "regular"} />
            <span>Episodes</span>
            <small>{episodes.length}</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={channelTab === "topics"}
            className={`channel-group-tab ${channelTab === "topics" ? "is-selected" : ""}`}
            onClick={() => setChannelTab("topics")}
          >
            <Lightbulb size={18} weight={channelTab === "topics" ? "fill" : "regular"} />
            <span>Idea Lab & Topics</span>
            <small>{topics.length}</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={channelTab === "dna"}
            className={`channel-group-tab ${channelTab === "dna" ? "is-selected" : ""}`}
            onClick={() => setChannelTab("dna")}
          >
            <FileText size={18} weight={channelTab === "dna" ? "fill" : "regular"} />
            <span>Channel DNA & Identity</span>
          </button>
        </div>

        {/* Tab 1: Episodes */}
        {channelTab === "episodes" ? (
          <div>
            <div className="section-heading" style={{ marginTop: "12px" }}>
              <div>
                <p className="eyebrow">Production Library</p>
                <h2>Confirmed Episodes</h2>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span className="count-note">
                  {episodes.length} {episodes.length === 1 ? "episode" : "episodes"}
                </span>
                <button className="primary-button compact" onClick={() => setChannelTab("topics")}>
                  <Plus size={15} />
                  <span>New Episode from Topics</span>
                </button>
              </div>
            </div>

            {episodes.length === 0 ? (
              <EmptyState
                compact
                icon={<FilmSlate size={24} />}
                title="No episodes confirmed yet"
                copy="Explore and confirm ideas in the Idea Lab to start generating video episodes."
                action="Explore Idea Lab"
                onAction={() => setChannelTab("topics")}
              />
            ) : (
              <div className="episode-list">
                {episodes.map((episode, index) => (
                  <div className="episode-row" key={episode.episode_id}>
                    <button
                      type="button"
                      className="episode-row-open"
                      aria-label={`${String(index + 1).padStart(2, "0")} ${episode.topic.title}`}
                      onClick={() => openEpisode(channel.channel_id, episode.episode_id)}
                    >
                      <div className="episode-index">{String(index + 1).padStart(2, "0")}</div>
                      <div className="episode-info">
                        <strong>{episode.topic.title}</strong>
                        <span>{episode.topic.premise}</span>
                      </div>
                      <StageBadge stage={episode.stage} />
                      <ArrowUpRight size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger episode-row-delete"
                      title={`Delete ${episode.topic.title}`}
                      aria-label={`Delete episode ${episode.topic.title}`}
                      onClick={() => setDeleteEpisodeTarget(episode)}
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Tab 2: Idea Lab & Topics */}
        {channelTab === "topics" ? (
          <div>
            <div className="section-heading" style={{ marginTop: "12px" }}>
              <div>
                <p className="eyebrow">Brainstorm & Curation</p>
                <h2>Topic Ideas ({topics.length})</h2>
              </div>
              <button
                className="primary-button"
                disabled={busy === "topics" || topicTaskActive || channel.status === "ARCHIVED"}
                onClick={() => void suggest()}
              >
                {busy === "topics" || topicTaskActive ? <CircleNotch className="spin" size={17} /> : <Sparkle size={17} />}
                <span>{topicTaskActive ? "Generating…" : "Suggest 5 topics"}</span>
              </button>
            </div>

            {topicTask ? <TopicProgress task={topicTask} now={topicClock} /> : null}

            {topics.length === 0 ? (
              <EmptyState
                compact
                icon={<Lightbulb size={23} />}
                title="No topic candidates yet"
                copy="Let AI generate 5 tailored video concepts aligned with your Channel DNA."
                action="Suggest topics"
                disabled={topicTaskActive}
                busy={topicTaskActive}
                busyLabel="Generating topics…"
                onAction={() => void suggest()}
              />
            ) : (
              <div className="topic-grid">
                {topics.slice(0, 5).map((topic) => (
                  <TopicCard
                    key={topic.topic_id}
                    topic={topic}
                    channelStyles={channel.selected_styles}
                    busy={confirmingTopicId === topic.topic_id}
                    disabled={Boolean(confirmingTopicId) || channel.status === "ARCHIVED"}
                    onConfirm={(questionCount, visualStyle) => void confirmTopic(topic, questionCount, visualStyle)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Tab 3: Channel DNA & Identity */}
        {channelTab === "dna" ? (
          <div className="detail-grid" style={{ marginTop: "12px" }}>
            <section className={`panel dna-panel ${showDna ? "is-open" : ""}`}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Identity Blueprint</p>
                  <h2>Channel DNA</h2>
                </div>
                <div className="panel-actions">
                  {channel.engine === "quiz" ? (
                    <VisualStylesMenu channel={channel} onRefresh={onRefresh} onNotice={onNotice} />
                  ) : null}
                  {editingDna ? (
                    <>
                      <button
                        className="quiet-button compact"
                        onClick={() => {
                          setEditingDna(false);
                          setDnaDraft(dna?.content ?? "");
                        }}
                      >
                        <X size={15} />
                        <span>Cancel</span>
                      </button>
                      <button
                        className="primary-button compact"
                        disabled={busy === "dna"}
                        onClick={() => void saveDna()}
                      >
                        {busy === "dna" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}
                        <span>Save</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="quiet-button compact dna-toggle"
                        aria-expanded={showDna}
                        aria-controls="channel-dna-content"
                        onClick={() => setShowDna((current) => !current)}
                      >
                        <span>{showDna ? "Hide DNA" : "View DNA"}</span>
                        <CaretDown size={14} />
                      </button>
                      {showDna ? (
                        <button className="quiet-button compact" onClick={() => setEditingDna(true)}>
                          <PencilSimple size={15} />
                          <span>Edit DNA</span>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              {dnaTask ? (
                <TaskProgressPanel
                  task={dnaTask}
                  title="Channel DNA"
                  activeLabel="Generating channel DNA"
                  completionLabel="Channel DNA ready"
                  now={topicClock}
                  compact
                />
              ) : null}
              {showDna ? (
                <div id="channel-dna-content" className="dna-content">
                  {editingDna ? (
                    <textarea
                      className="markdown-editor"
                      value={dnaDraft}
                      onChange={(event) => setDnaDraft(event.target.value)}
                      spellCheck={false}
                    />
                  ) : (
                    <pre className="markdown-preview">{dna?.content || "Loading DNA..."}</pre>
                  )}
                  <div className="file-meta">
                    <FileText size={14} />
                    <span>{dna?.path ?? `channels/${channel.slug}/channel_dna.md`}</span>
                    <span>{dna?.modified_at ? `Updated ${formatDate(dna.modified_at)}` : ""}</span>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="panel status-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Metadata</p>
                  <h2>Production Status</h2>
                </div>
              </div>
              <div className="status-stack">
                <StatusLine label="Engine" value={channel.engine === "quiz" ? "Quiz Engine" : "Documentary"} />
                <StatusLine label="Channel Status" value={channel.status} />
                <StatusLine label="Total Episodes" value={String(episodes.length)} />
                <StatusLine label="Target Audience" value={channel.target_audience || "General Audience"} />
                <StatusLine label="Language" value={channel.language || "English"} />
                <StatusLine label="Market" value={channel.market || "Global"} />
              </div>
            </section>
          </div>
        ) : null}
      </section>

      {deleteEpisodeTarget ? (
        <DeleteEpisodeModal
          channel={channel}
          episode={deleteEpisodeTarget}
          onClose={() => setDeleteEpisodeTarget(null)}
          onDeleted={handleEpisodeDeleted}
          onError={(error) =>
            onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not delete episode" })
          }
        />
      ) : null}
    </>
  );
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
