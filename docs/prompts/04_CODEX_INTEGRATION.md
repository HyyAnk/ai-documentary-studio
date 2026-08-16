# CODEX INTEGRATION — AI DOCUMENTARY STUDIO

## App Server Connection

Research the installed Codex version and the current official App Server protocol before implementing — the protocol may have changed since any training data, so verify against current docs/source rather than assuming. Implement:

1. Detect Codex installation & version.
2. Determine App Server availability; start/connect using the supported method.
3. Initialize the connection; maintain thread state.
4. Start turns, receive streamed events, handle completion/errors/approvals, allow interruption, resume existing threads when possible.

Persist the mapping `task → channel → episode → Codex thread → Codex turn → output files` server-side — never rely on browser session state alone.

## Context Engine — strict, per-task-type scoping (critical)

Every Codex call must receive the **minimum necessary** context for its specific task, scoped to the **currently selected channel/episode only**. Never include: other channels, the entire repository, full raw file dumps beyond what's listed below, or unrelated task history. Treat context assembly as an explicit, auditable step — log exactly what was sent with every task (see `02_ARCHITECTURE.md` §Logging).

| Task type | Include | Explicitly exclude |
|---|---|---|
| Generate DNA | `templates/example_channel_dna.md`, the user's channel description, channel metadata (name, audience, language, market) | other channels' DNA, all episodes |
| Suggest Topics | `channel_dna.md`, `style_guide.md` (if present), relevant `shared/*_rules.md` files, existing `topic_database.json` (titles/premises only, not full text), list of existing episode titles | full episode scripts/scenes, other channels |
| Generate Script | `channel_dna.md`, `style_guide.md`, `shared/script_rules.md`, the confirmed episode's `brief.md`/topic, `research.md` if present | scenes/dialogue from other episodes, unrelated topics |
| Generate Scenes | `shared/visual_rules.md` + `shared/prompt_rules.md`, the episode's `script.md`, relevant sections of `channel_dna.md` (visual language + scene rules only if the DNA is large), video-generation config (max duration, aspect ratio) | full channel DNA if oversized and only a subsection applies; other episodes |
| Regenerate dialogue/prompt (single scene) | that scene's current content, its immediate neighbors (for continuity), a `script.md` excerpt around that scene, relevant DNA sections | the full scene list, unrelated scenes |

If a Channel DNA or shared-rules file grows large, send the specific relevant sections (parsed by heading) rather than the whole file. Keep a rough context-size budget per task type and log/warn if a call exceeds it.

## Concurrency & Locking

- Multiple Codex tasks **may run in parallel** across different channels and different episodes.
- **Exactly one active task per episode at a time**: acquire a lock before starting (`lock_key = episode_id` for episode-scoped tasks, `lock_key = channel_id` for channel-scoped tasks like DNA generation or topic suggestion); release it on completion, failure, or cancellation.
- A new task targeting an already-locked episode/channel is placed in `QUEUED` with a `queue_position` and starts automatically once the lock frees; the user can cancel it while it's still queued.
- A global cap, `codex.max_concurrent_tasks` (configurable, sensible default e.g. 3), limits how many Codex turns run simultaneously across the whole app regardless of per-episode locks — extra tasks wait in `QUEUED`.
- The Tasks view shows QUEUED / RUNNING / WAITING_APPROVAL tasks with their channel/episode, so parallelism and queueing are visible and understandable to the user.

## Approvals

Surface Codex approval requests compactly: what Codex wants to do, the target file/command, `[Allow]` `[Deny]`. Never auto-bypass approval mechanisms.

## Context Continuity / Resumability

Repository files are authoritative, not conversation memory. Codex must be able to reconstruct full working context from `channel_dna.md` + episode files + shared rules + task metadata alone, so the system survives thread interruption, application restart, machine restart, a new thread, or a model change.

## Error Handling

Codex-specific failures (App Server down, auth failure, timeout, malformed response) map to the plain-language error patterns defined in `02_ARCHITECTURE.md` §Error Handling — never expose raw protocol errors in the main UI; keep them in the expandable debug panel.
