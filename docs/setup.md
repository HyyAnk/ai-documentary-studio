# Setup

1. Install Node.js and pnpm.
2. Run `pnpm install`.
3. Run `pnpm dev`.
4. Open the local URL printed by Vite.

On the first launch, the dashboard asks for a local content storage folder. It creates `channels/`, `.documentary-studio/tasks/`, `.documentary-studio/codex/`, and `.documentary-studio/logs/` inside that folder. The code, templates, and shared rules remain in the Git project.

The selected folder is saved locally in `.documentary-studio/storage.local.json`, which is ignored by Git. Change it later from Settings → Storage folder. Existing content is not moved automatically when switching folders. To use a different code project root, set `STUDIO_ROOT` before starting the server. To enable extra structured diagnostics, set `STUDIO_DEBUG=1`.
