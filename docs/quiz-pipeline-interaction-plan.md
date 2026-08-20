# Quiz pipeline interaction plan

## Primary flows

1. Open **Channels**, choose the **Quiz Channels** or **Documentary Channels** tab, then create or select a channel inside that tab. Only the selected group's channels are rendered.
2. Generate exactly five topic candidates. Each candidate carries a quiz format, age band, and question count.
3. Confirm one candidate to create a Quiz episode.
4. Set the question count, then click **Build video** once. The single pipeline runs research → treatment → script → visual bible → scenes → Quiz V2 → Director → assets → voice → timeline → QA → HyperFrames MP4.
5. Review the inline video, download the MP4, or rerun only the failed/changed stage.
6. Hover or focus a channel card to reveal **Delete channel**, or an episode row to reveal **Delete episode**. Channel deletion uses typed `Yes` confirmation; episode deletion uses a direct **Yes/No** confirmation.

## State transitions

- Channel: draft → active → archived/restored.
- Channel groups: Channels opens with one active group tab at a time. Quiz Channels and Documentary Channels each own their channel list and creation action; existing documentary channels remain in the Documentary Channels tab.
- Channel deletion: card delete affordance → yes/no choice → typed `Yes` confirmation → deleting → removed from every channel list.
- Episode deletion: episode-row delete affordance → yes/no choice → deleting → removed after server confirmation.
- Topic: generated → selected.
- Quiz episode: selected → research → treatment → script → visual bible → scenes → Quiz V2 → Director → assets → voice → timeline → QA → rendering → video ready.
- Task: queued → running → completed, failed, cancelled, or waiting for approval.

## Asynchronous behavior

- Every mutation acknowledges immediately with a pending button state and a task event.
- Delete confirmation keeps the channel visible until the server confirms deletion; the final button shows a pending state and duplicate submissions are disabled.
- Episode deletion keeps the row visible until the server confirms deletion; the Yes button shows a pending state and duplicate submissions are disabled.
- Long-running generation exposes the current step and a real percentage.
- Duplicate production or render submissions are disabled while the same episode lock is active; unrelated channels remain usable.
- WebSocket events update task progress. Terminal events refetch affected channel/episode data so results appear without reload.

## Success and recovery

- A successful render stores `quiz-video.mp4` and `render-manifest.json`, updates episode metadata, and exposes inline playback/download.
- Failed Codex, image, Chatterbox, lint, inspect, or render steps retain completed upstream artifacts and expose retry.
- `QuizV2Panel` is a live status and advanced regeneration surface. **Generate questions** is optional; it is never required before **Build video**.
- Cancelling the parent pipeline cancels active child tasks and leaves the last confirmed artifacts intact.
- HyperFrames preflight reports missing FFmpeg, FFprobe, Chrome, or source audio as the exact failed step.

## Refresh and concurrency

- Local repository files remain the source of truth.
- Task events are reconciled with API refetches after terminal state to prevent stale responses from overwriting newer artifacts.
- Per-episode locks serialize mutations; sequence/image work may run concurrently under distinct sub-locks.
- Reconnect uses bounded backoff and automatically reconciles tasks when the WebSocket returns.
- Channel deletion invalidates the local channel list and selected channel context after server confirmation; a failed delete keeps the dialog open with a retryable error.

## Desktop and mobile

- Desktop/tablet: the group tab strip stays above one active group summary and channel grid; task rail, artifacts, and video preview use the full content width.
- Mobile: the tab strip scrolls horizontally when needed, group metadata wraps, controls stack, task progress remains visible, and video scales to the viewport.
- Secondary actions stay inside artifact panels; the primary surface keeps only create, generate, render, retry, and download.
- Delete is a secondary card action revealed on hover/focus on desktop and always available as a touch-friendly icon on mobile. The confirmation modal stacks cleanly at narrow widths.
- Episode delete is a secondary row action revealed on hover/focus on desktop and always available as a touch-friendly icon on mobile. Its modal completes with Yes/No only.
- Keyboard focus, touch targets, reduced motion, concise titles, and the required responsive footer credit are preserved.
