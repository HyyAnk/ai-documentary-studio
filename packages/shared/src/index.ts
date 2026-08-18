import { z } from "zod";

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
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

const IsoDate = z.string().datetime({ offset: true });

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
});
export type TopicCandidate = z.infer<typeof TopicCandidateSchema>;

export const EpisodeTopicSchema = z.object({
  title: z.string().min(1),
  premise: z.string().min(1),
  hook: z.string().min(1),
});

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
});
export type Task = z.infer<typeof TaskSchema>;

export const AppConfigSchema = z.object({
  video_generation: z.object({
    provider: z.string().default("none"),
    model: z.string().default(""),
    max_scene_duration_seconds: z.number().positive().default(8),
    default_scene_duration_seconds: z.number().positive().default(6),
    narration_words_per_second: z.number().positive().default(2.3),
    aspect_ratio: z.string().default("16:9"),
  }),
  image_generation: z.object({
    enabled: z.boolean().default(true),
    images_per_bundle: z.number().int().min(1).max(2).default(1),
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
    auto_delete_threads: z.boolean().default(true),
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

export const ImageSettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  images_per_bundle: z.number().int().min(1).max(2).optional(),
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
  auto_delete_threads: z.boolean().default(true),
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
});
export type CreateChannelInput = z.infer<typeof CreateChannelInputSchema>;

export const UpdateChannelInputSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  target_audience: z.string().trim().max(240).optional(),
  language: z.string().trim().max(80).optional(),
  market: z.string().trim().max(120).optional(),
  status: ChannelStatusSchema.optional(),
});

export const SaveTextInputSchema = z.object({ content: z.string() });

export const TopicConfirmInputSchema = z.object({ topic_id: z.string().min(1) });

export const EpisodeSettingsInputSchema = z.object({
  target_duration_minutes: z.number().min(3).max(60),
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
  type: "task.updated" | "codex.status" | "approval.requested" | "system";
  task?: Task;
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
