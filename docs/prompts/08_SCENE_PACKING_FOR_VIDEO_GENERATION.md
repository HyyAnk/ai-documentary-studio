# SCENE PACKING FOR VIDEO GENERATION — REDUCE UNNECESSARY FRAGMENTATION

Grounded in the current repo: `shared/visual_rules.md`, `shared/prompt_rules.md`, `templates/example_scene.md`, `apps/server/src/context.ts` (`GENERATE_SCENES` branch), `apps/server/src/tasks.ts` (`normalizeSceneDurations`), `packages/shared/src/index.ts` (`AppConfigSchema.video_generation`).

## Problem

`shared/visual_rules.md` currently says *"One coherent visual idea per scene"* and `shared/prompt_rules.md` says *"Do not combine unrelated events in one shot."* Combined with an output contract that only enforces an upper bound (*"Keep each duration at or below the configured maximum"*), Codex has no incentive to pack story beats together — it creates a new scene for every beat, producing many small scenes (2s, 5s, 8s...) instead of denser ones. Each scene is one video-generation call; unnecessary scene count directly multiplies video/audio generation calls and cost/time.

Google Veo Omni Flash generates up to **8 seconds per call** and can itself contain **multiple internal cuts** within that one generation — so a single call can cover several short beats if the prompt describes them as sequential shots. The fix is almost entirely a **prompt/rules change**, not an architecture change.

## 1. Config additions (`packages/shared/src/index.ts`, `AppConfigSchema.video_generation`)

```ts
video_generation: z.object({
  provider: z.string().default("none"),
  model: z.string().default(""),
  max_scene_duration_seconds: z.number().positive().default(8),
  target_scene_duration_seconds: z.number().positive().default(8),   // new
  min_scene_duration_seconds: z.number().positive().default(4),      // new
  default_scene_duration_seconds: z.number().positive().default(6),
  aspect_ratio: z.string().default("16:9"),
}),
```

- `target_scene_duration_seconds` — the packing goal: Codex should combine adjacent beats until a scene is close to this length, not stop at the first coherent idea.
- `min_scene_duration_seconds` — a soft floor so isolated tiny scenes aren't created just because a beat happened to be short; combine it with a neighboring beat instead, unless it's genuinely the episode's final wrap-up moment.
- `max_scene_duration_seconds` stays the hard cap (matches the provider's real limit, e.g. 8s for Veo Omni Flash) — `normalizeSceneDurations` in `tasks.ts` remains the safety net for anything that still exceeds it and needs no changes.
- Update the "Video" section of the Settings panel to expose the two new fields alongside the existing ones.

## 2. Rewrite `shared/visual_rules.md`

Replace the current three bullets with packing-aware guidance:

```markdown
# Visual Rules

- Pack multiple adjacent story beats into one scene whenever they share era, place, and visual continuity — aim for each scene to reach close to the target duration, not the shortest coherent idea.
- Only start a new scene when the maximum duration would be exceeded, or a genuine narrative/topic boundary occurs (new location, new time period, new subject).
- Within one scene, sequence beats as separate shots inside the same Video Prompt using the CUT format (see prompt_rules.md) rather than splitting them into separate scenes.
- Keep era, subject, place, lens, and lighting continuity explicit across shots within a scene.
- Prefer documentary specificity over generic cinematic adjectives.
```

## 3. Rewrite `shared/prompt_rules.md`

Introduce the CUT-delimited multi-shot format for `visual_prompt`:

```markdown
# Prompt Rules

- A scene's Video Prompt may describe more than one shot when several beats are packed into it. Separate shots with a line containing only `CUT`.
- Each shot describes: subject, environment, era, action, camera, composition, lighting, atmosphere, motion, style.
- End the prompt with one shared continuity line covering era/style/lighting consistency across all shots in the scene, if more than one shot is present.
- Keep API parameters out of natural-language prompts.
- Do not combine genuinely unrelated events (different era, different location, different subject) into one shot or one scene — pack only beats that belong together.

Example (one ~8s scene containing three quick shots):

Wide shot of a 1970s research lab at night, fluorescent lights humming, engineers hunched over blueprints, 35mm film grain, slow dolly in.
CUT
Close-up of hands adjusting a prototype circuit board, warm desk lamp light, shallow depth of field, static camera.
CUT
Medium shot of an engineer stepping back, exhaling, glancing at a wall clock reading 3 AM, same lighting, slight handheld sway.
Continuity: same lab, same 1970s color palette and film grain across all three shots.
```

## 4. Update `templates/example_scene.md`

Change the example to demonstrate a packed, multi-cut scene (not a single-idea 6s scene), so the template itself teaches the desired density:

```markdown
# Scene 1

**Duration:** 8 seconds

## Dialogue

Narration covering two or three adjacent beats, timed to roughly 8 seconds of speech.

## Video Prompt

Shot 1 description...
CUT
Shot 2 description...
CUT
Shot 3 description...
Continuity: ...

## Notes

- Transition:
- Continuity:
```

## 5. Update `apps/server/src/context.ts` — `GENERATE_SCENES` output contract

Change the current output contract string:

```ts
// before
"Return a JSON array of scenes with duration_seconds, dialogue, visual_prompt, transition_note, and continuity_note. Keep each duration at or below the configured maximum. Do not write files."

// after
"Return a JSON array of scenes with duration_seconds, dialogue, visual_prompt, transition_note, and continuity_note. Pack adjacent beats into each scene, aiming for target_scene_duration_seconds and never exceeding max_scene_duration_seconds; avoid scenes below min_scene_duration_seconds unless it is the episode's final beat. When a scene covers multiple beats, separate them as shots in visual_prompt using a line containing only CUT, per prompt_rules.md. Do not write files."
```

The `.documentary-studio/config.json` snapshot is already included wholesale in this task's context (see the existing `add({ path: ".documentary-studio/config.json", ... })` call) — once the two new fields exist in config, Codex automatically receives them with no further context-engine changes needed.

## 6. UI — shot count badge (no schema change needed)

In `SceneCard`, compute a shot count client-side by splitting `visual_prompt` on lines that contain only `CUT` (`prompt.split(/^\s*CUT\s*$/m).length`) and show a small badge next to the duration, e.g. `8s · 3 cuts`. This is purely derived from existing text — no `Scene` schema change required.

## 7. Applying this to already-generated episodes

This is a rules/prompt change only; it does not retroactively fix scenes an episode already has. To apply the new packing behavior to an existing episode, the user re-runs `[Create Scene Breakdown]` (`GENERATE_SCENES`), which replaces the entire `scene_plan.md`/scene list for that episode. Surface a confirmation dialog before this action if the episode already has scenes ("This replaces all N existing scenes and any generated audio for them — continue?"), since existing per-scene audio (`audio_asset_path`) would need regeneration afterward. No automatic partial-merge of old and new scenes — regenerating scene breakdown is all-or-nothing, consistent with how it already works today.

## Acceptance criteria

- A freshly generated scene breakdown for a typical script produces noticeably fewer scenes than before, most landing near `target_scene_duration_seconds`, with very few (ideally none) below `min_scene_duration_seconds` except a legitimate final beat.
- Scenes covering multiple beats show `CUT`-delimited shots in `visual_prompt`, each shot individually well-formed per the prompt rules, with a shared continuity line when more than one shot is present.
- The Settings UI exposes `target_scene_duration_seconds` and `min_scene_duration_seconds`, and changes persist to `.documentary-studio/config.json`.
- `SceneCard` shows an accurate "N cuts" badge for scenes with multiple shots and no badge (or "1 cut") for single-shot scenes.
- Re-running `[Create Scene Breakdown]` on an existing episode prompts for confirmation before replacing the current scene list.
- No change to `Scene`, `Episode`, or `Task` schemas is required for this feature.
