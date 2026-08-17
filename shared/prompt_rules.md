# Prompt Rules

- A scene's Video Prompt may describe more than one shot when several beats are packed into it. Separate shots with a line containing only `CUT`.
- Each shot describes: subject, environment, era, action, camera, composition, lighting, atmosphere, motion, style.
- End the prompt with one shared continuity line covering era/style/lighting consistency across all shots in the scene, if more than one shot is present.
- Keep API parameters out of natural-language prompts.
- Do not combine genuinely unrelated events (different era, different location, different subject) into one shot or one scene — pack only beats that belong together.

Example (one ~8s scene containing three quick shots):

Wide shot of a 1970s research lab at night, fluorescent lights humming, engineers hunched over blueprints, 35mm film grain, slow dolly in.
CUT
Close-up of hands adjusting a prototype circuit board, warm desk lamp light, shallow depth of field, static camera.
CUT
Medium shot of an engineer stepping back, exhaling, glancing at a wall clock reading 3 AM, same lighting, slight handheld sway.
Continuity: same lab, same 1970s color palette and film grain across all three shots.
