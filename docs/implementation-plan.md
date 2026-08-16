# AI Documentary Studio — Implementation Plan

Status: initial plan for the empty workspace, prepared before application code.

## 1. Delivery scope and principles

The product will be a local-first production dashboard over a human-readable repository. The repository remains authoritative; the server derives state by reading files and keeps only operational task/connection metadata under `.documentary-studio/`.

Implementation follows the milestones in `docs/prompts/05_MILESTONES.md` in order:

1. Foundation and Channel Manager
2. Channel DNA
3. Codex App Server integration
4. Topic candidates and episode confirmation
5. Script generation and editing
6. Scene breakdown and per-scene regeneration
7. Polish, tests, and documentation

The first phase deliberately does not implement audio or video generation. Provider interfaces will exist as typed extension points only.

Non-negotiable invariants are enforced in server code and tested directly:

- Channel names, counts, and episode data are never hard-coded.
- Every user/AI-derived filesystem segment goes through one slug/path resolver.
- Topic suggestion returns lightweight candidates only; development starts only after confirmation.
- Every Codex task receives a small, explicit context manifest scoped to one channel or episode.
- One active task is allowed per episode/channel lock key, with a configurable global concurrency cap.
- Browser code never receives Codex credentials or arbitrary filesystem access.
- Interactive controls call real server actions and persist real repository files.

## 2. Technology choices

### Application stack

- TypeScript with strict checking across the workspace.
- `pnpm` workspaces for a single local project with shared types.
- React + Vite for the desktop-first frontend.
- Fastify for the local backend, with a small plugin/module surface rather than a service split.
- Zod for shared request, response, persisted-data, and configuration validation.
- `ws` for the local WebSocket task-event channel; ordinary CRUD uses JSON HTTP routes.
- Node `fs/promises`, `path`, and `crypto` for repository access and identifiers.
- Vitest for unit/integration tests; Playwright for the end-to-end browser acceptance flow.
- `marked` plus a small sanitised renderer for Markdown preview. Markdown editing remains a plain textarea in v1 so saves are transparent and predictable.
- CSS modules or colocated CSS with design tokens; no UI framework dependency is required for the intentionally compact visual language.

### Why this shape

This stack keeps the app easy to start on Windows with one command, shares validation between the browser and server, and leaves the repository readable without introducing a database or deployment infrastructure. The backend is the security boundary and the only component that can call Codex or write files.

The app will support a generated production build served by Fastify, plus a Vite development proxy. `pnpm dev` starts both through a small Node runner; `pnpm build` creates a distributable local build; `pnpm test` runs the deterministic suite.

## 3. Directory structure

The project will use this application layout while preserving the content layout from the source architecture:

```text
.
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── app.ts
│   │       ├── config.ts
│   │       ├── modules/
│   │       │   ├── channels/
│   │       │   ├── topics/
│   │       │   ├── episodes/
│   │       │   ├── tasks/
│   │       │   └── settings/
│   │       ├── codex/
│   │       ├── context/
│   │       ├── providers/
│   │       ├── repository/
│   │       └── transport/
│   └── web/
│       └── src/
│           ├── app/
│           ├── components/
│           ├── features/
│           └── styles/
├── packages/
│   └── shared/src/
│       ├── schemas.ts
│       ├── enums.ts
│       ├── api.ts
│       └── events.ts
├── channels/
├── templates/
├── shared/
├── .documentary-studio/
│   ├── config.json
│   ├── tasks/
│   ├── codex/
│   └── logs/
├── docs/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

`channels/`, `templates/`, `shared/`, and `.documentary-studio/` are created on first start if absent. The starter template and rules are committed as repository files. Runtime task records and context audit logs stay under `.documentary-studio/` and never inside a channel folder.

## 4. Repository and path model

`RepositoryService` owns all repository reads and writes. It exposes intent-level operations such as `createChannel`, `saveChannelDna`, `createEpisode`, `saveScenePlan`, and `backupBeforeRegenerate`; callers do not concatenate channel or episode paths.

`resolveSlug(input, parent)` will:

1. lowercase and transliterate/strip non-ASCII characters;
2. replace non-alphanumeric runs with `-`, collapse and trim;
3. truncate to 60 characters on a word boundary;
4. reject an empty result;
5. add `-2`, `-3`, etc. when the parent already contains the slug.

`resolvePath(rootKind, ...segments)` will resolve the fixed root, verify the canonical result is inside that root, reject null bytes, drive-qualified or absolute user segments, and reject symlink escapes. Codex output paths are ignored until independently mapped to the scoped channel/episode directory and validated by the same service.

All persisted JSON is written atomically through a temporary file in the same directory followed by a rename. Text files use UTF-8. Regeneration creates a timestamped `.bak` beside the target before replacing it.

## 5. Shared data model

`packages/shared` is the single source of truth for schemas used by both frontend and backend. It contains the enums and Zod schemas described in `03_DATA_MODEL.md`:

- `ChannelStatus`: `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED`.
- `EpisodeStage`: `IDEA`, `SELECTED`, `RESEARCH`, `RESEARCH_READY`, `SCRIPT`, `SCRIPT_READY`, `SCENE_BREAKDOWN`, `SCENE_READY`, `READY_FOR_GENERATION`.
- `TaskStatus`: `QUEUED`, `RUNNING`, `WAITING_APPROVAL`, `COMPLETED`, `FAILED`, `CANCELLED`.
- `TaskType`: `GENERATE_DNA`, `SUGGEST_TOPICS`, `GENERATE_SCRIPT`, `GENERATE_SCENES`, `REGENERATE_DIALOGUE`, `REGENERATE_PROMPT`, `REGENERATE_BOTH`.

The implementation adds version fields to persisted records where useful, while keeping the source fields stable. `episode.json` remains a concise index; Markdown files contain the editable artifacts. A scene parser/serializer will keep `scene_plan.md`, `dialogue_script.md`, and `video_prompts.md` consistent after AI output or manual edits.

## 6. Codex App Server strategy

### Verified environment and protocol

The local environment has Node `v24.15.0`, npm `11.12.1`, pnpm `11.5.2`, Python `3.13.3`, Git `2.50.1.windows.1`, and a Codex Desktop package at build `26.810.7004.0`. The bundled Codex executable is present, but direct execution from this PowerShell workspace is denied by the Windows Store package ACL. The adapter now resolves that case automatically: it locates the package binary, copies it into the ignored local runtime cache at `.documentary-studio/codex/codex.exe`, probes `codex-cli 0.148.0-alpha.9`, and uses the cached binary for App Server launches.

The current official OpenAI documentation describes App Server as bidirectional JSON-RPC 2.0 with the `jsonrpc` header omitted on the wire. It supports newline-delimited JSON over `stdio://` (the default), experimental WebSocket transport, Unix-socket transport, and `off`. The stable lifecycle is:

1. spawn/connect `codex app-server` using the supported transport;
2. send one `initialize` request with app metadata;
3. send the `initialized` notification;
4. start/resume a thread with `thread/start` or `thread/resume`;
5. call `turn/start` with scoped text input;
6. consume notifications such as `item/started`, `item/completed`, `item/agentMessage/delta`, and `turn/completed`;
7. handle `turn/interrupt`, approval requests, failures, and reconnect/resume.

The official docs also provide version-matched schema generation via `codex app-server generate-ts` and `codex app-server generate-json-schema`. The installed binary contains the same `app-server`, `--listen`, `stdio://`, `ws://`, `unix://`, `generate-ts`, and `generate-json-schema` command markers, so the adapter will use runtime-generated schemas when the executable is available and will keep the protocol layer isolated behind an interface. The implementation will not hard-code a model name; it will query `model/list` when connected and use configured/default selection only after validation.

### Adapter design

`CodexAppServerClient` will have transport-neutral methods:

```ts
connect(): Promise<ConnectionInfo>
initialize(): Promise<InitializeResult>
startThread(scope): Promise<ThreadRef>
resumeThread(threadId): Promise<ThreadRef>
startTurn(threadId, input, options): Promise<TurnRef>
interruptTurn(threadId, turnId): Promise<void>
respondToApproval(requestId, decision): Promise<void>
close(): Promise<void>
```

The first implementation uses a child process and JSONL stdio because it is the documented default and keeps the app local. `app_server_endpoint` can later select an explicitly configured WebSocket or Unix socket. Connection discovery checks the configured endpoint first, then the installed Codex command, and records a safe diagnostic reason. No secret or token is sent to the browser.

`CodexTaskRunner` owns the task lifecycle and maps every task to channel, episode, thread, turn, output files, lock key, and queue position. It listens to the adapter once per connection, serialises pending JSON-RPC requests by id, and publishes plain-language events to the browser. Raw protocol messages are written to `.documentary-studio/logs/` only when debug logging is enabled; context manifests are always auditable but redact secrets.

### Context engine

`ContextEngine.build(task)` returns an explicit manifest containing `includedFiles`, `excludedCategories`, `scope`, approximate byte/token size, and the exact text sent. It follows the task table in `04_CODEX_INTEGRATION.md` and parses large DNA/rules files by heading rather than dumping them wholesale. Context construction is tested with fixture channels to prove that other channels and unrelated episodes never appear.

## 7. Task queue, locks, and state machine

The server uses an in-memory scheduler backed by JSON task records for restart visibility. On startup, stale `RUNNING` tasks are marked `FAILED` with a recoverable diagnostic, while persisted completed outputs remain authoritative. A per-lock FIFO queue enforces `lock_key = channel_id` for channel tasks and `lock_key = episode_id` for episode tasks. A semaphore enforces `codex.max_concurrent_tasks` across all locks.

```text
QUEUED → RUNNING → WAITING_APPROVAL → RUNNING → COMPLETED
   │         │              │
   │         ├──────────────┴────→ FAILED
   │         └────────────────────→ CANCELLED
   └──────────────────────────────→ CANCELLED
```

`WAITING_APPROVAL` is entered only when App Server sends a permission/approval request. Denying approval yields `CANCELLED` or `FAILED` with a user-readable reason, according to whether the task itself was intentionally stopped. Completion handlers validate the expected output shape, enforce scope, persist files atomically, update episode stage, release the lock, and start the next queued task.

## 8. UI structure and product feel

The web app uses a compact production-tool shell:

- left sidebar: Dashboard, Channels, Topics, Episodes, Tasks, Settings;
- top context bar: selected channel, selected episode, current stage, Codex status;
- main content: route-level views with short action labels and tooltips for longer guidance;
- right-side or inline activity surface: running/queued task status and errors without exposing raw protocol by default.

Milestone 1 opens on a dashboard summary and channel manager. Empty states are actionable. Channel view exposes header, DNA status/editor, topic suggestions, episodes, and production status. Episode view exposes topic, script, paired scene blocks, and stage progress.

Visual rules: warm neutral surface, strong typographic hierarchy, quiet borders, compact cards, responsive two-column scene blocks, no gradients/glassmorphism/heavy shadows, and no analytics charts in v1. All buttons have disabled/loading/error states and complete a real server operation.

## 9. Milestone implementation and acceptance evidence

### Milestone 1

Build the workspace, server, frontend shell, repository bootstrap, channel CRUD, archive/delete confirmations, and Git metadata readout. Acceptance evidence: start command, empty channel list, create/edit/archive/delete persistence tests, and a browser smoke test.

### Milestone 2

Commit `templates/example_channel_dna.md`, add the complete canonical template, channel creation modes (`Use Example DNA`, upload, AI), Markdown editor, save/cancel/revert, path/modified metadata, and DNA validation. Acceptance evidence: two creation flows and immediate context refresh tests.

### Milestone 3

Implement the App Server client, generated-schema hook, initialize/thread/turn lifecycle, event streaming, approvals, task persistence, queue/lock scheduler, context manifests, reconnect/error states, and Tasks view. Acceptance evidence includes an adapter fake for deterministic tests plus an opt-in real App Server smoke test when the local binary is executable.

### Milestone 4

Implement exactly-five topic candidate validation and display, topic history persistence, selection, and confirmed episode creation with `episode.json` and `brief.md`. Acceptance evidence proves no development task is spawned during suggestion and duplicate titles are excluded from subsequent prompts.

### Milestone 5

Implement script context assembly, Codex result validation, `script.md` persistence, view/edit/save, and stage transitions. Acceptance evidence verifies episode-only context and real-file edits.

### Milestone 6

Implement scene schema/parser, duration splitting and validation, paired dialogue/prompt files, two-column UI, copy feedback, manual edits, backup-before-regenerate, and minimal single-scene regeneration. Acceptance evidence covers max duration, neighbor context, no collateral scene changes, and backup recovery.

### Milestone 7

Complete responsive/accessibility/loading/error states, docs, troubleshooting, tests, and release checks. Acceptance evidence is the full end-to-end flow from a fresh workspace, restart/resume from repository state, parallel episode tasks, queued same-episode task, approval handling, and a second channel created without source edits.

## 10. Testing strategy

Unit tests cover slug/path safety, atomic writes, Markdown section extraction, schemas, scene duration splitting, serialization, config validation, and stage transitions.

Integration tests use a temporary repository fixture and a fake App Server implementing the same request/notification contract. They verify context manifests, output scope enforcement, task state transitions, lock fairness, concurrency, interruption, approval decisions, connection loss, and restart recovery.

Playwright tests start the local server against a temporary repository, exercise channel creation/DNA editing/topic confirmation/script/scene editing, and assert that files—not just browser state—change. The real App Server test is marked environment-dependent and runs only when the configured Codex executable or endpoint passes the connection check.

Every test should use deterministic fixtures and avoid mutating the user's real channel content. Logs are captured under a test temp directory and are not committed.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| App Server protocol evolves | Generate version-matched schemas at setup, isolate the adapter, validate methods/capabilities, and show unavailable states clearly. |
| Windows Store executable cannot be launched by the app | Detect launch failure, support a configured endpoint/command path, keep the rest of the dashboard fully usable, and document the fix. |
| AI returns malformed or over-scoped output | Validate structured envelopes, parse only allowed files, enforce directory scope independently, and keep backups. |
| Manual Markdown edits drift from derived views | Make repository files authoritative, reparse on load, use one serializer, and show concise validation errors. |
| Concurrent writes corrupt files | Per-scope locks plus atomic same-directory writes and a backup before replacement. |
| Long context raises cost or leaks unrelated work | Explicit per-task manifests, heading extraction, size warnings, and tests asserting exclusions. |
| Empty repository onboarding is confusing | Bootstrap required folders/templates on first start and provide useful empty states with one next action. |

## 12. Future extension strategy

The provider interfaces remain independent of episode/scene models so Google Veo or other video providers can be added without changing the UI contract. Audio, image references, research providers, remote deployment, and a durable database can be layered behind existing service interfaces later. The repository format, task records, context engine, and App Server adapter are the stable seams for those additions. No future feature may bypass the path resolver, context scope, or task lock scheduler.

## 13. Official references consulted

- [Codex App Server — official OpenAI documentation](https://developers.openai.com/codex/app-server/): transport options, JSON-RPC message shape, initialize/thread/turn lifecycle, event streaming, approvals, and version-matched schema generation.
- Local installed Codex package: `OpenAI.Codex_26.810.7004.0_x64__2p2nqsd0c76g0`; executable launch was checked but blocked by the Windows Store package ACL in this shell environment.
