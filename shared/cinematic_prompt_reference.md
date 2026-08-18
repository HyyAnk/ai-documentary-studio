# Cinematic Prompt Reference (portable — Seedance / Veo Omni Flash / any video model)

This is the shared vocabulary for writing `visual_prompt`. It borrows proven precision techniques from professional shot-writing systems, generalized so the same text works unmodified in Seedance, Veo Omni Flash, or any comparable model — no platform-specific tags, no reference-image syntax, no voice-lock mechanics.

## Core principle: write the visible

The model reacts to what can be seen and measured, not mood words.

- ❌ "tense scene" → ✅ "man freezes, slowly clenches his fist, light only from the side, half his face in shadow"
- ❌ "epic shot of a car, fast and cool" → ✅ "low tracking shot alongside the car through a wet curve, headlights glowing, spray off the tyres"
- ❌ "documentary style" → ✅ "35mm film grain, restrained period color palette, archival reconstruction texture"

Plain, concrete, instruction-style language. Fewer precise words beat many vague ones. Positive phrasing only — state the target, never what to avoid.

The visual prompt is a footage prompt, not a graphics or post-production instruction. Keep captions, labels, logos, UI, charts, source IDs, and AI/reconstruction disclosure out of it. Use the shot's separate `editorial_overlay` metadata when a title, number, timeline, map callout, comparison, or chart should be added in the edit.

## Shot plan & timing

Every scene fits inside one fixed duration budget (`beat_duration_seconds` from config — currently the value shown in Settings). Two modes:

**Single shot** — one continuous idea fills the whole duration. No shot plan needed; just describe camera, action, lighting directly.

**Packed multi-shot** — two or three adjacent beats share era/place/continuity and are packed into one scene. Use explicit timecoded cuts:

```
SHOT PLAN (Ns total)
0.0s-3.5s — [shot 1: subject, action, camera behavior]
3.5s HARD CUT
3.5s-8.0s — [shot 2: subject, action, camera behavior]
```

Only pack beats that genuinely belong together (same era, same location or a natural match-cut between them). Never force unrelated events into one scene just to hit the duration target.

## Shot size & FOV

| Abbr | Meaning |
|------|---------|
| ECU | Extreme close-up (eyes, hands, a detail) |
| CU | Close-up (full face) |
| MCU | Medium close-up (head + shoulders) |
| MS | Medium shot (roughly to the waist) |
| WS | Wide shot (full figure + surroundings) |
| EWS | Extreme wide (scale, location) |

FOV in degrees (documentary-relevant range):

| FOV | Purpose |
|-----|---------|
| 84° | Wide establish, group blocking |
| 63° | Observational, reportage |
| 47° | Neutral human perspective, universal medium |
| 29° | Portrait compression, medium-isolate |
| 18° | Close-portrait, identity-preserving |
| 12° | Tele-detail (hands, objects) |

Use the closest discrete step, not an arbitrary number. In a multi-shot scene, state FOV per shot.

## Prompt sections (use only what the shot needs)

```
CAMERA
[Per shot: size + FOV° + movement (static / dolly / handheld / pan) + why the camera moves this way.]

ACTION
[Concrete physical actions, stated separately from camera motion. No abstractions — describe hands, posture, gaze, pace.]

LIGHTING
[Source, direction, exposure, white balance in Kelvin (3200K/4000K/5600K/8500K). Held constant across shots unless the location genuinely changes.]

ATMOSPHERE
[Film grain, haze in %, era-accurate texture, reconstruction cues — e.g. "haze density 20%", "35mm grain".]

CONTINUITY
[What stays identical across shots in this scene: subject appearance, wardrobe, environment, lighting direction, era.]
```

## Prompting rules

- Speeds in km/h, not "fast/slow."
- Atmosphere in percent/meters, not "light fog."
- Left/right described from the camera's point of view.
- Emotion through muscle-level action, never labels ("she looks sad" → "eyes drop to the table, jaw tightens").
- No director names, no signature-work references, no camera/lens/film-stock brand names — describe the look, not the gear.
- English only.

## Checklist before finalizing a scene's `visual_prompt`

- Is every shot's subject, action, and camera behavior unambiguous and visible?
- If more than one shot: are cuts marked with explicit timecodes and `HARD CUT`, summing exactly to the scene's duration?
- Does `CONTINUITY` cover everything that must not drift between shots?
- Is lighting/white-balance stated once and held, unless the location changes?
- No platform-specific syntax (no `@tag`, no reference-image mechanics, no voice-lock instructions) — the text must be paste-ready for any video model.
