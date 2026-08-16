import { z } from "zod";

export const ChannelStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

export const EpisodeStageSchema = z.enum([
  "IDEA",
  "SELECTED",
  "RESEARCH",
  "RESEARCH_READY",
  "SCRIPT",
  "SCRIPT_READY",
  "SCENE_BREAKDOWN",
  "SCENE_READY",
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
  "GENERATE_SCRIPT",
  "GENERATE_SCENES",
  "REGENERATE_DIALOGUE",
  "REGENERATE_PROMPT",
  "REGENERATE_BOTH",
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

export const SceneSchema = z.object({
  scene_id: z.string().min(1),
  episode_id: z.string().min(1),
  scene_number: z.number().int().positive(),
  duration_seconds: z.number().positive(),
  dialogue: z.string(),
  visual_prompt: z.string(),
  transition_note: z.string().default(""),
  continuity_note: z.string().default(""),
});
export type Scene = z.infer<typeof SceneSchema>;

export const EpisodeSchema = z.object({
  episode_id: z.string().min(1),
  channel_id: z.string().min(1),
  slug: z.string().min(1),
  topic: EpisodeTopicSchema,
  stage: EpisodeStageSchema,
  script_path: z.string().min(1),
  scene_plan_path: z.string().min(1),
  dialogue_script_path: z.string().min(1),
  video_prompts_path: z.string().min(1),
  created_at: IsoDate,
  updated_at: IsoDate,
});
export type Episode = z.infer<typeof EpisodeSchema>;

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
  scene_number: z.number().int().positive().nullable().default(null),
});
export type Task = z.infer<typeof TaskSchema>;

export const AppConfigSchema = z.object({
  video_generation: z.object({
    provider: z.string().default("none"),
    model: z.string().default(""),
    max_scene_duration_seconds: z.number().positive().default(8),
    default_scene_duration_seconds: z.number().positive().default(6),
    aspect_ratio: z.string().default("16:9"),
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
  }),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const CodexSettingsInputSchema = z.object({
  transport: z.enum(["app_server", "openai_compatible"]).optional(),
  model: z.string().trim().max(160).optional(),
  api_base_url: z.string().trim().max(2000).optional(),
  api_key: z.string().max(4000).optional(),
  app_server_endpoint: z.string().trim().max(2000).optional(),
  command: z.string().trim().max(500).optional(),
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
