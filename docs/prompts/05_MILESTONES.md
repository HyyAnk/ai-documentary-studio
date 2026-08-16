# MILESTONES & ACCEPTANCE CRITERIA — AI DOCUMENTARY STUDIO

Implement in order. Do not move to the next milestone until its acceptance criteria pass.

## Milestone 1 — Project Foundation

Build: frontend shell, backend, repository integration, basic dashboard shell, Channel Manager.

**Done when:**
- App starts locally with one command.
- Channels list renders from `channels/` on disk (empty state handled).
- Create / edit / archive / delete a channel works and writes real directories/files.
- No channel name or count is hard-coded anywhere in source.

## Milestone 2 — Channel DNA System

Build: `templates/example_channel_dna.md`, channel creation flow, DNA generation via Codex, Markdown editor, persistence.

**Done when:**
- `[Use Example DNA]` and `[Create DNA]` (AI) both produce a valid `channel_dna.md` following the template structure.
- DNA editor: view/edit/save/cancel/revert all work against the real file, with path + last-modified shown.
- Edited DNA is immediately used as context for the next AI task on that channel.

## Milestone 3 — Codex App Server Integration

Build: connection, thread/turn lifecycle, event streaming, error handling, approvals, task tracking, the context engine, concurrency/locking (all per `04_CODEX_INTEGRATION.md`).

**Done when:**
- Dashboard connects to a running Codex App Server and completes a real turn end-to-end.
- Task list shows QUEUED / RUNNING / WAITING_APPROVAL / COMPLETED / FAILED / CANCELLED correctly.
- Two tasks in two different episodes run concurrently; two tasks targeting the same episode correctly serialize (the second one queues).
- Context sent per task type matches the table in `04_CODEX_INTEGRATION.md` (verify via the logged context payload).
- Codex unavailable / App Server unavailable states show the specified plain-language errors with retry/reconnect actions.

## Milestone 4 — Topic System (candidates only)

Build: `[Suggest New Topics]`, exactly-5 result generation, selection UI, episode creation on confirm.

**Done when:**
- Suggest Topics returns exactly 5 lightweight candidates (title, premise, why it fits, hook, potential) with no research/script/scene work performed for any candidate.
- Selecting one and confirming creates the episode directory + `episode.json` + `brief.md`; the other 4 are not developed further.
- Re-running suggestion avoids repeating existing topics/episodes.

## Milestone 5 — Script System

Build: script generation, editing, persistence.

**Done when:**
- `[Create Script]` on a confirmed episode produces `script.md` using only that episode's context (per `04`).
- Script is viewable and manually editable in the dashboard; saves write to the real file.

## Milestone 6 — Scene System

Build: scene splitting, duration validation, dialogue/prompt pairing, two-column UI, copy buttons, per-scene regenerate.

**Done when:**
- `[Create Scene Breakdown]` splits `script.md` into scenes, each with dialogue + matching video prompt, none exceeding `max_scene_duration_seconds`.
- Two-column UI (Dialogue | Video Prompt) renders per scene with independent `[Copy]` buttons and a brief "Copied" confirmation.
- Manual edits to duration/dialogue/prompt/notes save without calling Codex.
- `[Regenerate]` (dialogue / prompt / both) calls Codex with only that scene's minimal context (per `04`) and preserves the previous version.

## Milestone 7 — Polish

Build: UX pass, tooltips, loading states, error handling, responsive layout, tests, documentation.

**Done when:**
- All interactive elements have appropriate loading/empty/error states.
- Two-column scene layout collapses correctly on narrow screens.
- The test suite from `02_ARCHITECTURE.md` §Testing passes.
- `README.md` and `docs/` (architecture, setup, codex-integration, channel-dna, episode-workflow, provider-system, troubleshooting) are complete and accurate.

No audio/video generation is implemented in any of these milestones.

## Final Acceptance (all milestones combined)

The project is successful only if the user can, end to end:

1. Start the dashboard locally.
2. Create a channel, generate DNA via AI, edit and save it.
3. Select the channel and generate exactly 5 topic candidates (lightweight only).
4. Select one topic and confirm — episode is created.
5. Generate a script, then a scene breakdown, from that episode alone.
6. See dialogue and video prompt side-by-side per scene, copy either independently, edit either, save edits.
7. Regenerate a single scene's dialogue/prompt without affecting other scenes, with the previous version recoverable.
8. Run two tasks on two different episodes at the same time; confirm a second task on the *same* episode queues instead of running concurrently.
9. Restart the dashboard and resume the workflow from repository state alone.
10. Add another channel without any source code change.
11. See real-time Codex task progress and handle a Codex error/approval gracefully.
