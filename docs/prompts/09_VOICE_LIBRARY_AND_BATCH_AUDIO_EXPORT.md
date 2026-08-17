# VOICE LIBRARY & BATCH AUDIO EXPORT

Grounded in the current repo: `packages/shared/src/index.ts` (`Channel.voice_reference_path`, `AudioSettingsInputSchema`, `VoiceReferenceUploadSchema`), `apps/server/src/repository.ts` (`saveVoiceReference`, `writeSceneAudio`, `getSceneAudioFile`, `assertRealPathInside`), `apps/server/src/tasks.ts` (`TaskManager.submit`, per-episode `lock_key`, separate `GENERATE_AUDIO` concurrency pool), `apps/server/src/providers/chatterbox.ts`, `services/tts/app.py`.

Today a channel has exactly one `voice_reference_path`, set by uploading a WAV directly via `PUT /api/channels/:channelId/voice-reference` — no way to browse, preview, or reuse voices across channels. This adds a proper voice library, then adds batch generate/download for episode audio.

## Part A — Voice Library

### A.1 Storage

New global (cross-channel) location, following the existing `.documentary-studio/` runtime-state convention:

```
.documentary-studio/
└── voices/
    ├── voices.json                 # index of VoiceProfile records
    └── <voice_id>/
        ├── reference.wav           # the uploaded cloning reference clip
        └── sample.wav              # auto-generated preview line, cached
```

### A.2 Schema (`packages/shared/src/index.ts`)

```ts
export const VoiceProfileSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().min(1).max(80),
  reference_path: z.string().min(1),
  sample_path: z.string().min(1),
  created_at: IsoDate,
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const CreateVoiceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  data: z.string().min(1).max(50_000_000), // base64 WAV, same convention as VoiceReferenceUploadSchema
});
```

No change to `ChannelSchema` — it keeps using its existing nullable `voice_reference_path: string`. Assigning a library voice to a channel just resolves the profile's `reference_path` and writes it into that same existing field via the existing `updateChannel()` path.

### A.3 API (`apps/server/src/app.ts`)

- `GET /api/voices` → `{ voices: VoiceProfile[] }`
- `POST /api/voices` → body `CreateVoiceInputSchema`. Validate the WAV header exactly like the existing `voice-reference` route already does. Save `reference.wav`, then synthesize a fixed preview line (e.g. *"This is a preview of this narrator voice for AI Documentary Studio."*) through `ChatterboxProvider`/the `/synthesize` endpoint using the new reference, and save the result as `sample.wav`. Append the new `VoiceProfile` to `voices.json`. Returns the created profile.
- `DELETE /api/voices/:voiceId` → reject with a clear error if any channel currently has `voice_reference_path` pointing at this profile's `reference_path` ("Voice is in use by N channel(s)"), mirroring the project's existing caution around not silently deleting things in use (same spirit as `ARCHIVED` channels not being deletable by accident).
- `PUT /api/channels/:channelId/voice` → body `{ voice_id: string | null }`. Resolves the profile (or `null` for the built-in default voice) and calls the existing channel update path to set `voice_reference_path` accordingly.
- Keep `PUT /api/channels/:channelId/voice-reference` working, but change its implementation to internally create a `VoiceProfile` named after the channel (e.g. `"<Channel Name> (uploaded)"`) and assign it — so every voice, however it enters the system, ends up in the one browsable library. This avoids two divergent storage paths for the same kind of asset.

### A.4 UI

- New "Voices" section in Settings: a list of voice cards (name, a `[▶ Preview]` button that plays `sample.wav` via a plain `<audio>` element, `[Delete]`), plus `[+ Add Voice]` (name + WAV upload, calls `POST /api/voices`).
- On each channel's settings/DNA panel, replace the current single-upload control with a `<select>` (or searchable dropdown) populated from `GET /api/voices`, with a **"Default (built-in)"** option representing `voice_id: null`, and an inline `[▶ Preview]` next to the current selection. Changing the selection calls `PUT /api/channels/:channelId/voice`.
- Uploading a brand-new voice directly from the channel panel remains possible — it just now goes through `POST /api/voices` followed by `PUT /api/channels/:channelId/voice`, so it also appears in the shared library afterward.

## Part B — Generate All & Download All (episode audio)

### B.1 Generate All

- New route: `POST /api/channels/:channelId/episodes/:episodeId/audio/generate-all` → body `{ force?: boolean }`.
  - Reads all scenes for the episode. For each scene where `audio_asset_path` is `null` (or, if `force: true`, every scene regardless), calls the existing `tasks.submit("GENERATE_AUDIO", channelId, episodeId, scene.scene_number)`.
  - Because `GENERATE_AUDIO` tasks already share `lock_key = episode_id`, submitting many at once is safe — they queue and run one at a time for this episode via the existing lock/pump logic in `tasks.ts`; no new concurrency logic is needed here.
  - Returns the list of created/queued tasks.
- UI: a `[Generate All Audio]` button above the scene list (e.g. in the Scene Breakdown header). While tasks are in flight, show aggregate progress by counting `GENERATE_AUDIO` tasks for this episode across `QUEUED`/`RUNNING`/`COMPLETED` (e.g. *"Generating audio: 3 / 8 scenes"*), reusing the existing task-event stream already wired up for per-scene `InlineTaskState`.

### B.2 Download All — two modes

Add a small control near `[Generate All Audio]`: a switch or dropdown with two options, **"Separate files (.zip)"** and **"Merged single file (.wav)"**, plus a `[Download]` button that fires the request for whichever mode is selected.

- `GET /api/channels/:channelId/episodes/:episodeId/audio/download?mode=separate`
  - Streams a ZIP (`archiver` npm package) containing every scene that currently has audio, named `scene-01.wav`, `scene-02.wav`, … in scene order. Scenes without audio are simply omitted — this mode works with partial audio.
  - Filename: `<episode-slug>-audio-scenes.zip`.
- `GET /api/channels/:channelId/episodes/:episodeId/audio/download?mode=merged`
  - Requires every scene to have audio; if any are missing, return a `409` with the list of missing scene numbers so the UI can show *"Scenes 4 and 7 have no audio yet"* instead of silently producing a broken file.
  - Node resolves the absolute, sanitized path for each scene's WAV (reusing the same `assertRealPathInside`-validated resolution `getSceneAudioFile` already does) and POSTs the ordered list of absolute paths plus the configured gap to the TTS sidecar's new merge endpoint, then streams the response back.
  - Filename: `<episode-slug>-audio-full.wav`.

### B.3 Merge endpoint (`services/tts/app.py`)

- `POST /merge` — body `{ paths: string[], gap_ms: number }` → concatenates the WAV files in `pydub` (or `soundfile`/`numpy`) in the given order, inserting `gap_ms` of silence between consecutive clips, and returns the merged `audio/wav` bytes. `gap_ms: 0` produces seamless concatenation.
- All files are expected to share sample rate/channel count since they all come from the same Chatterbox configuration — if a mismatch is ever detected, resample to the first file's format rather than failing.

### B.4 Config addition

```ts
audio_generation: z.object({
  // ...existing fields
  merge_gap_ms: z.number().int().nonnegative().default(300), // silence between scenes when merging; 0 = seamless
}),
```

Expose this as a field in the Settings "Audio" section next to `exaggeration`/`cfg_weight`.

## Acceptance criteria

- Settings → Voices shows every uploaded voice, each previewable by clicking play without generating new audio (plays the cached `sample.wav`).
- Assigning a voice to a channel from the dropdown persists and is used by the next `GENERATE_AUDIO` task for that channel's episodes.
- Deleting a voice currently assigned to a channel is blocked with a clear message; deleting an unused voice succeeds.
- `[Generate All Audio]` on an episode queues audio generation for every scene missing audio (or all scenes with `force: true`), visibly serialized one at a time for that episode, with running aggregate progress shown.
- Download in "Separate files" mode always succeeds and includes whatever scene audio currently exists.
- Download in "Merged single file" mode either produces one continuous WAV in correct scene order with the configured gap, or clearly reports which scenes are still missing audio instead of producing a partial/broken file.
- Changing `merge_gap_ms` in Settings changes the gap in the next merged download without requiring regeneration of any scene audio.
