import {
  type AppConfig,
  type DirectorPlan,
  type QuestionHistoryCheckResult,
  type QuizAssessment,
  type QuizAssetPlan,
  type QuizAssetResolution,
  type QuizTimeline,
  type QuizV2,
  type QuizQuestion,
  type QuizIssue,
  type VoicePlan,
  QuizQuestionSchema,
} from "@studio/shared";
import { RepositoryError, type RepositoryService } from "../../repository.js";
import { planQuizAssets } from "../assets/assetPlanner.js";
import { resolveQuizAssets } from "../assets/resolveQuizAssets.js";
import { buildQuizVoicePlan } from "../audio/voicePlan.js";
import { assembleQuizNarration, synthesizeQuizVoiceSegments, type QuizVoicePacingClamp } from "../audio/voiceSynthesis.js";
import { quizVoiceTargetWordsPerSecond } from "../audio/voicePolicy.js";
import { createDefaultDirectorPlan } from "../director/parseDirectorPlan.js";
import { assertDirectorPlanValid } from "../director/validateDirectorPlan.js";
import { deriveQuizV2FromScenes } from "../domain/quiz.js";
import { assessQuiz } from "../qa/quizAssessment.js";
import { preflightQuizRender } from "../qa/preflight.js";
import { compileQuizTimeline } from "../timeline/compileTimeline.js";
import { invalidateQuizArtifacts } from "./invalidation.js";
import { checkQuestionsAgainstHistory } from "../qa/questionHistory.js";

import type { AntigravityClient } from "../../antigravity.js";

export type QuizOrchestratorInput = {
  repository: RepositoryService;
  config: Pick<AppConfig, "audio_generation"> & { image_generation?: AppConfig["image_generation"]; question_history?: AppConfig["question_history"] };
  channelId: string;
  episodeId: string;
  activeEngine?: "codex" | "antigravity";
  antigravityClient?: AntigravityClient;
  onAssetProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void;
  onVoiceProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void;
  onVoicePacingClamp?: (details: QuizVoicePacingClamp) => Promise<void> | void;
};

export type QuizArtifacts = {
  quiz: QuizV2 | null;
  history_check: QuestionHistoryCheckResult | null;
  director_plan: DirectorPlan | null;
  asset_plan: QuizAssetPlan | null;
  asset_resolution: QuizAssetResolution | null;
  voice_plan: VoicePlan | null;
  timeline: QuizTimeline | null;
  assessment: QuizAssessment | null;
};

export async function readQuizArtifacts(input: QuizOrchestratorInput): Promise<QuizArtifacts> {
  const [quiz, history_check, director_plan, asset_plan, asset_resolution, voice_plan, timeline, assessment] = await Promise.all([
    input.repository.readQuiz(input.channelId, input.episodeId),
    input.repository.readHistoryCheck(input.channelId, input.episodeId),
    input.repository.readDirectorPlan(input.channelId, input.episodeId),
    input.repository.readAssetPlan(input.channelId, input.episodeId),
    input.repository.readQuizAssetResolution(input.channelId, input.episodeId),
    input.repository.readVoicePlan(input.channelId, input.episodeId),
    input.repository.readQuizTimeline(input.channelId, input.episodeId),
    input.repository.readQuizAssessment(input.channelId, input.episodeId),
  ]);
  return { quiz, history_check, director_plan, asset_plan, asset_resolution, voice_plan, timeline, assessment };
}

export async function generateQuiz(input: QuizOrchestratorInput): Promise<{ quiz: QuizV2; history_check: QuestionHistoryCheckResult; artifact_path: string; invalidated: string[] }> {
  const [episode, channel, scenes] = await Promise.all([
    input.repository.getEpisode(input.channelId, input.episodeId),
    input.repository.getChannel(input.channelId),
    input.repository.readScenes(input.channelId, input.episodeId),
  ]);
  const quiz = deriveQuizV2FromScenes({ episodeId: episode.episode_id, language: channel.language, ageBand: episode.quiz_config.age_band, format: episode.quiz_config.quiz_format, scenes });
  const artifact_path = await input.repository.writeQuiz(input.channelId, input.episodeId, quiz);

  // Run History Check against past 30 days
  const history = await input.repository.readQuestionHistory(input.channelId);
  const passThreshold = input.config.question_history?.pass_threshold ?? 2;
  const history_check = checkQuestionsAgainstHistory(input.episodeId, quiz.questions, history, passThreshold);
  await input.repository.writeHistoryCheck(input.channelId, input.episodeId, history_check);

  const invalidatedStages = invalidateQuizArtifacts("quiz");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  return { quiz, history_check, artifact_path, invalidated };
}

export async function remixQuizQuestions(input: QuizOrchestratorInput, requestedQuestionIds?: string[]): Promise<{ quiz: QuizV2; history_check: QuestionHistoryCheckResult; remixed_count: number; invalidated: string[] }> {
  const [episode, channel, scenes, currentQuiz] = await Promise.all([
    input.repository.getEpisode(input.channelId, input.episodeId),
    input.repository.getChannel(input.channelId),
    input.repository.readScenes(input.channelId, input.episodeId),
    input.repository.readQuiz(input.channelId, input.episodeId),
  ]);
  if (!currentQuiz) throw new RepositoryError("Generate Quiz facts before remixing questions", "QUIZ_REQUIRED");

  const history = await input.repository.readQuestionHistory(input.channelId);
  const passThreshold = input.config.question_history?.pass_threshold ?? 2;
  const initialCheck = checkQuestionsAgainstHistory(input.episodeId, currentQuiz.questions, history, passThreshold);

  const targetIds = new Set(
    requestedQuestionIds && requestedQuestionIds.length > 0
      ? requestedQuestionIds
      : initialCheck.items.filter((i) => i.status === "duplicate").map((i) => i.current_question_id)
  );

  if (targetIds.size === 0) {
    return { quiz: currentQuiz, history_check: initialCheck, remixed_count: 0, invalidated: [] };
  }

  const questionsToRemix = currentQuiz.questions.filter((q) => targetIds.has(q.id));

  const prompt = [
    "You are an expert Quiz Editor for an educational children and family entertainment channel.",
    `Channel: ${channel.display_name}. Language: ${channel.language}. Age Band: ${episode.quiz_config.age_band}. Format: ${episode.quiz_config.quiz_format}.`,
    "TASK: Rephrase the provided quiz questions so that their phrasing, perspective, hook, and clues feel completely fresh, creative, and non-repetitive compared to previously produced videos.",
    "STRICT RULES:",
    "1. Keep the EXACT same correct answer and preserve all visible choices verbatim.",
    "2. Keep the same format, difficulty, and child-friendly tone.",
    "3. Change the question sentence, clues, or angles to avoid similarity with previous questions.",
    "4. Return ONLY a valid JSON array containing the rephrased questions matching the schema: [{ id, number, format, difficulty, question, choices: [{ id, text }], correct_choice_id, explanation, fun_fact, source_ids, visual_opportunity }]. Do not include markdown code fences or conversational text.",
    "\nQuestions to rephrase:\n" + JSON.stringify(questionsToRemix, null, 2),
  ].join("\n");

  let rephrasedQuestions: QuizQuestion[] = [];
  try {
    const isAgy = input.activeEngine === "antigravity" && Boolean(input.antigravityClient);
    if (isAgy && input.antigravityClient) {
      const threadId = await input.antigravityClient.startThread();
      const rawOutput = await input.antigravityClient.startTurn(threadId, prompt);
      const jsonStart = rawOutput.indexOf("[");
      const jsonEnd = rawOutput.lastIndexOf("]");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(rawOutput.slice(jsonStart, jsonEnd + 1)) as unknown[];
        rephrasedQuestions = parsed.map((item) => QuizQuestionSchema.parse(item));
      }
    }
  } catch {
    // If external call fails, fall back to heuristic modification
  }

  if (rephrasedQuestions.length === 0) {
    rephrasedQuestions = questionsToRemix.map((q) => ({
      ...q,
      question: q.question.startsWith("Đố bạn ") ? q.question.replace("Đố bạn ", "Khám phá xem ") : `Thử thách mới: ${q.question}`,
    }));
  }

  const rephrasedMap = new Map(rephrasedQuestions.map((q) => [q.id, q]));
  const updatedQuestions = currentQuiz.questions.map((q) => rephrasedMap.get(q.id) ?? q);
  const updatedQuiz: QuizV2 = { ...currentQuiz, questions: updatedQuestions };

  await input.repository.writeQuiz(input.channelId, input.episodeId, updatedQuiz);

  const updatedScenes = scenes.map((scene) => {
    if (scene.quiz && rephrasedMap.has(scene.quiz.question_number ? `q-${scene.quiz.question_number}` : "")) {
      const rephrased = rephrasedMap.get(`q-${scene.quiz.question_number}`)!;
      return {
        ...scene,
        quiz: {
          ...scene.quiz,
          question: rephrased.question,
          explanation: rephrased.explanation,
        },
      };
    }
    return scene;
  });
  await input.repository.saveScenes(input.channelId, input.episodeId, updatedScenes);

  const updatedCheck = checkQuestionsAgainstHistory(input.episodeId, updatedQuiz.questions, history, passThreshold);
  const finalCheckItems = updatedCheck.items.map((item) => {
    if (targetIds.has(item.current_question_id)) {
      if (item.status === "passed") return { ...item, status: "remixed" as const };
    }
    return item;
  });
  const finalCheck: QuestionHistoryCheckResult = {
    ...updatedCheck,
    items: finalCheckItems,
  };
  await input.repository.writeHistoryCheck(input.channelId, input.episodeId, finalCheck);

  const invalidatedStages = invalidateQuizArtifacts("quiz");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);

  return { quiz: updatedQuiz, history_check: finalCheck, remixed_count: rephrasedQuestions.length, invalidated };
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
  const [quiz, director_plan, episode] = await Promise.all([
    input.repository.readQuiz(input.channelId, input.episodeId),
    input.repository.readDirectorPlan(input.channelId, input.episodeId),
    input.repository.getEpisode(input.channelId, input.episodeId).catch(() => null),
  ]);
  if (!quiz) throw new RepositoryError("Generate the Quiz facts before planning assets", "QUIZ_REQUIRED");
  if (!director_plan) throw new RepositoryError("Generate the Director plan before planning assets", "DIRECTOR_REQUIRED");
  const visualStyle = episode?.quiz_config?.resolved_visual_style ?? "pixar_3d";
  const asset_plan = planQuizAssets(quiz, director_plan, visualStyle);
  const artifact_path = await input.repository.writeAssetPlan(input.channelId, input.episodeId, asset_plan);
  const invalidatedStages = invalidateQuizArtifacts("assets");
  const invalidated = await input.repository.invalidateQuizArtifacts(input.channelId, input.episodeId, invalidatedStages);
  return { asset_plan, artifact_path, invalidated };
}

export async function resolveAssets(input: QuizOrchestratorInput): Promise<{ asset_resolution: QuizAssetResolution; issues: QuizIssue[]; invalidated: string[] }> {
  const [asset_plan, episode] = await Promise.all([
    input.repository.readAssetPlan(input.channelId, input.episodeId),
    input.repository.getEpisode(input.channelId, input.episodeId).catch(() => null),
  ]);
  if (!asset_plan) throw new RepositoryError("Plan Quiz assets before resolving them", "ASSET_PLAN_REQUIRED");
  const visualStyle = episode?.quiz_config?.resolved_visual_style ?? "pixar_3d";
  const result = await resolveQuizAssets({
    repository: input.repository,
    channelId: input.channelId,
    episodeId: input.episodeId,
    plan: asset_plan,
    visualStyle,
    activeEngine: input.activeEngine,
    antigravityClient: input.antigravityClient,
    imageConfig: input.config.image_generation ? { api_key: input.config.image_generation.api_key, model: input.config.image_generation.model } : undefined,
    onProgress: input.onAssetProgress,
  });
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
  const measured = await synthesizeQuizVoiceSegments({ repository: input.repository, config: input.config.audio_generation, channelId: input.channelId, episodeId: input.episodeId, voicePlan: plannedVoice, targetWordsPerSecond: quizVoiceTargetWordsPerSecond(quiz.age_band), onProgress: input.onVoiceProgress, onPacingClamp: input.onVoicePacingClamp });
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
