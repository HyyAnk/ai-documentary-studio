# Episode workflow

The supported flow is:

```text
candidate topics → confirm one → brief.md → script.md → scene_plan.md
```

Suggestion is preview-only and always returns exactly five candidates. Confirming one creates the episode directory and copies the selected topic into `episode.json` and `brief.md`. Unselected candidates remain in topic history so future suggestions can avoid repeats.

Scenes are stored in readable Markdown plus derived dialogue and prompt files. Manual edits write files directly. Regeneration backs up the scene plan before replacing the selected scene.

## Scene audio

After a scene breakdown exists, use `Generate Audio` inside that scene's Dialogue / Narration block. The action queues one `GENERATE_AUDIO` task for that scene, runs through the local Chatterbox sidecar, and adds a native audio player when the WAV is ready. Audio generation is per-scene in this phase; there is no episode-level batch action.

If a scene's dialogue changes manually or through `REGENERATE_DIALOGUE` / `REGENERATE_BOTH`, the repository clears `audio_asset_path`, `audio_generated_at`, and `audio_duration_seconds` before saving. Regenerating only the visual prompt keeps existing audio. This prevents a player from representing text that is no longer current.

The dashboard compares the generated WAV duration with the configured scene duration. When the difference exceeds one second or 15 percent, whichever is larger, it shows a warning and a manual `Match duration` action. The duration is never changed silently. Audio can be regenerated to replace the player without a page reload.
