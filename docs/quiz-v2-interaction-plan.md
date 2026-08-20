# Quiz Engine V2 stage detail

Quiz V2 is part of the single Quiz production pipeline. Operators click **Build video** once; the pipeline creates, validates, and renders every stage automatically. This panel is status-only and never exposes stage-level production controls.

## State transitions

- Artifact stages move from `not_started` to `running`, `ready`, `stale`, or `failed`.
- Changing Quiz facts invalidates Director, assets, voice, timeline, render, and dependent QA.
- Changing research, treatment, script, visual bible, scenes, question count, age band, format, or visual theme invalidates every affected downstream V2 artifact.
- Changing only a semantic asset invalidates render and render QA.
- Changing an SFX registry entry invalidates affected render evidence without changing Quiz facts.
- A failed downstream stage preserves every confirmed upstream artifact and retries from the earliest stale dependency.

## Async feedback and recovery

- The single Build video action immediately shows a pending state and reports `queued` or `running` state.
- WebSocket task events update progress; terminal events reconcile the episode and artifact state from the server.
- Slow operations expose the current stage and measurable progress when available.
- Blockers identify the question or artifact, expected value, observed value, and next action.
- Reconnects use the existing bounded WebSocket backoff and refetch the affected episode after reconnection.

## Desktop and mobile

- Desktop shows a compact horizontal rail for Research, Questions, Director, Assets, Voice, Timeline, QA, and Render.
- Mobile stacks the rail into a scrollable status list; the single Build video action remains in the episode header.
- Stage regeneration and retry are internal pipeline behavior; the UI does not expose per-stage production buttons. Download remains available only for confirmed output files.
- Long question, QA, and timeline content wraps without horizontal page overflow.
- The responsive footer exposes exactly `Develop - Design - Deliver by HyyAnk | Dư Ngọc Minh Hoàng` on desktop/tablet and `HyyAnk | Dư Ngọc Minh Hoàng` on mobile.

## Verification matrix

- Success: all affected views update after the server confirms persistence.
- Slow response: pending state remains visible and duplicate actions stay disabled.
- Empty: the next valid action explains how to populate the stage.
- Error: the failed stage remains visible with actionable error text; retry is performed through the single Build video action.
- Concurrent update: stale responses cannot replace a newer artifact because refreshes reconcile from repository state.
