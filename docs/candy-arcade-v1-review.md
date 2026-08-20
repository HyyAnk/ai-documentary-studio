# Candy Arcade V1 visual review

## Current to target migration

| Current renderer | Candy Arcade V1 |
| --- | --- |
| One V2 HTML/CSS composition with theme conditionals | Reusable template contract, tokens, palette resolver, layout resolver and semantic motion IDs |
| Repeated card layout with CSS topic symbols | Three semantic layouts: media-left, media-top and three visual choices |
| Generic visual fallback | Subject-aware deterministic fallback art, with provider-backed image requests when configured |
| Countdown dots | Timeline-driven Thinking Bar with independent episode progress |
| Cut/slide theme transition | Deterministic lightning-brush transition with branded mark pop |

## Review cycle one

| Problem | Change | Result |
| --- | --- | --- |
| Answer appeared in both the correct card and a central duplicate card | Removed the duplicate reveal card and used small sparkles around the highlighted canonical card | Reveal is clearer and retains one source of truth |
| Thinking marker did not follow fill | Compiled per-clip start/end percentages from the timeline thinking interval | Marker now moves exactly with the fill boundary |
| Generic top-right label repeated the question indicator | Replaced it with a phase action label | Faster visual scanning |
| No configured image provider resulted in identical star placeholders | Added deterministic subject-aware fallback illustrations for demo/degraded mode | Visual-choice answers are recognisable without leaking correctness |

## Review cycle two

The second MP4 passes HyperFrames lint/inspect, post-render media checks and the Quiz QA gate. Reviewed frames confirm: readable hierarchy at one glance, visible Thinking Bar, correct-answer emphasis without duplicate copy, distinct palette progression, semantic visual-choice cards and a branded brush transition.

## Limitations

- The live ShopAIKey/OpenAI-compatible image provider was not configured in this validation workspace, so the Golden Demo uses the deterministic semantic fallback rather than generated raster art.
- HyperFrames still reports advisory warnings for a long single-file timeline and repeated data-URI fallback images. They do not block lint or render; future template work should split long episodes into sub-compositions and use persisted generated assets.
