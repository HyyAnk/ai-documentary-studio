import type {
  AppConfig,
  DirectorPlan,
  QuizAssessment,
  QuizAssetPlan,
  QuizAssetResolution,
  QuizTimeline,
  QuizV2,
  QuizIssue,
  VoicePlan,
} from "@studio/shared";
import { RepositoryError, type RepositoryService } from "../../repository.js";
import { planQuizAssets } from "../assets/assetPlanner.js";
import { resolveQuizAssets } from "../assets/resolveQuizAssets.js";
import { buildQuizVoicePlan } from "../audio/voicePlan.js";
import { assembleQuizNarration, synthesizeQuizVoiceSegments } from "../audio/voiceSynthesis.js";
import { createDefaultDirectorPlan } from "../director/parseDirectorPlan.js";
import { assertDirectorPlanValid } from "../director/validateDirectorPlan.js";
import { deriveQuizV2FromScenes } from "../domain/quiz.js";
import { assessQuiz } from "../qa/quizAssessment.js";
import { preflightQuizRender } from "../qa/preflight.js";
import { compileQuizTimeline } from "../timeline/compileTimeline.js";
import { invalidateQuizArtifacts } from "./invalidation.js";

export type QuizOrchestratorInput = {
  repository: RepositoryService;
  config: Pick<AppConfig, "audio_generation">;
  channelId: string;
  episodeId: string;
  onAssetProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void;
  onVoiceProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void;
};

export type QuizArtifacts = {
  quiz: QuizV2 | null;
  director_plan: DirectorPlan | null;
  asset_plan: QuizAssetPlan | null;
  asset_resolution: QuizAssetResolution | null;
  voice_plan: VoicePlan | null;
  timeline: QuizTimeline | null;
  assessment: QuizAssessment | null;
};

export async function readQuizArtifacts(input: QuizOrchestratorInput): Promise<QuizArtifacts> {
  const [quiz, director_plan, asset_plan, asset_resolution, voice_plan, timeline, assessment] = await Promise.all([
    input.repository.readQuiz(input.channelId, input.episodeId),
    input.repository.readDirectorPlan(input.channelId, input.episodeId),
    input.repository.readAssetPlan(input.channelId, input.episodeId),
    input.repository.readQuizAssetResolution(input.channelId, input.episodeId),
    input.repository.readVoicePlan(input.channelId, input.episodeId),
    input.repository.readQuizTimeline(input.channelId, input.episodeId),
    input.repository.readQuizAssessment(input.channelId, input.episodeId),
  ]);
  return { quiz, director_plan, asset_plan, asset_resolution, voice_plan, timeline, assessment };
}

export async function generateQuiz(input: QuizOrchestratorInput): Promise<{ quiz: QuizV2; artifact_path: string; invalidated: string[] }> {
  const [episode, channel, scenes] = await Promise.all([
    input.repository.getEpisode(input.channelId, input.episodeId),
    input.repository.getChannel(input.channelId),
    input.repository.readScenes(input.channelId, input.episodeId),
  ]);
  const quiz = deriveQuizV2FromScenes({ episodeId: episode.episode_id, language: channel.language, ageBand: episode.quiz_config.age_band, format: episode.quiz_config.quiz_format, scenes });
  const artifact_path = await input.repository.writeQuiz(input.channelId, input.episodeId, quiz);
  const invalidatedStages = invalidateQuizArtifacts("quiz");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  return { quiz, artifact_path, invalidated };
}

export async function generateDirector(input: QuizOrchestratorInput): Promise<{ director_plan: DirectorPlan; artifact_path: string; invalidated: string[] }> {
  const quiz = await input.repository.readQuiz(input.channelId, input.episodeId);
  if (!quiz) throw new RepositoryError("Generate the Quiz facts before the Director plan", "QUIZ_REQUIRED");
  const director_plan = createDefaultDirectorPlan(quiz);
  const artifact_path = await input.repository.writeDirectorPlan(input.channelId, input.episodeId, director_plan);
  const invalidatedStages = invalidateQuizArtifacts("director");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  return { director_plan, artifact_path, invalidated };
}

export async function planAssets(input: QuizOrchestratorInput): Promise<{ asset_plan: QuizAssetPlan; artifact_path: string; invalidated: string[] }> {
  const [quiz, director_plan] = await Promise.all([
    input.repository.readQuiz(input.channelId, input.episodeId),
    input.repository.readDirectorPlan(input.channelId, input.episodeId),
  ]);
  if (!quiz) throw new RepositoryError("Generate the Quiz facts before planning assets", "QUIZ_REQUIRED");
  if (!director_plan) throw new RepositoryError("Generate the Director plan before planning assets", "DIRECTOR_REQUIRED");
  const asset_plan = planQuizAssets(quiz, director_plan);
  const artifact_path = await input.repository.writeAssetPlan(input.channelId, input.episodeId, asset_plan);
  const invalidatedStages = invalidateQuizArtifacts("assets");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  return { asset_plan, artifact_path, invalidated };
}

export async function resolveAssets(input: QuizOrchestratorInput): Promise<{ asset_resolution: QuizAssetResolution; issues: QuizIssue[]; invalidated: string[] }> {
  const asset_plan = await input.repository.readAssetPlan(input.channelId, input.episodeId);
  if (!asset_plan) throw new RepositoryError("Plan Quiz assets before resolving them", "ASSET_PLAN_REQUIRED");
  const result = await resolveQuizAssets({ repository: input.repository, channelId: input.channelId, episodeId: input.episodeId, plan: asset_plan, onProgress: input.onAssetProgress });
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidateQuizArtifacts("asset_resolution"));
  return { asset_resolution: result.resolution, issues: result.issues, invalidated };
}

export async function planVoice(input: QuizOrchestratorInput): Promise<{ voice_plan: VoicePlan; artifact_path: string; invalidated: string[] }> {
  const quiz = await input.repository.readQuiz(input.channelId, input.episodeId);
  if (!quiz) throw new RepositoryError("Generate the Quiz facts before planning voice", "QUIZ_REQUIRED");
  const voice_plan = buildQuizVoicePlan(quiz);
  const artifact_path = await input.repository.writeVoicePlan(input.channelId, input.episodeId, voice_plan);
  const invalidatedStages = invalidateQuizArtifacts("voice");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  return { voice_plan, artifact_path, invalidated };
}

export async function generateVoice(input: QuizOrchestratorInput): Promise<{ voice_plan: VoicePlan; timeline: QuizTimeline; narration_asset_path: string; narration_duration_seconds: number; artifact_path: string; timeline_path: string; invalidated: string[] }> {
  const [quiz, director_plan] = await Promise.all([
    input.repository.readQuiz(input.channelId, input.episodeId),
    input.repository.readDirectorPlan(input.channelId, input.episodeId),
  ]);
  if (!quiz) throw new RepositoryError("Generate the Quiz facts before generating voice", "QUIZ_REQUIRED");
  if (!director_plan) throw new RepositoryError("Generate the Director plan before generating voice", "DIRECTOR_REQUIRED");
  assertDirectorPlanValid(quiz, director_plan);
  const invalidatedStages = invalidateQuizArtifacts("voice");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  const plannedVoice = buildQuizVoicePlan(quiz);
  const measured = await synthesizeQuizVoiceSegments({ repository: input.repository, config: input.config.audio_generation, channelId: input.channelId, episodeId: input.episodeId, voicePlan: plannedVoice, onProgress: input.onVoiceProgress });
  const audioDurations = Object.fromEntries(measured.voicePlan.segments.flatMap((segment) => segment.duration_seconds === null ? [] : [[segment.segment_id, segment.duration_seconds]]));
  const timeline = compileQuizTimeline({ quiz, director: director_plan, voicePlan: measured.voicePlan, audioDurations });
  const narration = await assembleQuizNarration({ repository: input.repository, channelId: input.channelId, episodeId: input.episodeId, voicePlan: measured.voicePlan, timeline, segmentPaths: measured.segmentPaths });
  const [artifact_path, timeline_path] = await Promise.all([
    input.repository.writeVoicePlan(input.channelId, input.episodeId, measured.voicePlan),
    input.repository.writeQuizTimeline(input.channelId, input.episodeId, timeline),
  ]);
  return { voice_plan: measured.voicePlan, timeline, narration_asset_path: narration.assetPath, narration_duration_seconds: narration.durationSeconds, artifact_path, timeline_path, invalidated };
}

export async function compileTimeline(input: QuizOrchestratorInput): Promise<{ timeline: QuizTimeline; artifact_path: string; invalidated: string[] }> {
  const [quiz, director_plan, voice_plan] = await Promise.all([
    input.repository.readQuiz(input.channelId, input.episodeId),
    input.repository.readDirectorPlan(input.channelId, input.episodeId),
    input.repository.readVoicePlan(input.channelId, input.episodeId),
  ]);
  if (!quiz) throw new RepositoryError("Generate the Quiz facts before compiling the timeline", "QUIZ_REQUIRED");
  if (!director_plan) throw new RepositoryError("Generate the Director plan before compiling the timeline", "DIRECTOR_REQUIRED");
  if (!voice_plan) throw new RepositoryError("Generate the voice plan before compiling the timeline", "VOICE_PLAN_REQUIRED");
  assertDirectorPlanValid(quiz, director_plan);
  const audioDurations: Record<string, number> = {};
  for (const segment of voice_plan.segments) if (segment.duration_seconds !== null) audioDurations[segment.segment_id] = segment.duration_seconds;
  const timeline = compileQuizTimeline({ quiz, director: director_plan, voicePlan: voice_plan, audioDurations });
  const artifact_path = await input.repository.writeQuizTimeline(input.channelId, input.episodeId, timeline);
  const invalidatedStages = invalidateQuizArtifacts("timeline");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  return { timeline, artifact_path, invalidated };
}

export async function runQa(input: QuizOrchestratorInput): Promise<{ assessment: QuizAssessment; artifact_path: string }> {
  const artifacts = await readQuizArtifacts(input);
  if (!artifacts.quiz) throw new RepositoryError("Generate the Quiz facts before running QA", "QUIZ_REQUIRED");
  const assessment = assessQuiz({ quiz: artifacts.quiz, director: artifacts.director_plan, assetPlan: artifacts.asset_plan, resolvedAssets: artifacts.asset_resolution?.assets ?? [], voicePlan: artifacts.voice_plan, timeline: artifacts.timeline, measuredAudio: artifacts.voice_plan ? artifacts.voice_plan.segments.every((segment) => segment.duration_seconds !== null) : false });
  const artifact_path = await input.repository.writeQuizAssessment(input.channelId, input.episodeId, assessment);
  return { assessment, artifact_path };
}

export async function assertQuizRenderReady(input: QuizOrchestratorInput): Promise<{ artifacts: QuizArtifacts; assessment: QuizAssessment }> {
  const episode = await input.repository.getEpisode(input.channelId, input.episodeId);
  const artifacts = await readQuizArtifacts(input);
  if (!artifacts.quiz || !artifacts.director_plan || !artifacts.asset_plan || !artifacts.voice_plan || !artifacts.timeline) {
    throw new RepositoryError("Complete the Quiz V2 stages before rendering", "QUIZ_V2_INCOMPLETE");
  }
  const preflight = preflightQuizRender({ quiz: artifacts.quiz, director: artifacts.director_plan, assetPlan: artifacts.asset_plan, resolvedAssets: artifacts.asset_resolution?.assets ?? [], voicePlan: artifacts.voice_plan, timeline: artifacts.timeline, measuredAudio: episode.narration_duration_seconds !== null });
  if (!preflight.ok) {
    const blocker = preflight.assessment.issues.find((issue) => issue.severity === "blocker");
    throw new RepositoryError("Quiz V2 preflight blocked render: " + (blocker?.message ?? "Resolve the reported QA blockers before rendering."), "QUIZ_PREFLIGHT_BLOCKED");
  }
  return { artifacts, assessment: preflight.assessment };
}
