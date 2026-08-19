# Quiz pipeline interaction plan

## Primary flows

1. Open **Quiz Channels**, then create or select a channel.
2. Generate exactly five topic candidates. Each candidate carries a quiz format, age band, and question count.
3. Confirm one candidate to create a Quiz episode.
4. Set the question count, then run the production pipeline: research → Quiz plan → script → visual system → scenes → Chatterbox audio → HyperFrames MP4.
5. Review the inline video, download the MP4, or rerun only the failed/changed stage.

## State transitions

- Channel: draft → active → archived/restored.
- Topic: generated → selected.
- Quiz episode: selected → research ready → Quiz plan ready → script ready → visual system ready → scenes ready → narration ready → video rendering → video ready.
- Task: queued → running → completed, failed, cancelled, or waiting for approval.

## Asynchronous behavior

- Every mutation acknowledges immediately with a pending button state and a task event.
- Long-running generation exposes the current step and a real percentage.
- Duplicate production or render submissions are disabled while the same episode lock is active; unrelated channels remain usable.
- WebSocket events update task progress. Terminal events refetch affected channel/episode data so results appear without reload.

## Success and recovery

- A successful render stores `quiz-video.mp4` and `render-manifest.json`, updates episode metadata, and exposes inline playback/download.
- Failed Codex, image, Chatterbox, lint, inspect, or render steps retain completed upstream artifacts and expose retry.
- Cancelling the parent pipeline cancels active child tasks and leaves the last confirmed artifacts intact.
- HyperFrames preflight reports missing FFmpeg, FFprobe, Chrome, or source audio as the exact failed step.

## Refresh and concurrency

- Local repository files remain the source of truth.
- Task events are reconciled with API refetches after terminal state to prevent stale responses from overwriting newer artifacts.
- Per-episode locks serialize mutations; sequence/image work may run concurrently under distinct sub-locks.
- Reconnect uses bounded backoff and automatically reconciles tasks when the WebSocket returns.

## Desktop and mobile

- Desktop/tablet: channel group summary, channel grid, task rail, artifacts, and video preview use the full content width.
- Mobile: group metadata wraps, controls stack, task progress remains visible, and video scales to the viewport.
- Secondary actions stay inside artifact panels; the primary surface keeps only create, generate, render, retry, and download.
- Keyboard focus, touch targets, reduced motion, concise titles, and the required responsive footer credit are preserved.
