import { EditorialOverlaySchema, type Scene } from "@studio/shared";
import { splitAtNarrativeBoundaries } from "./production.js";

export type Beat = {
  dialogue: string;
  visual_prompt: string;
  continuity_key: string;
  transition_note: string;
  continuity_note: string;
  sequence_id: string;
  sequence_title: string;
  shot_id: string;
  asset_type: Scene["asset_type"];
  continuity_bundle_id: string;
  reference_asset_ids: string[];
  source_ids: string[];
  reconstruction: boolean;
  sound_cue: string;
  editorial_overlay: Scene["editorial_overlay"];
};

export type PackedBeat = Beat & { estSeconds: number };

export function estimateSpokenSeconds(dialogue: string, wordsPerSecond: number): number {
  const words = dialogue.trim().split(/\s+/).filter(Boolean).length;
  return words / Math.max(0.1, wordsPerSecond);
}

export function packBeatsIntoScenes(beats: Beat[], maxDuration: number, wordsPerSecond: number, episodeId: string): Scene[] {
  const safeMaxDuration = Math.max(0.1, maxDuration);
  const groups: PackedBeat[][] = [];
  let current: PackedBeat[] = [];
  let currentSeconds = 0;
  let currentKey: string | null = null;

  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    currentSeconds = 0;
    currentKey = null;
  };

  for (const beat of beats) {
    const est = estimateSpokenSeconds(beat.dialogue, wordsPerSecond);
    if (est > safeMaxDuration) {
      flush();
      const maxWords = Math.max(1, Math.floor(safeMaxDuration * wordsPerSecond));
      const chunks = splitAtNarrativeBoundaries(beat.dialogue, maxWords);
      for (const [chunkIndex, chunk] of chunks.entries()) {
        groups.push([{
          ...beat,
          dialogue: chunk,
          shot_id: `${beat.shot_id || "shot"}-${chunkIndex + 1}`,
          visual_prompt: continuationPrompt(beat.visual_prompt, chunkIndex, chunks.length),
          editorial_overlay: chunkIndex === 0 ? beat.editorial_overlay : EditorialOverlaySchema.parse({}),
          estSeconds: Math.min(safeMaxDuration, estimateSpokenSeconds(chunk, wordsPerSecond)),
        }]);
      }
      continue;
    }

    const fitsContinuity = currentKey === null || currentKey === beat.continuity_key;
    const fitsDuration = currentSeconds + est <= safeMaxDuration;
    if (fitsContinuity && fitsDuration) {
      current.push({ ...beat, estSeconds: est });
      currentSeconds += est;
      currentKey = beat.continuity_key;
    } else {
      flush();
      current = [{ ...beat, estSeconds: est }];
      currentSeconds = est;
      currentKey = beat.continuity_key;
    }
  }
  flush();

  return groups.map((group, index) => finalizeScene(group, index + 1, episodeId, safeMaxDuration));
}

export function composePackedVisualPrompt(group: PackedBeat[], sceneDuration: number): string {
  if (group.length === 1) return group[0].visual_prompt;

  const totalEstimated = group.reduce((sum, beat) => sum + beat.estSeconds, 0);
  const timeline: string[] = [`SHOT PLAN (${formatSeconds(sceneDuration)}s total)`];
  let cursor = 0;
  group.forEach((beat, index) => {
    const end = index === group.length - 1
      ? sceneDuration
      : cursor + (totalEstimated > 0 ? (beat.estSeconds / totalEstimated) * sceneDuration : sceneDuration / group.length);
    timeline.push(`${formatSeconds(cursor)}s-${formatSeconds(end)}s — shot ${index + 1}`);
    if (index < group.length - 1) timeline.push(`${formatSeconds(end)}s HARD CUT`);
    cursor = end;
  });

  const details = group.map((beat, index) => `Shot ${index + 1} detail:\n${beat.visual_prompt}`);
  const continuity = group.map((beat) => beat.continuity_note).filter(Boolean).join(" ")
    || "Maintain identical era, subject, and lighting across all shots in this scene.";
  return [...timeline, "", ...details, "", "CONTINUITY", continuity].join("\n");
}

export function composeMergedVisualPrompt(first: Scene, second: Scene): string {
  const cutAt = first.duration_seconds;
  const total = cutAt + second.duration_seconds;
  const continuity = first.continuity_note || "Maintain identical era, subject, and lighting across both shots in this scene.";
  return [
    `SHOT PLAN (${formatSeconds(total)}s total)`,
    `0.0s-${formatSeconds(cutAt)}s — shot 1`,
    `${formatSeconds(cutAt)}s HARD CUT`,
    `${formatSeconds(cutAt)}s-${formatSeconds(total)}s — shot 2`,
    "",
    `Shot 1 detail:\n${first.visual_prompt}`,
    `Shot 2 detail:\n${second.visual_prompt}`,
    "",
    "CONTINUITY",
    continuity,
  ].join("\n");
}

export function optimizeShortScenes(scenes: Scene[], maxDuration: number, episodeId: string): Scene[] {
  const result: Scene[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const current = scenes[index];
    const next = scenes[index + 1];
    const canMergeNext = current.duration_seconds < 2.5 && next
      && current.sequence_id === next.sequence_id
      && current.continuity_bundle_id === next.continuity_bundle_id
      && current.duration_seconds + next.duration_seconds <= maxDuration;
    if (canMergeNext && next) {
      result.push(mergeProductionScenes(current, next));
      index += 1;
      continue;
    }
    const previous = result[result.length - 1];
    const canMergePrevious = current.duration_seconds < 2.5 && previous
      && current.sequence_id === previous.sequence_id
      && current.continuity_bundle_id === previous.continuity_bundle_id
      && current.duration_seconds + previous.duration_seconds <= maxDuration;
    if (canMergePrevious && previous) result[result.length - 1] = mergeProductionScenes(previous, current);
    else result.push(current);
  }
  return result.map((scene, index) => ({ ...scene, scene_id: `${episodeId}_scene_${index + 1}`, scene_number: index + 1 }));
}

function mergeProductionScenes(first: Scene, second: Scene): Scene {
  return {
    ...first,
    duration_seconds: Number((first.duration_seconds + second.duration_seconds).toFixed(1)),
    dialogue: `${first.dialogue.trim()} ${second.dialogue.trim()}`.trim(),
    visual_prompt: composeMergedVisualPrompt(first, second),
    transition_note: second.transition_note,
    shot_id: [first.shot_id, second.shot_id].filter(Boolean).join("+"),
    reference_asset_ids: [...new Set([...first.reference_asset_ids, ...second.reference_asset_ids])],
    source_ids: [...new Set([...first.source_ids, ...second.source_ids])],
    reconstruction: first.reconstruction || second.reconstruction,
    sound_cue: [first.sound_cue, second.sound_cue].filter(Boolean).join("; "),
    editorial_overlay: mergeEditorialOverlays(first.editorial_overlay, second.editorial_overlay),
    audio_asset_path: null,
    audio_generated_at: null,
    audio_duration_seconds: null,
  };
}

export function splitDialogue(dialogue: string, count: number): string[] {
  const words = dialogue.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || count <= 1) return [dialogue];
  const size = Math.ceil(words.length / count);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += size) chunks.push(words.slice(index, index + size).join(" "));
  return chunks;
}

function finalizeScene(group: PackedBeat[], sceneNumber: number, episodeId: string, maxDuration: number): Scene {
  const totalEstimated = group.reduce((sum, beat) => sum + beat.estSeconds, 0);
  const minimumDuration = Math.min(2, maxDuration);
  const roundedDuration = Math.round(totalEstimated * 2) / 2;
  const duration = Math.min(maxDuration, Math.max(minimumDuration, roundedDuration));
  return {
    scene_id: `${episodeId}_scene_${sceneNumber}`,
    episode_id: episodeId,
    scene_number: sceneNumber,
    duration_seconds: duration,
    dialogue: group.map((beat) => beat.dialogue).join(" "),
    visual_prompt: composePackedVisualPrompt(group, duration),
    transition_note: group[group.length - 1].transition_note,
    continuity_note: group[0].continuity_note,
    sequence_id: group[0].sequence_id,
    sequence_title: group[0].sequence_title,
    shot_id: group.map((beat) => beat.shot_id).filter(Boolean).join("+") || `shot-${sceneNumber}`,
    asset_type: group[0].asset_type,
    continuity_bundle_id: group[0].continuity_bundle_id,
    reference_asset_ids: [...new Set(group.flatMap((beat) => beat.reference_asset_ids))],
    source_ids: [...new Set(group.flatMap((beat) => beat.source_ids))],
    reconstruction: group.some((beat) => beat.reconstruction),
    sound_cue: group.map((beat) => beat.sound_cue).filter(Boolean).join("; "),
    editorial_overlay: group.map((beat) => beat.editorial_overlay).reduce(mergeEditorialOverlays, EditorialOverlaySchema.parse({})),
    audio_asset_path: null,
    audio_generated_at: null,
    audio_duration_seconds: null,
  };
}

export function mergeEditorialOverlays(first: Scene["editorial_overlay"], second: Scene["editorial_overlay"]): Scene["editorial_overlay"] {
  const left = EditorialOverlaySchema.parse(first ?? {});
  const right = EditorialOverlaySchema.parse(second ?? {});
  if (left.kind === "none") return right;
  if (right.kind === "none") return left;
  return EditorialOverlaySchema.parse({
    kind: left.kind === right.kind ? left.kind : "comparison",
    text: [left.text, right.text].filter(Boolean).join(" · "),
    motion: left.motion !== "none" ? left.motion : right.motion,
    placement: left.placement,
    duration_seconds: left.duration_seconds ?? right.duration_seconds,
    data: [...left.data, ...right.data],
    source_ids: [...new Set([...left.source_ids, ...right.source_ids])],
  });
}

function continuationPrompt(prompt: string, index: number, count: number): string {
  if (count <= 1) return prompt;
  const shotSize = ["establishing composition", "medium observational detail", "tight evidence detail"][index % 3];
  return [`SHOT CONTINUATION ${index + 1}/${count}`, `CAMERA VARIATION: ${shotSize}; preserve the same continuity bundle while showing a new visible action.`, prompt].join("\n");
}

function formatSeconds(value: number): string {
  return value.toFixed(1);
}
