# AUDIO INTEGRATION — SCENE-LEVEL TEXT-TO-SPEECH (Chatterbox)

This extends the existing implementation at `HyyAnk/ai-documentary-studio`. It assumes the current code exactly as built: `packages/shared/src/index.ts` (Zod schemas), `apps/server/src/{app.ts,tasks.ts,repository.ts,providers/index.ts,config.ts}`, `apps/web/src/App.tsx` (`SceneCard` component). Read those files before making changes — this document tells you what to add and where, not a full rewrite.

## Goal

Add local text-to-speech for scene dialogue using **Chatterbox** (Resemble AI, MIT license, `github.com/resemble-ai/chatterbox`), playable **inline right next to the Dialogue block** in `SceneCard`. This is a deterministic local model call, not an LLM generation task — it must never go through Codex.

## 1. TTS microservice (new, Python, sidecar process)

Chatterbox is a Python package; do not try to run it inside the Node/Fastify server.

- New folder: `services/tts/`
  - `services/tts/app.py` — FastAPI app, loads Chatterbox once at module scope (never per-request — model load is slow)
    - `POST /synthesize` — body `{ text: string, voice_reference_path?: string, exaggeration?: number, cfg_weight?: number }` → returns raw `audio/wav` bytes
    - `GET /health` → `{ status: "ok", model_loaded: boolean }`
  - `services/tts/requirements.txt` — `chatterbox-tts`, `fastapi`, `uvicorn`
- Document in `docs/setup.md`: `pip install -r services/tts/requirements.txt`, then `uvicorn app:app --port 8890` from `services/tts/`. Optionally add a `pnpm dev:tts` script that shells out to it, and a note in `run dashboard.bat`.
- The Node server talks to this service only over local HTTP — it never imports Python packages directly, keeping the security boundary in `docs/architecture.md` intact.

## 2. Provider implementation

- New file: `apps/server/src/providers/chatterbox.ts`, implementing the existing `AudioProvider` interface from `apps/server/src/providers/index.ts` **unchanged**:
  ```ts
  export interface AudioProvider {
    generateDialogue(dialogue: string, voice: string): Promise<{ asset_path: string }>;
  }
  ```
- `generateDialogue` POSTs to `audio_generation.service_url`, receives WAV bytes, writes the file into `channels/<slug>/episodes/<slug>/assets/scene-<NN>.wav` **using the same path-sanitization helpers `repository.ts` already uses** (`assertRealPathInside`, the existing slug/path rules) — do not write files by any other route.
- On a network/service failure, throw a typed error that the task runner maps to a plain-language message ("Audio service unavailable"), same pattern as the existing Codex-unavailable handling.

## 3. Schema changes — `packages/shared/src/index.ts`

```ts
// SceneSchema: add these three fields
audio_asset_path: z.string().nullable().default(null),
audio_generated_at: IsoDate.nullable().default(null),
audio_duration_seconds: z.number().nonnegative().nullable().default(null),

// ChannelSchema: add
voice_reference_path: z.string().nullable().default(null),
// optional per-channel reference clip for consistent narrator voice
// via Chatterbox zero-shot cloning — a natural extension of Channel DNA identity

// TaskTypeSchema: add "GENERATE_AUDIO" to the enum

// AppConfigSchema: add a sibling block to video_generation/codex
audio_generation: z.object({
  provider: z.string().default("chatterbox"),
  service_url: z.string().default("http://127.0.0.1:8890"),
  exaggeration: z.number().min(0).max(1).default(0.5),
  cfg_weight: z.number().min(0).max(1).default(0.5),
  max_concurrent_tasks: z.number().int().positive().default(2),
}),
```

Update `apps/server/src/config.ts` `DEFAULT_CONFIG` to include the new `audio_generation` block, following the same merge pattern already used for `video_generation`/`codex`.

## 4. Stale-audio invalidation rule (important correctness rule)

Whenever `scene.dialogue` changes — manual edit, `REGENERATE_DIALOGUE`, or `REGENERATE_BOTH` — clear that scene's `audio_asset_path`, `audio_generated_at`, and `audio_duration_seconds` before saving. The UI must never show a Play button for audio that no longer matches the current dialogue text. `REGENERATE_PROMPT` alone must leave the audio fields untouched. Apply this both in `repository.saveScenes` (manual edits from the UI) and in `tasks.ts`'s `completeWithOutput` regeneration branch.

## 5. Task execution — `apps/server/src/tasks.ts`

`GENERATE_AUDIO` tasks must **not** go through `codex.connect()` / `startThread()` / `startTurn()`. Add a separate branch (e.g. `runAudioTask()`) invoked from `run()` based on `task.task_type`:

- `lock_key = episode_id` — same per-episode lock already used for scene tasks, so an audio job can't race a dialogue regenerate on the same scene.
- **Separate concurrency pool**, sized by `audio_generation.max_concurrent_tasks`, tracked independently from the existing `runningCount`/`maxConcurrent` (which governs Codex turns). An audio job must not consume a Codex concurrency slot, and a busy Codex queue must not block audio generation. This means `pump()` needs two independent counters/queues (or one generalized dispatcher keyed by task category), not a single shared one.
- No `contextEngine.build()` call — this task type never touches Codex context at all.
- Steps: load the target scene by `scene_number`, call `chatterboxProvider.generateDialogue(scene.dialogue, channel.voice_reference_path ?? "default")`, on success update the scene's three new fields, `finish(task, "COMPLETED", null, [audio_asset_path])`.
- Reuse the existing `TaskStatus`/`progress_message` fields as-is so `InlineTaskState` and `TaskProgressPanel` in the UI work without modification.

## 6. New API routes — `apps/server/src/app.ts`

- `POST /api/channels/:channelId/episodes/:episodeId/scenes/:sceneNumber/audio` — submits a `GENERATE_AUDIO` task, same response shape as the existing `POST /api/tasks` (`202` + `{ task }`).
- `GET /api/channels/:channelId/episodes/:episodeId/assets/:filename` — streams the WAV with `Content-Type: audio/wav` and **HTTP Range support** (`206 Partial Content`). The native `<audio>` element needs Range requests to scrub/seek — without it playback works but the seek bar won't. Validate `filename` through the same path-sanitization helper as every other file route; never trust the raw segment.

## 7. UI — `apps/web/src/App.tsx`, `SceneCard`

`SceneCard` currently renders two `.scene-block` columns (Dialogue, Video prompt), each with a `.block-heading` containing a `[Copy]` button. Add the audio control **inside the Dialogue block's `.block-heading`**, next to `[Copy]`:

- No audio yet → `[Generate Audio]` button (speaker/waveform icon). Calls the new endpoint; while active, look up the task the same way the existing code does for regenerate (`latestTask(episodeTasks, ["GENERATE_AUDIO"], scene.scene_number)`) and render `InlineTaskState`.
- Audio present → a compact `<audio controls src={...} />` directly under the block heading (native player — no custom waveform needed for v1), plus a small `[Regenerate Audio]` icon button next to it.
- Append a cache-busting query param to the audio `src`, e.g. `?v=${scene.audio_generated_at}`, so the browser doesn't keep playing a stale cached clip after regeneration.
- Disable the audio controls while `regenerating` (existing flag) or while a `GENERATE_AUDIO` task is active for that scene — same disabling pattern already used for the textarea.
- No episode-level "generate all audio" batch button in this pass — keep scope per-scene, matching how dialogue/prompt regeneration already works. Batch generation can be a clearly separate later addition.

## 8. Settings panel

Add an "Audio" section alongside the existing Codex/video settings: `service_url`, `exaggeration`/`cfg_weight` controls, and a per-channel voice-reference upload (saved to `channels/<slug>/assets/voice_reference.wav`, referenced by `channel.voice_reference_path`). Keep it optional — Chatterbox works with a default voice with no reference clip supplied.

## Acceptance criteria

- With the TTS microservice running, `[Generate Audio]` on a scene produces a playable WAV inline next to that scene's dialogue, without any Codex call (verify via the task record: no `codex_thread_id`/`codex_turn_id` set).
- Editing a scene's dialogue (manually, or via `REGENERATE_DIALOGUE`/`REGENERATE_BOTH`) clears that scene's audio fields and hides the player until audio is regenerated. `REGENERATE_PROMPT` alone does not touch audio.
- Generating audio for scenes in two different episodes runs concurrently; two audio jobs in the *same* episode serialize behind the episode lock.
- A running audio job does not reduce the number of concurrently available Codex task slots, and a busy Codex queue does not delay audio generation.
- If the TTS microservice is unreachable, the UI shows "Audio service unavailable" with a retry action — no raw stack trace, matching the existing Codex-unavailable UX.
- Regenerating audio replaces the player's content (cache-busted) without a full page reload.
- A channel with `voice_reference_path` set produces cloned-voice audio; a channel without one uses the default voice without erroring.
