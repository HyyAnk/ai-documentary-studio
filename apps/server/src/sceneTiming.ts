import type { Scene } from "@studio/shared";

export type Beat = {
  dialogue: string;
  visual_prompt: string;
  continuity_key: string;
  transition_note: string;
  continuity_note: string;
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
      const chunks = splitDialogue(beat.dialogue, Math.ceil(est / safeMaxDuration));
      for (const chunk of chunks) {
        groups.push([{
          ...beat,
          dialogue: chunk,
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
    audio_asset_path: null,
    audio_generated_at: null,
    audio_duration_seconds: null,
  };
}

function formatSeconds(value: number): string {
  return value.toFixed(1);
}
