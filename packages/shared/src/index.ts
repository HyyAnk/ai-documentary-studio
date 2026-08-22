import { z } from "zod";

export const QUIZ_MIN_QUESTION_COUNT = 3;
export const QUIZ_MAX_QUESTION_COUNT = 50;

export const ChannelStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

export const EpisodeStageSchema = z.enum([
  "IDEA",
  "SELECTED",
  "RESEARCH",
  "RESEARCH_READY",
  "TREATMENT",
  "TREATMENT_READY",
  "SCRIPT",
  "SCRIPT_READY",
  "VISUAL_BIBLE",
  "VISUAL_BIBLE_READY",
  "SCENE_BREAKDOWN",
  "SCENE_READY",
  "NARRATION_READY",
  "READY_FOR_GENERATION",
  "VIDEO_RENDERING",
  "VIDEO_READY",
]);
export type EpisodeStage = z.infer<typeof EpisodeStageSchema>;

export const TaskStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskTypeSchema = z.enum([
  "GENERATE_DNA",
  "SUGGEST_TOPICS",
  "GENERATE_RESEARCH",
  "GENERATE_TREATMENT",
  "GENERATE_SCRIPT",
  "GENERATE_VISUAL_BIBLE",
  "GENERATE_SCENES",
  "GENERATE_SEQUENCE_SCENES",
  "GENERATE_PIPELINE",
  "REGENERATE_DIALOGUE",
  "REGENERATE_PROMPT",
  "REGENERATE_BOTH",
  "GENERATE_NARRATION",
  "GENERATE_AUDIO",
  "GENERATE_BUNDLE_IMAGE",
  "GENERATE_VIDEO",
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

const IsoDate = z.string().datetime({ offset: true });

export const QuizImageStyleSchema = z.enum(["pixar_3d", "flat_vector", "kawaii_chibi", "voxel_lowpoly", "plastic_toy"]);
export type QuizImageStyle = z.infer<typeof QuizImageStyleSchema>;

export const ALL_QUIZ_IMAGE_STYLES: QuizImageStyle[] = ["pixar_3d", "flat_vector", "kawaii_chibi", "voxel_lowpoly", "plastic_toy"];

export const QUIZ_IMAGE_STYLE_LABELS: Record<QuizImageStyle, string> = {
  pixar_3d: "3D Pixar Animation",
  flat_vector: "2D Flat Vector",
  kawaii_chibi: "Chibi Kawaii Anime",
  voxel_lowpoly: "3D Voxel / Low-Poly",
  plastic_toy: "3D Glossy Vinyl Toy",
};

export const ChannelSchema = z.object({
  channel_id: z.string().min(1),
  slug: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().default(""),
  target_audience: z.string().default(""),
  language: z.string().default("English"),
  market: z.string().default(""),
  channel_dna_path: z.string().min(1),
  style_guide_path: z.string().nullable().default(null),
  status: ChannelStatusSchema,
  created_at: IsoDate,
  updated_at: IsoDate,
  episode_count: z.number().int().nonnegative().default(0),
  voice_reference_path: z.string().nullable().default(null),
  group_id: z.enum(["documentary", "quiz"]).default("documentary"),
  engine: z.enum(["documentary", "quiz"]).default("documentary"),
  selected_styles: z.array(QuizImageStyleSchema).default(["pixar_3d", "flat_vector", "kawaii_chibi", "voxel_lowpoly", "plastic_toy"]),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const TopicCandidateSchema = z.object({
  topic_id: z.string().min(1),
  channel_id: z.string().min(1),
  title: z.string().min(1),
  premise: z.string().min(1),
  why_it_fits: z.string().min(1),
  hook: z.string().min(1),
  estimated_potential: z.string().min(1),
  generated_at: IsoDate,
  selected: z.boolean().default(false),
  quiz_format: z.enum(["knowledge", "image_guess", "multiple_choice", "true_false", "odd_one_out"]).default("knowledge"),
  question_count: z.number().int().min(QUIZ_MIN_QUESTION_COUNT).max(QUIZ_MAX_QUESTION_COUNT).default(8),
  age_band: z.enum(["4-6", "7-9", "10-12", "family"]).default("7-9"),
  visual_style: z.enum(["mixed", "pixar_3d", "flat_vector", "kawaii_chibi", "voxel_lowpoly", "plastic_toy"]).default("mixed"),
});
export type TopicCandidate = z.infer<typeof TopicCandidateSchema>;

export const EpisodeTopicSchema = z.object({
  title: z.string().min(1),
  premise: z.string().min(1),
  hook: z.string().min(1),
});

export const QuizVisualThemeSchema = z.enum(["candy_arcade", "candy_pop", "space_lab", "jungle_jamboree", "ocean_explorer"]);
export type QuizVisualTheme = z.infer<typeof QuizVisualThemeSchema>;

export const QuizConfigSchema = z.object({
  question_count: z.number().int().min(QUIZ_MIN_QUESTION_COUNT).max(QUIZ_MAX_QUESTION_COUNT).default(8),
  quiz_format: z.enum(["knowledge", "image_guess", "multiple_choice", "true_false", "odd_one_out"]).default("knowledge"),
  age_band: z.enum(["4-6", "7-9", "10-12", "family"]).default("7-9"),
  answer_mode: z.enum(["voice_and_reveal", "voice_only"]).default("voice_and_reveal"),
  visual_theme: QuizVisualThemeSchema.default("candy_arcade"),
  visual_style: z.enum(["mixed", "pixar_3d", "flat_vector", "kawaii_chibi", "voxel_lowpoly", "plastic_toy"]).default("mixed"),
  resolved_visual_style: QuizImageStyleSchema.default("pixar_3d"),
});
export type QuizConfig = z.infer<typeof QuizConfigSchema>;

export const QuizQuestionFormatSchema = z.enum(["multiple_choice", "image_guess", "true_false", "odd_one_out"]);
export type QuizQuestionFormat = z.infer<typeof QuizQuestionFormatSchema>;

export const QuizAgeBandSchema = z.enum(["4-6", "7-9", "10-12", "family"]);
export type QuizAgeBand = z.infer<typeof QuizAgeBandSchema>;

// A child-friendly quiz needs reading, thinking, reveal, and explanation time.
// Keep this shared so topic selection and episode creation make the same promise.
export const QUIZ_SECONDS_PER_QUESTION = 33;
export const QUIZ_MIN_CHOICES_PER_QUESTION = 2;
export const QUIZ_MAX_CHOICES_PER_QUESTION = 3;

export const QuizChoiceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  text: z.string().trim().min(1).max(180),
});
export type QuizChoice = z.infer<typeof QuizChoiceSchema>;

export const QuizQuestionValidationSchema = z.object({
  semantic_status: z.enum(["pending", "validated"]).default("validated"),
  source_coverage: z.boolean().default(false),
  fact_locked: z.boolean().default(true),
});
export type QuizQuestionValidation = z.infer<typeof QuizQuestionValidationSchema>;

export const QuizQuestionSchema = z.object({
  id: z.string().min(1).max(80),
  number: z.number().int().positive(),
  format: QuizQuestionFormatSchema,
  difficulty: z.number().int().min(1).max(5),
  question: z.string().trim().min(1).max(320),
  choices: QuizChoiceSchema.array().min(QUIZ_MIN_CHOICES_PER_QUESTION).max(QUIZ_MAX_CHOICES_PER_QUESTION),
  correct_choice_id: z.string().min(1),
  explanation: z.string().trim().min(1).max(600),
  fun_fact: z.string().trim().max(600).default(""),
  source_ids: z.string().min(1).array().default([]),
  visual_opportunity: z.string().trim().max(500).default(""),
  validation: QuizQuestionValidationSchema.default({}),
}).superRefine((question, ctx) => {
  const choiceIds = new Set<string>();
  const choiceTexts = new Set<string>();
  for (const choice of question.choices) {
    if (choiceIds.has(choice.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: `Choice ID ${choice.id} is duplicated` });
    choiceIds.add(choice.id);
    const normalizedText = choice.text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (choiceTexts.has(normalizedText)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Visible choices must be unique after normalization" });
    choiceTexts.add(normalizedText);
  }
  if (!choiceIds.has(question.correct_choice_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["correct_choice_id"], message: "Canonical answer must reference a visible choice" });
  if (question.format === "true_false" && question.choices.length !== 2) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "True or false questions require exactly two choices" });
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizV2Schema = z.object({
  schema_version: z.literal(2),
  episode_id: z.string().min(1),
  age_band: QuizAgeBandSchema,
  language: z.string().trim().min(1).max(80),
  questions: QuizQuestionSchema.array().min(1).max(QUIZ_MAX_QUESTION_COUNT),
}).superRefine((quiz, ctx) => {
  const ids = new Set<string>();
  const numbers = new Set<number>();
  quiz.questions.forEach((question, index) => {
    if (ids.has(question.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "id"], message: `Question ID ${question.id} is duplicated` });
    ids.add(question.id);
    if (numbers.has(question.number)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "number"], message: `Question number ${question.number} is duplicated` });
    numbers.add(question.number);
    if (question.number !== index + 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "number"], message: "Question numbers must be sequential" });
  });
});
export type QuizV2 = z.infer<typeof QuizV2Schema>;

export const DirectorArchetypeSchema = z.enum([
  "text_multiple_choice",
  "illustrated_multiple_choice",
  "visual_multiple_choice",
  "image_guess",
  "true_false",
  "odd_one_out",
  "visual_reveal",
  "speed_round",
  "final_challenge",
]);
export type DirectorArchetype = z.infer<typeof DirectorArchetypeSchema>;

export const DirectorEnergySchema = z.enum(["gentle", "curious", "playful", "excited", "triumphant"]);
export const DirectorVisualDensitySchema = z.enum(["calm", "focused", "lively", "burst"]);
export const QuizPaletteIdSchema = z.enum(["auto", "lime", "aqua", "sunny", "purple", "pink", "orange", "red", "blue"]);
export type QuizPaletteId = z.infer<typeof QuizPaletteIdSchema>;
export const QuizLayoutIdSchema = z.enum(["auto", "media_left_choices_right", "visual_choices_three", "media_top_choices_bottom", "media_center_choices_side"]);
export type QuizLayoutId = z.infer<typeof QuizLayoutIdSchema>;
export const QuizMotionIdSchema = z.enum([
  "auto",
  "enter.pop",
  "enter.slideUp",
  "enter.slideLeft",
  "enter.slideRight",
  "enter.scale",
  "idle.float",
  "idle.push",
  "idle.pulse",
  "emphasis.wiggle",
  "emphasis.punch",
  "emphasis.glow",
  "reveal.correct",
  "reveal.incorrect",
  "exit.fade",
  "exit.slide",
]);
export type QuizMotionId = z.infer<typeof QuizMotionIdSchema>;
export const QuizTransitionIdSchema = z.enum(["auto", "bubble_splash", "brush_wave", "lightning_brush"]);
export type QuizTransitionId = z.infer<typeof QuizTransitionIdSchema>;
export const DirectorBeatIntentSchema = z.enum(["question_enter", "choice_reveal", "thinking", "countdown", "answer_reveal", "explanation", "fun_fact", "celebrate", "transition"]);
export const DirectorAssetIntentSchema = z.enum(["question_illustration", "choice_illustration", "answer_reveal", "background", "mascot_pose"]);
export const MascotStateSchema = z.enum(["idle", "wave", "curious", "thinking", "point", "surprised", "celebrate", "encourage"]);
export const SfxIntentSchema = z.enum(["ui_pop", "ui_soft", "countdown_tick", "countdown_final", "correct_small", "correct_medium", "correct_big", "transition_soft", "transition_fast", "score_gain", "streak"]);
export type SfxIntent = z.infer<typeof SfxIntentSchema>;
export const TransitionIntentSchema = z.enum(["cut", "slide", "wipe", "zoom"]);
export const RewardIntensitySchema = z.enum(["small", "medium", "big"]);

export const DirectorBeatSchema = z.object({
  question_id: z.string().min(1),
  archetype: DirectorArchetypeSchema,
  energy: DirectorEnergySchema,
  visual_density: DirectorVisualDensitySchema,
  palette_id: QuizPaletteIdSchema.default("auto"),
  layout_id: QuizLayoutIdSchema.default("auto"),
  motion_id: QuizMotionIdSchema.default("auto"),
  transition_id: QuizTransitionIdSchema.default("auto"),
  thinking_seconds: z.number().positive().max(30),
  beat_intents: DirectorBeatIntentSchema.array().min(1),
  asset_intents: DirectorAssetIntentSchema.array().default([]),
  mascot_state: MascotStateSchema.nullable().default(null),
  sfx_intents: SfxIntentSchema.array().default([]),
  transition_intent: TransitionIntentSchema,
  reward_intensity: RewardIntensitySchema,
}).strict();
export type DirectorBeat = z.infer<typeof DirectorBeatSchema>;

export const DirectorPlanSchema = z.object({
  schema_version: z.literal(2),
  episode_id: z.string().min(1),
  archetype_family: z.string().min(1).max(80),
  beats: DirectorBeatSchema.array().min(1).max(QUIZ_MAX_QUESTION_COUNT),
  midpoint_question_id: z.string().nullable().default(null),
  final_challenge_question_id: z.string().nullable().default(null),
}).superRefine((plan, ctx) => {
  const seen = new Set<string>();
  plan.beats.forEach((beat, index) => {
    if (seen.has(beat.question_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["beats", index, "question_id"], message: "Each question may have only one director beat" });
    seen.add(beat.question_id);
  });
});
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;

export const QuizAssetPurposeSchema = z.enum(["answer_option", "question_illustration", "hero_question_image", "answer_reveal", "background", "mascot"]);
export const QuizAssetStyleSchema = z.enum(["cute_illustration", "bold_icon", "photo_reference", "abstract_shape", "mascot_pose"]);
export const ImageAspectRatioSchema = z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2"]);
export type ImageAspectRatio = z.infer<typeof ImageAspectRatioSchema>;
export const QuizAssetAspectRatioSchema = ImageAspectRatioSchema;
export type QuizAssetAspectRatio = z.infer<typeof QuizAssetAspectRatioSchema>;
export const AssetConsistencyGroupSchema = z.object({
  group_id: z.string().min(1).max(120),
  question_id: z.string().min(1),
  purpose: z.literal("visual_answer_set"),
  style_family: z.string().min(1).max(120),
  rendering_medium: z.string().min(1).max(120),
  lighting: z.string().min(1).max(160),
  framing: z.string().min(1).max(160),
  background_treatment: z.string().min(1).max(160),
  subject_scale: z.string().min(1).max(120),
  contrast: z.string().min(1).max(120),
  saturation: z.string().min(1).max(120),
  edge_treatment: z.string().min(1).max(120),
  detail_level: z.string().min(1).max(120).default("medium, simplified child-friendly detail"),
  face_policy: z.enum(["none", "all", "natural_only"]).default("natural_only"),
  asset_ids: z.string().min(1).array().min(2),
});
export type AssetConsistencyGroup = z.infer<typeof AssetConsistencyGroupSchema>;
export const QuizAssetRequirementSchema = z.object({
  asset_id: z.string().min(1).max(120),
  question_id: z.string().nullable().default(null),
  subject: z.string().trim().min(1).max(180),
  purpose: QuizAssetPurposeSchema,
  style: QuizAssetStyleSchema,
  aspect_ratio: QuizAssetAspectRatioSchema,
  transparent_background: z.boolean(),
  required: z.boolean(),
  semantic_key: z.string().trim().min(1).max(180),
  consistency_group_id: z.string().min(1).max(120).nullable().default(null),
});
export type QuizAssetRequirement = z.infer<typeof QuizAssetRequirementSchema>;

export const QuizAssetPlanSchema = z.object({
  schema_version: z.literal(2),
  episode_id: z.string().min(1),
  assets: QuizAssetRequirementSchema.array(),
  consistency_groups: AssetConsistencyGroupSchema.array().default([]),
}).superRefine((plan, ctx) => {
  const ids = new Set<string>();
  const semanticKeys = new Set<string>();
  plan.assets.forEach((asset, index) => {
    if (ids.has(asset.asset_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets", index, "asset_id"], message: "Asset IDs must be unique" });
    if (semanticKeys.has(asset.semantic_key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets", index, "semantic_key"], message: "Asset semantic keys must be unique" });
    ids.add(asset.asset_id);
    semanticKeys.add(asset.semantic_key);
  });
  const assetIds = new Set(plan.assets.map((asset) => asset.asset_id));
  const groupIds = new Set<string>();
  plan.consistency_groups.forEach((group, index) => {
    if (groupIds.has(group.group_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consistency_groups", index, "group_id"], message: "Asset consistency group IDs must be unique" });
    groupIds.add(group.group_id);
    group.asset_ids.forEach((assetId, assetIndex) => {
      if (!assetIds.has(assetId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consistency_groups", index, "asset_ids", assetIndex], message: "Consistency group references an unknown asset" });
    });
  });
  plan.assets.forEach((asset, index) => {
    if (asset.consistency_group_id && !groupIds.has(asset.consistency_group_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets", index, "consistency_group_id"], message: "Asset references an unknown consistency group" });
  });
});
export type QuizAssetPlan = z.infer<typeof QuizAssetPlanSchema>;

export const QuizResolvedAssetSchema = QuizAssetRequirementSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string().min(1),
  source: z.enum(["explicit_episode", "channel_reusable", "cache", "provider", "fallback", "demo"]),
  fallback_tier: z.number().int().positive().optional(),
  degraded: z.boolean().optional(),
});
export type QuizResolvedAsset = z.infer<typeof QuizResolvedAssetSchema>;

export const QuizAssetResolutionSchema = z.object({
  schema_version: z.literal(2),
  episode_id: z.string().min(1),
  template_id: z.string().min(1).max(80),
  assets: QuizResolvedAssetSchema.array(),
});
export type QuizAssetResolution = z.infer<typeof QuizAssetResolutionSchema>;

export const VoiceSegmentRoleSchema = z.enum(["intro", "question", "choice", "thinking_prompt", "countdown", "reveal", "explanation", "fun_fact", "midpoint", "outro"]);
export type VoiceSegmentRole = z.infer<typeof VoiceSegmentRoleSchema>;
export const VoicePhraseDeliverySchema = z.enum(["normal", "emphasis", "question_end", "playful", "warm"]);
export type VoicePhraseDelivery = z.infer<typeof VoicePhraseDeliverySchema>;
export const VoicePauseClassSchema = z.enum(["micro", "phrase", "anticipation", "none"]);
export type VoicePauseClass = z.infer<typeof VoicePauseClassSchema>;
export const VoicePhraseSchema = z.object({
  text: z.string().trim().min(1),
  delivery: VoicePhraseDeliverySchema.default("normal"),
  pause_after: VoicePauseClassSchema.default("none"),
});
export type VoicePhrase = z.infer<typeof VoicePhraseSchema>;
export const VoiceSegmentSchema = z.object({
  segment_id: z.string().min(1),
  role: VoiceSegmentRoleSchema,
  question_id: z.string().nullable().default(null),
  text: z.string().trim().min(1),
  duration_seconds: z.number().nonnegative().nullable().default(null),
  phrases: VoicePhraseSchema.array().default([]),
});
export type VoiceSegment = z.infer<typeof VoiceSegmentSchema>;
export const VoicePlanSchema = z.object({ schema_version: z.literal(2), episode_id: z.string().min(1), segments: VoiceSegmentSchema.array().min(1) }).superRefine((plan, ctx) => {
  if (new Set(plan.segments.map((segment) => segment.segment_id)).size !== plan.segments.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["segments"], message: "Voice segment IDs must be unique" });
});
export type VoicePlan = z.infer<typeof VoicePlanSchema>;

export const QuizTimelineEventTypeSchema = z.enum([
  "background.enter",
  "background.motion",
  "question.enter",
  "choices.enter",
  "countdown.start",
  "countdown.tick",
  "answer.reveal",
  "answer.dim_wrong",
  "mascot.state",
  "reward.play",
  "sfx.play",
  "music.state",
  "narration.segment",
  "fact.enter",
  "transition.start",
]);
export type QuizTimelineEventType = z.infer<typeof QuizTimelineEventTypeSchema>;
export const QuizTimelineEventSchema = z.object({
  event_id: z.string().min(1),
  type: QuizTimelineEventTypeSchema,
  at_seconds: z.number().nonnegative(),
  duration_seconds: z.number().nonnegative().default(0),
  question_id: z.string().nullable().default(null),
  choice_id: z.string().nullable().default(null),
  segment_id: z.string().nullable().default(null),
  payload: z.record(z.unknown()).default({}),
});
export type QuizTimelineEvent = z.infer<typeof QuizTimelineEventSchema>;
export const QuizTimelineSchema = z.object({
  schema_version: z.literal(2),
  episode_id: z.string().min(1),
  duration_seconds: z.number().positive(),
  events: QuizTimelineEventSchema.array().min(1),
}).superRefine((timeline, ctx) => {
  if (new Set(timeline.events.map((event) => event.event_id)).size !== timeline.events.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events"], message: "Timeline event IDs must be unique" });
  for (let index = 1; index < timeline.events.length; index += 1) {
    if (timeline.events[index].at_seconds < timeline.events[index - 1].at_seconds) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events", index, "at_seconds"], message: "Timeline events must be ordered by timestamp" });
  }
  const end = Math.max(...timeline.events.map((event) => event.at_seconds + event.duration_seconds));
  if (end > timeline.duration_seconds + 0.001) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["duration_seconds"], message: "Timeline duration must cover every event" });
});
export type QuizTimeline = z.infer<typeof QuizTimelineSchema>;

export const QuizIssueStageSchema = z.enum(["semantic", "director", "assets", "voice", "timeline", "layout", "render"]);
export const QuizIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["blocker", "warning", "info"]),
  message: z.string().min(1),
  next_action: z.string().min(1),
  question_ids: z.string().array().default([]),
  stage: QuizIssueStageSchema,
});
export type QuizIssue = z.infer<typeof QuizIssueSchema>;

export const QuizAssessmentSchema = z.object({
  schema_version: z.literal(2),
  episode_id: z.string().min(1),
  assessed_at: IsoDate,
  score: z.number().int().min(0).max(100),
  rating: z.enum(["production_ready", "needs_review", "not_ready"]),
  categories: z.object({
    semantic: z.number().int().min(0).max(100),
    visual: z.number().int().min(0).max(100),
    pacing: z.number().int().min(0).max(100),
    audio: z.number().int().min(0).max(100),
    variety: z.number().int().min(0).max(100),
    render_integrity: z.number().int().min(0).max(100),
  }),
  candy_arcade_visual: z.object({
    pacing: z.number().int().min(0).max(20),
    hierarchy: z.number().int().min(0).max(15),
    asset_consistency: z.number().int().min(0).max(15),
    motion: z.number().int().min(0).max(15),
    reveal: z.number().int().min(0).max(10),
    transition: z.number().int().min(0).max(10),
    readability: z.number().int().min(0).max(10),
    visual_variety: z.number().int().min(0).max(5),
    total: z.number().int().min(0).max(100),
  }).optional(),
  issues: QuizIssueSchema.array(),
});
export type QuizAssessment = z.infer<typeof QuizAssessmentSchema>;

export const EditorialOverlaySchema = z.object({
  kind: z.enum(["none", "caption", "stat_card", "timeline", "bar_chart", "line_chart", "map_callout", "comparison", "quote"]).default("none"),
  text: z.string().default(""),
  motion: z.enum(["none", "fade_up", "slide_in", "draw_on", "count_up", "highlight"]).default("none"),
  placement: z.enum(["lower_third", "upper_left", "upper_right", "center", "side_panel"]).default("lower_third"),
  duration_seconds: z.number().positive().max(20).nullable().default(null),
  data: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().default("") })).default([]),
  source_ids: z.array(z.string()).default([]),
}).default({ kind: "none", motion: "none", placement: "lower_third" });
export type EditorialOverlay = z.infer<typeof EditorialOverlaySchema>;

export const QuizSceneContentSchema = z.object({
  phase: z.enum(["intro", "question", "reveal", "explanation", "outro"]).default("question"),
  question_number: z.number().int().positive().nullable().default(null),
  question: z.string().default(""),
  choices: z.array(z.string()).max(QUIZ_MAX_CHOICES_PER_QUESTION).default([]),
  answer: z.string().default(""),
  explanation: z.string().default(""),
  image_prompt: z.string().default(""),
});
export type QuizSceneContent = z.infer<typeof QuizSceneContentSchema>;

export const SceneSchema = z.object({
  scene_id: z.string().min(1),
  episode_id: z.string().min(1),
  scene_number: z.number().int().positive(),
  duration_seconds: z.number().positive(),
  dialogue: z.string(),
  visual_prompt: z.string(),
  transition_note: z.string().default(""),
  continuity_note: z.string().default(""),
  sequence_id: z.string().default("sequence-1"),
  sequence_title: z.string().default("Sequence 1"),
  shot_id: z.string().default(""),
  asset_type: z.enum(["archive", "document", "map", "diagram", "ai_reconstruction", "contemporary", "transition"]).default("ai_reconstruction"),
  continuity_bundle_id: z.string().default(""),
  reference_asset_ids: z.array(z.string()).default([]),
  source_ids: z.array(z.string()).default([]),
  reconstruction: z.boolean().default(true),
  sound_cue: z.string().default(""),
  editorial_overlay: EditorialOverlaySchema,
  quiz: QuizSceneContentSchema.nullable().default(null),
  audio_asset_path: z.string().nullable().default(null),
  audio_generated_at: IsoDate.nullable().default(null),
  audio_duration_seconds: z.number().nonnegative().nullable().default(null),
});
export type Scene = z.infer<typeof SceneSchema>;

export const EpisodeSchema = z.object({
  episode_id: z.string().min(1),
  channel_id: z.string().min(1),
  slug: z.string().min(1),
  topic: EpisodeTopicSchema,
  stage: EpisodeStageSchema,
  script_path: z.string().min(1),
  research_path: z.string().nullable().default(null),
  treatment_path: z.string().nullable().default(null),
  visual_bible_path: z.string().nullable().default(null),
  scene_plan_path: z.string().min(1),
  dialogue_script_path: z.string().min(1),
  video_prompts_path: z.string().min(1),
  target_duration_minutes: z.number().min(3).max(60).default(8),
  target_word_count: z.number().int().positive().default(1050),
  narration_asset_path: z.string().nullable().default(null),
  narration_generated_at: IsoDate.nullable().default(null),
  narration_duration_seconds: z.number().positive().nullable().default(null),
  narration_segment_count: z.number().int().nonnegative().default(0),
  measured_narration_words_per_second: z.number().positive().nullable().default(null),
  quiz_config: QuizConfigSchema.default({}),
  video_asset_path: z.string().nullable().default(null),
  video_generated_at: IsoDate.nullable().default(null),
  video_duration_seconds: z.number().positive().nullable().default(null),
  render_manifest_path: z.string().nullable().default(null),
  created_at: IsoDate,
  updated_at: IsoDate,
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const ProductionIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["blocker", "warning", "info"]),
  message: z.string().min(1),
  next_action: z.string().min(1),
  scene_numbers: z.array(z.number().int().positive()).default([]),
});

export const ProductionAssessmentSchema = z.object({
  score: z.number().min(0).max(100),
  rating: z.enum(["not_ready", "needs_work", "production_ready"]),
  assessed_at: IsoDate,
  metrics: z.object({
    target_duration_seconds: z.number().positive(),
    estimated_narration_seconds: z.number().nonnegative(),
    narration_word_count: z.number().int().nonnegative(),
    target_word_count: z.number().int().positive(),
    calibrated_word_target_count: z.number().int().positive().optional(),
    scene_count: z.number().int().nonnegative(),
    sequence_count: z.number().int().nonnegative(),
    unique_prompt_ratio: z.number().min(0).max(1),
    structured_prompt_ratio: z.number().min(0).max(1),
    continuity_coverage_ratio: z.number().min(0).max(1),
    source_coverage_ratio: z.number().min(0).max(1),
    narration_coverage_ratio: z.number().min(0).max(1),
    overlay_coverage_ratio: z.number().min(0).max(1).default(0),
    factual_anchor_count: z.number().int().nonnegative(),
    research_source_count: z.number().int().nonnegative(),
  }),
  issues: ProductionIssueSchema.array(),
});
export type ProductionAssessment = z.infer<typeof ProductionAssessmentSchema>;

export const TaskSchema = z.object({
  task_id: z.string().min(1),
  task_type: TaskTypeSchema,
  channel_id: z.string().min(1),
  episode_id: z.string().nullable(),
  status: TaskStatusSchema,
  created_at: IsoDate,
  started_at: IsoDate.nullable().default(null),
  completed_at: IsoDate.nullable().default(null),
  codex_thread_id: z.string().nullable().default(null),
  codex_turn_id: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  output_files: z.array(z.string()).default([]),
  lock_key: z.string().min(1),
  queue_position: z.number().int().nonnegative().nullable().default(null),
  progress_message: z.string().default(""),
  progress_percent: z.number().min(0).max(100).nullable().default(null),
  scene_number: z.number().int().positive().nullable().default(null),
  accumulated_duration_seconds: z.number().nonnegative().default(0),
});
export type Task = z.infer<typeof TaskSchema>;

export const EngineIdSchema = z.enum(["codex", "antigravity"]);
export type EngineId = z.infer<typeof EngineIdSchema>;

export const AppConfigSchema = z.object({
  active_engine: EngineIdSchema.default("codex"),
  video_generation: z.object({
    provider: z.string().default("hyperframes"),
    model: z.string().default(""),
    hyperframes_command: z.string().default("npx hyperframes"),
    render_quality: z.enum(["draft", "standard", "high"]).default("draft"),
    fps: z.number().int().min(24).max(60).default(30),
    max_scene_duration_seconds: z.number().positive().default(8),
    default_scene_duration_seconds: z.number().positive().default(6),
    narration_words_per_second: z.number().positive().default(2.3),
    aspect_ratio: z.string().default("16:9"),
  }),
  image_generation: z.object({
    enabled: z.boolean().default(true),
    images_per_bundle: z.number().int().min(1).max(2).default(1),
    provider: z.string().default("gpti2"),
    model: z.string().default("gpt-image-2"),
    api_key: z.string().default(""),
    has_api_key: z.boolean().optional(),
    quality: z.string().default("low"),
    max_concurrent_tasks: z.number().int().positive().default(3),
  }),
  codex: z.object({
    max_concurrent_tasks: z.number().int().positive().default(3),
    transport: z.enum(["app_server", "openai_compatible"]).default("app_server"),
    app_server_endpoint: z.string().default("stdio://"),
    command: z.string().default("codex"),
    model: z.string().default(""),
    experimental_api: z.boolean().default(false),
    api_base_url: z.string().default(""),
    api_key: z.string().default(""),
    auto_delete_threads: z.boolean().default(false),
    failed_thread_retention_days: z.number().int().nonnegative().default(7),
  }),
  antigravity: z.object({
    max_concurrent_tasks: z.number().int().positive().default(3),
    command: z.string().default("agy"),
    model: z.string().default("gemini-2.5-pro"),
    api_base_url: z.string().default(""),
    api_key: z.string().default(""),
    auto_delete_threads: z.boolean().default(false),
    failed_thread_retention_days: z.number().int().nonnegative().default(7),
  }),
  audio_generation: z.object({
    provider: z.string().default("chatterbox"),
    service_url: z.string().default("http://127.0.0.1:8890"),
    exaggeration: z.number().min(0).max(1).default(0.5),
    cfg_weight: z.number().min(0).max(1).default(0.5),
    max_concurrent_tasks: z.number().int().positive().default(2),
    merge_gap_ms: z.number().int().nonnegative().default(300),
    match_target_duration: z.boolean().default(true),
  }),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const VoiceProfileSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().min(1).max(80),
  reference_path: z.string().min(1),
  sample_path: z.string().min(1),
  created_at: IsoDate,
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const CreateVoiceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  data: z.string().min(1).max(50_000_000),
});
export type CreateVoiceInput = z.infer<typeof CreateVoiceInputSchema>;

export const AssignVoiceInputSchema = z.object({ voice_id: z.string().trim().min(1).nullable() });
export type AssignVoiceInput = z.infer<typeof AssignVoiceInputSchema>;

export const GenerateAllAudioInputSchema = z.object({ force: z.boolean().default(false) });
export type GenerateAllAudioInput = z.infer<typeof GenerateAllAudioInputSchema>;

export const GenerateAllBundleImagesInputSchema = z.object({ force: z.boolean().default(false) });
export type GenerateAllBundleImagesInput = z.infer<typeof GenerateAllBundleImagesInputSchema>;

export const ImageModelIdSchema = z.enum(["gpt-image-2", "nano-banana-2"]);
export type ImageModelId = z.infer<typeof ImageModelIdSchema>;

export const ImageSettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  images_per_bundle: z.number().int().min(1).max(2).optional(),
  provider: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  api_key: z.string().max(4000).optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
  max_concurrent_tasks: z.number().int().positive().max(16).optional(),
});
export type ImageSettingsInput = z.infer<typeof ImageSettingsInputSchema>;

export const AudioSettingsInputSchema = z.object({
  provider: z.string().trim().max(80).optional(),
  service_url: z.string().trim().url().max(2000).optional(),
  exaggeration: z.number().min(0).max(1).optional(),
  cfg_weight: z.number().min(0).max(1).optional(),
  max_concurrent_tasks: z.number().int().positive().max(16).optional(),
  merge_gap_ms: z.number().int().nonnegative().max(10_000).optional(),
  match_target_duration: z.boolean().optional(),
});
export type AudioSettingsInput = z.infer<typeof AudioSettingsInputSchema>;

export const VideoSettingsInputSchema = z.object({
  max_scene_duration_seconds: z.number().positive().max(120).optional(),
  narration_words_per_second: z.number().positive().max(20).optional(),
});
export type VideoSettingsInput = z.infer<typeof VideoSettingsInputSchema>;

export const VoiceReferenceUploadSchema = z.object({
  data: z.string().min(1).max(50_000_000),
});
export type VoiceReferenceUpload = z.infer<typeof VoiceReferenceUploadSchema>;

export const CodexSettingsInputSchema = z.object({
  transport: z.enum(["app_server", "openai_compatible"]).optional(),
  model: z.string().trim().max(160).optional(),
  api_base_url: z.string().trim().max(2000).optional(),
  api_key: z.string().max(4000).optional(),
  app_server_endpoint: z.string().trim().max(2000).optional(),
  command: z.string().trim().max(500).optional(),
  auto_delete_threads: z.boolean().optional(),
  failed_thread_retention_days: z.number().int().nonnegative().max(3650).optional(),
});
export type CodexSettingsInput = z.infer<typeof CodexSettingsInputSchema>;

export const CodexModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type CodexModel = z.infer<typeof CodexModelSchema>;

export const CodexSettingsSchema = z.object({
  transport: z.enum(["app_server", "openai_compatible"]),
  model: z.string(),
  api_base_url: z.string(),
  has_api_key: z.boolean(),
  app_server_endpoint: z.string(),
  command: z.string(),
  auto_delete_threads: z.boolean().default(false),
  failed_thread_retention_days: z.number().int().nonnegative().default(7),
});
export type CodexSettings = z.infer<typeof CodexSettingsSchema>;

export const CodexSettingsResponseSchema = z.object({
  settings: CodexSettingsSchema,
  models: CodexModelSchema.array(),
  installation: z.object({
    installed: z.boolean(),
    command: z.string(),
    version: z.string().nullable(),
    error: z.string().optional(),
  }),
});
export type CodexSettingsResponse = z.infer<typeof CodexSettingsResponseSchema>;

export const AntigravitySettingsInputSchema = z.object({
  model: z.string().trim().max(160).optional(),
  command: z.string().trim().max(500).optional(),
  api_base_url: z.string().trim().max(2000).optional(),
  api_key: z.string().max(4000).optional(),
  auto_delete_threads: z.boolean().optional(),
  failed_thread_retention_days: z.number().int().nonnegative().max(3650).optional(),
});
export type AntigravitySettingsInput = z.infer<typeof AntigravitySettingsInputSchema>;

export const AntigravityModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type AntigravityModel = z.infer<typeof AntigravityModelSchema>;

export const AntigravitySettingsSchema = z.object({
  model: z.string(),
  command: z.string(),
  api_base_url: z.string(),
  has_api_key: z.boolean(),
  auto_delete_threads: z.boolean().default(false),
  failed_thread_retention_days: z.number().int().nonnegative().default(7),
});
export type AntigravitySettings = z.infer<typeof AntigravitySettingsSchema>;

export const AntigravitySettingsResponseSchema = z.object({
  settings: AntigravitySettingsSchema,
  models: AntigravityModelSchema.array(),
  installation: z.object({
    installed: z.boolean(),
    command: z.string(),
    version: z.string().nullable(),
    authenticated: z.boolean().default(false),
    error: z.string().optional(),
  }),
});
export type AntigravitySettingsResponse = z.infer<typeof AntigravitySettingsResponseSchema>;

export const EngineSettingsInputSchema = z.object({
  active_engine: EngineIdSchema,
  model: z.string().trim().max(160).optional(),
});
export type EngineSettingsInput = z.infer<typeof EngineSettingsInputSchema>;

export const StorageInfoSchema = z.object({
  path: z.string().min(1),
  default_path: z.string().min(1),
  channel_path: z.string().min(1),
  configured: z.boolean(),
});
export type StorageInfo = z.infer<typeof StorageInfoSchema>;

export const StoragePathInputSchema = z.object({
  path: z.string().trim().min(1).max(2000),
});

export const CreateChannelInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  target_audience: z.string().trim().max(240).default(""),
  language: z.string().trim().max(80).default("English"),
  market: z.string().trim().max(120).default(""),
  dna_mode: z.enum(["example", "ai", "upload"]).default("example"),
  dna_content: z.string().optional(),
  group_id: z.enum(["documentary", "quiz"]).default("documentary"),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInputSchema>;

export const UpdateChannelInputSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  target_audience: z.string().trim().max(240).optional(),
  language: z.string().trim().max(80).optional(),
  market: z.string().trim().max(120).optional(),
  status: ChannelStatusSchema.optional(),
  selected_styles: z.array(QuizImageStyleSchema).optional(),
});

export const SaveTextInputSchema = z.object({ content: z.string() });

export const TopicConfirmInputSchema = z.object({
  topic_id: z.string().min(1),
  question_count: z.number().int().min(QUIZ_MIN_QUESTION_COUNT).max(QUIZ_MAX_QUESTION_COUNT).optional(),
  visual_style: z.enum(["mixed", "pixar_3d", "flat_vector", "kawaii_chibi", "voxel_lowpoly", "plastic_toy"]).optional(),
});

export const EpisodeSettingsInputSchema = z.object({
  target_duration_minutes: z.number().min(3).max(60).optional(),
  question_count: z.number().int().min(QUIZ_MIN_QUESTION_COUNT).max(QUIZ_MAX_QUESTION_COUNT).optional(),
  quiz_format: z.enum(["knowledge", "image_guess", "multiple_choice", "true_false", "odd_one_out"]).optional(),
  age_band: z.enum(["4-6", "7-9", "10-12", "family"]).optional(),
  answer_mode: z.enum(["voice_and_reveal", "voice_only"]).optional(),
  visual_theme: QuizVisualThemeSchema.optional(),
  visual_style: z.enum(["mixed", "pixar_3d", "flat_vector", "kawaii_chibi", "voxel_lowpoly", "plastic_toy"]).optional(),
  resolved_visual_style: QuizImageStyleSchema.optional(),
});
export type EpisodeSettingsInput = z.infer<typeof EpisodeSettingsInputSchema>;

export const SceneUpdateInputSchema = z.object({
  scene_number: z.number().int().positive(),
  duration_seconds: z.number().positive(),
  dialogue: z.string(),
  visual_prompt: z.string(),
  transition_note: z.string().default(""),
  continuity_note: z.string().default(""),
});

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
});

export type ApiError = { error: string; detail?: string };
export type TaskEvent = {
  type: "task.updated" | "codex.status" | "antigravity.status" | "engine.status" | "approval.requested" | "system";
  task?: Task;
  engine?: EngineId;
  status?: "connected" | "disconnected" | "unavailable" | "connecting";
  message?: string;
  request_id?: number;
  approval?: { kind: string; reason?: string; command?: string; cwd?: string };
};

export const ContextManifestSchema = z.object({
  task_type: TaskTypeSchema,
  scope: z.object({ channel_id: z.string(), episode_id: z.string().nullable() }),
  included_files: z.array(z.object({ path: z.string(), reason: z.string(), bytes: z.number().int().nonnegative() })),
  excluded_categories: z.array(z.string()),
  approximate_bytes: z.number().int().nonnegative(),
  prompt: z.string(),
});
export type ContextManifest = z.infer<typeof ContextManifestSchema>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
