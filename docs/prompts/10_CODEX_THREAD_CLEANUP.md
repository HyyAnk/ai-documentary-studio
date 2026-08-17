# CODEX THREAD CLEANUP — PREVENT UNBOUNDED SESSION ACCUMULATION

Grounded in the current repo: `apps/server/src/tasks.ts` (`TaskManager.finish()`, task lifecycle), `apps/server/src/codex.ts` (`CodexAppServerClient`, `startThread`/`resumeThread`), `packages/shared/src/index.ts` (`AppConfigSchema.codex`, `TaskSchema.codex_thread_id`).

## Why

Every task always calls `startThread()` — `codex_thread_id` is never carried from one task to another, so `resumeThread()` only ever applies within a single still-running task, never across tasks. This is intentional (the app rebuilds full context from repository files on every task, per the existing Context Continuity principle), but it means **every generation, suggestion, and regeneration creates a brand-new Codex session** that persists on disk indefinitely until the user manually cleans it up in Codex itself. At production usage volume (many channels × many episodes × many regenerates) this accumulates quickly and clutters Codex's own session/resume list.

Since the app never depends on an old thread's memory, and every task's real output is already durably written to the repository by `repository.ts` before `finish()` marks the task `COMPLETED`, deleting a thread after its task finishes is safe by construction — it only removes Codex's internal transcript for that task, never any file in `channels/`.

## 1. Config additions (`packages/shared/src/index.ts`, `AppConfigSchema.codex`)

```ts
codex: z.object({
  // ...existing fields
  auto_delete_threads: z.boolean().default(true),
  failed_thread_retention_days: z.number().int().nonnegative().default(7),
}),
```

- `auto_delete_threads` — master switch; when `false`, no automatic deletion happens at all (useful if the user wants to inspect threads via `codex resume` for a while).
- `failed_thread_retention_days` — threads belonging to `FAILED`/`CANCELLED` tasks are kept for this many days (for debugging via the Codex CLI directly) before being swept; `0` means delete immediately, same as `COMPLETED`.

Add both fields to the Settings "Codex" section alongside the existing transport/model/endpoint controls.

## 2. Codex client — add `deleteThread`

In `apps/server/src/codex.ts`, add a method next to `startThread`/`resumeThread`:

```ts
async deleteThread(threadId: string): Promise<void> {
  if (!threadId) return;
  await this.ensureConnected();
  if (this.config.codex.transport === "openai_compatible") return; // no server-side thread to delete
  try {
    await this.request("thread/delete", { threadId });
  } catch {
    // Best-effort: a thread that's already gone, or a Codex version without this method,
    // should not fail the task that triggered cleanup.
  }
}
```

`thread/delete` is a real App Server method (added upstream for exactly this purpose — permanently removing a thread and any of its subagent threads/metadata). Calling it is best-effort and must never throw into the caller — cleanup failing should never fail or retry the underlying task.

## 3. Hook cleanup into `TaskManager.finish()`

In `apps/server/src/tasks.ts`, `finish()` is the single place every task lifecycle ends (`COMPLETED`, `FAILED`, `CANCELLED`). Extend it:

```ts
private async finish(taskId: string, status: TaskStatus, error: string | null, outputFiles: string[] = []): Promise<void> {
  const task = this.get(taskId);
  // ...existing update logic that persists status/error/output_files...

  if (task.codex_thread_id && this.config.codex.auto_delete_threads) {
    if (status === "COMPLETED") {
      await this.codex.deleteThread(task.codex_thread_id);
    } else if ((status === "FAILED" || status === "CANCELLED") && this.config.codex.failed_thread_retention_days === 0) {
      await this.codex.deleteThread(task.codex_thread_id);
    }
    // FAILED/CANCELLED with retention_days > 0 are left for the sweep job below.
  }
}
```

`GENERATE_AUDIO` tasks never have a `codex_thread_id` (they never touch Codex — see `06_AUDIO_INTEGRATION.md`), so this branch is a no-op for them, which is correct.

## 4. Retention sweep for FAILED/CANCELLED threads

Add a lightweight periodic sweep (an interval started alongside the existing task pump, e.g. once every few hours is enough — this is not latency-sensitive):

- Scan tasks with `status` in `FAILED`/`CANCELLED`, a non-null `codex_thread_id`, and `completed_at` older than `failed_thread_retention_days`.
- Call `codex.deleteThread()` for each, then clear `codex_thread_id` on the task record (set to `null`) so the sweep doesn't repeat work and the Task view can show "thread cleaned up" instead of a dead reference.
- Skip the sweep entirely if `auto_delete_threads` is `false`.

## 5. Manual fallback in Settings

Even with auto-cleanup on, some threads can pre-date this feature or slip through (e.g. app crash mid-task). Add one button in Settings → Codex: **`[Clean up old Codex sessions]`**, which runs the same sweep logic on demand across all tasks regardless of the retention window (i.e. treat every FAILED/CANCELLED/COMPLETED task with a lingering `codex_thread_id` as eligible), and reports how many were removed. This is the same safe, best-effort `deleteThread` call — never touches repository files.

## 6. What must never change

- No change to how `output_files` are produced or where they're written — this feature only ever calls `codex.deleteThread()`, never any `repository.*` write/delete method.
- No change to `contextEngine.build()` or the Context Continuity behavior — every task still rebuilds context from repository files, exactly as before; this feature is purely about disposing of Codex's own transcript once a task no longer needs it.
- A thread must never be deleted while its task is still `RUNNING` or `WAITING_APPROVAL` — only from within `finish()` (i.e. after the task has reached a terminal state) or the sweep (which already filters to terminal states).

## Acceptance criteria

- With `auto_delete_threads` on (default), a `COMPLETED` task's Codex thread is deleted immediately after completion; the episode/channel's files on disk are unaffected and remain fully usable (open, edit, regenerate) afterward.
- A `FAILED` or `CANCELLED` task's thread survives for `failed_thread_retention_days` before the sweep removes it, so a user can `codex resume` it for debugging within that window.
- Setting `failed_thread_retention_days` to `0` deletes failed/cancelled threads immediately too.
- Turning `auto_delete_threads` off stops all automatic deletion (both the `finish()` hook and the sweep); nothing is deleted until the user runs the manual `[Clean up old Codex sessions]` button.
- A `deleteThread` failure (e.g. Codex temporarily unreachable, or already deleted) never fails, retries, or changes the status of the task that triggered it — it is strictly best-effort and silent beyond a debug log line.
- Running the manual cleanup button reports an accurate count and leaves repository files completely untouched.
- `GENERATE_AUDIO` tasks are unaffected by any of this (no `codex_thread_id` to clean up).
