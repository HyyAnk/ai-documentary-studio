# Visual Rules

- A scene's real budget is time, not ideas: pack adjacent beats into one scene whenever they share era, place, and visual continuity, until the dialogue's estimated spoken length reaches the scene's duration.
- Estimate spoken length as `word_count(dialogue) / narration_words_per_second` (value from config, default ≈2.3 words/sec — a measured documentary narration pace). A scene whose dialogue is well under its duration at that pace is under-packed; add the next beat instead of leaving it short, unless it is deliberately a single held dramatic beat (see below).
- Worked example at 8s and 2.3 words/sec: a full scene needs roughly 18 words of dialogue. A 7-word line only fills ~3s — combine it with the next beat rather than creating a new scene for 5 remaining seconds of near-silence.
- It is fine for a single beat to intentionally fill the whole duration alone (a held reaction shot, a dramatic pause) — packing is a target, not a rule that forbids single-idea scenes. What must be avoided is a scene whose *duration number* doesn't reflect its *actual spoken content* for no dramatic reason.
- Only start a new scene when: the combined dialogue would exceed the duration budget at the configured pace, or a genuine narrative/topic boundary occurs (new location, new era, new subject).
- Within one scene, sequence packed beats as separate timecoded shots in `visual_prompt` (see `cinematic_prompt_reference.md`) rather than splitting them into separate scenes.
- Keep era, subject, place, lens, and lighting continuity explicit across shots within a scene.
- Prefer documentary specificity over generic cinematic adjectives.
