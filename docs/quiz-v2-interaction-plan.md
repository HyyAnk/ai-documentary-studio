# Quiz Engine V2 stage detail

Quiz V2 is part of the single Quiz production pipeline. Operators normally click **Build video** once; the pipeline creates and validates every stage automatically. This panel remains available for status, inspection, and advanced per-stage regeneration.

## Advanced regeneration flow

1. Open a Quiz episode in the existing production workspace.
2. Use a stale or failed stage action only when a targeted regeneration is needed.
3. Render is enabled only after the complete V2 chain is present and QA has no blockers.

## State transitions

- Artifact stages move from `not_started` to `running`, `ready`, `stale`, or `failed`.
- Changing Quiz facts invalidates Director, assets, voice, timeline, render, and dependent QA.
- Changing research, treatment, script, visual bible, scenes, question count, age band, format, or visual theme invalidates every affected downstream V2 artifact.
- Changing only a semantic asset invalidates render and render QA.
- Changing an SFX registry entry invalidates affected render evidence without changing Quiz facts.
- A failed downstream stage preserves every confirmed upstream artifact and retries from the earliest stale dependency.

## Async feedback and recovery

- Every action immediately disables only its duplicate submission and reports `queued` or `running` state.
- WebSocket task events update progress; terminal events reconcile the episode and artifact state from the server.
- Slow operations expose the current stage and measurable progress when available.
- Blockers identify the question or artifact, expected value, observed value, and next action.
- Reconnects use the existing bounded WebSocket backoff and refetch the affected episode after reconnection.

## Desktop and mobile

- Desktop shows a compact horizontal rail for Research, Questions, Director, Assets, Voice, Timeline, QA, and Render.
- Mobile stacks the rail into a scrollable stage list and keeps the next primary action visible in the artifact panel.
- Secondary actions such as inspect, regenerate, retry, and download stay inside the selected artifact panel.
- Long question, QA, and timeline content wraps without horizontal page overflow.
- The responsive footer exposes exactly `Develop - Design - Deliver by HyyAnk | Dư Ngọc Minh Hoàng` on desktop/tablet and `HyyAnk | Dư Ngọc Minh Hoàng` on mobile.

## Verification matrix

- Success: all affected views update after the server confirms persistence.
- Slow response: pending state remains visible and duplicate actions stay disabled.
- Empty: the next valid action explains how to populate the stage.
- Error: the failed stage remains available with retry and actionable error text.
- Concurrent update: stale responses cannot replace a newer artifact because refreshes reconcile from repository state.
