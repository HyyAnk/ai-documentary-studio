# AI Documentary Studio

Local-first workspace for managing channel DNA, documentary topics, scripts, and scene plans with Codex.

## Start locally

Requirements:

- Node.js 24 or newer
- pnpm 11 or newer
- Codex installed and authenticated if AI generation is needed

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The browser talks to the local Fastify server on port `4310`; credentials and filesystem access stay on the server.

Production build:

```bash
pnpm build
pnpm start
```

Run checks:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

## Publish to GitHub

The repository is prepared for GitHub. Runtime logs, task records, Playwright output, build folders, local environment files, the cached Codex binary, and local channel artifacts are ignored. Channel content remains on the local machine as the production source of truth; `channels/.gitkeep` only preserves the empty folder in Git.

From the project root:

```bash
git init
git add .
git commit -m "Initial AI Documentary Studio workspace"
git branch -M main
git remote add origin https://github.com/<your-account>/<your-repository>.git
git push -u origin main
```

Choose a license before publishing if this will be public. No license is added automatically because that is a legal/project decision.

## Repository layout

`channels/` is the local production source of truth. Each channel contains `channel.json`, `channel_dna.md`, `style_guide.md`, topic history, and episode folders. Episode artifacts are readable Markdown files plus `episode.json`. These generated and authored content files are intentionally not pushed to GitHub.

`.documentary-studio/` contains local configuration, task records, Codex metadata, and structured logs. It never replaces the content files as the source of truth.

## Current scope

The first release covers:

- channel creation, editing, archive, delete, and DNA editing;
- exactly-five lightweight topic candidates and confirmation into an episode;
- script generation/editing;
- scene breakdown with paired dialogue and video prompts;
- manual scene edits, copy actions, backups, and single-scene regeneration;
- task queueing, per-channel/per-episode locks, progress events, approvals, and reconnect states.

Audio and video generation are intentionally provider interfaces only.

## Notes

The Codex App Server adapter uses the documented JSONL stdio transport by default. On Windows, if the Store-installed executable cannot be launched directly, the server automatically caches a runnable copy under `.documentary-studio/codex/`. Set `codex.command`, `codex.app_server_endpoint`, or `codex.model` in `.documentary-studio/config.json` when the local installation needs an explicit command or endpoint. See [Codex integration](docs/codex-integration.md) for the lifecycle and context contract.
