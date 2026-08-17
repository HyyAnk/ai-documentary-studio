import { ArrowLeft, ArrowUpRight, CheckCircle, CircleNotch, DownloadSimple, FilmSlate, FloppyDisk, PencilSimple, Play, SpeakerHigh, WarningCircle, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel, Episode, ProductionAssessment, Scene, Task } from "@studio/shared";
import { api } from "../api";
import { isTaskActive, isTaskTerminal, latestTask } from "../lib/utils";
import { useEpisode } from "../hooks/useEpisode";
import { EmptyState, LoadingState } from "./EmptyState";
import { PageTitle, StageBadge } from "./AppChrome";
import { SceneCard } from "./SceneCard";
import { TaskProgressPanel } from "./TaskProgressPanel";
import type { Notice } from "./types";

type ArtifactName = "research.md" | "treatment.md" | "script.md" | "visual_bible.md";

const artifactConfig: Array<{ filename: ArtifactName; title: string; taskType: Task["task_type"]; active: string; complete: string }> = [
  { filename: "research.md", title: "Research", taskType: "GENERATE_RESEARCH", active: "Verifying sources", complete: "Research ready" },
  { filename: "treatment.md", title: "Treatment", taskType: "GENERATE_TREATMENT", active: "Structuring the story", complete: "Treatment ready" },
  { filename: "script.md", title: "Narration script", taskType: "GENERATE_SCRIPT", active: "Writing narration", complete: "Script ready" },
  { filename: "visual_bible.md", title: "Visual bible", taskType: "GENERATE_VISUAL_BIBLE", active: "Locking visual identity", complete: "Visual bible ready" },
];

export function EpisodesView({ channel, episodeId, tasks, onTaskSubmitted, openChannel, openEpisode, maxDuration, narrationWordsPerSecond, onNotice }: { channel: Channel | null; episodeId: string | null; tasks: Task[]; onTaskSubmitted: (task: Task) => void; openChannel: (id: string) => void; openEpisode: (channelId: string, episodeId: string) => void; maxDuration: number; narrationWordsPerSecond: number; onNotice: (notice: NonNullable<Notice>) => void }) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const terminalTaskKey = tasks.filter((task) => task.channel_id === channel?.channel_id && isTaskTerminal(task)).map((task) => `${task.task_id}:${task.status}`).join("|");
  useEffect(() => { if (channel) void api.episodes(channel.channel_id).then((response) => setEpisodes(response.episodes)).catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [channel?.channel_id, terminalTaskKey, onNotice]);
  if (!channel) return <section className="page-wrap"><PageTitle eyebrow="Episodes" title="Choose a channel" /><EmptyState compact icon={<FilmSlate size={23} />} title="Select a channel" copy="Open a channel to see episodes." action="Browse channels" onAction={() => onNotice({ tone: "neutral", message: "Choose a channel first" })} /></section>;
  if (episodeId) return <EpisodeDetail channel={channel} episodeId={episodeId} tasks={tasks} onTaskSubmitted={onTaskSubmitted} maxDuration={maxDuration} narrationWordsPerSecond={narrationWordsPerSecond} onBack={() => openChannel(channel.channel_id)} onNotice={onNotice} />;
  return <section className="page-wrap"><button className="back-button" onClick={() => openChannel(channel.channel_id)}><ArrowLeft size={16} />Channel</button><PageTitle eyebrow={channel.display_name} title="Episodes" />{episodes.length === 0 ? <EmptyState icon={<FilmSlate size={26} />} title="No episodes yet" copy="Choose a topic to create one." action="Open channel" onAction={() => openChannel(channel.channel_id)} /> : <div className="episode-list">{episodes.map((episode, index) => <button className="episode-row" key={episode.episode_id} onClick={() => openEpisode(channel.channel_id, episode.episode_id)}><div className="episode-index">{String(index + 1).padStart(2, "0")}</div><div className="episode-info"><strong>{episode.topic.title}</strong><span>{episode.topic.premise}</span></div><StageBadge stage={episode.stage} /><ArrowUpRight size={17} /></button>)}</div>}</section>;
}

function EpisodeDetail({ channel, episodeId, tasks, onTaskSubmitted, maxDuration, narrationWordsPerSecond, onBack, onNotice }: { channel: Channel; episodeId: string; tasks: Task[]; onTaskSubmitted: (task: Task) => void; maxDuration: number; narrationWordsPerSecond: number; onBack: () => void; onNotice: (notice: NonNullable<Notice>) => void }) {
  const handleEpisodeError = useCallback((error: Error) => onNotice({ tone: "bad", message: error.message }), [onNotice]);
  const state = useEpisode(channel.channel_id, episodeId, handleEpisodeError);
  const { episode, research, setResearch, treatment, setTreatment, script, setScript, visualBible, setVisualBible, scenes, setScenes, assessment, load } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [episodeClock, setEpisodeClock] = useState(() => Date.now());
  const [durationDraft, setDurationDraft] = useState(8);
  const episodeTasks = tasks.filter((task) => task.episode_id === episodeId);
  const sequenceShotTasks = episodeTasks.filter((task) => task.task_type === "GENERATE_SEQUENCE_SCENES");
  const latestShotBatchStartedAt = sequenceShotTasks.map((task) => task.created_at).sort().at(-1) ?? null;
  const currentShotBatch = latestShotBatchStartedAt ? sequenceShotTasks.filter((task) => Math.abs(Date.parse(task.created_at) - Date.parse(latestShotBatchStartedAt)) < 5_000) : [];
  const completedShotSequences = currentShotBatch.filter((task) => task.status === "COMPLETED").length;
  const activeEpisodeTask = episodeTasks.find(isTaskActive) ?? null;
  const [observedTerminalTasks, setObservedTerminalTasks] = useState(() => new Set<string>());

  useEffect(() => { if (episode) setDurationDraft(episode.target_duration_minutes); }, [episode?.episode_id, episode?.target_duration_minutes]);
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
  }), [research, treatment, script, visualBible, scenes.length, episode?.narration_asset_path]);

  const nextTask: { type: Task["task_type"]; label: string } = !readiness.research
    ? { type: "GENERATE_RESEARCH", label: "Research topic" }
    : !readiness.treatment
      ? { type: "GENERATE_TREATMENT", label: "Build treatment" }
      : !readiness.script
        ? { type: "GENERATE_SCRIPT", label: "Write script" }
        : !readiness.visualBible
          ? { type: "GENERATE_VISUAL_BIBLE", label: "Lock visual identity" }
          : !readiness.scenes
            ? { type: "GENERATE_SCENES", label: "Build shot plan" }
            : { type: "GENERATE_NARRATION", label: readiness.narration ? "Regenerate narration" : "Generate narration" };

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

  const saveDuration = async () => {
    if (!episode || durationDraft === episode.target_duration_minutes) return;
    setBusy("duration");
    try { await api.updateEpisode(channel.channel_id, episodeId, durationDraft); await load(); onNotice({ tone: "good", message: "Duration target updated" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update duration" }); }
    finally { setBusy(null); }
  };

  const saveScenes = async () => {
    setBusy("scenes");
    try { await api.saveScenes(channel.channel_id, episodeId, scenes); await load(); onNotice({ tone: "good", message: "Shot edits saved" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save shots" }); }
    finally { setBusy(null); }
  };
  const mergeNext = async (sceneNumber: number) => { const key = `MERGE_NEXT${sceneNumber}`; setBusy(key); try { const result = await api.mergeNextScene(channel.channel_id, episodeId, sceneNumber); setScenes(result.scenes); onNotice({ tone: "good", message: `Shot ${sceneNumber} combined` }); } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not combine shots" }); } finally { setBusy(null); } };
  const copy = async (key: string, value: string) => { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(null), 1300); };

  if (!episode) return <section className="page-wrap"><LoadingState /></section>;
  const artifactValues: Record<ArtifactName, { value: string; set: (value: string) => void }> = {
    "research.md": { value: research, set: setResearch },
    "treatment.md": { value: treatment, set: setTreatment },
    "script.md": { value: script, set: setScript },
    "visual_bible.md": { value: visualBible, set: setVisualBible },
  };
  const prerequisites: Record<ArtifactName, boolean> = { "research.md": true, "treatment.md": readiness.research, "script.md": readiness.treatment, "visual_bible.md": readiness.script };

  return <section className="page-wrap detail-page">
    <button className="back-button" onClick={onBack}><ArrowLeft size={16} />{channel.display_name}</button>
    <header className="detail-header episode-detail-header">
      <div><p className="eyebrow">Production workspace</p><h1>{episode.topic.title}</h1><p className="detail-copy">{episode.topic.premise}</p></div>
      <div className="detail-actions"><StageBadge stage={episode.stage} /><label className="duration-target">Target<input aria-label="Target duration in minutes" type="number" min="3" max="60" value={durationDraft} onChange={(event) => setDurationDraft(Number(event.target.value))} onBlur={() => void saveDuration()} />min</label><button className="primary-button" disabled={Boolean(activeEpisodeTask) || busy === nextTask.type} onClick={() => void createTask(nextTask.type)}>{activeEpisodeTask || busy === nextTask.type ? <CircleNotch className="spin" size={16} /> : <Play size={16} />}{activeEpisodeTask ? "Working…" : nextTask.label}</button></div>
    </header>

    <PipelineRail readiness={readiness} />
    {assessment ? <AssessmentPanel assessment={assessment} /> : null}

    <div className="artifact-stack">
      {artifactConfig.map((config, index) => {
        const artifact = artifactValues[config.filename];
        const task = latestTask(episodeTasks, [config.taskType]);
        return <ArtifactPanel key={config.filename} {...config} content={artifact.value} setContent={artifact.set} task={task} now={episodeClock} disabled={!prerequisites[config.filename] || Boolean(activeEpisodeTask && activeEpisodeTask.task_id !== task?.task_id)} saving={busy === config.filename} defaultOpen={config.filename === "script.md" || (!isReady(artifact.value) && index === 0)} onGenerate={() => void createTask(config.taskType)} onSave={(content) => void saveArtifact(config.filename, content)} />;
      })}
    </div>

    <section className="panel narration-production-panel">
      <div className="panel-heading"><div><p className="eyebrow">Audio master</p><h2>Production narration</h2></div><button className="primary-button compact" disabled={!readiness.script || Boolean(activeEpisodeTask)} onClick={() => void createTask("GENERATE_NARRATION")}>{latestTask(episodeTasks, ["GENERATE_NARRATION"]) && isTaskActive(latestTask(episodeTasks, ["GENERATE_NARRATION"])!) ? <CircleNotch className="spin" size={15} /> : <SpeakerHigh size={15} />}{readiness.narration ? "Regenerate" : "Generate"}</button></div>
      {latestTask(episodeTasks, ["GENERATE_NARRATION"]) ? <TaskProgressPanel task={latestTask(episodeTasks, ["GENERATE_NARRATION"])!} title="Narration" activeLabel="Generating by sequence" completionLabel="Narration ready" now={episodeClock} compact /> : null}
      {episode.narration_asset_path ? <div className="master-audio-row"><audio controls preload="metadata" src={`${api.narrationAudioUrl(channel.channel_id, episodeId)}?v=${encodeURIComponent(episode.narration_generated_at ?? "")}`} aria-label="Production narration audio" /><span>{formatDuration(episode.narration_duration_seconds ?? 0)} · {episode.narration_segment_count} segments · {(episode.measured_narration_words_per_second ?? narrationWordsPerSecond).toFixed(2)} words/sec</span><a className="quiet-button compact" href={api.narrationAudioUrl(channel.channel_id, episodeId)} download={`${episode.slug}-narration.wav`}><DownloadSimple size={15} />Download</a></div> : <p className="artifact-empty">Generate after the script is approved to preserve long-form phrasing and calibrate timing.</p>}
    </section>

    <section className="shot-plan-section">
      <div className="section-heading scene-heading"><div><p className="eyebrow">Edit timeline</p><h2>Shot plan</h2></div><div className="scene-heading-actions"><button className="primary-button" disabled={!readiness.visualBible || Boolean(activeEpisodeTask)} onClick={() => void createTask("GENERATE_SCENES")}>{latestTask(episodeTasks, ["GENERATE_SCENES"]) && isTaskActive(latestTask(episodeTasks, ["GENERATE_SCENES"])!) ? <CircleNotch className="spin" size={17} /> : <FilmSlate size={17} />}{scenes.length ? "Regenerate shots" : "Generate shots"}</button></div></div>
      {currentShotBatch.length > 0 ? <div className="batch-shot-progress" role="progressbar" aria-label="Shot sequence progress" aria-valuemin={0} aria-valuemax={currentShotBatch.length} aria-valuenow={completedShotSequences}><div><strong>{completedShotSequences} / {currentShotBatch.length} sequences</strong><span>{currentShotBatch.some((task) => task.status === "FAILED") ? "Retry failed sequences from Tasks" : currentShotBatch.some(isTaskActive) ? "Generating in parallel" : "Sequence batch complete"}</span></div><div><span style={{ transform: `scaleX(${completedShotSequences / currentShotBatch.length})` }} /></div></div> : latestTask(episodeTasks, ["GENERATE_SCENES"]) ? <TaskProgressPanel task={latestTask(episodeTasks, ["GENERATE_SCENES"])!} title="Shot generation" activeLabel="Building sequence-aware shots" completionLabel="Shot plan ready" now={episodeClock} /> : null}
      {scenes.length === 0 ? <EmptyState compact icon={<FilmSlate size={23} />} title="No shots yet" copy="Complete the visual bible first." action="Generate shots" disabled={!readiness.visualBible || Boolean(activeEpisodeTask)} busy={Boolean(latestTask(episodeTasks, ["GENERATE_SCENES"]) && isTaskActive(latestTask(episodeTasks, ["GENERATE_SCENES"])!))} busyLabel="Generating…" onAction={() => void createTask("GENERATE_SCENES")} /> : <div className="scene-list">{scenes.map((scene, index) => <div key={scene.scene_id}>{index === 0 || scenes[index - 1].sequence_id !== scene.sequence_id ? <div className="sequence-divider"><span>{scene.sequence_id}</span><strong>{scene.sequence_title}</strong></div> : null}<SceneCard scene={scene} nextScene={scenes[index + 1] ?? null} task={latestTask(episodeTasks, ["REGENERATE_DIALOGUE", "REGENERATE_PROMPT", "REGENERATE_BOTH"], scene.scene_number)} audioTask={latestTask(episodeTasks, ["GENERATE_AUDIO"], scene.scene_number)} channelId={channel.channel_id} episodeId={episodeId} now={episodeClock} maxDuration={maxDuration} narrationWordsPerSecond={episode.measured_narration_words_per_second ?? narrationWordsPerSecond} copied={copied} busy={busy} onCopy={copy} onChange={(next) => setScenes((current) => current.map((item) => item.scene_id === scene.scene_id ? next : item))} onRegenerate={(type) => void createTask(type, scene.scene_number)} onGenerateAudio={() => void createTask("GENERATE_AUDIO", scene.scene_number)} onMergeNext={() => void mergeNext(scene.scene_number)} /></div>)}<div className="scene-save-row"><span>Manual edits update the assessment after save</span><button className="primary-button compact" disabled={busy === "scenes" || episodeTasks.some(isTaskActive)} onClick={() => void saveScenes()}>{busy === "scenes" ? <CircleNotch className="spin" size={15} /> : <FloppyDisk size={15} />}{busy === "scenes" ? "Saving…" : "Save shots"}</button></div></div>}
    </section>
  </section>;
}

function PipelineRail({ readiness }: { readiness: { research: boolean; treatment: boolean; script: boolean; visualBible: boolean; scenes: boolean; narration: boolean } }) {
  const steps = [["Research", readiness.research], ["Treatment", readiness.treatment], ["Script", readiness.script], ["Visual bible", readiness.visualBible], ["Shots", readiness.scenes], ["Narration", readiness.narration]] as const;
  return <ol className="pipeline-rail" aria-label="Episode production progress">{steps.map(([label, ready], index) => <li className={ready ? "is-ready" : ""} key={label}><span>{ready ? <CheckCircle size={15} weight="fill" /> : index + 1}</span><strong>{label}</strong></li>)}</ol>;
}

function AssessmentPanel({ assessment }: { assessment: ProductionAssessment }) {
  const blockers = assessment.issues.filter((issue) => issue.severity === "blocker");
  return <section className={`assessment-panel ${assessment.rating}`}><div className="assessment-score"><strong>{assessment.score}</strong><span>Production score</span></div><div className="assessment-summary"><div><h2>{assessment.rating === "production_ready" ? "Production ready" : assessment.rating === "needs_work" ? "Needs review" : "Not ready"}</h2><span>{assessment.metrics.narration_word_count} / {assessment.metrics.target_word_count} words · {assessment.metrics.sequence_count} sequences · {assessment.metrics.scene_count} shots</span></div>{blockers.length ? <details><summary><WarningCircle size={16} />{blockers.length} blocker{blockers.length === 1 ? "" : "s"}</summary><ul>{assessment.issues.map((issue) => <li key={issue.code} className={issue.severity}><strong>{issue.message}</strong><span>{issue.next_action}</span></li>)}</ul></details> : <span className="assessment-ready"><CheckCircle size={16} />Quality gates passed</span>}</div></section>;
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
    GENERATE_NARRATION: "Generate narration",
    GENERATE_AUDIO: "Generate preview",
  };
  return labels[type] ?? "Generate";
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
