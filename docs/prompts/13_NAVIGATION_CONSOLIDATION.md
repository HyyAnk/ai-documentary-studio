# NAVIGATION CONSOLIDATION — REMOVE REDUNDANT TOPICS/EPISODES TABS

Grounded in the current repo: `apps/web/src/components/types.ts` (`Page`), `apps/web/src/components/AppChrome.tsx` (`Sidebar`), `apps/web/src/App.tsx` (routing/state), `apps/web/src/components/ChannelView.tsx` (`ChannelsView`, `ChannelDetail`, `ChannelsListView`), `apps/web/src/components/EpisodeView.tsx` (`EpisodesView`, `EpisodeDetail`), `apps/web/src/components/TopicPanel.tsx` (`TopicsView`), `apps/web/src/components/ChannelList.tsx` (`DashboardView`).

## Why

Auditing what each page actually renders:

- **Dashboard** — metrics + a full channel grid (`channel-grid`) + activity feed. The channel grid duplicates Channels.
- **Channels** (nothing selected) — renders `ChannelsListView`, which is the same channel grid again.
- **Channels** (channel selected) — `ChannelDetail`, which already renders DNA, topic suggestions (`topics.slice(0, 5).map(...)`), **and** the episode list (`episodes.map(...)`) inline, all in one screen. This is where the real, unique content lives.
- **Topics** (top-level) — `TopicsView` in `TopicPanel.tsx` renders nothing but a list of channels; clicking one just calls `openChannel()`. It shows zero topic data of its own — it's a pure re-route to Channels.
- **Episodes** (top-level, no channel context) — dead-ends on "Select a channel" with no way to pick one from that screen. With a channel selected, it shows an episode list that `ChannelDetail` already renders inline.

Net result: four sidebar destinations, two of which (Topics, Episodes) add no capability that Channels doesn't already have, and one of which is a dead end when opened directly. Consolidate to **Dashboard, Channels, Tasks, Settings**.

## 1. `apps/web/src/components/types.ts`

```ts
export type Page = "dashboard" | "channels" | "tasks" | "settings";
```

Remove `"topics"` and `"episodes"`.

## 2. `apps/web/src/components/AppChrome.tsx` — `Sidebar`

Remove the `topics` and `episodes` entries from the `items` array:

```ts
const items: Array<{ page: Page; label: string; icon: typeof House }> = [
  { page: "dashboard", label: "Dashboard", icon: House },
  { page: "channels", label: "Channels", icon: Broadcast },
  { page: "tasks", label: "Tasks", icon: ListChecks },
];
```

Drop the now-unused `Lightbulb` and `FilmSlate` imports from this file's import line (they're still used elsewhere in `ChannelView.tsx`/`EpisodeView.tsx` — only remove them here).

## 3. `apps/web/src/components/EpisodeView.tsx` — keep `EpisodeDetail`, drop the rest

- Add `export` to `function EpisodeDetail(...)` — it currently isn't exported.
- Delete the exported `EpisodesView` function entirely. Its "no channel selected" dead-end and its episode-list branch are both redundant now — `ChannelDetail` already renders the episode list inline and is reached through `Channels`, so there's no remaining caller for a standalone episode-list screen.
- Leave `EpisodeDetail` and everything it depends on (state, helpers, sub-components in this file) unchanged — only its container changes, not its content.

## 4. Delete `apps/web/src/components/TopicPanel.tsx`

Remove the file and its import in `App.tsx`. `ChannelDetail` already shows topic suggestions for the open channel; there is no unique content left in this file to preserve.

## 5. `apps/web/src/components/ChannelView.tsx` — `ChannelsView` absorbs episode detail

Extend `ChannelsView` to take `selectedEpisodeId` and render `EpisodeDetail` when both a channel and an episode are selected:

```ts
import { EpisodeDetail } from "./EpisodeView";

export function ChannelsView({
  selectedChannel, selectedEpisodeId, channels, tasks, onTaskSubmitted,
  openChannel, openEpisode, onCreate, onRefresh, onNotice,
  maxDuration, narrationWordsPerSecond,
}: {
  selectedChannel: Channel | null;
  selectedEpisodeId: string | null;
  channels: Channel[];
  tasks: Task[];
  onTaskSubmitted: (task: Task) => void;
  openChannel: (id: string) => void;
  openEpisode: (channelId: string, episodeId: string) => void;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (notice: NonNullable<Notice>) => void;
  maxDuration: number;
  narrationWordsPerSecond: number;
}) {
  if (selectedChannel && selectedEpisodeId) {
    return <EpisodeDetail
      channel={selectedChannel}
      episodeId={selectedEpisodeId}
      tasks={tasks}
      onTaskSubmitted={onTaskSubmitted}
      maxDuration={maxDuration}
      narrationWordsPerSecond={narrationWordsPerSecond}
      onBack={() => openChannel(selectedChannel.channel_id)}
      onNotice={onNotice}
    />;
  }
  if (selectedChannel) {
    return <ChannelDetail channel={selectedChannel} channels={channels} tasks={tasks} onTaskSubmitted={onTaskSubmitted} onBack={() => openChannel("")} onRefresh={onRefresh} onNotice={onNotice} openEpisode={openEpisode} />;
  }
  return <ChannelsListView channels={channels} onCreate={onCreate} openChannel={openChannel} />;
}
```

`ChannelDetail` itself is unchanged — it already calls `openEpisode(channel.channel_id, episode.episode_id)` from its inline episode list, which now stays within the same `channels` page instead of navigating to a separate one.

## 6. `apps/web/src/App.tsx` — routing/state

- `openEpisode`: change the page it sets.
  ```ts
  const openEpisode = (channelId: string, episodeId: string) => { setSelectedChannelId(channelId); setSelectedEpisodeId(episodeId); setPage("channels"); };
  ```
- `navigate`: simplify now that there's one page that owns both selections.
  ```ts
  const navigate = (next: Page) => {
    setPage(next);
    if (next !== "channels") { setSelectedChannelId(null); setSelectedEpisodeId(null); }
  };
  ```
- Remove the `page === "topics"` and `page === "episodes"` render branches and their `TopicsView`/`EpisodesView` imports.
- Update the `page === "channels"` branch to pass the new props:
  ```tsx
  <ChannelsView
    selectedChannel={selectedChannel}
    selectedEpisodeId={selectedEpisodeId}
    channels={channels}
    tasks={tasks}
    onTaskSubmitted={upsertTask}
    openChannel={openChannel}
    openEpisode={openEpisode}
    onCreate={() => setShowCreate(true)}
    onRefresh={refresh}
    onNotice={setNotice}
    maxDuration={appConfig?.video_generation.max_scene_duration_seconds ?? 8}
    narrationWordsPerSecond={appConfig?.video_generation.narration_words_per_second ?? 2.3}
  />
  ```

## 7. `apps/web/src/components/ChannelList.tsx` — trim `DashboardView`'s channel grid

Dashboard should stay an overview, not a second full channel browser. Replace the full `channel-grid` in `DashboardView` with a short "recent channels" preview (top 6 by `updated_at`, descending) plus a link into the full list:

```tsx
<div className="section-heading">
  <div><p className="eyebrow">Library</p><h2>Channels</h2></div>
  <button className="text-button" onClick={openChannelsList}>View all <ArrowUpRight size={15} /></button>
</div>
{channels.length === 0
  ? <EmptyState icon={<Broadcast size={26} />} title="No channels" copy="Create a channel to begin." action="Create channel" onAction={onCreate} />
  : <div className="channel-grid">
      {[...channels].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6)
        .map((channel, index) => <ChannelCard key={channel.channel_id} index={index + 1} channel={channel} onOpen={() => openChannel(channel.channel_id)} />)}
    </div>}
```

Add an `openChannelsList: () => void` prop to `DashboardView`, wired in `App.tsx` to `() => navigate("channels")`. `ChannelsListView` (used inside `ChannelsView` for the no-selection case) is unchanged — it remains the one place that shows every channel.

## Acceptance criteria

- Sidebar shows exactly four items: Dashboard, Channels, Tasks (Settings stays as the separate bottom item it already is).
- Opening an episode from a channel's episode list stays under the "Channels" nav item (it no longer switches to a different top-level tab), and the back button returns to that channel's detail view.
- No dead-end screen exists anywhere in the app — every reachable page shows either content or a clear path to get some (e.g. "Create a channel").
- `TopicPanel.tsx` no longer exists in the repo; no remaining import references it.
- `EpisodesView` no longer exists as an exported symbol; `EpisodeDetail` is exported and is the only surviving piece of that file's page-level UI.
- Dashboard shows at most 6 recent channels with a working "View all" link into the full Channels list; Channels remains the single place to browse every channel.
- `pnpm typecheck` and the existing test suite pass with no new failures introduced by removing these files/branches.

---

# PART B — CONTINUITY BUNDLE ANCHOR IMAGES (STYLE LOCK)

Grounded in the current repo: `packages/shared/src/index.ts` (`SceneSchema.continuity_bundle_id`/`reference_asset_ids`, already present but always empty), `shared/visual_bible_rules.md` (`Anchor-frame prompt` field, already required per bundle), `apps/server/src/context.ts` (`GENERATE_VISUAL_BIBLE`/`GENERATE_SEQUENCE_SCENES` branches), `apps/server/src/tasks.ts`, `apps/server/src/providers/index.ts` (`ImageProvider`, already stubbed), `apps/web/src/components/EpisodeView.tsx` (the existing `sequence-divider` grouping in the scene list).

## Why this is cheap, not expensive

Text prompts alone can't guarantee two independently-generated 8s clips look like the same footage. A real reference image is a much stronger lock. The question is granularity — and the codebase already answers it: continuity bundles (`CB-01`, `CB-02`, ...) are defined per **sequence** (6–10 per episode), not per scene, and every scene under a sequence already carries that sequence's `continuity_bundle_id`. So the right unit is **one anchor image per bundle, reused by every scene in it** — for a typical episode with 20–40 scenes across 6–10 sequences, that's 6–10 images generated once, not one per scene. `reference_asset_ids` on `Scene` already exists specifically to hold this; it has just never been populated.

Since Codex itself can generate images (the account in use has an image-generation skill), no separate external service is needed — unlike audio (`06_AUDIO_INTEGRATION.md`), which needed a Python sidecar because Chatterbox is a standalone library. Image generation here is just another Codex task type, using the App Server connection that already exists in `codex.ts`.

## 1. Config (`packages/shared/src/index.ts`, `AppConfigSchema`)

```ts
image_generation: z.object({
  enabled: z.boolean().default(false),
  images_per_bundle: z.number().int().min(1).max(2).default(1),
}),
```

`images_per_bundle: 2` is an opt-in for extra insurance (e.g. one wide establishing anchor + one close/detail anchor) — default stays at 1 to keep this cheap by default. Expose both in Settings under a new "Images" section, off by default until the user turns it on.

## 2. Provider (`apps/server/src/providers/`)

New `apps/server/src/providers/codexImage.ts` implementing the existing, unchanged interface:

```ts
export interface ImageProvider {
  generateReference(prompt: string): Promise<{ asset_path: string }>;
}
```

`generateReference` runs a Codex task (see Step 4) rather than calling an external HTTP service — it submits a turn asking Codex to produce one image for the given anchor-frame prompt, using whatever image-generation skill/model the connected Codex account has, and saves the returned image bytes to disk.

**Implementation-time verification needed:** exactly how the App Server surfaces generated image output (a base64 image content block in the turn result, a file path Codex reports after writing it itself, or something else) depends on the specific image skill available to the connected Codex account. Research the current App Server response shape for an image-producing turn before wiring this up — the same caution `00_MASTER_KICKOFF.md` already asks for when integrating any App Server behavior that isn't yet confirmed against the live protocol.

## 3. Where images live

```
channels/<slug>/episodes/<slug>/assets/bundles/CB-01.png
channels/<slug>/episodes/<slug>/assets/bundles/CB-01-alt.png   (only if images_per_bundle: 2)
```

Same `assets/` convention already used for scene audio; reuse the existing path-sanitization helpers, nothing new needed there.

## 4. Task type and route

New task type `GENERATE_BUNDLE_IMAGE`. Reuse the existing `submit(taskType, channelId, episodeId, sceneNumber)` signature exactly as `GENERATE_SEQUENCE_SCENES` already does — pass the bundle's number (`1` for `CB-01`, `2` for `CB-02`, ...) as the `sceneNumber` argument; no `Task` schema change needed.

Route in `apps/server/src/app.ts`:

```
POST /api/channels/:channelId/episodes/:episodeId/visual-bible/bundles/:bundleNumber/image
```

Submits one `GENERATE_BUNDLE_IMAGE` task for that bundle. Add a batch counterpart:

```
POST /api/channels/:channelId/episodes/:episodeId/visual-bible/images/generate-all
```

Parses `visual_bible.md` for every `## Continuity bundle CB-XX` heading and submits one task per bundle missing an image (or every bundle, if `{ force: true }` is passed) — same "loop and submit, let the existing per-episode lock serialize them" pattern already used for `audio/generate-all` in `09_VOICE_LIBRARY_AND_BATCH_AUDIO_EXPORT.md`. No new concurrency logic required; these tasks share the same episode lock as every other Codex task for that episode.

## 5. Context and completion (`apps/server/src/context.ts`, `apps/server/src/tasks.ts`)

`GENERATE_BUNDLE_IMAGE` context: the specific bundle's section from `visual_bible.md` (reuse `selectMarkdownSection` the way `GENERATE_SEQUENCE_SCENES` already selects a bundle by number), plus the channel DNA's `Visual Style`/`Visual Language` sections. Output contract: "Generate exactly one reference image matching this continuity bundle's Anchor-frame prompt. The image must depict only the environment/subject/era/palette/lighting described — no text, no captions, no logos, no split panels."

On completion:
1. Save the returned image to `assets/bundles/CB-XX.png` (or `-alt.png` for a second image).
2. Load all scenes for the episode, find every scene where `continuity_bundle_id === "CB-XX"`, and append the new asset's path into that scene's `reference_asset_ids` if not already present. Save via the existing `repository.saveScenes`.

This is the automatic propagation that avoids per-scene image generation: one task, one image, applied to every scene in that bundle without touching their `dialogue`/`visual_prompt` text at all.

## 6. UI

- In the Visual Bible section of `EpisodeDetail`/episode view, list each continuity bundle with its anchor-frame prompt text and a `[Generate anchor image]` button (or `[Regenerate]` once one exists), showing a thumbnail once generated. Add a `[Generate all bundle images]` button at the top of this section, calling the batch route.
- In the scene list, the existing `sequence-divider` header (already grouping scenes by `sequence_id`) is the natural place to show that sequence's bundle thumbnail once — not repeated on every `SceneCard` underneath it, since they all share the same reference.
- Add a `[Download all reference images]` button (zip, reusing the `archiver` dependency already added for audio export in `09_VOICE_LIBRARY_AND_BATCH_AUDIO_EXPORT.md`) so the user can grab every bundle's image in one file when it's time to paste prompts + references into Veo Omni Flash or Seedance.
- Each `SceneCard`'s video-prompt column gets a small "Reference: CB-XX" label with a `[Copy image]`/download link when that bundle has an image — a visible reminder to attach it alongside the text prompt in the video tool, since this app only produces prompts and reference assets, not the video itself.

## 7. Explicit non-goals (avoid scope creep)

- No automatic first-frame chaining from actual rendered video clips — this app never calls a video-generation API itself (`VideoProvider` is still just a stub), so it has no rendered frames to chain from. If the user wants that tighter workflow, it's a manual step outside this app: after generating a scene's video externally, save its last frame and use it as the next scene's reference input in the video tool directly. This can be documented as a recommended workflow note in `docs/episode-workflow.md`, not built.
- No per-scene image generation — only per-bundle, per Step 1's reasoning.
- No image editing/regeneration UI beyond simple regenerate — no cropping, compositing, or multi-image blending in this pass.

## Acceptance criteria

- With `image_generation.enabled` on, generating a bundle's anchor image produces a real image file under that episode's `assets/bundles/` folder and automatically appears in `reference_asset_ids` for every scene sharing that `continuity_bundle_id`.
- `[Generate all bundle images]` creates at most one task per bundle (or two, if `images_per_bundle: 2`), serialized behind the same per-episode lock as other Codex tasks — never one task per scene.
- Regenerating a bundle's image updates the reference for every scene under that bundle without altering any scene's `dialogue` or `visual_prompt`.
- `[Download all reference images]` produces a zip with one file per generated bundle image.
- With `image_generation.enabled` off (the default), nothing changes anywhere in the app — no new buttons appear, no new tasks are created.
- A scene whose bundle has no generated image yet still works normally end-to-end (text prompt only) — this feature is additive, never a blocker for existing scene/audio generation.
