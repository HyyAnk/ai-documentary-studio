# Setup

1. Install Node.js and pnpm.
2. Run `pnpm install`.
3. Run `pnpm dev`.
4. Open the local URL printed by Vite.

The server bootstraps `channels/`, `.documentary-studio/tasks/`, `.documentary-studio/codex/`, and `.documentary-studio/logs/` when they do not exist. The committed templates and shared rules are loaded from the repository.

To use a different local repository root, set `STUDIO_ROOT` before starting the server. To enable extra structured diagnostics, set `STUDIO_DEBUG=1`.
