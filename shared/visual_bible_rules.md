# Episode Visual Bible Rules

- A text prompt alone cannot guarantee continuity. Define reusable identity locks before writing shots.
- Preserve channel constants across episodes: aspect ratio, graphic language, typography behavior, editorial overlay language, grain, caption style, and transition restraint.
- Define episode constants: palette, recurring hero objects, era treatment, evidence treatment, and the reconstruction boundary.
- Create one continuity bundle per sequence with a stable ID, era, location, subjects, objects/wardrobe, palette, lighting, texture, anchor-frame prompt, reference asset slots, and allowed camera variation.
- Reference asset slots are provider-neutral IDs. Provider adapters may later bind them to images, seeds, first frames, or model-specific references without polluting prompt text.
- Reconstruction must be visibly plausible and tied to research claim IDs; never present a reconstruction as archive footage in the production metadata. Do not place an AI or reconstruction disclosure label inside the visual-generation prompt.
- Define an editorial overlay language separately from footage prompts: caption, stat card, timeline, chart, map callout, comparison, and quote treatments with a restrained motion vocabulary.
- For Quiz Visual Bible documents, include a clearly labeled `Safe motion` section covering allowed motion, prohibited motion, and a reduced-motion fallback; never use strobing, flashing, seizure-triggering patterns, or unsafe rapid camera movement.
- In Quiz episodes, Anchor-frame prompts in continuity bundles must describe ONLY the clean visual subject, character, or environment illustration. Never include question cards, answer choices, countdown timers, text, or UI elements in Anchor-frame prompts; the video engine renders all interactive UI and question cards dynamically as a separate overlay.
- Overlays should appear on roughly 25–30% of shots across an episode, only when they clarify a date, number, geography, comparison, named program, or sourced quote. Most shots should remain clean footage.
