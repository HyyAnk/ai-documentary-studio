# Candy Arcade V4 interaction plan

## Primary flow

Each question follows one deterministic visual state sequence: question entrance → choices entrance → one persistent thinking countdown → answer reveal → explanation or fact → transition. The timer fill and marker share the same start, duration, and normalized progress, so seeking never creates a second countdown clock or a boundary jump.

## State transitions and acknowledgement

- Question entrance acknowledges a new question with the title and hero entrance animation.
- Choices entrance acknowledges the available answers with staggered cards.
- Thinking acknowledges the active decision window with the visible Thinking Bar, moving marker, caption, and restrained ambient motion.
- Reveal acknowledges the result with the canonical correct card, a brief impact flash, overshoot, check badge, and reward particles. Incorrect cards recede without changing quiz semantics.
- Explanation acknowledges the teaching beat with the fact card and keeps the hero alive with deterministic Ken Burns motion.

## Asynchronous operations and recovery

Asset planning and resolution remain cache-first, provider-second, and deterministic fallback last. Every compiled asset prompt is logged with channel, episode worker, and step context. Provider failure preserves the existing issue severity and next action. Voice synthesis persists measured segment durations before timeline compilation; a failed or missing measurement blocks preflight instead of showing an unconfirmed duration.

## Data refresh strategy

The existing artifact invalidation chain remains authoritative: asset changes invalidate render and QA; voice changes invalidate timeline, render, and QA; timeline changes invalidate render and QA. After each successful mutation, the next pipeline stage reads the persisted artifact, so no manual refresh or stale in-memory result is used.

## Desktop and mobile behavior

The production composition remains a fixed 1920×1080 canvas for HyperFrames. Media-left uses a large split stage at render resolution; media-top uses a wide hero with a shorter thinking-phase height so the answer grid and Thinking Bar stay inside the frame. Reduced-motion users receive the same states and copy with animation collapsed to an instant acknowledgement. No quiz content or canonical answer mapping changes between layout variants.

## Locked Thinking Bar invariant

The Thinking/Progress Bar is present in 100% of question clips, at one fixed pixel position relative to the 1920×1080 frame, identical across every layout and every question. It becomes visible at the same instant as the question and drains continuously until the reveal. This is a locked invariant of the Candy Arcade template.
