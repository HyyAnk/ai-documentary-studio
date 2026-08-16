# ARCHITECTURE — AI DOCUMENTARY STUDIO

## Source of Truth

The Git repository is the source of truth, not the database. Important artifacts (DNA, scripts, scenes, dialogue, prompts) are human-readable files. The dashboard is an interface over files + derived state. A user must be able to understand the project by browsing the repo without the dashboard.

## Project Structure

```
ai-documentary-studio/
├── channels/
│   └── <channel-slug>/
│       ├── channel_dna.md
│       ├── style_guide.md
│       ├── topic_database.json
│       ├── topics/                 # ephemeral candidate sets, see 03_DATA_MODEL.md
│       ├── episodes/
│       │   └── <episode-slug>/
│       │       ├── episode.json
│       │       ├── brief.md
│       │       ├── research.md
│       │       ├── sources.md
│       │       ├── outline.md
│       │       ├── script.md
│       │       ├── scene_plan.md
│       │       ├── dialogue_script.md
│       │       ├── video_prompts.md
│       │       └── assets/
│       └── assets/
├── templates/
│   ├── example_channel_dna.md
│   ├── example_style_guide.md
│   ├── example_episode.json
│   └── example_scene.md
├── shared/
│   ├── production_rules.md
│   ├── research_rules.md
│   ├── script_rules.md
│   ├── visual_rules.md
│   └── prompt_rules.md
├── .documentary-studio/
│   ├── config.json
│   ├── tasks/
│   ├── codex/
│   └── logs/
└── README.md
```

May be refined if research shows something better; do not create duplicate sources of truth.

## Local-First

Runs on the user's machine. No cloud backend required for v1: local repo access, local Codex App Server, local file management, local task state. Design abstractions so remote deployment is possible later, but don't build it now.

## Security

Never expose Codex tokens/API keys/secrets to the browser. Browser talks only to the local backend; the backend talks to Codex, the filesystem, and future providers. Credentials stay server-side. The backend independently validates every filesystem path it is asked to write to — see the path resolution rule in `03_DATA_MODEL.md` — it never trusts a path handed back by Codex without re-checking it.

## Provider Architecture (stubs only for now)

Interfaces, not implementations, in this phase:

```
VideoProvider.generateScene()
AudioProvider.generateDialogue()
ImageProvider.generateReference()
ResearchProvider.search()
```

`VideoProvider → GoogleVeoProvider` as a future adapter — no Google-specific logic in the episode UI/model. The scene model stays provider-neutral (`scene.dialogue`, `scene.visual_prompt`, `scene.duration`, `scene.aspect_ratio`).

Duration config (not hard-coded per provider):

```yaml
video_generation:
  provider:
  model:
  max_scene_duration_seconds:
  default_scene_duration_seconds:
  aspect_ratio:
```

## Tech Stack

Prefer TypeScript, a modern React frontend, a lightweight backend, shared schemas (e.g. Zod) between frontend and backend, local filesystem integration, WebSocket/SSE for live task events. Reuse the existing repo stack if one is already suitable. Choose based on local usability, Codex integration, filesystem access, maintainability, and extensibility — not popularity.

## No Overengineering

No microservices, Kubernetes, message queues, cloud infrastructure, or distributed databases in v1. A well-structured, modular local application is correct. Use modular architecture rather than distributed architecture.

## Git

Optional `git status` / modified files / current branch surfaced in the UI. Never auto-commit or auto-push — the user stays in control of commits and pushes.

## Logging & Observability

Structured logs in `.documentary-studio/logs/`, never inside channel directories. UI shows plain-language status ("Generating 5 topic ideas…") not raw protocol details ("turn/start request ID 019c…"); raw details are available in an expandable debug panel. Also log the exact context payload sent to Codex per task (see `04_CODEX_INTEGRATION.md`) for debugging and cost review.

## Error Handling

Never fail silently.

- Codex unavailable → show "Codex unavailable" + `[Reconnect]`.
- App Server unavailable → show "Codex App Server unavailable" + `[Retry]`.
- File write failure → concise error message with expandable technical detail; no raw stack traces in the main UI.

## Testing

Cover: channel creation, DNA generation/editing, topic candidate generation, topic selection/confirmation, episode creation, scene generation, duration validation, file persistence, context resolution (correct minimal context per task type), task state transitions, Codex connection failure/interruption/completion, approval flow, slug/path sanitization, and concurrency/locking behavior. Add integration tests for the App Server adapter where practical.
