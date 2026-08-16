# PRODUCT SPEC — AI DOCUMENTARY STUDIO

## 1. Objective

Local-first web dashboard for managing an AI-assisted documentary production network across multiple channels.

- Initial concept: 10 channels. The actual number must be unlimited and config-driven — see `03_DATA_MODEL.md`.
- A new channel is created entirely from the UI, no code changes.

First implementation phase covers:

```
TOPIC (candidates only) → TOPIC SELECTED → SCRIPT → SCENE BREAKDOWN → DIALOGUE BLOCK + VIDEO PROMPT BLOCK
```

No audio/video generation yet — architecture must leave room for it (see provider interfaces in `02_ARCHITECTURE.md`).

## 2. Product Feel

Must feel like a professional creative production tool. Must NOT feel like: an admin panel, a dev tool, a database manager, a generic chatbot, or a cluttered SaaS dashboard.

- Clean, compact, modern, fast, visual, minimal, information-dense without clutter.
- Short labels only in the main UI: `[+ Channel]`, `[Generate DNA]`, `[Suggest Topics]`, `[Create Script]`, `[Scene Plan]`.
- Longer explanations live in tooltips/hover/popovers, never permanently on-screen.

## 3. Workflow Continuity

The system always knows: selected channel, selected episode, current stage, applicable Channel DNA, relevant files, associated Codex thread, last AI output, next logical action.

The user never re-pastes Channel DNA or re-explains "this is the same channel." Every action inside an open episode automatically resolves `channel_id`, `channel_dna.md`, `episode_id`, topic, script, scene list, project path, and Codex context — see the context engine in `04_CODEX_INTEGRATION.md`.

## 4. Channel Manager

CRUD: create, edit, archive, delete, duplicate config, open channel folder, open/edit DNA, view episodes, view topic ideas, view production status.

Channel status values and full schema: see `03_DATA_MODEL.md`.

## 5. Topic Flow — TWO SEPARATE STEPS (important)

**Step A — Suggest Topics (lightweight, preview only)**

`[Suggest New Topics]` sends one Codex task that reads `channel_dna.md`, style guide, shared topic rules, existing topic database, and existing episode list, and returns **exactly 5** topic candidates. Each candidate contains only:

- title
- one-sentence premise
- why it fits the channel
- hook
- estimated documentary potential

This step must **not** trigger research, scripting, or scene work for any candidate — all 5 stay lightweight and cheap to generate. Display them as 5 selectable cards, e.g.:

```
[Why Flying Cars Never Happened]
[Why 3D TV Failed]
[The Technology That Arrived 30 Years Too Early]
```

**Step B — Confirm & Develop (full development, separate task)**

`[Use This Topic]` creates the episode directory + `episode.json` + `brief.md` from the chosen candidate. Only **after** this confirmation does any further AI work begin (script generation, research, scene breakdown — see below). The 4 unselected candidates are not developed further unless the user re-runs suggestion; they remain as history so future suggestions avoid repeating them.

## 6. Script Generation

After topic confirmation: `[Create Script]` → Codex receives channel + episode context only → generates `script.md`.

## 7. Scene Breakdown

`[Create Scene Breakdown]` → Codex splits the script into scenes. Every scene is a paired block:

- LEFT: Dialogue / Narration
- RIGHT: Video Generation Prompt
- Scene number, duration, optional visual/continuity notes
- `[Copy]` button on each side — copies only that block, shows a brief "Copied" confirmation, no large toast

Video prompt content: subject, environment, era, action, camera, composition, lighting, atmosphere, motion, style, continuity. No API parameters embedded in the natural-language text. Scene duration must never exceed `max_scene_duration_seconds` from config — split long dialogue into multiple scenes rather than exceeding it. A scene should be one coherent visual shot, not several unrelated events.

## 8. Editing & Regeneration

The user can edit duration/dialogue/prompt/notes directly — saves write straight to the repository file, no Codex call needed for manual edits.

`[Regenerate]` (dialogue / prompt / both) is the only action that calls Codex again for an existing scene, using the minimal single-scene context defined in `04_CODEX_INTEGRATION.md`. Keep the previous version retrievable (simple file history or a `.bak` copy on regenerate) so a regenerate never silently destroys the last good output.

## 9. Channel DNA

`templates/example_channel_dna.md` is the canonical schema example (not a real channel), with sections: Channel Identity, Core Concept, Core Question, Audience, Geographic Market, Content Pillars, Topic Selection Rules, Topics That Fit / Do Not Fit, Story Structure, Narrative Style, Tone, Visual Language, AI Reconstruction Rules, Fact Accuracy Rules, Title Patterns, Thumbnail Principles, Episode Length, Scene Rules, Voice/Narration Rules, Quality Checklist.

Channel DNA editor: Markdown view, edit mode, save/cancel/revert, file path + last-modified indicator. Saves write to the real repo file (never only browser state) and become the active context for all future tasks on that channel immediately.

Create Channel flow: name + topic/concept required; audience/language/market/notes optional. User chooses `[Upload channel_dna.md]` or `[Create DNA with AI]` (free-text description → `[Create DNA]` → Codex reads `templates/example_channel_dna.md`, adapts it to the description, preserves the schema, saves into the new channel directory, returns the result to the dashboard).

## 10. Dashboard Information Architecture

Sidebar: Dashboard, Channels, Topics, Episodes, Tasks, Settings.

- Channel view → Channel header → DNA → topic suggestions → episodes → production status.
- Episode view → Episode header → topic → script → scene breakdown → production status.

Home screen: channel count, active episodes, running tasks, items needing review, recent activity. No heavy analytics/charts in v1 — this is a production dashboard, not an analytics dashboard.

## 11. Visual Design

Whitespace, hierarchy, compact cards, clear typography, subtle borders/hover states, consistent icons, responsive layout. Avoid gradients, glassmorphism, giant cards, unnecessary animation, long labels, excessive badges. Desktop is the primary target; the two-column scene layout collapses to stacked (Dialogue above Video Prompt) on narrow screens.

## 12. Output Files (per episode)

`episode.json`, `brief.md`, `script.md`, `scene_plan.md`, `dialogue_script.md`, `video_prompts.md`. Exact storage representation may be improved, but the information must stay in readable files.
