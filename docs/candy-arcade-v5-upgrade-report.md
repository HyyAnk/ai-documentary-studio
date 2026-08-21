# Candy Arcade V5 upgrade report

## Verification summary

The Candy Arcade V5 bug-fix pass was implemented against the eight confirmed defects in the task brief. A fresh five-question Golden Demo was rendered through the existing Fastify → HyperFrames path after preparing deterministic semantic PNG fallbacks for the validation-only environment.

`TYPECHECK=pass`, `TEST=27 files / 133 tests passed`, `E2E=11 passed`, `DIFF_CHECK=pass`, `PREFLIGHT_QA=97/100 production_ready`, `RENDER=pass`.

| Check | V5 result |
|---|---:|
| Typecheck | passed |
| Server tests | 27 files / 133 tests |
| Browser E2E | 11 passed |
| HyperFrames lint | 0 errors, 2 non-blocking track-density warnings |
| HyperFrames validate | 0 errors; 21 contrast audit warnings retained in the existing palette contract |
| HyperFrames inspect | 0 errors / 0 warnings; 6 informational intentional animation overflows |
| Fresh MP4 | 92.967s, 1920×1080, 30fps, H.264 + AAC |
| Post-render QA | no render issues |

Fresh video: [`quiz-video.mp4`](../tmp/candy-arcade-golden-demo/2026-08-21T03-17-51-720Z/channels/candy-arcade-golden-demo/episodes/candy-arcade-challenge/assets/quiz-video.mp4)

## Before / after measurements

| Area | Before V4 behavior | V5 result |
|---|---|---|
| Voice slowdown | `pacingLimit / actual` had no lower bound | `MIN_QUIZ_VOICE_SLOWDOWN_TEMPO = 0.85`; clamp telemetry includes segment, role, actual pace, limit, and applied tempo |
| Choice prosody | Three-item lists could become isolated single-word TTS calls | Short lists remain one phrase; longer comma boundaries split only when both sides have at least three words |
| Reveal TTS | `exaggeration: .80` on a bare answer word | `exaggeration: .66`; reveal copy remains functionally unchanged |
| Answer face policy | Option groups forced `none` | Planner and schema default use `natural_only`; solo hero `none` contract is unchanged |
| Background rays | Fixed 1640×1640 box, 820px radius, `.13` opacity, scene-duration rotation | `inset:-30%` box measured 3072×1728 (`x=-576..2496`, `y=-324..1404`), `.065` opacity, fixed 150s rotation |
| Thinking Bar timing | Appeared at `clipStart + thinkingAt` after drain had already finished | Visibility and drain both start at `clipStart` and use `timerDuration` |
| Thinking Bar styling | White card with instructional captions | Transparent floating track, saturated green/cyan/blue/purple/pink fill, no instructional text |
| Image motion | `answer-float` was defined but unused | `.option-image` and `.answer-card img` consume `answer-float` with deterministic `--item-phase` staggering; visual reveal uses a separate border/parent animation |
| Bar position | Grid flow varied by layout | `phase-region` is absolute at `bottom:54px`; measured top is `Y=848px` in every question clip |

## Fixed-position and overlap audit

The fresh validation DOM measured five question clips covering all four layouts:

| Layout | Phase top | Phase bottom | Foreground overlap |
|---|---:|---:|---:|
| `media_left_choices_right` | 848px | 1026px | 0 |
| `visual_choices_three` | 848px | 1026px | 0 |
| `media_top_choices_bottom` | 848px | 1026px | 0 |
| `media_center_choices_side` | 848px | 1026px | 0 |

The fact card intentionally occupies the same phase slot during the later reveal/explanation state; it is time-separated from the Thinking Bar. Bar and fill computed animation delays were identical for every clip (`--clip-start`).

## Audio diagnostics

The fresh narration contains 52 measured segments and is 92.946s long. Peak level is `0.8421`, clipping samples are `0`, and reveal-to-explanation energy ratio is `1.064`. The diagnostics flagged one 1.15s unexpected low-audio run for review; the remaining long low-audio runs are inside expected countdown/transition windows. Choice/reveal spot checks show short choice lists remain contextualized and reveal segments use the calmer `.66` exaggeration setting.

Diagnostics: [`narration-diagnostics.json`](../tmp/candy-arcade-golden-demo/2026-08-21T03-17-51-720Z/.documentary-studio/quiz-voice/ep_1d0302b0f65b4250/narration-diagnostics.json)

## Fresh frame evidence

- [Full question-cycle contact sheet](../tmp/candy-arcade-v5/final/full-cycle/contact-sheet.png)
- [Eight-frame Thinking Bar drain contact sheet](../tmp/candy-arcade-v5/final/thinking/contact-sheet.png)
- [All four layout contact sheet](../tmp/candy-arcade-v5/final/layouts/contact-sheet.png)
- [Ray coverage and calm drift contact sheet](../tmp/candy-arcade-v5/final/rays/contact-sheet.png)
- [Animal option close-up A](../tmp/candy-arcade-v5/final/animals/animal-option-a.jpg)
- [Animal option close-up B](../tmp/candy-arcade-v5/final/animals/animal-option-b.jpg)
- [Layout measurement JSON](../tmp/candy-arcade-golden-demo/2026-08-21T03-17-51-720Z/.documentary-studio/hyperframes/ep_1d0302b0f65b4250/v5-layout-measurements.json)

## Reviewed decisions

The reveal still repeats the answer name intentionally as a quiz-show beat; only phrase context and reveal performance settings changed. Background music, SFX, mascot behavior, palette resolution, solo-hero face policy, and the documentary pipeline were left untouched.
