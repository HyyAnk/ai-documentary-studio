# Codex integration

The dashboard supports two local transports:

- **Local Codex App Server**: starts `codex app-server --listen stdio://` by default. The wire format is newline-delimited JSON-RPC messages without the `jsonrpc` header.
- **Cockpit API Service**: calls the OpenAI-compatible Responses API exposed by Cockpit Tools. Set the Base URL and API key in Settings; the adapter accepts a host URL or a URL that already ends in `/v1`.

Cockpit Tools documents its Codex API service as a bundled CLIProxyAPI sidecar that keeps the same Base URL/API key workflow. The dashboard only stores those settings locally and never commits them.

The local App Server lifecycle is:

```text
connect
  → initialize
  → initialized
  → thread/start or thread/resume
  → turn/start
  → item and turn notifications
  → turn/completed
```

The app records `task_id`, channel, episode, `codex_thread_id`, `codex_turn_id`, lock key, and output files. A task is allowed to run only when its channel/episode lock is free and the global concurrency cap has capacity.

## Context contract

`ContextEngine` builds an auditable manifest for every call. Topic suggestions include only channel DNA, style/rules, existing titles/premises, and episode titles. Script and scene tasks include only the confirmed episode plus the required rules. Single-scene regeneration includes that scene, immediate neighbors, a script excerpt, and relevant DNA sections.

The exact prompt and included file list are written to `.documentary-studio/logs/context-manifests.jsonl`. Other channels, full unrelated episodes, raw task history, and secrets are excluded.

## Cockpit setup

1. Start Cockpit Tools and enable its Codex API service.
2. Open this dashboard's Settings.
3. Select `Cockpit API Service`.
4. Paste the Base URL shown by Cockpit. A value such as `http://127.0.0.1:<port>` is normalized to `/v1`; an existing `/v1` suffix is preserved.
5. Paste the API key. It is written to `.documentary-studio/codex.local.json`, which is ignored by Git.
6. Choose the model from the top-bar dropdown and reconnect Codex.

The adapter uses `POST /responses` with the selected model and scoped prompt, then translates the response back into the dashboard task lifecycle. It also reads `GET /models` when available; the dropdown keeps a small Codex fallback list if Cockpit does not expose that endpoint.

Do not put Cockpit keys in `.documentary-studio/config.json`, source files, screenshots, logs, or issue reports.

## Approvals and failure states

Server-initiated approval requests become `WAITING_APPROVAL` and are surfaced in the Tasks view. The user can accept, accept for the session, decline, or cancel. Disconnects, malformed output, timeouts, and upstream errors become visible task failures with technical details kept in logs/debug state.
