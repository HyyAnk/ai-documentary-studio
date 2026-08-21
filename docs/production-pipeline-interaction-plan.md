# Production pipeline interaction plan

## Primary flow

1. Confirm a topic and choose target duration.
2. Generate or edit research with linked sources and a claim ledger.
3. Generate a timed treatment with documentary sequences.
4. Generate and review a word-budgeted narration script.
5. Generate an episode visual bible with continuity bundles.
6. Generate sequence-aware shots and video prompts.
7. Generate production narration by sequence, then use its measured duration to calibrate future shot packing.
8. Review the production assessment and resolve blockers before export.

## Shot-plan synchronization contract

- Generate shots reads the numbered script sections, reconciles them with treatment sections and continuity bundles, then queues one task per canonical sequence ID.
- A sequence task starts with an immediate queued/running state, loads its exact numbered upstream sections, writes an isolated draft, and only commits the complete ordered set after every sequence succeeds.
- If an existing visual bible is missing a required bundle, the pipeline marks it stale and regenerates it with the missing IDs before shot tasks are queued. Legacy artifacts use the complete upstream document as a recoverable fallback, so a retry does not fail during context assembly.
- Success persists all drafts and refreshes scenes, sequence progress, assessment, and bundle references through task events. Failure preserves completed drafts and keeps retry available; stale or out-of-order responses cannot overwrite a newer committed plan.
- Desktop shows the batch progress rail and per-sequence task status; mobile keeps the same status text and primary retry action visible while secondary artifact details remain collapsible.

## State and recovery

- Codex and audio operations are queued, acknowledged immediately, and scoped to one episode lock.
- Each completed mutation refreshes the episode, artifacts, scenes, and assessment automatically.
- Failures preserve prior artifacts and expose a retry action; regeneration never claims success before the server persists output.
- Editing an upstream artifact keeps downstream work visible but makes the assessment report the resulting mismatch. Editing the script invalidates production narration metadata.
- Narration generation reports real segment percentage, prevents duplicate submission, and leaves unrelated controls available.

## Synchronization

- WebSocket task events update pending and terminal states. Terminal events trigger an episode refetch.
- Repository writes remain atomic. Episode-level locks prevent research/script/scene/audio races.
- Stale narration cannot remain attached after a script edit. Scene dialogue edits continue to invalidate only their scene preview audio.

## Desktop and mobile

- Desktop presents a compact pipeline rail, artifact review panels, production assessment, and two-column narration/prompt shot cards.
- Mobile stacks the same order, keeps the next primary action prominent, moves secondary editing into each artifact panel, and exposes all tooltips through focus/title text.
- Both layouts show one responsive footer credit using the required desktop and mobile strings.
