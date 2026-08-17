# UI REFACTOR & POLISH — FOLLOW-UP TO AUDIO INTEGRATION

This is a companion to `06_AUDIO_INTEGRATION.md`. Do this work as its own reviewable step — ideally the component split lands *before* the audio UI changes, so the audio diff stays small and readable instead of growing an already-large `App.tsx`.

## 1. Split `apps/web/src/App.tsx` into components

The file is currently a single ~60K monolith containing every screen and subcomponent (`SceneCard`, `TaskTableRow`, panels, etc.). This is a pure structural refactor — **no behavior change**, no prop-shape change, no renamed API calls. Target layout:

```
apps/web/src/
├── App.tsx                    # top-level routing/state composition only
├── api.ts                     # unchanged
├── components/
│   ├── ChannelList.tsx
│   ├── ChannelView.tsx        # DNA editor, topic suggestions, episodes list
│   ├── TopicPanel.tsx
│   ├── EpisodeView.tsx        # script + scene breakdown container
│   ├── SceneCard.tsx          # incl. the new audio controls from 06
│   ├── TaskPanel.tsx
│   ├── TaskTableRow.tsx
│   ├── TaskProgressPanel.tsx
│   ├── InlineTaskState.tsx
│   ├── SettingsPanel.tsx      # incl. the new Audio settings section from 06
│   └── EmptyState.tsx
└── hooks/
    ├── useChannels.ts
    ├── useEpisode.ts
    └── useTasks.ts
```

Rules:
- Move code as-is; do not "improve" logic while moving it — refactor and feature work should not be mixed in the same diff.
- Each component keeps its own explicit prop types (already present inline — just relocate them beside their component).
- Shared helpers (`formatTaskType`, `formatDate`, `latestTask`, `isTaskActive`, etc.) go in a `lib/` or `utils.ts` file, imported by whichever components need them — do not duplicate.
- `styles.css` stays as one file for now; splitting CSS is out of scope here.

## 2. Scene duration vs. audio duration mismatch warning

Once `GENERATE_AUDIO` completes and `scene.audio_duration_seconds` is known, `SceneCard` should compare it against `scene.duration_seconds`:

- If the difference exceeds a small tolerance (e.g. more than 1 second or more than 15%, whichever is larger), show a compact inline warning badge near the Duration input — e.g. "Audio is 3.2s longer than the set duration."
- Include a `[Match duration]` button next to the badge that sets `duration_seconds` to the rounded `audio_duration_seconds` (clamped to `max_scene_duration_seconds` from config). This is a manual action, one click — **never auto-apply silently**, since the user may have intentionally set a shorter duration for pacing.
- The badge disappears once durations are within tolerance, or once audio is cleared (per the stale-audio rule in `06_AUDIO_INTEGRATION.md`).
- This check runs entirely client-side from data already on the `Scene` object — no new API call needed.

## 3. Explicit non-goals for this phase

State these directly so scope doesn't silently creep while doing the refactor or the audio work:

- No custom waveform rendering — the native `<audio controls>` element is sufficient.
- No episode-level "generate all audio" batch action.
- No audio trimming, splicing, or in-app editing UI.
- No automatic duration adjustment without an explicit user click.

Any of these can be proposed later as a separate, clearly scoped addition — they should not appear as side effects of this work.

## 4. Documentation sync

Update existing docs to match the implemented architecture (the project's own principle is that documentation must reflect the real repo, not the other way around):

- `docs/architecture.md` — add the `audio_generation` config block and the separate audio concurrency pool.
- `docs/provider-system.md` — document the `ChatterboxProvider` implementation of `AudioProvider`, and the `services/tts/` sidecar.
- `docs/episode-workflow.md` — mention the inline "Generate Audio" step next to scene dialogue, and the stale-audio invalidation rule.
- `docs/setup.md` — add the Python sidecar setup steps (`pip install -r services/tts/requirements.txt`, `uvicorn app:app --port 8890`).

## Acceptance criteria

- `App.tsx` contains only top-level composition/state wiring; every screen-level block now lives in its own file under `components/`.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` all pass unmodified in behavior after the split — no functional regression on any screen (channel list, DNA editor, topic suggestion, script, scene breakdown, tasks, settings).
- A manual pass through every screen behaves identically to before the refactor.
- The duration-mismatch badge appears only when the gap exceeds tolerance, offers a one-click fix, and disappears correctly when audio is cleared or regenerated within tolerance.
- No batch-audio button, no waveform UI, and no silent auto-duration-change exist anywhere in the app.
- The four docs files above accurately describe the audio feature as actually implemented.
