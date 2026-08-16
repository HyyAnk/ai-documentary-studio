# DATA MODEL — AI DOCUMENTARY STUDIO

## Slug & Path Sanitization (mandatory, centralized)

All filesystem paths that incorporate a user- or AI-provided name (channel name, episode/topic title) MUST go through one shared `resolveSlug()` / `resolvePath()` utility. No other code may build these paths manually.

**Slug generation rule:**

1. Lowercase.
2. Transliterate/strip non-ASCII characters.
3. Replace anything that isn't `a-z0-9` with a single `-`.
4. Collapse repeated `-`, trim leading/trailing `-`.
5. Max length 60 characters (truncate on a word boundary).
6. If the resulting slug already exists under the parent directory, append `-2`, `-3`, … until unique.
7. Reject (regenerate or error) if the slug is empty after sanitization.

**Path resolution rule:**

1. Every path is built by joining a fixed root (`channels/`, `templates/`, etc.) with sanitized slugs only — never with raw user input.
2. After joining, resolve the absolute path and verify it is still inside the intended root directory (defends against `..`, absolute paths, symlink tricks, null bytes, drive letters). Reject the operation if the check fails.
3. Codex-driven file writes must be constrained to the specific channel/episode directory the task was scoped to (see `04_CODEX_INTEGRATION.md`) — the backend enforces this independently of what Codex claims to be doing; it does not blindly trust Codex's own path arguments.

## Enums

**ChannelStatus**: `DRAFT | ACTIVE | PAUSED | ARCHIVED`

- `DRAFT` — created, DNA not finalized yet.
- `ACTIVE` — normal operation, appears in all pickers.
- `PAUSED` — hidden from "suggest topics" defaults but still visible/editable.
- `ARCHIVED` — read-only, hidden from default lists, not deletable by accident (requires explicit unarchive or a hard-delete confirmation).

**EpisodeStage**: `IDEA | SELECTED | RESEARCH | RESEARCH_READY | SCRIPT | SCRIPT_READY | SCENE_BREAKDOWN | SCENE_READY | READY_FOR_GENERATION`

v1 implements `SELECTED → SCRIPT → SCRIPT_READY → SCENE_BREAKDOWN → SCENE_READY`. `RESEARCH` stages exist in the model but may be a no-op/stub in v1.

**TaskStatus**: `QUEUED | RUNNING | WAITING_APPROVAL | COMPLETED | FAILED | CANCELLED`

**TaskType**: `GENERATE_DNA | SUGGEST_TOPICS | GENERATE_SCRIPT | GENERATE_SCENES | REGENERATE_DIALOGUE | REGENERATE_PROMPT | REGENERATE_BOTH` (extend as needed; keep this list defined in one place, not scattered across code).

## Schemas (indicative — implement with typed/validated schemas, e.g. Zod)

**Channel**
```
channel_id, slug, display_name, description, target_audience, language,
market, channel_dna_path, style_guide_path, status: ChannelStatus,
created_at, updated_at
```

**Topic (candidate — ephemeral until selected)**
```
topic_id, channel_id, title, premise, why_it_fits, hook,
estimated_potential, generated_at, selected: boolean
```
Stored per suggestion run under `channels/<slug>/topics/`. Only the selected candidate graduates into an Episode. Unselected candidates are kept as history for "avoid repeating" context but are never developed further.

**Episode**
```
episode_id, channel_id, slug, topic (title/premise/hook copied from the
selected Topic), stage: EpisodeStage, script_path, scene_plan_path,
dialogue_script_path, video_prompts_path, created_at, updated_at
```

**Scene**
```
scene_id, episode_id, scene_number, duration_seconds, dialogue,
visual_prompt, transition_note, continuity_note
```

**Task**
```
task_id, task_type: TaskType, channel_id, episode_id (nullable),
status: TaskStatus, created_at, started_at, completed_at,
codex_thread_id, codex_turn_id, error, output_files,
lock_key, queue_position
```
`lock_key` and `queue_position` support the concurrency model defined in `04_CODEX_INTEGRATION.md`.

**CodexThread**
```
thread_id, channel_id, episode_id (nullable), created_at, last_used_at, status
```

**ProviderConfig / AppSettings**
```
video_generation: { provider, model, max_scene_duration_seconds,
                     default_scene_duration_seconds, aspect_ratio }
codex: { max_concurrent_tasks, app_server_endpoint, ... }
```

Do not duplicate these types between frontend and backend — one shared schema module, imported by both.
