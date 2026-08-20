# Candy Arcade V4 upgrade report

## Verification summary

The fixed Wonder Quest 10-question episode was regenerated after the V10 voice-cache bump and the final media-left sizing correction.

`BASELINE_TYPECHECK=pass`, `BASELINE_TEST=25 files / 98 tests passed`, `BASELINE_RENDER_OK=existing 203.000s MP4`.

| Check | Baseline | V4 result |
|---|---:|---:|
| `pnpm typecheck` | passed | passed |
| `pnpm test` | 25 files / 98 tests | 26 files / 101 tests |
| `pnpm test:e2e` | 10 passed in the prior validation | 10 passed |
| Render | existing 203.000s MP4 | fresh 175.233s MP4 |
| Render probe | 1920×1080, 30fps, AAC | 1920×1080, 30fps, AAC |
| Pre-render QA | 97/100, production_ready | 97/100, production_ready |

Final `git diff --check` passed.

The fresh video is at `tmp/quiz-v2-live-validation/2026-08-19T12-02-59-880Z/channels/little-lab-quiz-validation/episodes/wonder-quest-space-nature-everyday-science/assets/quiz-video.mp4`.

## Hero area measurement

Frame area is 1920×1080 = 2,073,600px. The old generic hero was 800×284 = 10.96% of the frame. V4 layout contracts are:

| Layout | Before | V4 hero/option image area |
|---|---:|---:|
| `media_left_choices_right` | 10.96% | approximately 840×580 = 23.51% |
| `media_top_choices_bottom` | 10.96% | 1500×500 = 36.17% in choices, 1500×360 = 26.04% while thinking/explaining |
| `visual_choices_three` | 10.96% generic fallback | 3×501×372 = 26.97% total option-art area |

The rendered frame strip confirms the media-left hero and answer column read as a true split stage, and the full Thinking Bar remains visible after the final 580px sizing adjustment.

## Thinking Bar marker

The marker is now a sibling of the scaled fill and moves with `left: 100% → 0%` under the same duration and delay. Eight evenly spaced rendered frames from the first 5.2-second thinking interval were sampled. Pixel measurements of the connected pink marker core, using a fixed color tolerance, were:

`1.0714, 1.0714, 1.0714, 1.0714, 1.0714, 1.0357, 1.0714, 1.0357`

All samples remain within the 0.92-1.08 target after raster tolerance rounding; the authored CSS box is fixed at 76×76, ratio 1.00. The regression test also checks that the marker cannot be nested under `.timer-progress` again.

## Narration pacing

Measured on the same 52-segment episode. The old files are preserved as `paced-v9`; the new files are `paced-v10`.

| Role | Before seconds | V4 seconds | Before WPS | V4 WPS |
|---|---:|---:|---:|---:|
| question | 35.553 | 28.051 | 2.222 | 2.816 |
| choice | 41.913 | 31.639 | 1.026 | 1.359 |
| thinking_prompt | 5.246 | 5.412 | 6.481 | 6.283 |
| reveal | 12.133 | 9.750 | 0.907 | 1.128 |
| explanation | 44.698 | 37.244 | 2.394 | 2.873 |
| intro | 1.887 | 2.419 | 4.239 | 3.307 |
| outro | 3.274 | 3.096 | 3.359 | 3.553 |

Master narration dropped from 202.971s to 175.215s. Timeline compilation preserved the minimum 5.2-second thinking interval, and final question cycles range from 14.866s to 19.253s, inside the age 7-9 target. The pacing cache namespace was bumped so future runs cannot silently reuse V3 tempo assets.

## Fresh frame evidence

- [Final contact sheet](../tmp/candy-arcade-v4/final/contact-sheet.png)
- [Thinking Bar eight-frame contact sheet](../tmp/candy-arcade-v4/final/thinking/contact-sheet.png)
- [Reveal start/mid/end contact sheet](../tmp/candy-arcade-v4/final/reveal/contact-sheet.png)
- [Baseline contact sheet](../tmp/candy-arcade-v4/before/contact-sheet.png)

## Deferred items

- Background music and SFX remain deferred by design. This pass preserves the narration-first mix documented in the V2 validation report.
- A recurring reacting mascot remains deferred as requested. The legacy V2 mascot code is an opportunity for a separate personality and character-design decision.
- Full browser pixel regression remains represented by deterministic composition geometry and rendered-frame evidence in this environment; the existing HyperFrames render path was used for the final MP4 and frame samples.
