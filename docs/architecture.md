# Architecture

The app is one local modular service with a React/Vite frontend. Fastify is the security boundary: it reads the repository, writes artifacts, calls Codex, and streams task events. The browser only calls `/api/*` and receives validated data.

## Modules

- `repository`: channel, topic, episode, Markdown, atomic write, backup, and path safety operations;
- `context`: explicit task-specific context manifests and audit logs;
- `codex`: transport and JSON-RPC request lifecycle;
- `tasks`: queue, global semaphore, scope locks, approvals, and task persistence;
- `providers`: future provider boundaries for video, audio, image, and research work;
- `shared`: the single Zod schema package used by both applications.

No database, microservices, queues, or cloud backend are required for v1.
