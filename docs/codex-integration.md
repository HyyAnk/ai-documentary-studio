# Codex integration

The adapter starts `codex app-server --listen stdio://` by default. The wire format is newline-delimited JSON-RPC messages without the `jsonrpc` header. The connection lifecycle is:

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

## Approvals and failure states

Server-initiated approval requests become `WAITING_APPROVAL` and are surfaced in the Tasks view. The user can accept, accept for the session, decline, or cancel. Disconnects, malformed output, timeouts, and upstream errors become visible task failures with technical details kept in logs/debug state.
