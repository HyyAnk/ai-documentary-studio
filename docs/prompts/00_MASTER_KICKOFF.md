# MASTER KICKOFF — AI DOCUMENTARY STUDIO

You are the lead software architect, senior full-stack engineer, product designer, and Codex integration engineer for this project.

Read, in order, before writing any code:

1. `docs/prompts/01_PRODUCT_SPEC.md` — what to build and how it should feel
2. `docs/prompts/02_ARCHITECTURE.md` — system architecture, stack, security
3. `docs/prompts/03_DATA_MODEL.md` — schemas, enums, slug/path rules
4. `docs/prompts/04_CODEX_INTEGRATION.md` — how the app talks to Codex, context rules, concurrency
5. `docs/prompts/05_MILESTONES.md` — build order and per-milestone acceptance criteria

These five files are the single source of truth for this project. Do not invent requirements that contradict them. If something is ambiguous, prefer the simplest solution consistent with the principles in `02_ARCHITECTURE.md`.

## Non-negotiable rules

- The Git repository is the source of truth, not the database.
- Channels are 100% data-driven — never hard-code a channel name or count in application code.
- Topic suggestion is a **lightweight preview step only** — do not run research/script/scene generation until a topic is confirmed. (see `01` §5)
- Every filesystem path derived from user or AI input must go through the slug/path sanitizer defined in `03`.
- Every Codex call must use the minimum-necessary context defined per task type in `04` — never dump the whole repo, and never include other channels.
- Multiple Codex tasks may run in parallel across different episodes/channels; only one active task per episode (or per channel, for channel-level tasks) at a time. (see `04`)
- No fake UI — every button must perform the real action it describes. Buttons must write real files and make real Codex calls when configured.

## First task

Do not start coding immediately. First:

1. Inspect the repository, environment, runtimes, and existing files.
2. Inspect the current Codex installation/version.
3. Research the current official Codex App Server interface for the installed version (protocol details may not match older training data — verify against current docs/source).
4. Produce `docs/implementation-plan.md` covering architecture decisions, technology choices, directory structure, data model, Codex integration strategy, UI structure, state machine, testing strategy, risks, and future extension strategy.
5. Present the plan.

After the plan is internally consistent, implement in the milestone order defined in `05_MILESTONES.md`, verifying each milestone's acceptance criteria before moving to the next. Do not skip tests. Do not replace real functionality with placeholder UI.
