# Prompt Rules

Write `visual_prompt` following the full structure in `cinematic_prompt_reference.md` (shot plan/timecodes when packed, CAMERA, ACTION, LIGHTING, ATMOSPHERE, CONTINUITY sections). This is required, not optional — a single unstructured paragraph is not an acceptable output.

- If the scene packs more than one beat, open with a `SHOT PLAN` block: timecoded ranges ending in a stated `HARD CUT`, summing exactly to the scene's duration.
- Describe subject, environment, era, action, camera (shot size + FOV°), composition, lighting (with Kelvin white balance), atmosphere (grain/haze in %), and continuity for every shot.
- State camera motion and subject motion separately — never conflate them.
- Keep API parameters, model names, and platform-specific syntax out of the prompt text (no `@tag` references, no voice-lock instructions, no v2v/i2v directives) — this text must be paste-ready for Seedance, Veo Omni Flash, or any comparable model without editing.
- Do not combine genuinely unrelated events (different era, different location, different subject) into one shot or one scene — pack only beats that truly belong together, per `visual_rules.md`.
- Run the checklist in `cinematic_prompt_reference.md` before finalizing each scene's prompt.
