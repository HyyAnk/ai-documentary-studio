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
import type { CodexAppServerClient } from "../../codex.js";
import { executeSinglePromptText, type LLMClient } from "../../utils/promptSanitizer.js";

export type QuizOrchestratorInput = {
  repository: RepositoryService;
  config: Pick<AppConfig, "audio_generation"> & { image_generation?: AppConfig["image_generation"]; question_history?: AppConfig["question_history"] };
  channelId: string;
  episodeId: string;
  activeEngine?: "codex" | "antigravity";
  antigravityClient?: AntigravityClient;
  codexClient?: CodexAppServerClient;
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

function normalizeRawQuizQuestion(raw: unknown, targetFallback?: QuizQuestion): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : targetFallback?.id ?? "q-1";
  const number = typeof obj.number === "number" && obj.number > 0 ? obj.number : targetFallback?.number ?? 1;
  const format = (typeof obj.format === "string" && obj.format ? obj.format : targetFallback?.format ?? "multiple_choice") as QuizQuestion["format"];
  const difficulty = typeof obj.difficulty === "number" && obj.difficulty >= 1 && obj.difficulty <= 5 ? obj.difficulty : targetFallback?.difficulty ?? 2;

  let question = typeof obj.question === "string" ? obj.question.trim() : targetFallback?.question ?? "";
  question = question.replace(/^(?:Challenge|Quiz|Can you solve|Can you guess)\s*:\s*/i, "").trim();

  let choices: Array<{ id: string; text: string }> = [];
  if (Array.isArray(obj.choices)) {
    choices = obj.choices.map((c: unknown, idx: number) => {
      if (typeof c === "string") {
        return { id: `c${idx + 1}`, text: c.trim() };
      }
      if (typeof c === "object" && c !== null) {
        const itemObj = c as Record<string, unknown>;
        const rawCId = typeof itemObj.id === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(itemObj.id) ? itemObj.id.toLowerCase() : `c${idx + 1}`;
        const rawCText = typeof itemObj.text === "string" ? itemObj.text.trim() : `Option ${idx + 1}`;
        return { id: rawCId, text: rawCText };
      }
      return { id: `c${idx + 1}`, text: `Option ${idx + 1}` };
    });
  } else if (targetFallback?.choices) {
    choices = [...targetFallback.choices];
  }

  // Ensure unique choice texts
  const seenTexts = new Set<string>();
  choices = choices.filter((c) => {
    const norm = c.text.toLowerCase();
    if (seenTexts.has(norm)) return false;
    seenTexts.add(norm);
    return true;
  });

  // Clamp choices to max 3 (or 2 for true_false) as required by QuizQuestionSchema
  const maxChoices = format === "true_false" ? 2 : 3;
  let correctChoiceId = typeof obj.correct_choice_id === "string" ? obj.correct_choice_id.toLowerCase() : choices[0]?.id ?? "c1";

  // If correct choice matches text rather than ID
  const matchedChoice = choices.find((c) => c.id === correctChoiceId || c.text.toLowerCase() === correctChoiceId.toLowerCase());
  if (matchedChoice) {
    correctChoiceId = matchedChoice.id;
  } else if (choices.length > 0) {
    correctChoiceId = choices[0].id;
  }

  if (choices.length > maxChoices) {
    const targetCorrect = choices.find((c) => c.id === correctChoiceId);
    if (targetCorrect && choices.indexOf(targetCorrect) >= maxChoices) {
      choices = [targetCorrect, ...choices.filter((c) => c !== targetCorrect).slice(0, maxChoices - 1)];
    } else {
      choices = choices.slice(0, maxChoices);
    }
  }

  while (choices.length < (format === "true_false" ? 2 : 3) && targetFallback) {
    const nextIdx = choices.length + 1;
    choices.push({ id: `c${nextIdx}`, text: `Option ${nextIdx}` });
  }

  if (!choices.some((c) => c.id === correctChoiceId)) {
    correctChoiceId = choices[0]?.id ?? "c1";
  }

  const explanation = typeof obj.explanation === "string" && obj.explanation.trim()
    ? obj.explanation.trim()
    : targetFallback?.explanation ?? "Correct answer explanation.";

  const fun_fact = typeof obj.fun_fact === "string" ? obj.fun_fact.trim() : targetFallback?.fun_fact ?? "";
  const visual_opportunity = typeof obj.visual_opportunity === "string" ? obj.visual_opportunity.trim() : targetFallback?.visual_opportunity ?? "";

  const candidate = {
    id,
    number,
    format,
    difficulty,
    question,
    choices,
    correct_choice_id: correctChoiceId,
    explanation,
    fun_fact,
    source_ids: Array.isArray(obj.source_ids) ? (obj.source_ids as string[]) : targetFallback?.source_ids ?? [],
    visual_opportunity,
    validation: { semantic_status: "validated" as const, source_coverage: false, fact_locked: true },
  };

  return QuizQuestionSchema.parse(candidate);
}

function parseQuizQuestionsFromOutput(rawOutput: string, fallbackMap: Map<string, QuizQuestion>): QuizQuestion[] {
  let cleaned = rawOutput.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsedJson: unknown = null;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    const arrayStart = cleaned.indexOf("[");
    const arrayEnd = cleaned.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        parsedJson = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
      } catch {}
    }

    if (!parsedJson) {
      const objStart = cleaned.indexOf("{");
      const objEnd = cleaned.lastIndexOf("}");
      if (objStart >= 0 && objEnd > objStart) {
        try {
          parsedJson = JSON.parse(cleaned.slice(objStart, objEnd + 1));
        } catch {}
      }
    }
  }

  if (!parsedJson) return [];

  const rawItems: unknown[] = Array.isArray(parsedJson)
    ? parsedJson
    : typeof parsedJson === "object" && parsedJson !== null && "questions" in parsedJson && Array.isArray((parsedJson as Record<string, unknown>).questions)
    ? (parsedJson as Record<string, unknown>).questions as unknown[]
    : [parsedJson];

  const results: QuizQuestion[] = [];
  for (const item of rawItems) {
    const rawId = typeof (item as Record<string, unknown>)?.id === "string" ? (item as Record<string, unknown>).id as string : undefined;
    const fallback = rawId ? fallbackMap.get(rawId) : fallbackMap.values().next().value;
    try {
      const normalized = normalizeRawQuizQuestion(item, fallback);
      if (normalized) results.push(normalized);
    } catch {}
  }

  return results;
}

export async function remixQuizQuestions(
  input: QuizOrchestratorInput,
  requestedQuestionIds?: string[],
  mode: "rephrase" | "replace" = "rephrase"
): Promise<{ quiz: QuizV2; history_check: QuestionHistoryCheckResult; remixed_count: number; invalidated: string[] }> {
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
  const otherQuestionsInEpisode = currentQuiz.questions.filter((q) => !targetIds.has(q.id));
  const otherQuestionsSummary = otherQuestionsInEpisode.length > 0
    ? "\nOTHER EXISTING QUESTIONS IN THIS EPISODE (ABSOLUTELY MUST NOT DUPLICATE OR OVERLAP TOPICS/ANSWERS):\n" +
      otherQuestionsInEpisode.map((q, idx) => `${idx + 1}. "${q.question}" -> Correct Answer: "${q.choices.find((c) => c.id === q.correct_choice_id)?.text || ""}"`).join("\n")
    : "";

  const recentHistorySummary = history.length > 0
    ? "\nRECENT PAST HISTORY QUESTIONS TO AVOID (DO NOT DUPLICATE):\n" +
      history.slice(0, 15).map((h, idx) => `${idx + 1}. "${h.question_text}" -> Answer: "${h.correct_answer}"`).join("\n")
    : "";

  const prompt = mode === "replace"
    ? [
        "You are an expert Quiz Creator for an educational children and family entertainment channel.",
        `Channel: ${channel.display_name}. Language: ${channel.language}. Age Band: ${episode.quiz_config.age_band}. Format: ${episode.quiz_config.quiz_format}.`,
        `Episode Topic/Theme: ${episode.topic || episode.slug || channel.display_name}.`,
        "TASK: Generate BRAND NEW, unique quiz questions to completely replace the specified target questions.",
        "",
        "CRITICAL RULES FOR REPLACING WITH NEW QUESTIONS:",
        "1. GENERATE FRESH FACTS & ANSWERS: Create completely NEW question topics and knowledge facts matching the episode theme. Generate strictly 3 distinct choices (id: 'c1', 'c2', 'c3' for multiple choice, or exactly 2 for true/false) with one designated correct_choice_id. Provide a clear, educational explanation and fun_fact.",
        "2. ANTI-DUPLICATION / ZERO COLLISION: The new questions MUST NOT duplicate or overlap with any other existing questions in this episode, nor any questions from past history.",
        "3. STRICT BREVITY & LENGTH: Question text MUST be 10 to 18 words maximum (ABSOLUTE MAXIMUM 120 CHARACTERS). Each choice text must be concise (under 30 characters).",
        "4. NO FILLER PREFIXES: Start directly with the natural question hook. NEVER use labels like 'Quiz:', 'Challenge:', 'Can you guess:', etc.",
        "5. MATCH AGE & TONE: Use child-friendly, engaging, native phrasing in " + channel.language + " suited for age band " + episode.quiz_config.age_band + ".",
        "6. PRESERVE METADATA: Keep the same id, number, format, and difficulty for each target question so it fits seamlessly into the episode.",
        "7. VALID JSON SCHEMA: Return ONLY a valid JSON array or object containing the questions matching the schema: [{ id, number, format, difficulty, question, choices: [{ id, text }], correct_choice_id, explanation, fun_fact, source_ids, visual_opportunity }]. Strictly 2 to 3 choices. Do NOT wrap in markdown code blocks.",
        "",
        "Target questions to replace with fresh facts:\n" + JSON.stringify(questionsToRemix, null, 2),
        otherQuestionsSummary,
        recentHistorySummary,
      ].filter(Boolean).join("\n")
    : [
        "You are an expert Quiz Editor for an educational children and family entertainment channel.",
        `Channel: ${channel.display_name}. Language: ${channel.language}. Age Band: ${episode.quiz_config.age_band}. Format: ${episode.quiz_config.quiz_format}.`,
        "TASK: Rephrase and remix the provided quiz questions so that their phrasing, perspective, hook, and clues feel completely fresh, creative, and non-repetitive compared to previously produced videos.",
        "",
        "CRITICAL CONSTRAINTS & QUALITY RULES:",
        "1. PRESERVE EXACT CHOICES & ANSWER: Keep the EXACT same correct answer and preserve all choices (id, text) verbatim. Do NOT modify choice text or which choice is correct.",
        "2. STRICT BREVITY & LENGTH LIMIT: The rephrased question MUST be concise, punchy, and readable in 2.5 to 4.0 seconds (10 to 18 words maximum, ABSOLUTE MAXIMUM 120 CHARACTERS). It must easily fit into the mobile video layout without overflowing.",
        "3. NO FILLER PREFIXES: NEVER prepend filler words or labels such as 'Quiz:', 'Challenge:', 'Can you solve:', 'Can you guess:', 'Question #:', 'Hey kids,' or long conversational setups. Start directly with the natural question hook.",
        "4. PERSPECTIVE & CLUE SHIFT: Transform direct or generic questions into engaging curiosity hooks (e.g. clue-based description, scenic context, or fun deduction).",
        "5. MATCH TONE & LANGUAGE: Maintain natural, child-friendly, native phrasing in " + channel.language + " suited for age band " + episode.quiz_config.age_band + ".",
        "6. VALID JSON SCHEMA: Return ONLY a valid JSON array or object containing the rephrased questions matching the schema: [{ id, number, format, difficulty, question, choices: [{ id, text }], correct_choice_id, explanation, fun_fact, source_ids, visual_opportunity }]. Do NOT wrap in markdown code blocks or add conversational prose.",
        "",
        "Questions to remix:\n" + JSON.stringify(questionsToRemix, null, 2),
      ].join("\n");

  let rephrasedQuestions: QuizQuestion[] = [];
  let executionError: Error | null = null;
  const client: LLMClient | null =
    input.activeEngine === "antigravity" && input.antigravityClient
      ? input.antigravityClient
      : input.codexClient ?? input.antigravityClient ?? null;

  if (client) {
    try {
      const rawOutput = await executeSinglePromptText(client, prompt, { timeoutMs: 90_000 });
      const fallbackMap = new Map(questionsToRemix.map((q) => [q.id, q]));
      rephrasedQuestions = parseQuizQuestionsFromOutput(rawOutput, fallbackMap);
    } catch (err) {
      executionError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (rephrasedQuestions.length === 0) {
    const errorDetail = executionError ? `: ${executionError.message}` : ". Please check that your AI engine (Antigravity/Codex) is connected and active.";
    throw new RepositoryError(
      `Question remix failed${errorDetail}`,
      "REMIX_FAILED"
    );
  }

  const rephrasedMap = new Map(rephrasedQuestions.map((q) => [q.id, q]));
  const updatedQuestions = currentQuiz.questions.map((q) => rephrasedMap.get(q.id) ?? q);
  const updatedQuiz: QuizV2 = { ...currentQuiz, questions: updatedQuestions };

  await input.repository.writeQuiz(input.channelId, input.episodeId, updatedQuiz);

  const updatedScenes = scenes.map((scene) => {
    if (scene.quiz && rephrasedMap.has(scene.quiz.question_number ? `q-${scene.quiz.question_number}` : "")) {
      const rephrased = rephrasedMap.get(`q-${scene.quiz.question_number}`)!;
      const correctChoiceText = rephrased.choices.find((c) => c.id === rephrased.correct_choice_id)?.text || "";
      return {
        ...scene,
        quiz: {
          ...scene.quiz,
          question: rephrased.question,
          options: rephrased.choices.map((c) => c.text),
          correct_answer: correctChoiceText,
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
    imageConfig: input.config.image_generation ? {
      api_key: input.config.image_generation.api_key,
      model: input.config.image_generation.model,
      provider: input.config.image_generation.provider,
      base_url: input.config.image_generation.base_url,
      quality: input.config.image_generation.quality,
    } : undefined,
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
