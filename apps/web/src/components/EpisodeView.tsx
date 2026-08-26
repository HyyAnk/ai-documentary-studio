import { ArrowLeft, ArrowRight, ArrowsClockwise, ArrowsInSimple, ArrowsOutSimple, Check, CheckCircle, CircleNotch, Copy, DownloadSimple, Eye, FileText, FilmSlate, FloppyDisk, FolderOpen, Image, Lightbulb, MagnifyingGlass, PencilSimple, Play, SpeakerHigh, VideoCamera, WarningCircle, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_QUIZ_IMAGE_STYLES, QUIZ_IMAGE_STYLE_LABELS, QUIZ_MAX_QUESTION_COUNT, QUIZ_MIN_QUESTION_COUNT, type Channel, type ProductionAssessment, type QuestionHistoryCheckResult, type QuizImageStyle, type Scene, type Task } from "@studio/shared";
import { api, type BundleImage } from "../api";
import { isTaskActive, isTaskTerminal, latestTask } from "../lib/utils";
import { parseContinuityBundles } from "../lib/continuity";
import { useEpisode } from "../hooks/useEpisode";
import { EmptyState, LoadingState } from "./EmptyState";
import { StageBadge, EpisodeAssetPills } from "./AppChrome";
import { SceneCard } from "./SceneCard";
import { TaskProgressPanel } from "./TaskProgressPanel";
import { QuizV2Panel } from "./QuizV2Panel";
import { EpisodeBreadcrumb } from "./Breadcrumbs";
import { PromptFocusModal } from "./PromptFocusModal";
import type { Notice } from "./types";

export type PreviewImageData = {
  url: string;
  filename: string;
  bundleId: string;
  title: string;
  prompt: string;
  priceVnd?: number;
  model?: string;
  aspectRatio?: string;
};

type ArtifactName = "research.md" | "treatment.md" | "script.md" | "visual_bible.md";

const artifactConfig: Array<{ filename: ArtifactName; title: string; taskType: Task["task_type"]; active: string; complete: string }> = [
  { filename: "research.md", title: "Research", taskType: "GENERATE_RESEARCH", active: "Verifying sources", complete: "Research ready" },
  { filename: "treatment.md", title: "Treatment", taskType: "GENERATE_TREATMENT", active: "Structuring the story", complete: "Treatment ready" },
  { filename: "script.md", title: "Narration script", taskType: "GENERATE_SCRIPT", active: "Writing narration", complete: "Script ready" },
  { filename: "visual_bible.md", title: "Visual bible", taskType: "GENERATE_VISUAL_BIBLE", active: "Locking visual identity", complete: "Visual bible ready" },
];

export function EpisodeDetail({
  channel,
  episodeId,
  tasks,
  activeTab,
  onTabChange,
  onNavigateHome,
  onNavigateChannels,
  onNavigateChannel,
  onTaskSubmitted,
  maxDuration,
  narrationWordsPerSecond,
  imageGenerationEnabled,
  imagesPerBundle,
  onBack,
  onNotice,
  simplifyMode = true,
}: {
  channel: Channel;
  episodeId: string;
  tasks: Task[];
  activeTab?: string | null;
  onTabChange?: (tab: string) => void;
  onNavigateHome?: () => void;
  onNavigateChannels?: () => void;
  onNavigateChannel?: () => void;
  onTaskSubmitted: (task: Task) => void;
  maxDuration: number;
  narrationWordsPerSecond: number;
  imageGenerationEnabled: boolean;
  imagesPerBundle: number;
  onBack: () => void;
  onNotice: (notice: NonNullable<Notice>) => void;
  simplifyMode?: boolean;
}) {
  const handleEpisodeError = useCallback((error: Error) => onNotice({ tone: "bad", message: error.message }), [onNotice]);
  const state = useEpisode(channel.channel_id, episodeId, handleEpisodeError);
  const { episode, research, setResearch, treatment, setTreatment, script, setScript, visualBible, setVisualBible, scenes, setScenes, assessment, bundleImages, quizV2, load } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [episodeClock, setEpisodeClock] = useState(() => Date.now());
  const [questionCountDraft, setQuestionCountDraft] = useState(8);
  const [durationDraft, setDurationDraft] = useState(8);
  const [previewImage, setPreviewImage] = useState<PreviewImageData | null>(null);
  const [promptModalScene, setPromptModalScene] = useState<Scene | null>(null);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [globalPromptExpanded, setGlobalPromptExpanded] = useState<boolean | null>(false);
  const [historyCheck, setHistoryCheck] = useState<QuestionHistoryCheckResult | null>(null);
  const [isRemixing, setIsRemixing] = useState(false);
  const initialWorkflowTab = (activeTab === "script" || activeTab === "visual" || activeTab === "timeline" || activeTab === "remix") ? activeTab : "timeline";
  const [workflowTab, setWorkflowTab] = useState<"script" | "visual" | "timeline" | "remix">(initialWorkflowTab);

  const loadHistoryCheck = useCallback(async () => {
    try {
      const res = await api.quizHistoryCheck(channel.channel_id, episodeId);
      setHistoryCheck(res.history_check);
    } catch {
      // Ignore non-fatal check error
    }
  }, [channel.channel_id, episodeId]);

  useEffect(() => {
    void loadHistoryCheck();
  }, [loadHistoryCheck, quizV2?.quiz, scenes.length]);

  const handleRemix = async () => {
    try {
      setIsRemixing(true);
      const res = await api.remixQuizQuestions(channel.channel_id, episodeId);
      setHistoryCheck(res.history_check);
      await load();
      onNotice({ tone: "good", message: `Đã remix thành công ${res.remixed_count} câu hỏi và kiểm tra lại lịch sử!` });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Remix câu hỏi thất bại" });
    } finally {
      setIsRemixing(false);
    }
  };

  useEffect(() => {
    if (activeTab && (activeTab === "script" || activeTab === "visual" || activeTab === "timeline" || activeTab === "remix") && activeTab !== workflowTab) {
      setWorkflowTab(activeTab);
    }
  }, [activeTab]);

  const switchWorkflowTab = (tab: "script" | "visual" | "timeline" | "remix") => {
    setWorkflowTab(tab);
    onTabChange?.(tab);
  };
  const episodeTasks = tasks.filter((task) => task.episode_id === episodeId);
  const sequenceShotTasks = episodeTasks.filter((task) => task.task_type === "GENERATE_SEQUENCE_SCENES");
  const latestShotBatchStartedAt = sequenceShotTasks.map((task) => task.created_at).sort().at(-1) ?? null;
  const currentShotBatch = latestShotBatchStartedAt ? sequenceShotTasks.filter((task) => Math.abs(Date.parse(task.created_at) - Date.parse(latestShotBatchStartedAt)) < 5_000) : [];
  const completedShotSequences = currentShotBatch.filter((task) => task.status === "COMPLETED").length;
  const activeEpisodeTask = episodeTasks.find(isTaskActive) ?? null;
  const pipelineTask = latestTask(episodeTasks, ["GENERATE_PIPELINE"]);
  const [observedTerminalTasks, setObservedTerminalTasks] = useState(() => new Set<string>());

  const sequences = useMemo(() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    for (const s of scenes) {
      const existing = map.get(s.sequence_id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(s.sequence_id, { id: s.sequence_id, title: s.sequence_title || s.sequence_id, count: 1 });
      }
    }
    return Array.from(map.values());
  }, [scenes]);

  const filterCounts = useMemo(() => {
    let missingAudio = 0;
    let audioMismatch = 0;
    let hasOverlay = 0;
    let multiCut = 0;
    for (const s of scenes) {
      if (!s.audio_asset_path) missingAudio += 1;
      if (s.audio_duration_seconds !== null && s.audio_duration_seconds !== undefined && Math.abs(s.audio_duration_seconds - s.duration_seconds) > Math.max(1, s.duration_seconds * 0.15)) {
        audioMismatch += 1;
      }
      if (s.editorial_overlay && s.editorial_overlay.kind !== "none") hasOverlay += 1;
      if (s.visual_prompt.trim() && s.visual_prompt.split(/^\s*(?:CUT|HARD CUT)\s*$/m).length > 1) multiCut += 1;
    }
    return { missingAudio, audioMismatch, hasOverlay, multiCut };
  }, [scenes]);

  const filteredScenes = useMemo(() => {
    return scenes.filter((scene) => {
      if (selectedSequenceId !== "all" && scene.sequence_id !== selectedSequenceId) return false;
      if (selectedStatusFilter === "missing_audio" && scene.audio_asset_path) return false;
      if (selectedStatusFilter === "audio_mismatch") {
        const isMismatch = scene.audio_duration_seconds !== null && scene.audio_duration_seconds !== undefined && Math.abs(scene.audio_duration_seconds - scene.duration_seconds) > Math.max(1, scene.duration_seconds * 0.15);
        if (!isMismatch) return false;
      }
      if (selectedStatusFilter === "has_overlay" && (!scene.editorial_overlay || scene.editorial_overlay.kind === "none")) return false;
      if (selectedStatusFilter === "multi_cut") {
        const cuts = scene.visual_prompt.trim() ? scene.visual_prompt.split(/^\s*(?:CUT|HARD CUT)\s*$/m).length : 0;
        if (cuts <= 1) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNumber = String(scene.scene_number).includes(q);
        const matchDialogue = scene.dialogue.toLowerCase().includes(q);
        const matchPrompt = scene.visual_prompt.toLowerCase().includes(q);
        const matchSeq = scene.sequence_title.toLowerCase().includes(q);
        const matchOverlay = scene.editorial_overlay?.text?.toLowerCase().includes(q);
        if (!matchNumber && !matchDialogue && !matchPrompt && !matchSeq && !matchOverlay) return false;
      }
      return true;
    });
  }, [scenes, selectedSequenceId, selectedStatusFilter, searchQuery]);

  const filteredTotalSeconds = useMemo(() => {
    return filteredScenes.reduce((sum, s) => sum + s.duration_seconds, 0);
  }, [filteredScenes]);

  const isQuiz = channel.engine === "quiz";
  useEffect(() => {
    if (episode) {
      setQuestionCountDraft(episode.quiz_config?.question_count ?? 8);
      setDurationDraft(episode.target_duration_minutes);
    }
  }, [episode?.episode_id, episode?.quiz_config?.question_count, episode?.target_duration_minutes]);

  useEffect(() => { setObservedTerminalTasks(new Set(episodeTasks.filter(isTaskTerminal).map((task) => task.task_id))); }, [episodeId]);
  useEffect(() => { if (!episodeTasks.some(isTaskActive)) return; const timer = window.setInterval(() => setEpisodeClock(Date.now()), 1000); return () => window.clearInterval(timer); }, [episodeTasks.some(isTaskActive)]);
  useEffect(() => {
    const newlyTerminal = episodeTasks.filter((task) => isTaskTerminal(task) && !observedTerminalTasks.has(task.task_id));
    if (newlyTerminal.length === 0) return;
    setObservedTerminalTasks((current) => new Set([...current, ...newlyTerminal.map((task) => task.task_id)]));
    void load().catch(handleEpisodeError);
  }, [episodeTasks.map((task) => `${task.task_id}:${task.status}`).join("|"), handleEpisodeError, load, observedTerminalTasks]);

  const readiness = useMemo(() => ({
    research: isReady(research),
    treatment: isReady(treatment),
    script: isReady(script),
    visualBible: isReady(visualBible),
    scenes: scenes.length > 0,
    narration: Boolean(episode?.narration_asset_path),
    video: Boolean(episode?.video_asset_path),
  }), [research, treatment, script, visualBible, scenes.length, episode?.narration_asset_path, episode?.video_asset_path]);

  const totalImageCostVnd = useMemo(() => bundleImages.reduce((sum, img) => sum + (img.price_vnd ?? 50), 0), [bundleImages]);

  const createTask = async (taskType: Task["task_type"], sceneNumber?: number) => {
    if (taskType === "GENERATE_SCENES" && scenes.length > 0 && !window.confirm(`Replace all ${scenes.length} shots and clear their preview audio?`)) return;
    const taskKey = taskType + (sceneNumber ?? "");
    setBusy(taskKey);
    try {
      if (taskType === "GENERATE_SCENES") {
        const batch = await api.generateShots(channel.channel_id, episodeId);
        batch.tasks.forEach(onTaskSubmitted);
        onNotice({ tone: "good", message: `${batch.sequence_count} shot sequences queued` });
        return;
      }
      const result = taskType === "GENERATE_AUDIO"
        ? await api.generateAudio(channel.channel_id, episodeId, sceneNumber ?? 0)
        : await api.createTask({ task_type: taskType, channel_id: channel.channel_id, episode_id: episodeId, scene_number: sceneNumber });
      onTaskSubmitted(result.task);
      onNotice({ tone: "good", message: `${taskLabel(taskType)} queued` });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not start task" });
    } finally { setBusy(null); }
  };

  const saveArtifact = async (filename: ArtifactName, content: string) => {
    setBusy(filename);
    try {
      await api.saveFile(channel.channel_id, episodeId, filename, content);
      onNotice({ tone: "good", message: `${artifactConfig.find((item) => item.filename === filename)?.title ?? "Artifact"} saved` });
      await load();
    } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save artifact" }); }
    finally { setBusy(null); }
  };

  const saveQuestionCount = async () => {
    if (!episode || questionCountDraft === (episode.quiz_config?.question_count ?? 8)) return;
    if (!Number.isInteger(questionCountDraft) || questionCountDraft < QUIZ_MIN_QUESTION_COUNT || questionCountDraft > QUIZ_MAX_QUESTION_COUNT) {
      onNotice({ tone: "bad", message: `Questions must be between ${QUIZ_MIN_QUESTION_COUNT} and ${QUIZ_MAX_QUESTION_COUNT}` });
      setQuestionCountDraft(episode.quiz_config?.question_count ?? 8);
      return;
    }
    setBusy("question-count");
    try { await api.updateEpisode(channel.channel_id, episodeId, { question_count: questionCountDraft }); await load(); onNotice({ tone: "good", message: "Question count updated" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update question count" }); }
    finally { setBusy(null); }
  };

  const saveVisualStyle = async (newStyle: QuizImageStyle | "mixed") => {
    if (!episode || newStyle === (episode.quiz_config?.visual_style ?? "mixed")) return;
    setBusy("visual-style");
    try {
      await api.updateEpisode(channel.channel_id, episodeId, { visual_style: newStyle });
      await load();
      onNotice({ tone: "good", message: `Visual style set to ${newStyle === "mixed" ? "Mixed" : QUIZ_IMAGE_STYLE_LABELS[newStyle]}` });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update visual style" });
    } finally {
      setBusy(null);
    }
  };

  const saveDuration = async () => {
    if (!episode || durationDraft === episode.target_duration_minutes) return;
    setBusy("duration");
    try { await api.updateEpisode(channel.channel_id, episodeId, { target_duration_minutes: durationDraft }); await load(); onNotice({ tone: "good", message: "Duration target updated" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update duration" }); }
    finally { setBusy(null); }
  };

  const saveScenes = async () => {
    setBusy("scenes");
    try { await api.saveScenes(channel.channel_id, episodeId, scenes); await load(); onNotice({ tone: "good", message: "Shot edits saved" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save shots" }); }
    finally { setBusy(null); }
  };

  const mergeNext = async (sceneNumber: number) => {
    const key = `MERGE_NEXT${sceneNumber}`;
    setBusy(key);
    try {
      const result = await api.mergeNextScene(channel.channel_id, episodeId, sceneNumber);
      setScenes(result.scenes);
      onNotice({ tone: "good", message: `Shot ${sceneNumber} combined` });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not combine shots" });
    } finally {
      setBusy(null);
    }
  };

  const openVideoFolder = async () => {
    setBusy("video-folder");
    try {
      await api.openVideoFolder(channel.channel_id, episodeId);
      onNotice({ tone: "good", message: "Video folder opened" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not open video folder" });
    } finally {
      setBusy(null);
    }
  };

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1300);
  };

  const copyAllVisualPrompts = async () => {
    const text = scenes
      .map((s) => `// Shot ${String(s.scene_number).padStart(2, "0")} (${s.sequence_title})\n${s.visual_prompt}`)
      .join("\n\n---\n\n");
    await navigator.clipboard.writeText(text);
    onNotice({ tone: "good", message: `Copied prompts for all ${scenes.length} shots to clipboard` });
  };

  const generateBundleImage = async (bundleNumber: number) => {
    const key = `bundle-image-${bundleNumber}`;
    setBusy(key);
    try {
      const result = await api.generateBundleImage(channel.channel_id, episodeId, bundleNumber);
      onTaskSubmitted(result.task);
      onNotice({ tone: "good", message: `Anchor image ${String(bundleNumber).padStart(2, "0")} queued` });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not start anchor image" });
    } finally {
      setBusy(null);
    }
  };

  const generateAllBundleImages = async () => {
    setBusy("bundle-images-all");
    try {
      const result = await api.generateAllBundleImages(channel.channel_id, episodeId);
      result.tasks.forEach(onTaskSubmitted);
      onNotice({
        tone: "good",
        message: `${result.tasks.length} anchor image${result.tasks.length === 1 ? "" : "s"} queued`,
      });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not start anchor images" });
    } finally {
      setBusy(null);
    }
  };

  if (!episode) return <section className="page-wrap"><LoadingState /></section>;

  const artifactValues: Record<ArtifactName, { value: string; set: (value: string) => void }> = {
    "research.md": { value: research, set: setResearch },
    "treatment.md": { value: treatment, set: setTreatment },
    "script.md": { value: script, set: setScript },
    "visual_bible.md": { value: visualBible, set: setVisualBible },
  };
  const prerequisites: Record<ArtifactName, boolean> = {
    "research.md": true,
    "treatment.md": readiness.research,
    "script.md": readiness.treatment,
    "visual_bible.md": readiness.script,
  };

  const channelStyles = channel.selected_styles && channel.selected_styles.length > 0 ? channel.selected_styles : ALL_QUIZ_IMAGE_STYLES;

  return (
    <section className="page-wrap detail-page">
      <EpisodeBreadcrumb
        channelName={channel.display_name}
        episodeTitle={episode.topic.title}
        engine={channel.engine}
        onNavigateHome={onNavigateHome}
        onNavigateChannels={onNavigateChannels}
        onNavigateChannel={onNavigateChannel || onBack}
      />

      <header className="detail-header episode-detail-header">
        <div>
          <p className="eyebrow">Quiz Production Studio</p>
          <h1>{episode.topic.title}</h1>
          <p className="detail-copy">{episode.topic.premise}</p>
        </div>
        <div className="detail-actions">
          <div className="episode-detail-badges">
            <StageBadge stage={episode.stage} />
            <EpisodeAssetPills episode={episode} tasks={episodeTasks} />
          </div>
          {totalImageCostVnd > 0 ? (
            <span className="bundle-image-cost-tag" title="Total image generation cost for this episode">
              💰 {totalImageCostVnd.toLocaleString("en-US")} VND
            </span>
          ) : null}
          {isQuiz ? (
            <div className="episode-quiz-controls">
              <label className="duration-target">
                Questions
                <input
                  aria-label="Question count"
                  type="number"
                  min={QUIZ_MIN_QUESTION_COUNT}
                  max={QUIZ_MAX_QUESTION_COUNT}
                  value={questionCountDraft}
                  onChange={(event) => setQuestionCountDraft(Number(event.target.value))}
                  onBlur={() => void saveQuestionCount()}
                />
              </label>
              <label className="visual-style-picker-label">
                Style
                <select
                  aria-label="Visual style"
                  value={episode.quiz_config?.visual_style ?? "mixed"}
                  disabled={Boolean(activeEpisodeTask)}
                  onChange={(event) => void saveVisualStyle(event.target.value as QuizImageStyle | "mixed")}
                >
                  <option value="mixed">🎲 Mixed (Random)</option>
                  {channelStyles.map((style) => (
                    <option key={style} value={style}>
                      {QUIZ_IMAGE_STYLE_LABELS[style]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <label className="duration-target">
              Target
              <input
                aria-label="Target duration in minutes"
                type="number"
                min="3"
                max="60"
                value={durationDraft}
                onChange={(event) => setDurationDraft(Number(event.target.value))}
                onBlur={() => void saveDuration()}
              />
              min
            </label>
          )}
          <button
            className="primary-button"
            disabled={Boolean(activeEpisodeTask) || busy === "GENERATE_PIPELINE"}
            onClick={() => void createTask("GENERATE_PIPELINE")}
          >
            {activeEpisodeTask || busy === "GENERATE_PIPELINE" ? (
              <CircleNotch className="spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            <span>
              {activeEpisodeTask
                ? "Working…"
                : isQuiz && readiness.video
                ? "Render again"
                : pipelineTask?.status === "FAILED"
                ? "Retry pipeline"
                : isQuiz
                ? "Build video"
                : readiness.narration
                ? "Run pipeline again"
                : "Start production"}
            </span>
          </button>
        </div>
      </header>

      {pipelineTask ? (
        <TaskProgressPanel
          task={pipelineTask}
          title="Production pipeline"
          activeLabel="Running the next step"
          completionLabel="Production pipeline complete"
          now={episodeClock}
          progressLabel="Production pipeline progress"
        />
      ) : null}

      {/* Persistent Top Monitors: Pipeline Rail, QA Scorecard, and Final Video Player */}
      {isQuiz ? (
        <QuizV2Panel
          state={quizV2}
          readiness={readiness}
          pipelineTask={pipelineTask}
          tasks={episodeTasks}
          questionCount={episode.quiz_config?.question_count ?? 0}
        />
      ) : (
        <PipelineRail readiness={readiness} quiz={false} pipelineTask={pipelineTask} tasks={episodeTasks} />
      )}

      {assessment && !isQuiz ? <AssessmentPanel assessment={assessment} /> : null}

      <section className="panel quiz-video-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Rendered Master</p>
            <h2>Quiz Video MP4</h2>
          </div>
          {!isQuiz ? (
            <button
              className="primary-button compact"
              disabled={!readiness.narration || !readiness.scenes || Boolean(activeEpisodeTask)}
              onClick={() => void createTask("GENERATE_VIDEO")}
            >
              {latestTask(episodeTasks, ["GENERATE_VIDEO"]) && isTaskActive(latestTask(episodeTasks, ["GENERATE_VIDEO"])!) ? (
                <CircleNotch className="spin" size={15} />
              ) : (
                <FilmSlate size={15} />
              )}
              <span>{readiness.video ? "Render again" : "Render video"}</span>
            </button>
          ) : null}
        </div>
        {latestTask(episodeTasks, ["GENERATE_VIDEO"]) ? (
          <TaskProgressPanel
            task={latestTask(episodeTasks, ["GENERATE_VIDEO"])!}
            title="HyperFrames render"
            activeLabel="Rendering video"
            completionLabel="Video ready"
            now={episodeClock}
            compact
          />
        ) : null}
        {episode.video_asset_path ? (
          <div className="quiz-video-result">
            <video
              controls
              preload="metadata"
              src={`${api.videoUrl(channel.channel_id, episodeId)}?v=${encodeURIComponent(episode.video_generated_at ?? "")}`}
              aria-label="Rendered video"
            />
            <div>
              <strong>MP4 with Chatterbox audio</strong>
              <span>{formatDuration(episode.video_duration_seconds ?? 0)} · HyperFrames Render</span>
              <div className="video-result-actions">
                <a
                  className="quiet-button compact"
                  href={api.videoUrl(channel.channel_id, episodeId)}
                  download={`${episode.slug}.mp4`}
                >
                  <DownloadSimple size={15} />
                  <span>Download MP4</span>
                </a>
                <button
                  className="quiet-button compact"
                  disabled={busy === "video-folder"}
                  onClick={() => void openVideoFolder()}
                >
                  {busy === "video-folder" ? <CircleNotch className="spin" size={15} /> : <FolderOpen size={15} />}
                  <span>{busy === "video-folder" ? "Opening…" : "Open folder"}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="artifact-empty">Render video once narration and shot breakdown are complete.</p>
        )}
      </section>

      {/* 4-Stage Creation Workspace Tabs (Hidden in Simplify Mode) */}
      {!simplifyMode ? (
        <div className="channel-group-tabs" role="tablist" aria-label="Episode creation workspace" style={{ margin: "24px 0 26px" }}>
          <button
            type="button"
            role="tab"
            aria-selected={workflowTab === "script"}
            className={`channel-group-tab ${workflowTab === "script" ? "is-selected" : ""}`}
            onClick={() => switchWorkflowTab("script")}
          >
            <FileText size={17} weight={workflowTab === "script" ? "fill" : "regular"} />
            <span>1. Script & Plan</span>
            {readiness.script ? <CheckCircle size={14} weight="fill" style={{ color: "var(--green)" }} /> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workflowTab === "remix"}
            className={`channel-group-tab ${workflowTab === "remix" ? "is-selected" : ""}`}
            onClick={() => switchWorkflowTab("remix")}
          >
            <ArrowsClockwise size={17} weight={workflowTab === "remix" ? "bold" : "regular"} />
            <span>Question Remix</span>
            {historyCheck?.duplicate_count ? (
              <span className={`tab-badge ${historyCheck.passed ? "badge-success" : "badge-warning"}`}>
                {historyCheck.duplicate_count}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workflowTab === "visual"}
            className={`channel-group-tab ${workflowTab === "visual" ? "is-selected" : ""}`}
            onClick={() => switchWorkflowTab("visual")}
          >
            <Image size={17} weight={workflowTab === "visual" ? "fill" : "regular"} />
            <span>2. Visual & Continuity</span>
            {bundleImages.length > 0 ? <small>{bundleImages.length}</small> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workflowTab === "timeline"}
            className={`channel-group-tab ${workflowTab === "timeline" ? "is-selected" : ""}`}
            onClick={() => switchWorkflowTab("timeline")}
          >
            <FilmSlate size={17} weight={workflowTab === "timeline" ? "fill" : "regular"} />
            <span>3. Timeline & Shots</span>
            {scenes.length > 0 ? <small>{scenes.length}</small> : null}
          </button>
        </div>
      ) : null}

      {/* Stage 1: Script & Plan */}
      {workflowTab === "script" && !simplifyMode ? (
        <div className="artifact-stack">
          {artifactConfig
            .filter((c) => c.filename !== "visual_bible.md")
            .map((config, index) => {
              const artifact = artifactValues[config.filename];
              const task = latestTask(episodeTasks, [config.taskType]);
              return (
                <ArtifactPanel
                  key={config.filename}
                  {...config}
                  content={artifact.value}
                  setContent={artifact.set}
                  task={task}
                  now={episodeClock}
                  disabled={!prerequisites[config.filename] || Boolean(activeEpisodeTask && activeEpisodeTask.task_id !== task?.task_id)}
                  saving={busy === config.filename}
                  defaultOpen={config.filename === "script.md" || (!isReady(artifact.value) && index === 0)}
                  onGenerate={() => void createTask(config.taskType)}
                  onSave={(content) => void saveArtifact(config.filename, content)}
                />
              );
            })}
        </div>
      ) : null}

      {/* Stage: Question Remix & History Check */}
      {workflowTab === "remix" && !simplifyMode ? (
        <section className="remix-section panel" style={{ marginTop: "12px" }}>
          <div className="section-heading" style={{ marginBottom: "20px" }}>
            <div>
              <p className="eyebrow">Content Quality & Anti-Duplicate</p>
              <h2>Question Remix & History Check</h2>
            </div>
            <div className="scene-heading-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleRemix()}
                disabled={isRemixing || !historyCheck || historyCheck.items.length === 0}
              >
                {isRemixing ? <CircleNotch className="spin" size={17} /> : <ArrowsClockwise size={17} />}
                <span>Remix & Check again</span>
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => switchWorkflowTab("timeline")}
              >
                <span>Continue Build</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          <div className={`history-check-summary-banner ${historyCheck?.passed ? "is-passed" : "is-blocked"}`}>
            <div className="summary-left">
              {historyCheck?.passed ? (
                <CheckCircle size={28} weight="fill" className="status-icon-passed" />
              ) : (
                <WarningCircle size={28} weight="fill" className="status-icon-warning" />
              )}
              <div>
                <strong className="summary-title">
                  {historyCheck?.passed
                    ? "Đạt điều kiện History Check"
                    : `Phát hiện ${historyCheck?.duplicate_count || 0} câu hỏi bị trùng lặp với lịch sử`}
                </strong>
                <p className="summary-desc">
                  {historyCheck
                    ? `Tổng số câu: ${historyCheck.total_questions} | Câu trùng: ${historyCheck.duplicate_count} | Ngưỡng cho phép pass: <= ${historyCheck.pass_threshold} câu`
                    : "Đang tải dữ liệu History Check..."}
                </p>
              </div>
            </div>
            <div className="summary-badge-group">
              <span className={`status-pill ${historyCheck?.passed ? "is-success" : "is-warning"}`}>
                {historyCheck?.passed ? "PASSED" : "ACTION RECOMMENDED"}
              </span>
            </div>
          </div>

          {historyCheck && historyCheck.items.length > 0 ? (
            <div className="remix-questions-list">
              <h3 style={{ margin: "24px 0 12px", fontSize: "15px", fontWeight: 600 }}>
                Chi tiết đối chiếu từng câu hỏi ({historyCheck.items.length})
              </h3>
              <div className="remix-cards-grid">
                {historyCheck.items.map((item, index) => {
                  const isDupe = item.status === "duplicate";
                  const isRemixed = item.status === "remixed";
                  return (
                    <div
                      key={item.current_question_id || index}
                      className={`remix-card ${isDupe ? "is-duplicate" : isRemixed ? "is-remixed" : "is-clean"}`}
                    >
                      <div className="remix-card-header">
                        <div className="remix-card-number">
                          <span className="q-badge">Câu #{index + 1}</span>
                          <span className={`match-status-badge is-${item.status}`}>
                            {isDupe ? "⚠️ Trùng với lịch sử" : isRemixed ? "✨ Đã Remix" : "✓ Câu hỏi mới"}
                          </span>
                        </div>
                        {item.matched_entry ? (
                          <span className="similarity-pill">
                            Độ trùng: {Math.round(item.similarity_score * 100)}%
                          </span>
                        ) : null}
                      </div>

                      <div className="remix-card-body">
                        <div className="remix-col current-col">
                          <label className="col-label">Câu hỏi hiện tại trong Video:</label>
                          <p className="remix-question-text">"{item.current_question_text}"</p>
                          <div className="remix-choices-list">
                            {item.current_choices.map((c, i) => (
                              <span
                                key={i}
                                className={`choice-chip ${c === item.current_correct_answer ? "is-correct" : ""}`}
                              >
                                {c} {c === item.current_correct_answer ? "✓" : ""}
                              </span>
                            ))}
                          </div>
                        </div>

                        {item.matched_entry ? (
                          <div className="remix-col history-col">
                            <label className="col-label">
                              Trùng với video cũ: <strong>{item.matched_entry.episode_title}</strong>
                            </label>
                            <p className="remix-question-text history-text">
                              "{item.matched_entry.question_text}"
                            </p>
                            <div className="matched-meta">
                              <span>📅 Ngày render: {new Date(item.matched_entry.rendered_at).toLocaleDateString("vi-VN")}</span>
                              <span className="match-reason-tag">{item.match_reason}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="remix-col history-col is-empty-match">
                            <p className="clean-note">✓ Không tìm thấy câu hỏi tương tự trong 30 ngày qua.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="artifact-empty" style={{ padding: "40px 0" }}>
              <p>Chưa có thông tin đối chiếu câu hỏi. Nhấn <strong>Generate script / Quiz</strong> ở bước 1 để đối chiếu.</p>
            </div>
          )}
        </section>
      ) : null}

      {/* Stage 2: Visual & Continuity */}
      {workflowTab === "visual" && !simplifyMode ? (
        <div>
          {(() => {
            const config = artifactConfig.find((c) => c.filename === "visual_bible.md")!;
            const artifact = artifactValues["visual_bible.md"];
            const task = latestTask(episodeTasks, [config.taskType]);
            return (
              <ArtifactPanel
                key="visual_bible.md"
                {...config}
                content={artifact.value}
                setContent={artifact.set}
                task={task}
                now={episodeClock}
                disabled={!prerequisites["visual_bible.md"] || Boolean(activeEpisodeTask && activeEpisodeTask.task_id !== task?.task_id)}
                saving={busy === "visual_bible.md"}
                defaultOpen={true}
                onGenerate={() => void createTask(config.taskType)}
                onSave={(content) => void saveArtifact("visual_bible.md", content)}
              />
            );
          })()}

          {imageGenerationEnabled ? (
            <BundleImagesPanel
              bundles={parseContinuityBundles(visualBible)}
              images={bundleImages}
              tasks={episodeTasks}
              now={episodeClock}
              channelId={channel.channel_id}
              episodeId={episodeId}
              imagesPerBundle={imagesPerBundle}
              resolvedStyle={episode.quiz_config?.resolved_visual_style}
              busy={busy}
              disabled={false}
              onGenerate={(bundleNumber) => void generateBundleImage(bundleNumber)}
              onGenerateAll={() => void generateAllBundleImages()}
              onPreviewImage={(img) => setPreviewImage(img)}
            />
          ) : null}
        </div>
      ) : null}

      {/* Stage 3: Timeline & Shot Plan */}
      {workflowTab === "timeline" && !simplifyMode ? (
        <section className="shot-plan-section">
          <div className="section-heading scene-heading" style={{ marginTop: "12px" }}>
            <div>
              <p className="eyebrow">Shot Breakdown</p>
              <h2>Timeline & Shots ({scenes.length})</h2>
            </div>
            <div className="scene-heading-actions">
              {scenes.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setGlobalPromptExpanded(globalPromptExpanded ? false : true)}
                    title={globalPromptExpanded ? "Collapse all prompt boxes" : "Expand all prompt boxes"}
                  >
                    {globalPromptExpanded ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
                    <span>{globalPromptExpanded ? "Collapse all prompts" : "Expand all prompts"}</span>
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => void copyAllVisualPrompts()}
                    title="Copy all prompts in text format"
                  >
                    <Copy size={16} />
                    <span>Copy all prompts</span>
                  </button>
                </>
              ) : null}
              <button
                className="primary-button"
                disabled={!readiness.visualBible || Boolean(activeEpisodeTask)}
                onClick={() => void createTask("GENERATE_SCENES")}
              >
                {latestTask(episodeTasks, ["GENERATE_SCENES"]) && isTaskActive(latestTask(episodeTasks, ["GENERATE_SCENES"])!) ? (
                  <CircleNotch className="spin" size={17} />
                ) : (
                  <FilmSlate size={17} />
                )}
                <span>{scenes.length ? "Regenerate shots" : "Generate shots"}</span>
              </button>
            </div>
          </div>

          {currentShotBatch.length > 0 ? (
            <div
              className="batch-shot-progress"
              role="progressbar"
              aria-label="Shot sequence progress"
              aria-valuemin={0}
              aria-valuemax={currentShotBatch.length}
              aria-valuenow={completedShotSequences}
            >
              <div>
                <strong>
                  {completedShotSequences} / {currentShotBatch.length} sequences
                </strong>
                <span>
                  {currentShotBatch.some((task) => task.status === "FAILED")
                    ? "Retry failed sequences from Tasks"
                    : currentShotBatch.some(isTaskActive)
                    ? "Generating in parallel"
                    : "Sequence batch complete"}
                </span>
              </div>
              <div>
                <span style={{ transform: `scaleX(${completedShotSequences / currentShotBatch.length})` }} />
              </div>
            </div>
          ) : latestTask(episodeTasks, ["GENERATE_SCENES"]) ? (
            <TaskProgressPanel
              task={latestTask(episodeTasks, ["GENERATE_SCENES"])!}
              title="Shot generation"
              activeLabel="Building sequence-aware shots"
              completionLabel="Shot plan ready"
              now={episodeClock}
            />
          ) : null}

          {scenes.length === 0 ? (
            <EmptyState
              compact
              icon={<FilmSlate size={23} />}
              title="No shots generated yet"
              copy="Lock the visual bible first, then generate parallel sequence shots."
              action="Generate shots"
              disabled={!readiness.visualBible || Boolean(activeEpisodeTask)}
              busy={Boolean(latestTask(episodeTasks, ["GENERATE_SCENES"]) && isTaskActive(latestTask(episodeTasks, ["GENERATE_SCENES"])!))}
              busyLabel="Generating…"
              onAction={() => void createTask("GENERATE_SCENES")}
            />
          ) : (
            <div>
              {/* Shot Plan Filtering & Quick Access Toolbar */}
              <div className="shot-plan-toolbar">
                <div className="toolbar-top-row">
                  <div className="search-box">
                    <MagnifyingGlass size={15} className="search-icon" />
                    <input
                      type="text"
                      placeholder="Search dialogue, prompt, sequence, or shot #…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        className="search-clear-btn"
                        onClick={() => setSearchQuery("")}
                        title="Clear search query"
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>

                  <div className="toolbar-summary-meta">
                    <span>
                      Showing <strong>{filteredScenes.length}</strong> of <strong>{scenes.length}</strong> shots (
                      {formatDuration(filteredTotalSeconds)})
                    </span>
                    {selectedSequenceId !== "all" || selectedStatusFilter !== "all" || searchQuery ? (
                      <button
                        type="button"
                        className="link-button"
                        style={{ fontSize: "12px", marginLeft: "6px" }}
                        onClick={() => {
                          setSelectedSequenceId("all");
                          setSelectedStatusFilter("all");
                          setSearchQuery("");
                        }}
                      >
                        Reset filters
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="toolbar-filters-row">
                  {sequences.length > 1 ? (
                    <div className="filter-group">
                      <span className="filter-label">Sequence:</span>
                      <div className="filter-pills" role="group" aria-label="Filter by sequence">
                        <button
                          type="button"
                          className={`filter-pill ${selectedSequenceId === "all" ? "is-active" : ""}`}
                          onClick={() => setSelectedSequenceId("all")}
                        >
                          All ({scenes.length})
                        </button>
                        {sequences.map((seq) => (
                          <button
                            key={seq.id}
                            type="button"
                            className={`filter-pill ${selectedSequenceId === seq.id ? "is-active" : ""}`}
                            onClick={() => setSelectedSequenceId(seq.id)}
                            title={seq.title}
                          >
                            {seq.title} ({seq.count})
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="filter-group">
                    <span className="filter-label">Filter:</span>
                    <div className="filter-pills" role="group" aria-label="Filter by status">
                      <button
                        type="button"
                        className={`filter-pill ${selectedStatusFilter === "all" ? "is-active" : ""}`}
                        onClick={() => setSelectedStatusFilter("all")}
                      >
                        All
                      </button>
                      {filterCounts.missingAudio > 0 ? (
                        <button
                          type="button"
                          className={`filter-pill is-warning ${selectedStatusFilter === "missing_audio" ? "is-active" : ""}`}
                          onClick={() => setSelectedStatusFilter(selectedStatusFilter === "missing_audio" ? "all" : "missing_audio")}
                        >
                          🎙️ Missing Audio ({filterCounts.missingAudio})
                        </button>
                      ) : null}
                      {filterCounts.audioMismatch > 0 ? (
                        <button
                          type="button"
                          className={`filter-pill is-warning ${selectedStatusFilter === "audio_mismatch" ? "is-active" : ""}`}
                          onClick={() => setSelectedStatusFilter(selectedStatusFilter === "audio_mismatch" ? "all" : "audio_mismatch")}
                        >
                          ⚠️ Audio Mismatch ({filterCounts.audioMismatch})
                        </button>
                      ) : null}
                      {filterCounts.hasOverlay > 0 ? (
                        <button
                          type="button"
                          className={`filter-pill ${selectedStatusFilter === "has_overlay" ? "is-active" : ""}`}
                          onClick={() => setSelectedStatusFilter(selectedStatusFilter === "has_overlay" ? "all" : "has_overlay")}
                        >
                          🎨 Overlays ({filterCounts.hasOverlay})
                        </button>
                      ) : null}
                      {filterCounts.multiCut > 0 ? (
                        <button
                          type="button"
                          className={`filter-pill ${selectedStatusFilter === "multi_cut" ? "is-active" : ""}`}
                          onClick={() => setSelectedStatusFilter(selectedStatusFilter === "multi_cut" ? "all" : "multi_cut")}
                        >
                          ✂️ Multi-cut ({filterCounts.multiCut})
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {filteredScenes.length === 0 ? (
                <EmptyState
                  compact
                  icon={<MagnifyingGlass size={22} />}
                  title="No shots match this filter"
                  copy="Try selecting another sequence, clearing your search query, or resetting filters."
                  action="Reset all filters"
                  onAction={() => {
                    setSelectedSequenceId("all");
                    setSelectedStatusFilter("all");
                    setSearchQuery("");
                  }}
                />
              ) : (
                <div className="scene-list">
                  {filteredScenes.map((scene, index) => (
                    <div key={scene.scene_id}>
                      {index === 0 || filteredScenes[index - 1].sequence_id !== scene.sequence_id ? (
                        <SequenceDivider
                          scene={scene}
                          images={bundleImages}
                          channelId={channel.channel_id}
                          episodeId={episodeId}
                          onPreviewImage={(img) => setPreviewImage(img)}
                        />
                      ) : null}
                      <SceneCard
                        scene={scene}
                        nextScene={scenes.find((s) => s.scene_number === scene.scene_number + 1) ?? null}
                        task={latestTask(episodeTasks, ["REGENERATE_DIALOGUE", "REGENERATE_PROMPT", "REGENERATE_BOTH"], scene.scene_number)}
                        audioTask={latestTask(episodeTasks, ["GENERATE_AUDIO"], scene.scene_number)}
                        channelId={channel.channel_id}
                        episodeId={episodeId}
                        now={episodeClock}
                        maxDuration={maxDuration}
                        narrationWordsPerSecond={episode.measured_narration_words_per_second ?? narrationWordsPerSecond}
                        copied={copied}
                        busy={busy}
                        globalPromptExpanded={globalPromptExpanded}
                        onCopy={copy}
                        onChange={(next) => setScenes((current) => current.map((item) => (item.scene_id === scene.scene_id ? next : item)))}
                        onRegenerate={(type) => void createTask(type, scene.scene_number)}
                        onGenerateAudio={() => void createTask("GENERATE_AUDIO", scene.scene_number)}
                        onMergeNext={() => void mergeNext(scene.scene_number)}
                        onOpenPromptModal={(targetScene) => setPromptModalScene(targetScene)}
                      />
                    </div>
                  ))}
                  <div className="scene-save-row">
                    <span>Manual edits update the assessment score after saving</span>
                    <button
                      className="primary-button compact"
                      disabled={busy === "scenes" || episodeTasks.some(isTaskActive)}
                      onClick={() => void saveScenes()}
                    >
                      {busy === "scenes" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}
                      <span>{busy === "scenes" ? "Saving…" : "Save shots"}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isQuiz ? (
            <section className="panel narration-production-panel" style={{ marginTop: "24px" }}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Master Audio</p>
                  <h2>Production Narration Track</h2>
                </div>
                <button
                  className="primary-button compact"
                  disabled={!readiness.script || Boolean(activeEpisodeTask)}
                  onClick={() => void createTask("GENERATE_NARRATION")}
                >
                  {latestTask(episodeTasks, ["GENERATE_NARRATION"]) && isTaskActive(latestTask(episodeTasks, ["GENERATE_NARRATION"])!) ? (
                    <CircleNotch className="spin" size={15} />
                  ) : (
                    <SpeakerHigh size={15} />
                  )}
                  <span>{readiness.narration ? "Regenerate" : "Generate Audio"}</span>
                </button>
              </div>
              {latestTask(episodeTasks, ["GENERATE_NARRATION"]) ? (
                <TaskProgressPanel
                  task={latestTask(episodeTasks, ["GENERATE_NARRATION"])!}
                  title="Narration"
                  activeLabel="Generating by sequence"
                  completionLabel="Narration ready"
                  now={episodeClock}
                  compact
                />
              ) : null}
              {episode.narration_asset_path ? (
                <div className="master-audio-row">
                  <audio
                    controls
                    preload="metadata"
                    src={`${api.narrationAudioUrl(channel.channel_id, episodeId, episode.narration_asset_path.split("/").at(-1))}?v=${encodeURIComponent(episode.narration_generated_at ?? "")}`}
                    aria-label="Production narration audio"
                  />
                  <span>
                    {formatDuration(episode.narration_duration_seconds ?? 0)} · {episode.narration_segment_count} segments ·{" "}
                    {(episode.measured_narration_words_per_second ?? narrationWordsPerSecond).toFixed(2)} words/sec
                  </span>
                  <a
                    className="quiet-button compact"
                    href={api.narrationAudioUrl(channel.channel_id, episodeId, episode.narration_asset_path.split("/").at(-1))}
                    download={`${episode.slug}-narration.wav`}
                  >
                    <DownloadSimple size={15} />
                    <span>Download WAV</span>
                  </a>
                </div>
              ) : (
                <p className="artifact-empty">Generate after script approval to lock speech pacing and timing calibration.</p>
              )}
            </section>
          ) : null}
        </section>
      ) : null}

      {previewImage ? <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} /> : null}
      {promptModalScene ? (
        <PromptFocusModal
          scene={promptModalScene}
          channelId={channel.channel_id}
          episodeId={episodeId}
          onSave={(updatedPrompt) => {
            setScenes((current) =>
              current.map((item) =>
                item.scene_id === promptModalScene.scene_id ? { ...item, visual_prompt: updatedPrompt } : item
              )
            );
          }}
          onClose={() => setPromptModalScene(null)}
        />
      ) : null}
    </section>
  );
}

function resolveQuizPipelineStage(pipelineTask: Task | null, tasks: Task[]): string | null {
  if (pipelineTask && isTaskActive(pipelineTask)) {
    const text = `${pipelineTask.error ?? ""} ${pipelineTask.progress_message ?? ""}`.toLowerCase();
    if (text.includes("research")) return "research";
    if (text.includes("treatment") || text.includes("facts") || text.includes("director")) return "treatment";
    if (text.includes("script")) return "script";
    if (text.includes("visual bible") || text.includes("asset")) return "visualBible";
    if (text.includes("scene") || text.includes("sequence") || text.includes("shot")) return "scenes";
    if (text.includes("voice") || text.includes("audio") || text.includes("narration")) return "narration";
    if (text.includes("video") || text.includes("render")) return "video";
  }
  const child = tasks.find((task) => isTaskActive(task));
  if (child) {
    if (child.task_type === "GENERATE_RESEARCH") return "research";
    if (child.task_type === "GENERATE_TREATMENT") return "treatment";
    if (child.task_type === "GENERATE_SCRIPT") return "script";
    if (child.task_type === "GENERATE_VISUAL_BIBLE" || child.task_type === "GENERATE_BUNDLE_IMAGE") return "visualBible";
    if (child.task_type === "GENERATE_SCENES" || child.task_type === "GENERATE_SEQUENCE_SCENES") return "scenes";
    if (child.task_type === "GENERATE_NARRATION") return "narration";
    if (child.task_type === "GENERATE_VIDEO") return "video";
  }
  return null;
}

function PipelineRail({
  readiness,
  pipelineTask = null,
  tasks = [],
}: {
  readiness: { research: boolean; treatment: boolean; script: boolean; visualBible: boolean; scenes: boolean; narration: boolean; video: boolean };
  quiz?: boolean;
  pipelineTask?: Task | null;
  tasks?: Task[];
}) {
  const steps = [
    { key: "research", label: "Research", ready: readiness.research },
    { key: "treatment", label: "Quiz plan", ready: readiness.treatment },
    { key: "script", label: "Script", ready: readiness.script },
    { key: "visualBible", label: "Design", ready: readiness.visualBible },
    { key: "scenes", label: "Scenes", ready: readiness.scenes },
    { key: "narration", label: "Audio", ready: readiness.narration },
    { key: "video", label: "Video", ready: readiness.video },
  ] as const;

  const activeStageKey = resolveQuizPipelineStage(pipelineTask, tasks);

  return (
    <ol className="pipeline-rail" aria-label="Episode production progress">
      {steps.map((step, index) => {
        const isRunning = activeStageKey === step.key;
        const isReady = step.ready;
        const className = isRunning ? "is-running" : isReady ? "is-ready" : "";
        return (
          <li className={className} key={step.label}>
            <span>
              {isRunning ? (
                <CircleNotch className="spin" size={15} />
              ) : isReady ? (
                <CheckCircle size={15} weight="fill" />
              ) : (
                index + 1
              )}
            </span>
            <div className="pipeline-rail-content">
              <strong>{step.label}</strong>
              <span className="pipeline-rail-status">{isRunning ? "Generating" : isReady ? "Ready" : "Waiting"}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PromptCollapsible({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = prompt.length > 120;
  if (!isLong) {
    return <p className="bundle-prompt-text">{prompt}</p>;
  }
  return (
    <div className="bundle-prompt-collapsible">
      <p className={`bundle-prompt-text ${expanded ? "is-expanded" : "is-collapsed"}`}>
        {expanded ? prompt : `${prompt.slice(0, 120)}…`}
      </p>
      <button
        type="button"
        className="prompt-toggle-btn"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Collapse prompt ▲" : "View full prompt ▼"}
      </button>
    </div>
  );
}

function ImagePreviewModal({ image, onClose }: { image: PreviewImageData; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="image-preview-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image preview">
      <div className="image-preview-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="image-preview-modal-header">
          <div className="image-preview-title">
            <span className="continuity-badge">{image.bundleId}</span>
            <strong>{image.title}</strong>
          </div>
          <div className="image-preview-actions">
            <a className="primary-button compact" href={image.url} download={image.filename} title="Download image">
              <DownloadSimple size={15} /> Download
            </a>
            <button className="quiet-button compact icon-only" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="image-preview-body">
          <img src={image.url} alt={`${image.bundleId} preview`} />
        </div>
        <div className="image-preview-footer">
          <p className="image-preview-prompt">{image.prompt}</p>
          <div className="image-preview-meta">
            {typeof image.priceVnd === "number" ? <span className="cost-badge">💰 {image.priceVnd.toLocaleString("en-US")} VND</span> : null}
            {image.aspectRatio ? <span className="aspect-badge">{image.aspectRatio}</span> : null}
            {image.model ? <span className="cost-model">{image.model}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function BundleImagesPanel({ bundles, images, tasks, now, channelId, episodeId, imagesPerBundle, resolvedStyle, busy, disabled, onGenerate, onGenerateAll, onPreviewImage }: { bundles: ReturnType<typeof parseContinuityBundles>; images: BundleImage[]; tasks: Task[]; now: number; channelId: string; episodeId: string; imagesPerBundle: number; resolvedStyle?: QuizImageStyle; busy: string | null; disabled: boolean; onGenerate: (bundleNumber: number) => void; onGenerateAll: () => void; onPreviewImage: (data: PreviewImageData) => void }) {
  const activeImageTask = tasks.some((task) => task.task_type === "GENERATE_BUNDLE_IMAGE" && isTaskActive(task));
  return <section className="panel bundle-images-panel">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">Style lock</p>
        <div className="bundle-heading-with-badge">
          <h2>Continuity images</h2>
          {resolvedStyle ? (
            <span className="style-lock-badge" title="Resolved style for this episode">
              ✨ {QUIZ_IMAGE_STYLE_LABELS[resolvedStyle] || resolvedStyle}
            </span>
          ) : null}
        </div>
      </div>
      <div className="panel-heading-actions"><a className="quiet-button compact" href={images.length ? api.downloadBundleImagesUrl(channelId, episodeId) : undefined} aria-disabled={!images.length} download><DownloadSimple size={15} />Download all</a><button className="primary-button compact" disabled={disabled || activeImageTask || busy === "bundle-images-all" || bundles.length === 0} onClick={onGenerateAll}>{busy === "bundle-images-all" || activeImageTask ? <CircleNotch className="spin" size={15} /> : <Play size={15} />}{activeImageTask ? "Generating…" : "Generate all"}</button></div>
    </div>
    {bundles.length === 0 ? <p className="artifact-empty">Generate the visual bible to define continuity bundles.</p> : <div className="bundle-image-list">{bundles.map((bundle) => {
      const bundleImages = images.filter((image) => image.bundle_id === bundle.bundle_id);
      const task = latestTask(tasks, ["GENERATE_BUNDLE_IMAGE"], bundle.bundle_number);
      const taskActive = Boolean(task && isTaskActive(task));
      return <article className="bundle-image-card" key={bundle.bundle_id}>
        <div className="bundle-image-copy">
          <div><span className="continuity-badge">{bundle.bundle_id}</span><strong>{bundle.title}</strong></div>
          <PromptCollapsible prompt={bundle.anchor_prompt} />
          <span className="bundle-image-count">{bundleImages.length} / {imagesPerBundle} image{imagesPerBundle === 1 ? "" : "s"}</span>
        </div>
        <div className="bundle-image-assets">
          {bundleImages.map((image) => (
            <div className="bundle-image-item" key={image.filename}>
              <button
                type="button"
                className="bundle-image-thumb-btn"
                onClick={() => onPreviewImage({
                  url: api.bundleImageUrl(channelId, episodeId, image.filename),
                  filename: image.filename,
                  bundleId: bundle.bundle_id,
                  title: bundle.title,
                  prompt: bundle.anchor_prompt,
                  priceVnd: image.price_vnd,
                  model: image.model,
                  aspectRatio: image.aspect_ratio,
                })}
                title="Click to enlarge image"
              >
                <img src={api.bundleImageUrl(channelId, episodeId, image.filename)} alt={`${bundle.bundle_id} anchor`} />
                <span className="bundle-image-zoom-overlay">
                  <Eye size={16} weight="bold" />
                  <span>Zoom</span>
                </span>
              </button>
              {typeof image.price_vnd === "number" ? (
                <div className="bundle-image-cost-tag" title={image.price_breakdown ? Object.entries(image.price_breakdown).map(([k, v]) => `${k}: ${v} VND`).join(", ") : `${image.price_vnd} VND`}>
                  <span className="cost-badge">💰 {image.price_vnd.toLocaleString("en-US")} VND</span>
                  {image.aspect_ratio ? <span className="aspect-badge">{image.aspect_ratio}</span> : null}
                  {image.model ? <span className="cost-model">{image.model}</span> : null}
                </div>
              ) : null}
            </div>
          ))}
          <button className="quiet-button compact" disabled={disabled || taskActive || busy === `bundle-image-${bundle.bundle_number}`} onClick={() => onGenerate(bundle.bundle_number)}>{taskActive || busy === `bundle-image-${bundle.bundle_number}` ? <CircleNotch className="spin" size={14} /> : <Play size={14} />}{bundleImages.length ? "Regenerate" : "Generate anchor"}</button>
        </div>
        {task ? <TaskProgressPanel task={task} title={bundle.bundle_id} activeLabel="Generating anchor image" completionLabel="Anchor image ready" now={now} compact /> : null}
      </article>;
    })}</div>}
  </section>;
}

function SequenceDivider({ scene, images, channelId, episodeId, onPreviewImage }: { scene: Scene; images: BundleImage[]; channelId: string; episodeId: string; onPreviewImage?: (data: PreviewImageData) => void }) {
  const image = images.find((item) => item.bundle_id === scene.continuity_bundle_id && item.variant === 0);
  return (
    <div className="sequence-divider">
      <span>{scene.sequence_id}</span>
      <strong>{scene.sequence_title}</strong>
      {image ? (
        <button
          type="button"
          className="sequence-anchor-btn"
          onClick={() => onPreviewImage?.({
            url: api.bundleImageUrl(channelId, episodeId, image.filename),
            filename: image.filename,
            bundleId: scene.continuity_bundle_id,
            title: scene.sequence_title,
            prompt: scene.visual_prompt,
          })}
          title="Click to enlarge image"
        >
          <img src={api.bundleImageUrl(channelId, episodeId, image.filename)} alt={`${scene.continuity_bundle_id} anchor`} />
          <span>{scene.continuity_bundle_id}</span>
        </button>
      ) : null}
    </div>
  );
}

function AssessmentPanel({ assessment }: { assessment: ProductionAssessment }) {
  const blockers = assessment.issues.filter((issue) => issue.severity === "blocker");
  const targetWords = assessment.metrics.calibrated_word_target_count || assessment.metrics.target_word_count;
  return <section className={`assessment-panel ${assessment.rating}`}><div className="assessment-score"><strong>{assessment.score}</strong><span>Production score</span></div><div className="assessment-summary"><div><h2>{assessment.rating === "production_ready" ? "Production ready" : assessment.rating === "needs_work" ? "Needs review" : "Not ready"}</h2><span>{assessment.metrics.narration_word_count} / {targetWords} calibrated words · {assessment.metrics.sequence_count} sequences · {assessment.metrics.scene_count} shots · {Math.round((assessment.metrics.overlay_coverage_ratio ?? 0) * 100)}% overlays</span></div>{blockers.length ? <details><summary><WarningCircle size={16} />{blockers.length} blocker{blockers.length === 1 ? "" : "s"}</summary><ul>{assessment.issues.map((issue) => <li key={issue.code} className={issue.severity}><strong>{issue.message}</strong><span>{issue.next_action}</span></li>)}</ul></details> : <span className="assessment-ready"><CheckCircle size={16} />Quality gates passed</span>}</div></section>;
}

function ArtifactPanel({ filename, title, taskType, active, complete, content, setContent, task, now, disabled, saving, defaultOpen, onGenerate, onSave }: { filename: ArtifactName; title: string; taskType: Task["task_type"]; active: string; complete: string; content: string; setContent: (value: string) => void; task: Task | null; now: number; disabled: boolean; saving: boolean; defaultOpen: boolean; onGenerate: () => void; onSave: (content: string) => void }) {
  const [editing, setEditing] = useState(false);
  const ready = isReady(content);
  const activeTask = Boolean(task && isTaskActive(task));
  return <details className={`panel artifact-panel ${ready ? "is-ready" : ""}`} open={defaultOpen}>
    <summary><div><span className="artifact-status">{ready ? <CheckCircle size={16} weight="fill" /> : <span />}</span><h2>{title}</h2></div><span>{ready ? "Ready" : "Pending"}</span></summary>
    <div className="artifact-panel-body">
      <div className="artifact-actions">{editing ? <><button className="quiet-button compact" onClick={() => setEditing(false)}><X size={14} />Cancel</button><button className="primary-button compact" disabled={saving} onClick={() => { onSave(content); setEditing(false); }}>{saving ? <CircleNotch className="spin" size={14} /> : <FloppyDisk size={14} />}Save</button></> : <><button className="quiet-button compact" disabled={!ready || activeTask} onClick={() => setEditing(true)}><PencilSimple size={14} />Edit</button><button className="primary-button compact" disabled={disabled || activeTask} onClick={onGenerate}>{activeTask ? <CircleNotch className="spin" size={14} /> : <Play size={14} />}{ready ? "Regenerate" : taskLabel(taskType)}</button></>}</div>
      {task ? <TaskProgressPanel task={task} title={title} activeLabel={active} completionLabel={complete} now={now} compact /> : null}
      {editing ? <textarea className="markdown-editor artifact-editor" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} /> : <pre className="markdown-preview artifact-preview">{ready ? content : `${title} has not started.`}</pre>}
    </div>
  </details>;
}

function isReady(content: string): boolean {
  return Boolean(content.trim()) && !/(?:has not started|generation has not started|breakdown has not started)/i.test(content);
}

function taskLabel(type: Task["task_type"]): string {
  const labels: Partial<Record<Task["task_type"], string>> = {
    GENERATE_RESEARCH: "Research",
    GENERATE_TREATMENT: "Build",
    GENERATE_SCRIPT: "Write",
    GENERATE_VISUAL_BIBLE: "Build",
    GENERATE_SCENES: "Generate shots",
    GENERATE_PIPELINE: "Start production",
    GENERATE_NARRATION: "Generate narration",
    GENERATE_AUDIO: "Generate preview",
    GENERATE_VIDEO: "Render video",
  };
  return labels[type] ?? "Generate";
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
