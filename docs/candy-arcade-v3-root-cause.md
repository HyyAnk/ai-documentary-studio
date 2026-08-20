# Candy Arcade V3 root-cause report

This is the pre-implementation inspection for the V3 visual and voice pass.

| Issue | Owning module | Observed symptom | Root cause | Change and verification |
|---|---|---|---|---|
| Progress jump | `apps/server/src/quiz/render/candyArcadeComposition.ts` | The fill/token can jump at countdown boundaries | The thinking interval was emitted as a pre-countdown clip plus one clip per countdown tick; each clip recreated independent `width` and `left` animations | Emit one persistent timer clip and animate one transformed parent that owns both fill and marker; test normalized values, seek determinism, and 24/30/60fps continuity |
| Progress visual quality | Candy Arcade composition CSS | Looks like a dashboard bar | Thin track, layout `width`/`left` animation, weak token hierarchy | `QuizTimerTrack`: thick shell, depth, sticker token, coupled transformed progress parent, deterministic sparkle accents |
| Static foreground | Composition CSS | Cards settle into still UI while children think | Ambient behavior was mostly limited to the hero entrance and background shapes | Add deterministic float/breathe/drift/tilt primitives and phase offsets; test identical output for identical IDs |
| Transition simplicity | Director defaults and composition CSS | Brush wipe reads as a generic web transition | Default was `brush_wave` and had no explicit attack/hit/release acts | Make `bubble_splash` the default with six curated bubbles, a brand hit, particles, and release; preserve brush as alternate |
| Reveal simplicity | Composition CSS | Correct/wrong states appear together | State classes and reveal effects began at the same clip timestamp | Stagger wrong-card recession, correct emphasis, sticker pop, and reward particles; verify event order remains canonical |
| Visual answer inconsistency | Shared asset contract and prompt compiler | Generated answer sets can differ in face treatment/detail | Contract omitted detail level and face policy | Add `detail_level` and `face_policy`, include both in prompts, retain blocker/manual-review fairness gates |
| Voice monotony | `quiz/audio/voicePlan.ts`, `quiz/audio/voiceSynthesis.ts` | Host sounds like one flat read | Large monolithic segments and one tempo per role; thinking copy existed but was not scheduled | Add semantic phrases, role delivery, deterministic pause classes, role-specific supported Chatterbox settings, and scheduled thinking prompts |
| Phrase timing | Voice synthesis | Phrases run together or gaps repeat mechanically | No phrase boundaries or pause intent existed | Segment only natural punctuation/clause boundaries and vary pauses deterministically within bounded classes |
| Long low-audio regions | Timeline and narration assembly | Extended dead air relative to the reference | Thinking prompt was not synthesized; every question had broad silent intervals | Schedule short thinking prompts inside existing thinking time and persist low-audio/occupancy diagnostics |
| Question/reveal structure | Timeline compiler | Reveal/fact delivery is not clearly separated | Reveal and explanation were scheduled as ordinary adjacent narration with no performance metadata | Keep canonical text unchanged, give reveal higher supported exaggeration, preserve a deliberate reveal hold, then deliver explanation/fact warmer |

V4 applies the same explicit art-direction discipline to solo hero images. Answer-option sets still use their shared consistency group, while `hero_question_image` and `question_illustration` prompts now receive a deterministic solo contract for polished 3D clay-like rendering, dimensional lighting, rim-light edge treatment, medium child-friendly detail, and a `face_policy: none` decision. This prevents a hero subject from becoming accidentally photographic or anthropomorphic simply because it has no answer-set group.

## Provider capability map

The installed Chatterbox adapter accepts `text`, optional `voice_reference_path`, `exaggeration`, and `cfg_weight`. V3 uses only those existing fields. Pace is controlled through phrase segmentation, bounded deterministic gaps, and the existing FFmpeg `atempo` post-process; no unsupported provider parameter was introduced.

## Controlled asset strategy decision

The current production path remains separate provider calls with an identical RenderContract. It preserves subject accuracy and existing per-asset caching, while the strengthened contract makes style, framing, detail, and face policy explicit. Contact-sheet generation remains a future experiment because it would add crop failure modes and a new provider path without evidence that it improves this pipeline’s current assets.
