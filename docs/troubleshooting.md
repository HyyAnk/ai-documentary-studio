# Troubleshooting

## Codex is unavailable

Check that Codex is installed and authenticated, then use `Reconnect` in the top bar. The server never exposes credentials to the browser. On Windows Store installations, the server automatically copies the package binary into `.documentary-studio/codex/` when direct execution is blocked. If a different installation should be preferred, set its full path in `.documentary-studio/config.json` under `codex.command`.

## App Server is unavailable

The default transport is local stdio. If using a configured WebSocket endpoint, use a loopback or secured endpoint and verify the endpoint is reachable before restarting the dashboard.

## A task is stuck

Open Tasks. Queued tasks wait for the same episode/channel lock or for the global concurrency cap. A running task can be cancelled. After a dashboard restart, an interrupted running task is marked failed while repository artifacts remain intact.

## A file does not save

The backend accepts only known Markdown artifact names and only paths beneath the selected channel or episode. Check `.documentary-studio/logs/` with `STUDIO_DEBUG=1` for the technical detail.
