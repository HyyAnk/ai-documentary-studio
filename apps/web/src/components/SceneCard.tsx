import { ArrowClockwise, ArrowRight, Check, CircleNotch, Copy, SpeakerHigh, WarningCircle } from "@phosphor-icons/react";
import { useLayoutEffect, useRef } from "react";
import type { Scene, Task } from "@studio/shared";
import { InlineTaskState } from "./InlineTaskState";
import { isTaskActive } from "../lib/utils";

export function SceneCard({ scene, nextScene, task, audioTask, channelId, episodeId, now, maxDuration, narrationWordsPerSecond, copied, busy, onCopy, onChange, onRegenerate, onGenerateAudio, onMergeNext }: { scene: Scene; nextScene: Scene | null; task: Task | null; audioTask: Task | null; channelId: string; episodeId: string; now: number; maxDuration: number; narrationWordsPerSecond: number; copied: string | null; busy: string | null; onCopy: (key: string, value: string) => Promise<void>; onChange: (scene: Scene) => void; onRegenerate: (type: Task["task_type"]) => void; onGenerateAudio: () => void; onMergeNext: () => void }) {
  const dialogueRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const regenerating = Boolean(task && isTaskActive(task));
  const audioGenerating = Boolean(audioTask && isTaskActive(audioTask));
  const processing = regenerating || audioGenerating;
  const audioFailed = audioTask?.status === "FAILED" || audioTask?.status === "CANCELLED";
  const submitting = busy === `REGENERATE_BOTH${scene.scene_number}`;
  const mergePending = busy === `MERGE_NEXT${scene.scene_number}`;
  const audioFilename = scene.audio_asset_path?.split("/").pop();
  const audioSrc = audioFilename ? `/api/channels/${channelId}/episodes/${episodeId}/assets/${audioFilename}?v=${encodeURIComponent(scene.audio_generated_at ?? "")}` : null;
  const audioMismatch = scene.audio_duration_seconds !== null && scene.audio_duration_seconds !== undefined && Math.abs(scene.audio_duration_seconds - scene.duration_seconds) > Math.max(1, scene.duration_seconds * 0.15);
  const audioDelta = scene.audio_duration_seconds === null || scene.audio_duration_seconds === undefined ? 0 : Math.abs(scene.audio_duration_seconds - scene.duration_seconds);
  const audioDirection = (scene.audio_duration_seconds ?? 0) > scene.duration_seconds ? "longer" : "shorter";
  const shotCount = scene.visual_prompt.trim() ? scene.visual_prompt.split(/^\s*(?:CUT|HARD CUT)\s*$/m).length : 0;
  const estimatedNarrationSeconds = estimateSpokenSeconds(scene.dialogue, narrationWordsPerSecond);
  const narrationReadout = Number.isInteger(estimatedNarrationSeconds) ? String(estimatedNarrationSeconds) : estimatedNarrationSeconds.toFixed(1);
  const mergedDuration = nextScene ? scene.duration_seconds + nextScene.duration_seconds : null;
  const mergeTooLong = mergedDuration !== null && mergedDuration > maxDuration;
  const mergeTooltip = mergeTooLong ? `Combined duration exceeds the ${maxDuration}s generation limit` : "Override automatic shot grouping";
  const matchDuration = () => { if (scene.audio_duration_seconds !== null && scene.audio_duration_seconds !== undefined) onChange({ ...scene, duration_seconds: Math.min(maxDuration, Math.max(1, Math.round(scene.audio_duration_seconds))) }); };
  const clearAudioWhenDialogueChanges = (dialogue: string): Scene => dialogue === scene.dialogue ? { ...scene, dialogue } : { ...scene, dialogue, audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null };
  const autoGrow = (element: HTMLTextAreaElement) => { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`; };
  const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

  useLayoutEffect(() => {
    if (dialogueRef.current) autoGrow(dialogueRef.current);
    if (promptRef.current) autoGrow(promptRef.current);
  }, [scene.dialogue, scene.visual_prompt]);

  return <article className={`scene-card ${processing || mergePending ? "is-processing" : ""}`}>
    <div className="scene-card-header">
      <div className="scene-number">Shot {String(scene.scene_number).padStart(2, "0")}</div>
      <span className="shot-sequence">{scene.sequence_title}</span>
      <span className="shot-type">{scene.asset_type.replaceAll("_", " ")}</span>
      {scene.continuity_bundle_id ? <span className="continuity-badge">{scene.continuity_bundle_id}</span> : null}
      <label className="duration-input">Duration <input type="number" min="1" max={maxDuration} step="0.5" value={scene.duration_seconds} disabled={processing || mergePending} onChange={(event) => onChange({ ...scene, duration_seconds: Math.min(maxDuration, Number(event.target.value)) })} /> sec</label>
      <span className="narration-estimate">~{narrationReadout}s narration</span>
      {shotCount > 1 ? <span className="scene-cut-badge">{scene.duration_seconds}s · {shotCount} cuts</span> : null}
      {audioMismatch ? <div className="audio-duration-warning" role="status"><WarningCircle size={13} />Preview is {audioDelta.toFixed(1)}s {audioDirection}<button type="button" onClick={matchDuration}>Match</button></div> : null}
      <div className="scene-tools">
        <button className="quiet-button compact" onClick={() => onRegenerate("REGENERATE_BOTH")} disabled={submitting || processing || mergePending}>{submitting || regenerating ? <CircleNotch className="spin" size={14} /> : <ArrowClockwise size={14} />}{regenerating ? "Regenerating…" : "Regenerate"}</button>
        {nextScene ? <span className="control-tooltip" data-tooltip={mergeTooltip} title={mergeTooltip} tabIndex={mergeTooLong ? 0 : -1}><button className="quiet-button compact merge-button" type="button" aria-label="Combine with next shot" disabled={mergeTooLong || mergePending || processing} onClick={onMergeNext}>{mergePending ? <CircleNotch className="spin" size={14} /> : <ArrowRight size={14} />}{mergePending ? "Combining…" : "Combine"}</button></span> : null}
      </div>
    </div>
    {task ? <InlineTaskState task={task} now={now} /> : null}
    <div className="scene-columns">
      <div className="scene-block">
        <div className="block-heading"><span>Narration timeline excerpt</span><div className="scene-block-actions"><button className="copy-button" onClick={() => void onCopy(`${scene.scene_id}-dialogue`, scene.dialogue)}>{copied === `${scene.scene_id}-dialogue` ? <Check size={14} /> : <Copy size={14} />}{copied === `${scene.scene_id}-dialogue` ? "Copied" : "Copy"}</button>{!audioSrc ? <button className="copy-button" type="button" disabled={processing || mergePending} onClick={onGenerateAudio} title={audioFailed ? "Retry preview audio" : "Generate preview audio"}><SpeakerHigh size={14} />{audioFailed ? "Retry preview" : "Preview audio"}</button> : null}</div></div>
        {audioTask ? <InlineTaskState task={audioTask} now={now} /> : null}
        {audioSrc ? <div className="audio-player-row"><audio controls={!processing && !mergePending} preload="metadata" src={audioSrc} aria-label={`Shot ${scene.scene_number} preview audio`} /><button className="icon-button" type="button" title="Regenerate preview audio" aria-label="Regenerate preview audio" disabled={processing || mergePending} onClick={onGenerateAudio}><ArrowClockwise size={15} /></button></div> : null}
        <textarea ref={dialogueRef} rows={1} value={scene.dialogue} disabled={processing || mergePending} onInput={(event) => autoGrow(event.currentTarget)} onChange={(event) => onChange(clearAudioWhenDialogueChanges(event.target.value))} />
      </div>
      <div className="scene-block prompt-block">
        <div className="block-heading"><span>Video generation prompt</span><button className="copy-button" onClick={() => void onCopy(`${scene.scene_id}-prompt`, scene.visual_prompt)}>{copied === `${scene.scene_id}-prompt` ? <Check size={14} /> : <Copy size={14} />}{copied === `${scene.scene_id}-prompt` ? "Copied" : "Copy"}</button></div>
        <textarea ref={promptRef} rows={1} value={scene.visual_prompt} disabled={processing || mergePending} onInput={(event) => autoGrow(event.currentTarget)} onChange={(event) => onChange({ ...scene, visual_prompt: event.target.value })} />
      </div>
    </div>
    <div className="scene-notes"><input aria-label="Transition note" placeholder="Transition" value={scene.transition_note} disabled={processing || mergePending} onChange={(event) => onChange({ ...scene, transition_note: event.target.value })} /><input aria-label="Continuity note" placeholder="Continuity" value={scene.continuity_note} disabled={processing || mergePending} onChange={(event) => onChange({ ...scene, continuity_note: event.target.value })} /></div>
    <details className="shot-metadata">
      <summary>Production metadata</summary>
      <div className="shot-metadata-grid">
        <label>Asset type<select value={scene.asset_type} onChange={(event) => onChange({ ...scene, asset_type: event.target.value as Scene["asset_type"] })}><option value="archive">Archive</option><option value="document">Document</option><option value="map">Map</option><option value="diagram">Diagram</option><option value="ai_reconstruction">AI reconstruction</option><option value="contemporary">Contemporary</option><option value="transition">Transition</option></select></label>
        <label>Continuity bundle<input value={scene.continuity_bundle_id} onChange={(event) => onChange({ ...scene, continuity_bundle_id: event.target.value })} /></label>
        <label>Reference assets<input value={scene.reference_asset_ids.join(", ")} onChange={(event) => onChange({ ...scene, reference_asset_ids: list(event.target.value) })} /></label>
        <label>Source IDs<input value={scene.source_ids.join(", ")} onChange={(event) => onChange({ ...scene, source_ids: list(event.target.value) })} /></label>
        <label>Sound cue<input value={scene.sound_cue} onChange={(event) => onChange({ ...scene, sound_cue: event.target.value })} /></label>
      </div>
    </details>
  </article>;
}

function estimateSpokenSeconds(dialogue: string, wordsPerSecond: number): number {
  const words = dialogue.trim().split(/\s+/).filter(Boolean).length;
  return words / Math.max(0.1, wordsPerSecond);
}
