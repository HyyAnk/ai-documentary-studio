# Mission: Build Quiz Engine V2

You are working inside the existing `ai-documentary-studio` repository.

Your task is to design and implement **Quiz Engine V2**, an extensible, deterministic, testable production pipeline for automatically producing high-quality children's YouTube quiz videos.

This is NOT a request to blindly add features.

You must operate as a senior software architect, senior TypeScript engineer, production pipeline engineer, QA engineer, and critical code reviewer.

The implementation is considered successful only when you can provide evidence that:

1. the architecture fits the existing repository;
2. existing documentary functionality remains intact;
3. Quiz V2 domain boundaries are clean;
4. deterministic components are actually deterministic;
5. invalid data fails before expensive rendering;
6. generated videos can be validated technically;
7. meaningful automated tests exist;
8. the full existing test suite still passes;
9. you have critically reviewed and corrected your own implementation.

---

# NON-NEGOTIABLE OPERATING RULE

Do NOT start coding immediately.

Do NOT assume the architecture described below perfectly matches the current repository.

The repository itself is the source of truth.

Before implementation you MUST inspect the existing repository and reconcile this specification with the actual code.

If the implementation already contains functionality described here:

* reuse it;
* refactor it where appropriate;
* do not create duplicate competing systems.

Do not rewrite working infrastructure simply because a new implementation appears cleaner.

Prefer incremental migration.

---

# PHASE 0 — REPOSITORY RECONNAISSANCE

Before making changes, inspect at minimum:

* root `package.json`
* workspace configuration
* `packages/shared`
* server architecture
* `apps/server/src/tasks.ts`
* `apps/server/src/context.ts`
* `apps/server/src/repository.ts`
* `apps/server/src/production.ts`
* provider implementations
* current Quiz schemas
* current Quiz pipeline tests
* current HyperFrames rendering implementation
* Chatterbox integration
* episode persistence
* configuration
* API routes
* web API layer
* episode/production UI
* task UI
* Playwright tests
* documentation describing Quiz pipeline
* production pipeline documentation

Search the repository for:

* `quiz`
* `QuizConfig`
* `QuizSceneContent`
* `GENERATE_PIPELINE`
* `GENERATE_VIDEO`
* `buildQuizComposition`
* `hyperframes`
* `render-manifest`
* `narration`
* `productionAssessment`
* `GENERATE_AUDIO`
* `GENERATE_BUNDLE_IMAGE`

Then produce an internal implementation map:

```text
CURRENT COMPONENT
PURPOSE
REUSE?
REFACTOR?
REPLACE?
REASON
```

Do not modify code until this map is complete.

---

# PHASE 0B — BASELINE

Before modifications, run the appropriate existing checks.

At minimum attempt:

```bash
pnpm typecheck
pnpm test
```

Run E2E when the environment permits:

```bash
pnpm test:e2e
```

Record internally:

```text
BASELINE_TYPECHECK
BASELINE_UNIT_TESTS
BASELINE_E2E
EXISTING_FAILURES
```

Do not attribute an existing failure to your changes.

---

# ARCHITECTURAL PRINCIPLES

Quiz Engine V2 must follow these rules.

## Rule 1 — Keep existing infrastructure

Reuse the existing:

* local-first repository;
* Fastify security boundary;
* shared Zod schemas;
* task manager;
* task events;
* scope locks;
* Codex context engine;
* Chatterbox provider;
* HyperFrames integration;
* atomic repository writes;
* episode storage;
* existing channel/episode concepts.

Do not build a second job queue.

Do not build a second persistence database.

Do not bypass RepositoryService for persistent artifacts.

---

## Rule 2 — Separate knowledge from presentation

Quiz facts must not depend on the video renderer.

Introduce a canonical Quiz domain artifact.

Conceptually:

```text
research
   ↓
quiz knowledge
   ↓
creative direction
   ↓
assets + voice
   ↓
timeline
   ↓
renderer
   ↓
QA
```

---

## Rule 3 — LLM chooses intent, code chooses pixels

Codex may choose semantic intents such as:

```text
illustrated_multiple_choice
thinking
celebrate
correct_medium
playful_slide
```

Codex must NOT be responsible for:

```text
CSS coordinates
pixel positions
raw HTML
frame indexes
absolute animation transforms
asset filenames
filesystem paths
```

Those belong to deterministic code.

---

## Rule 4 — Deterministic timeline

Given the same:

```text
Quiz
DirectorPlan
resolved assets
audio durations
render config
```

the timeline compiler must produce structurally identical output.

Do not use an LLM in timeline compilation.

---

## Rule 5 — Fail cheap

The pipeline must validate:

```text
quiz semantics
director plan
asset requirements
timeline
layout assumptions
audio availability
```

before starting an expensive video render.

---

# TARGET MODULE STRUCTURE

Do not force this exact structure if the repository reveals a materially better fit, but preserve equivalent domain boundaries.

Preferred server structure:

```text
apps/server/src/quiz/
  domain/
    quiz.ts
    directorPlan.ts
    assetPlan.ts
    voicePlan.ts
    timeline.ts
    qa.ts

  director/
    quizDirector.ts
    prompt.ts
    parseDirectorPlan.ts
    validateDirectorPlan.ts

  assets/
    assetPlanner.ts
    assetResolver.ts
    assetRegistry.ts
    assetCache.ts
    assetFingerprint.ts
    validateAssets.ts

  audio/
    voicePlanner.ts
    sfxRegistry.ts
    musicPolicy.ts

  timeline/
    timingPolicy.ts
    compileTimeline.ts
    validateTimeline.ts

  render/
    renderer.ts
    hyperframesRenderer.ts
    buildComposition.ts

    components/
      Background.ts
      QuestionCard.ts
      AnswerCard.ts
      Countdown.ts
      Score.ts
      Mascot.ts
      Reward.ts

    archetypes/
      textMultipleChoice.ts
      illustratedMultipleChoice.ts
      imageGuess.ts
      trueFalse.ts
      oddOneOut.ts
      speedRound.ts
      finalChallenge.ts

    themes/
      candyPop.ts
      spaceLab.ts
      jungleJamboree.ts
      oceanExplorer.ts

  qa/
    semanticQa.ts
    directorQa.ts
    timelineQa.ts
    assetQa.ts
    renderQa.ts
    quizAssessment.ts

  pipeline/
    QuizPipelineV2.ts
    artifactState.ts
    invalidation.ts
```

Keep files reasonably focused.

Do not create one new 2000-line `quiz.ts`.

---

# SHARED DOMAIN MODEL

Extend the shared Zod package.

Every new persistent artifact MUST:

* have a Zod schema;
* expose an inferred TypeScript type;
* contain `schema_version`;
* reject malformed values;
* use safe defaults only where semantically safe.

---

# QUIZ V2 SCHEMA

Create a canonical structure equivalent to:

```ts
QuizV2 {
  schema_version: 2
  episode_id
  age_band
  language
  questions[]
}
```

Each question should support:

```ts
id
number

format:
  multiple_choice
  image_guess
  true_false
  odd_one_out

difficulty:
  integer 1..5

question

choices[]

correct_choice_id

explanation

fun_fact

source_ids[]

visual_opportunity

validation
```

For choice-based questions:

* IDs must be unique.
* There must be exactly one canonical correct choice.
* `correct_choice_id` must exist.
* visible choices must not be duplicates after normalized comparison.

Do not silently repair logically invalid questions.

Reject them.

---

# DIRECTOR PLAN

Implement a separate creative-direction artifact.

The director works on the complete episode, not questions independently.

It should select:

```text
archetype
energy
visual_density
thinking time
beat intents
asset intents
mascot states
SFX intents
transition intent
reward intensity
```

Define semantic enums instead of arbitrary strings wherever practical.

Example archetypes:

```text
text_multiple_choice
illustrated_multiple_choice
image_guess
true_false
odd_one_out
visual_reveal
speed_round
final_challenge
```

---

# EPISODE-LEVEL DIRECTING

Director validation must examine the whole episode.

Detect:

* excessive repeated archetypes;
* identical reveal treatment throughout;
* flat energy;
* lack of visual variation;
* missing midpoint moment;
* missing final challenge;
* too many high-energy events;
* excessive animation density;
* insufficient thinking time;
* excessive thinking time.

Do not force every question to be visually busy.

Variation is more important than maximum motion.

---

# DIFFICULTY CURVE

Provide deterministic evaluation of difficulty progression.

Do not require one exact sequence, but flag obviously poor patterns such as:

```text
5,1,5,1,5,1
```

unless intentionally marked as a mixed challenge format.

The default production tendency should gradually increase difficulty.

---

# ASSET PLAN

Director output should create semantic asset requirements.

Example:

```json
{
  "asset_id": "q01-choice-b",
  "subject": "cheetah",
  "purpose": "answer_option",
  "style": "cute_illustration",
  "aspect_ratio": "1:1",
  "transparent_background": true,
  "required": true
}
```

Do not encode provider details into quiz knowledge objects.

---

# ASSET RESOLVER

Implement a provider-neutral resolver.

Resolution preference:

```text
explicit episode asset
→ channel reusable asset
→ global/local cache
→ configured image provider
→ safe built-in fallback
```

The exact order may be adjusted to fit current repository architecture.

Important:

A required asset may only fall back if the fallback still preserves the semantic correctness of the question.

For example:

A generic animal icon is NOT an acceptable fallback for an image-identification question whose answer depends on recognizing a cheetah.

That must be a blocker.

---

# ASSET CACHE

Avoid regenerating identical common assets.

Implement stable fingerprints based on normalized semantic inputs and relevant generation version/provider information.

Test that:

```text
same request → same fingerprint
materially different request → different fingerprint
```

Never use unsafe raw user strings directly as filesystem paths.

---

# VOICE PLAN

Create narration segments by semantic role.

Recommended roles:

```text
intro
question
choice
thinking_prompt
countdown
reveal
explanation
fun_fact
midpoint
outro
```

Preserve Chatterbox as the audio provider boundary.

Do not move TTS logic into the renderer.

Prefer measured audio duration after synthesis over estimated word duration.

---

# SFX SYSTEM

Create semantic SFX intents.

Minimum:

```text
ui_pop
ui_soft
countdown_tick
countdown_final
correct_small
correct_medium
correct_big
transition_soft
transition_fast
score_gain
streak
```

Implement a registry.

Director chooses the intent.

Registry resolves the actual reusable asset.

Do not expose filesystem filenames to Codex prompts.

Missing decorative SFX should degrade gracefully.

Missing narration must block render.

---

# MUSIC POLICY

Design a minimal state-based music model:

```text
intro
play
think
reveal
result
```

Do not require complex music generation.

The first implementation may use reusable local loops/stings.

Make music optional.

Narration must remain intelligible.

---

# TIMING POLICY

Centralize timing constants.

Do not scatter values across render components.

Example concepts:

```text
question entrance
choice entrance stagger
minimum thinking time
countdown interval
reveal delay
reward duration
fun fact duration
transition duration
```

Age band may influence thinking time.

---

# TIMELINE COMPILER

Create:

```ts
compileQuizTimeline(...)
```

Inputs should include normalized:

```text
QuizV2
DirectorPlan
resolved assets
voice segment durations
render configuration
```

Output:

```text
QuizTimelineV2
```

Timeline events should use semantic event types.

Examples:

```text
background.enter
question.enter
choices.enter
countdown.start
countdown.tick
answer.reveal
answer.dim_wrong
mascot.state
reward.play
sfx.play
music.state
fact.enter
transition.start
```

Event timestamps must be deterministic.

---

# TIMELINE INVARIANTS

Tests must prove:

1. no timestamp < 0;
2. events are ordered;
3. reveal occurs after thinking;
4. reveal uses the canonical answer;
5. reward occurs after reveal;
6. question N cannot reveal question N+1's answer;
7. no narration segment is scheduled outside timeline bounds;
8. timeline duration covers all events;
9. question ordering is preserved;
10. deterministic input produces deterministic output.

Create direct unit tests for every invariant.

---

# VISUAL EVENT DENSITY

Implement a QA metric for long visually static regions.

This is not a requirement that something must animate every second.

Measure significant visual events.

Flag a warning when gameplay contains an unintentionally long static interval.

Use a configurable threshold.

Do not count insignificant hidden events as visual activity.

---

# RENDERER EXTRACTION

The current Quiz HyperFrames composition must be refactored out of the general task manager.

The task manager should orchestrate rendering.

It should not own detailed quiz HTML/CSS.

Create a renderer boundary equivalent to:

```ts
interface QuizRenderer {
  prepare(input): Promise<PreparedQuizRender>
  render(input): Promise<QuizRenderResult>
}
```

HyperFrames is the first implementation.

---

# HYPERFRAMES

Preserve current working HyperFrames lint/inspect/render behavior where appropriate.

Do not regress strict rendering.

Separate:

```text
composition generation
preflight
lint
inspect
render
post-render verification
```

Return structured stage evidence.

---

# RENDER ARCHETYPES

Implement an MVP set:

1. text multiple choice
2. illustrated multiple choice
3. image guess
4. true/false
5. odd one out

If speed/final challenge can be implemented safely without significant instability, add them.

Prefer five polished archetypes over eight broken ones.

---

# VISUAL COMPONENTS

Create reusable components or equivalent render primitives for:

```text
Background
QuestionCard
AnswerCard
Countdown
Score
Mascot placeholder/state
Reward
Progress
FunFact
```

Do not duplicate large CSS strings across archetypes.

---

# THEMES

Preserve compatibility with existing Quiz themes where possible:

```text
candy_pop
space_lab
jungle_jamboree
ocean_explorer
```

Theme should control design tokens, not question logic.

Use a theme-token object equivalent to:

```text
background
surface
text
accent1
accent2
accent3
success
muted
radius
font stack
```

Avoid hardcoding theme colors throughout renderer modules.

---

# MOTION SEMANTICS

Create controlled motion primitives.

Examples:

```text
enter_pop
enter_slide
enter_scale

idle_float
idle_bob
idle_pulse

emphasis_wiggle
emphasis_punch

reward_small
reward_medium
reward_big

transition_slide
transition_wipe
transition_zoom
```

Respect reduced-motion concepts in the preview/UI when relevant.

Never introduce strobing/flashing.

---

# REWARD SYSTEM

Reward intensity must be semantic:

```text
small
medium
big
```

Avoid identical confetti after every question.

Use episode progression to vary rewards.

---

# MASCOT

Architect support for mascot state even if a full mascot asset library is not yet available.

States:

```text
idle
wave
curious
thinking
point
surprised
celebrate
encourage
```

Renderer must gracefully omit mascot when no mascot asset is configured.

Do not make mascot assets mandatory for V2 MVP.

---

# SCORE / PROGRESS

Implement on-screen progression independent of real viewer interaction.

This is a passive YouTube quiz, so do NOT pretend to know whether the viewer answered correctly.

Use labels such as:

```text
Question 3 / 10
How many did you get right?
Keep your score!
```

Do NOT increment a fake personal correctness score automatically.

A "streak" may only be used as playful invitation framing if it does not falsely claim the viewer answered correctly.

---

# PRE-RENDER QA

Implement a structured report.

Checks should cover at minimum:

## Semantic

* exact question count;
* canonical answers;
* duplicate options;
* empty content;
* source IDs;
* age compatibility;
* answer leakage.

## Director

* valid archetypes;
* beats exist;
* reveal exists;
* reward exists where required;
* adequate think time;
* whole-episode variety.

## Timeline

* all invariants;
* total duration;
* audio bounds;
* correct answer mapping.

## Assets

* required assets resolved;
* files exist;
* safe paths;
* image dimensions where available;
* valid MIME/format.

## Layout

At minimum provide deterministic checks for:

* text length limits;
* answer count;
* safe rendering assumptions;
* extremely long choices;
* excessive question length.

Where HyperFrames inspection can provide stronger evidence, use it.

---

# POST-RENDER QA

Rendering success is NOT equivalent to video quality success.

After HyperFrames render, verify with FFprobe or existing suitable tooling:

```text
file exists
nonzero size
video stream exists
audio stream exists
duration is readable
resolution
fps
audio/video duration relationship
```

When practical using existing local dependencies:

* sample frames at multiple timestamps;
* verify sampled frames are readable;
* detect obvious black frames;
* detect obviously frozen output across the entire video.

Do not add huge dependencies merely for sophisticated CV.

Prefer lightweight checks.

---

# RENDER EVIDENCE

Extend render-manifest information.

Include equivalent fields:

```json
{
  "engine": "hyperframes",
  "quiz_engine_version": 2,
  "schema_version": 2,

  "source_fingerprints": {},

  "question_count": 10,

  "duration_seconds": 120,

  "resolution": {
    "width": 1920,
    "height": 1080
  },

  "fps": 30,

  "preflight": {},
  "lint": {},
  "inspect": {},
  "render": {},
  "post_render": {},

  "qa_score": 92,

  "generated_at": "..."
}
```

Do not persist machine-specific unsafe paths in long-lived user artifacts unless absolutely required.

---

# QUIZ ASSESSMENT

Create a Quiz-specific quality assessment instead of forcing documentary metrics onto Quiz.

Suggested category weights:

```text
semantic          25
visual            20
pacing            15
audio             15
variety           10
render_integrity  15
```

Total: 100.

Ratings:

```text
production_ready
needs_review
not_ready
```

Suggested threshold:

```text
>= 85 and no blockers
production_ready

70–84
needs_review

< 70
not_ready
```

Any semantic correctness blocker must prevent `production_ready`.

---

# ISSUE MODEL

Every QA issue should contain:

```text
code
severity
message
next_action
question_ids
stage
```

Severity:

```text
blocker
warning
info
```

Error messages must tell the operator what to do.

Bad:

```text
Invalid timeline.
```

Good:

```text
Question 4 reveals choice C, but QuizV2 defines choice B as the canonical answer. Regenerate or repair the director/timeline before rendering.
```

---

# PERSISTENCE

Add repository methods for Quiz V2 artifacts.

Do not let arbitrary API file paths write into the episode.

Use explicit safe methods.

Examples:

```text
readQuiz
writeQuiz
readDirectorPlan
writeDirectorPlan
readAssetPlan
writeAssetPlan
readVoicePlan
writeVoicePlan
readQuizTimeline
writeQuizTimeline
readQuizQa
writeQuizQa
```

Names may differ.

Preserve atomic writes.

Preserve path safety.

---

# ARTIFACT VERSIONING

Every V2 JSON artifact must contain:

```text
schema_version
```

Support detecting older/missing artifacts.

Do not silently reinterpret malformed V1 data as valid V2.

---

# BACKWARD COMPATIBILITY

Existing documentary channels MUST keep working.

Existing Quiz episodes MUST remain viewable.

Implement migration or lazy upgrade where practical.

Do not destroy existing:

```text
scene_plan.md
dialogue_script.md
video_prompts.md
```

during initial V2 rollout.

V2 may derive its initial Quiz model from existing structured scene data when safe.

If migration is ambiguous, require regeneration rather than guessing.

---

# INVALIDATION GRAPH

Implement explicit artifact dependency logic.

Conceptual dependency graph:

```text
research
→ quiz
→ director
→ asset plan
→ voice plan
→ timeline
→ render
→ QA
```

But invalidation should be minimal.

Examples:

Changing an answer:

```text
invalidate director
invalidate timeline
invalidate render
invalidate dependent QA
```

Changing only an illustration:

```text
do not invalidate research
do not invalidate Quiz facts
invalidate render
invalidate render QA
```

Changing SFX registry implementation:

```text
do not invalidate Quiz
invalidate affected render outputs if necessary
```

Test invalidation behavior.

---

# TASK SYSTEM

Integrate with the existing task manager.

Do not create another asynchronous orchestration system.

Add Quiz-specific task types only when they provide a meaningful retry boundary.

Possible tasks:

```text
GENERATE_QUIZ
GENERATE_QUIZ_DIRECTOR
RESOLVE_QUIZ_ASSETS
GENERATE_QUIZ_AUDIO
COMPILE_QUIZ_TIMELINE
ASSESS_QUIZ
GENERATE_VIDEO
```

Do not mechanically create all of these if existing task composition provides a cleaner approach.

The parent production pipeline should expose meaningful progress.

---

# PIPELINE RETRY

Each completed artifact must remain available after downstream failure.

Example:

```text
quiz ready
director ready
assets ready
audio ready
timeline ready
render failed
```

Retry should restart at render unless an upstream dependency is stale.

Do not rerun Codex unnecessarily.

---

# CODEX CONTEXT

Update `ContextEngine` carefully.

Create scoped prompts for:

```text
Quiz generation
Quiz Director
```

Do NOT send renderer implementation details to the creative director prompt.

The director should see:

```text
Quiz facts
Channel DNA
visual style
age band
available semantic archetypes
available SFX intents
available mascot states
timing policy bounds
```

It should not see secrets or unrelated episodes.

Preserve auditable context manifests.

---

# DIRECTOR PROMPT CONTRACT

The Director prompt must explicitly say:

* return JSON only;
* preserve every canonical question and answer;
* never change facts;
* never invent new answer options;
* choose presentation only;
* use only supported enums;
* evaluate episode-level variation;
* respect age band;
* avoid frightening imagery;
* avoid strobing;
* avoid manipulative urgency;
* prefer visual storytelling over text-only repetition.

Parse output through Zod.

Do not trust the LLM output without validation.

---

# FACT / PRESENTATION FIREWALL

This is a mandatory invariant.

The Director is not allowed to change:

```text
question text
choice text
correct answer
source IDs
factual explanation
```

If director output attempts to redefine facts, reject it.

Presentation references question IDs.

It does not own Quiz facts.

Write tests proving this.

---

# API

Add only the routes needed for operator workflow.

Potential endpoints:

```text
GET quiz-v2
POST generate quiz
GET director-plan
POST generate director-plan
GET timeline
POST compile timeline
GET quiz-assessment
POST assess
POST render
```

Adapt route names to current API conventions.

Validate all request bodies.

---

# UI V2

Integrate with the existing episode production screen.

Do not build a disconnected second application.

For Quiz episodes expose a production rail equivalent to:

```text
Research
Questions
Director
Assets
Voice
Timeline
QA
Render
```

Each step should show:

```text
not started
ready
stale
running
failed
```

Operator should be able to:

```text
inspect artifact
regenerate affected stage
retry failure
render
view QA
preview/download MP4
```

Avoid exposing implementation noise.

---

# QA UI

Show:

```text
overall score
rating
blockers
warnings
per-category score
```

Make blockers actionable.

Example:

```text
BLOCKER
Q7 canonical answer mismatch

Expected: B — Cheetah
Timeline reveal: C — Lion

Action:
Recompile timeline.
```

---

# TEST STRATEGY

Tests are part of implementation, not cleanup.

Create tests alongside each phase.

---

# SCHEMA TESTS

Test:

```text
valid QuizV2
invalid answer reference
duplicate choice IDs
duplicate normalized choices
unsupported archetype
invalid timeline event
invalid score
```

---

# TIMELINE TESTS

Test multiple fixtures:

```text
3-question quiz
8-question quiz
30-question quiz
long narration
short narration
true/false
image guess
odd one out
mixed quiz
```

Verify deterministic snapshots or equivalent stable structural output.

Avoid fragile tests based only on huge raw HTML snapshots.

Test semantic output.

---

# RENDERER TESTS

Test:

* question appears;
* expected choices appear;
* reveal references canonical answer;
* correct archetype component is selected;
* narration asset is mounted;
* timeline duration is used;
* theme tokens are applied;
* unsafe text is escaped.

---

# QA FAILURE FIXTURES

Create intentionally broken fixtures:

```text
wrong answer reveal
missing asset
empty choice
duplicate answers
timeline overlap
missing narration
timeline too short
unsupported archetype
```

Tests must verify that the correct blocker is returned.

---

# SECURITY TESTS

Test:

```text
asset path traversal
unsafe filename
malformed JSON artifact
external path injection
HTML text escaping
```

Do not weaken RepositoryService path protections.

---

# REGRESSION TESTS

Run existing documentary tests after major architecture changes.

Quiz V2 must not alter documentary assessments or normal documentary render behavior unintentionally.

---

# E2E

Add Playwright coverage for at least the critical Quiz workflow when feasible:

```text
open Quiz episode
observe V2 production stages
run/retry stage using mocked or controlled backend behavior
view QA status
open rendered video state
```

Keep E2E deterministic.

Do not require a paid external provider.

---

# IMPLEMENTATION CHECKPOINT PROTOCOL

After EVERY major phase:

1. stop implementation;
2. run relevant typecheck/tests;
3. inspect the diff;
4. compare implementation against this specification;
5. identify defects, shortcuts, architectural leakage, missing tests, duplicated logic, naming problems, and edge cases;
6. fix discovered issues;
7. rerun tests;
8. only then proceed.

Do not claim a phase complete simply because it compiles.

---

# SELF-REVIEW QUESTIONS

At every checkpoint explicitly ask yourself:

```text
Did I duplicate an existing abstraction?

Did I put domain logic inside tasks.ts?

Did I let Codex control deterministic presentation details?

Can incorrect answers reach render?

Can missing assets reach expensive rendering?

Can the same timeline input produce different output?

Did I introduce a path-safety hole?

Did I invalidate more artifacts than necessary?

Did I write a test for the failure mode?

Did I make Documentary Engine behavior worse?

Would an operator understand the failure message?

Is this code maintainable after 1,000 automatically generated episodes?
```

If any answer is concerning, fix it before proceeding.

---

# PHASED EXECUTION

Execute in this order unless repository evidence requires a justified adjustment.

## Phase 1

Shared Quiz V2 domain schemas.

Gate:

```bash
pnpm typecheck
```

plus new schema tests.

---

## Phase 2

Repository persistence + versioning.

Gate:

repository tests.

Verify atomic writes and path safety.

---

## Phase 3

Canonical Quiz compilation/generation.

Gate:

semantic QA tests.

No Director yet.

---

## Phase 4

Quiz Director.

Gate:

Zod parsing, fact firewall, episode-level variation tests.

---

## Phase 5

Asset planning/resolution/cache abstraction.

Gate:

resolver tests, fingerprint tests, fallback tests.

Do not require an external provider for tests.

---

## Phase 6

Voice plan + SFX registry.

Gate:

deterministic semantic-plan tests.

---

## Phase 7

Timeline compiler.

This is a critical phase.

Write extensive tests before proceeding.

Gate:

all timeline invariants pass.

---

## Phase 8

Extract existing Quiz renderer from `tasks.ts`.

Preserve current working behavior first.

Gate:

old Quiz render tests continue to pass.

Do not simultaneously redesign everything during extraction.

---

## Phase 9

Introduce V2 renderer/archetypes/theme/motion.

Gate:

renderer tests and HyperFrames lint/inspect fixture where possible.

---

## Phase 10

Pre-render QA.

Gate:

broken fixture tests.

No blocker fixture should reach renderer.

---

## Phase 11

Pipeline orchestration and invalidation.

Gate:

pipeline tests proving retry from the correct stage.

---

## Phase 12

Post-render QA + render evidence.

Gate:

fixture MP4 or controlled generated render verification.

---

## Phase 13

UI.

Gate:

typecheck + targeted Playwright.

---

## Phase 14

Backward compatibility.

Test an existing V1 Quiz episode.

Test documentary episode behavior.

---

## Phase 15 — FINAL AUDIT

Run:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

If E2E cannot run because of a documented environment dependency, distinguish:

```text
NOT RUN
```

from:

```text
FAILED
```

Never report an unexecuted test as passing.

---

# FINAL CODE REVIEW

Before declaring completion, review the entire final diff as if reviewing another senior engineer's pull request.

Look specifically for:

```text
large functions
duplicated constants
renderer logic in TaskManager
unsafe filesystem access
weak Zod validation
silent fallbacks
unhandled stale artifacts
unnecessary Codex calls
incorrect dependency invalidation
fragile regex
tests that only assert strings
unused V1 code
broken documentary behavior
hardcoded Windows assumptions
machine-specific persisted paths
missing cancellation behavior
```

Fix material findings.

Then rerun affected tests.

---

# FINAL OUTPUT FORMAT

When implementation is complete, do not merely say "done".

Return a concise implementation report with:

## 1. Architecture implemented

Explain the actual final architecture.

## 2. Files changed

Group by:

```text
shared
server
quiz domain
renderer
QA
web
tests
docs
```

## 3. Major design decisions

Include important deviations from this specification and why repository evidence justified them.

## 4. Tests

Report exact commands and outcomes.

Example:

```text
pnpm typecheck
PASS

pnpm test
PASS — 124 tests

pnpm test:e2e
PASS — 16 tests
```

Never invent counts.

## 5. QA evidence

Describe what prevents:

```text
wrong-answer render
missing assets
bad timeline
audio-less video
invalid render
```

## 6. Known limitations

Be explicit.

## 7. Self-review findings

List problems discovered during your own review and what you changed to fix them.

## 8. Remaining recommendations

Only items that are legitimately outside the implemented scope.

---

# DEFINITION OF DONE

Quiz Engine V2 is NOT done until all of the following are true:

* canonical Quiz facts are separated from presentation;
* Director cannot mutate facts;
* Director uses semantic intents;
* assets are resolved through a boundary;
* timeline compilation is deterministic;
* canonical answers and rendered reveals are validated;
* renderer is separated from general TaskManager logic;
* pre-render QA can block bad input;
* post-render QA verifies the MP4;
* QA produces actionable structured issues;
* failures preserve completed upstream artifacts;
* retry starts from the appropriate stale/failed stage;
* existing documentary behavior remains operational;
* existing Quiz episodes do not become unusable;
* relevant unit tests exist;
* regression tests pass;
* typecheck passes;
* self-review has been performed;
* issues found during self-review have been addressed;
* implementation documentation is updated.

If one of these conditions cannot be achieved because of a real repository/environment limitation, document the limitation and implement the safest partial solution rather than faking completion.

---

# PRIORITY ORDER

When tradeoffs are necessary, prioritize:

1. factual correctness;
2. deterministic behavior;
3. testability;
4. backward compatibility;
5. recovery/retry behavior;
6. visual quality;
7. extensibility;
8. implementation cleverness.

Never sacrifice correctness or testability for flashy visual features.

Begin with Phase 0 repository reconnaissance.

Do not write code until you understand the existing system.
