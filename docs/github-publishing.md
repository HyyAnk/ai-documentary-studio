# GitHub publishing checklist

The project is ready to be placed in a Git repository.

## Included

- TypeScript source, shared schemas, templates, rules, tests, documentation, and `pnpm-lock.yaml`.
- `channels/` as the repository source of truth. It contains a `.gitkeep` while the workspace is empty.
- A GitHub Actions workflow that installs dependencies, typechecks, tests, and builds.
- `.gitattributes` with normalized text line endings.

## Excluded

- `node_modules/`, build output, coverage, Playwright artifacts, local logs, task records, and the cached Codex executable.
- `.env` files except a future `.env.example`.
- Private key and certificate file extensions.

## Before publishing publicly

1. Review channel content and remove anything intended to remain private.
2. Decide on and add a license.
3. Configure the GitHub remote and push from the local repository.
4. Never commit API keys, Codex credentials, private keys, or personal logs.
