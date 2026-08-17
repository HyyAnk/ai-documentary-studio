# SCENE TIMING & CINEMATIC PROMPTS — AUTOMATIC BEAT PACKING

Grounded in the current repo: `packages/shared/src/index.ts` (`AppConfigSchema.video_generation`), `apps/server/src/context.ts` (`GENERATE_SCENES`/regenerate branches, `readSharedRules`), `apps/server/src/tasks.ts` (`parseScenesOutput`, `normalizeSceneDurations`, `splitDialogue`), `apps/server/src/app.ts` (scene routes), `apps/web/src/components/SceneCard.tsx`.

This replaces `08_SCENE_PACKING_FOR_VIDEO_GENERATION.md` in full (never applied — implement this instead, not that one).

## Problem and design principle

Today `shared/visual_rules.md` says *"one coherent visual idea per scene"* and the output contract only caps duration from above — nothing ties a scene's `duration_seconds` to how long its `dialogue` actually takes to speak, so scenes come back marked 8s while containing 3s of narration.

The fix separates two different jobs that were wrongly combined into one LLM call:

- **Creative writing** (what an LLM is good at): write small, self-contained narrative beats, and judge which adjacent beats visually belong together.
- **Duration packing** (what code is good at, and an LLM is not reliable at): grouping beats into scenes so each scene's total estimated speaking time fits its duration budget.

Codex only does the first job. A deterministic function does the second. Packing is then correct by construction on every run — no reliance on the model "remembering" to follow a duration instruction, and no manual cleanup step required for ordinary output.

## Step 0 — Copy the pre-written reference/rule files first

Four ready-to-use files are provided alongside this one. Copy them into the repo **before** making any code change, overwriting the existing versions:

| Provided file | Copy to |
|---|---|
| `shared/cinematic_prompt_reference.md` | `shared/cinematic_prompt_reference.md` (new file) |
| `shared/visual_rules.md` | `shared/visual_rules.md` (overwrite) |
| `shared/prompt_rules.md` | `shared/prompt_rules.md` (overwrite) |
| `templates/example_scene.md` | `templates/example_scene.md` (overwrite) |

These are plain content files — no code in them. Everything below wires them into the running app.

## 1. Config (`packages/shared/src/index.ts`, `AppConfigSchema.video_generation`)

```ts
video_generation: z.object({
  provider: z.string().default("none"),
  model: z.string().default(""),
  max_scene_duration_seconds: z.number().positive().default(8),
  default_scene_duration_seconds: z.number().positive().default(6),
  narration_words_per_second: z.number().positive().default(2.3), // new
  aspect_ratio: z.string().default("16:9"),
}),
```

Only one field is genuinely new: `narration_words_per_second`, used by the packing algorithm below to estimate how long a beat's dialogue takes to speak. Do **not** add a separate "target duration" field — `max_scene_duration_seconds` is already the single number the user needs to set: the real hard limit of whatever video tool is in use (8 for Veo Omni Flash today; potentially 15/20/30 with another tool later). In the Settings "Video" section, relabel that field **"Scene duration (seconds)"** with helper text: *"The maximum length your video generation tool can produce per call. Scene breakdown packs narration beats to fill this duration automatically."* Add `narration_words_per_second` as a secondary field labeled **"Narration pace (words/sec)"**, helper text explaining it's used to estimate spoken length.

## 2. `apps/server/src/context.ts` — Codex returns beats, not pre-grouped scenes

Add the new reference file to the existing `readSharedRules` call in the `GENERATE_SCENES` branch, and add the same call (currently missing) to the regenerate branch, so single-scene regeneration also follows the structured format:

```ts
await this.readSharedRules(["visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"], sharedFiles);
```

Replace the `GENERATE_SCENES` output contract:

```ts
"Return a JSON array of narrative beats covering the full script, in order — not pre-grouped scenes and not pre-computed durations. Each beat: { dialogue: one self-contained narration idea, visual_prompt: a single shot's CAMERA/ACTION/LIGHTING/ATMOSPHERE description per cinematic_prompt_reference.md (no SHOT PLAN or timecodes — that is assembled automatically), continuity_key: a short slug shared by this beat and any adjacent beats that depict the same visual continuity (same era, place, subjects) and could be shot back-to-back in one generation call, transition_note, continuity_note }. Do not group beats or estimate their duration — the system packs beats into scenes automatically based on estimated narration length and continuity_key. Do not write files."
```

`continuity_key` is the one piece of judgment Codex still exercises — a creative decision ("do these beats happen in the same place/moment"), not arithmetic, so an LLM is well-suited to it. `visual_prompt` per beat is just the single-shot block from `cinematic_prompt_reference.md` — no `SHOT PLAN`/`HARD CUT`; the server only adds that when it actually merges beats (Step 3), so Codex never has to guess timecodes.

Update the regenerate branch's output contract to require the same structured single-shot format (CAMERA/ACTION/LIGHTING/ATMOSPHERE/CONTINUITY per `cinematic_prompt_reference.md`) so a regenerated scene never falls back to an unstructured paragraph either — regeneration still operates on one already-packed `Scene`, not raw beats, so no other change is needed there.

## 3. `apps/server/src/tasks.ts` — deterministic packing

Replace the `GENERATE_SCENES` completion line:

```ts
// before
const scenes = normalizeSceneDurations(parseScenesOutput(output, task.episode_id!), this.maxSceneDuration);

// after
const beats = parseBeatsOutput(output, task.episode_id!);
const scenes = packBeatsIntoScenes(beats, this.maxSceneDuration, this.config.video_generation.narration_words_per_second);
```

`parseBeatsOutput` mirrors the existing `parseScenesOutput` shape but reads `{ dialogue, visual_prompt, continuity_key, transition_note, continuity_note }` per item — no `duration_seconds` expected from Codex.

```ts
type Beat = { dialogue: string; visual_prompt: string; continuity_key: string; transition_note: string; continuity_note: string };
type PackedBeat = Beat & { estSeconds: number };

function estimateSpokenSeconds(dialogue: string, wordsPerSecond: number): number {
  const words = dialogue.trim().split(/\s+/).filter(Boolean).length;
  return words / Math.max(0.1, wordsPerSecond);
}

function packBeatsIntoScenes(beats: Beat[], maxDuration: number, wordsPerSecond: number): Scene[] {
  const groups: PackedBeat[][] = [];
  let current: PackedBeat[] = [];
  let currentSeconds = 0;
  let currentKey: string | null = null;

  for (const beat of beats) {
    const est = estimateSpokenSeconds(beat.dialogue, wordsPerSecond);

    if (est > maxDuration) {
      // a single beat alone exceeds the limit — split it on its own, same fallback normalizeSceneDurations used
      if (current.length) { groups.push(current); current = []; currentSeconds = 0; currentKey = null; }
      const chunks = splitDialogue(beat.dialogue, Math.ceil(est / maxDuration));
      for (const chunk of chunks) {
        groups.push([{ ...beat, dialogue: chunk, estSeconds: Math.min(maxDuration, estimateSpokenSeconds(chunk, wordsPerSecond)) }]);
      }
      continue;
    }

    const fitsContinuity = currentKey === null || currentKey === beat.continuity_key;
    const fitsDuration = currentSeconds + est <= maxDuration;
    if (fitsContinuity && fitsDuration) {
      current.push({ ...beat, estSeconds: est });
      currentSeconds += est;
      currentKey = beat.continuity_key;
    } else {
      if (current.length) groups.push(current);
      current = [{ ...beat, estSeconds: est }];
      currentSeconds = est;
      currentKey = beat.continuity_key;
    }
  }
  if (current.length) groups.push(current);

  return groups.map((group, index) => finalizeScene(group, index + 1));
}

function finalizeScene(group: PackedBeat[], sceneNumber: number): Scene {
  const totalSeconds = Math.max(2, group.reduce((sum, b) => sum + b.estSeconds, 0));
  return {
    scene_id: `scene_${sceneNumber}`, // keep whatever `${episodeId}_scene_${n}` convention parseScenesOutput used
    scene_number: sceneNumber,
    duration_seconds: Math.round(totalSeconds * 2) / 2, // nearest 0.5s
    dialogue: group.map((b) => b.dialogue).join(" "),
    visual_prompt: composePackedVisualPrompt(group),
    transition_note: group[group.length - 1].transition_note,
    continuity_note: group[0].continuity_note,
    audio_asset_path: null,
    audio_generated_at: null,
    audio_duration_seconds: null,
  } as Scene;
}

function composePackedVisualPrompt(group: PackedBeat[]): string {
  if (group.length === 1) return group[0].visual_prompt;
  let cursor = 0;
  const timeline: string[] = [`SHOT PLAN (${group.reduce((s, b) => s + b.estSeconds, 0).toFixed(1)}s total)`];
  group.forEach((beat, i) => {
    const start = cursor, end = cursor + beat.estSeconds;
    timeline.push(`${start.toFixed(1)}s-${end.toFixed(1)}s — shot ${i + 1}`);
    if (i < group.length - 1) timeline.push(`${end.toFixed(1)}s HARD CUT`);
    cursor = end;
  });
  const details = group.map((beat, i) => `Shot ${i + 1} detail:\n${beat.visual_prompt}`);
  const continuity = group.map((b) => b.continuity_note).filter(Boolean).join(" ")
    || "Maintain identical era, subject, and lighting across all shots in this scene.";
  return [...timeline, "", ...details, "", "CONTINUITY", continuity].join("\n");
}
```

`splitDialogue` is reused as-is for the single-beat-too-long fallback. `normalizeSceneDurations` becomes dead code for `GENERATE_SCENES`; confirm nothing else calls it before removing it.

## 4. Merge-with-next — optional manual override, not a correctness mechanism

New route in `apps/server/src/app.ts`, next to the existing scene/audio routes:

```
POST /api/channels/:channelId/episodes/:episodeId/scenes/:sceneNumber/merge-next
```

Server logic:
- Reject if `sceneNumber` is the last scene, or the next scene doesn't exist.
- Reject with `409` if `scene[n].duration_seconds + scene[n+1].duration_seconds > max_scene_duration_seconds`, message: `"Merged duration would exceed the {max}s scene limit."`
- On success, combine the two into one scene: concatenate `dialogue`; combine `visual_prompt` into a `SHOT PLAN` with a `HARD CUT` at `scene[n].duration_seconds` (reuse `composePackedVisualPrompt`-style assembly, treating each existing scene's prompt as one shot's detail); sum `duration_seconds`; `transition_note` from scene[n+1]; `continuity_note` from scene[n]; clear `audio_asset_path`/`audio_generated_at`/`audio_duration_seconds` on the merged scene (stale-audio rule from `06_AUDIO_INTEGRATION.md`).
- Renumber subsequent scenes down by one, save via `repository.saveScenes`, return the updated list.

Since packing is now automatic and correct by construction, this button exists only for when the user disagrees with the AI's `continuity_key` grouping and wants a different combination than what was generated — label it in the UI as **"Combine with next scene"** with a tooltip like *"Override the automatic grouping"*, not as a step needed to fix durations.

## 5. UI — `apps/web/src/components/SceneCard.tsx`

- Add a small estimated-duration readout next to the Duration input, computed client-side with the same formula as `estimateSpokenSeconds` (share the ~3-line utility between `apps/web` and `apps/server`, or duplicate it): `~{seconds}s narration` in `--muted` text. Since duration is now derived from this exact estimate server-side, it will normally read as an near-exact match — this is confirmation, not a warning.
- Add a `[Combine with next]` icon button next to `[Regenerate]`, shown only when the scene isn't the last one; disabled with a tooltip when the combined duration would exceed `max_scene_duration_seconds`. Calls the merge route; refreshes the scene list on success.
- Change `.scene-block textarea` from a fixed `min-height: 164px` to `min-height: 80px` with content-based auto-grow, so a shorter (but legitimately intentional) scene doesn't render as a mostly-empty box.

## 6. Applying this to already-generated episodes

This changes generation logic, not existing files. To apply it to an episode that already has scenes, re-run `[Create Scene Breakdown]` (replaces the whole scene list — keep a confirmation dialog before doing so, since it also discards any generated audio for those scenes).

## Acceptance criteria

- A freshly generated scene breakdown never needs manual merging to reach reasonable duration usage — `duration_seconds` on every scene reflects the actual packed beats' estimated spoken length, computed by code, not asserted by Codex.
- Beats with different `continuity_key`s are never packed together, even when there's remaining time budget in the current scene.
- A single beat whose dialogue alone exceeds `max_scene_duration_seconds` is still handled (split via `splitDialogue`) without failing the task.
- Multi-beat scenes produce a `visual_prompt` with a correctly computed `SHOT PLAN`/`HARD CUT` timeline whose timecodes sum exactly to `duration_seconds`.
- The same `visual_prompt` text is usable as-is in either Seedance or Veo Omni Flash — no `@tag`, voice-lock, or other platform-specific syntax appears anywhere in generated prompts.
- `[Combine with next]` still works for manual overrides but is never required for ordinary output.
- Changing "Scene duration (seconds)" or "Narration pace (words/sec)" in Settings changes the packing outcome of the next `GENERATE_SCENES` run with no other action required.
- Scene cards with legitimately short dialogue no longer show a large block of empty space disproportionate to their content.
