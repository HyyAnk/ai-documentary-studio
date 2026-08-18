# Script Rules

- Write for spoken clarity.
- Use a clear cold open, stakes, turning points, and a precise ending.
- Do not invent facts, quotes, or sources.
- Write to the episode's target word count within the stated tolerance.
- Follow the approved treatment sequence order and make each sequence change the viewer's understanding.
- Prefer dated events, named actors, decisions, evidence, and consequences over repeated abstract explanation.
- Keep claim IDs in HTML comments after each section so narration stays clean while the source trail remains auditable.
- Do not include generic visual directions inside narration. Visual development happens after the script is locked.
- Add a restrained humor layer to every suitable documentary script: use dry observation, ironic contrast, an unexpectedly specific analogy, or a self-aware aside to reveal a new angle on the evidence. Humor must advance the argument, not pad the runtime.
- Humor replaces a generic explanatory sentence; it is not an extra paragraph. Keep the final script near its calibrated word target after the humor beats are inserted.
- Add the hidden marker `<!-- HUMOR_POLICY: v1 -->` immediately after the script title so the pipeline can distinguish scripts reviewed under this policy from legacy artifacts.
- For a typical 6–10 minute episode, aim for roughly 2–5 humor beats, spaced across the story rather than stacked together. Keep the cold open, turning point, and ending focused unless a light line genuinely sharpens the point.
- Never invent a quote, statistic, reaction, or anecdote for a joke. Do not mock victims, vulnerable people, tragedies, or cultures. For sensitive subjects, use gentle framing and allow zero audible laughter when that is the respectful choice.
- Put an audio cue after a humorous spoken line using an HTML comment only: `<!-- AUDIO_CUE: chuckle -->` for a small amused beat or `<!-- AUDIO_CUE: laugh -->` for a rare audible laugh. The comment is not spoken and must not replace the joke's actual wording.
- Use at most one audible laugh cue per three minutes of target runtime. Prefer `chuckle` and let punctuation carry the comic timing; never write `(laughs)`, `[laugh]`, or other production directions directly into the visible narration.
