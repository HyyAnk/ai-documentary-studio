import {
  QuizQuestionFormatSchema,
  QuizV2Schema,
  QUIZ_MAX_CHOICES_PER_QUESTION,
  QUIZ_MIN_CHOICES_PER_QUESTION,
  type QuizConfig,
  type QuizQuestionFormat,
  type QuizV2,
  type Scene,
} from "@studio/shared";

export class QuizDomainError extends Error {
  constructor(message: string, public readonly code = "QUIZ_DOMAIN_ERROR") {
    super(message);
    this.name = "QuizDomainError";
  }
}

export function normalizeQuizText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function stripQuizChoiceLabel(value: string): string {
  return value.trim().replace(/^(?:(?:choice|option)[\s_-]*)?(?:[a-z]|\d{1,2})\s*[-–—:.)]\s+/i, "").trim();
}

function normalizeQuizChoiceText(value: string): string {
  return normalizeQuizText(stripQuizChoiceLabel(value)).replace(/[.!?…。！？]+$/u, "");
}

/**
 * Returns the unique visible choice represented by a spoken/scripted answer.
 * Quiz shot plans often say "B — Inclined plane" while the visible choice is
 * only "Inclined plane". The label is accepted only when its suffix is empty
 * or still matches the referenced visible choice.
 */
export function resolveVisibleQuizChoice(choices: string[], answer: string): number | null {
  const normalizedAnswer = normalizeQuizChoiceText(answer);
  const normalizedChoices = choices.map((choice, index) => ({ index, normalized: normalizeQuizChoiceText(choice) }));
  const exactMatches = normalizedChoices.filter((choice) => choice.normalized === normalizedAnswer);
  if (exactMatches.length === 1) return exactMatches[0].index;
  if (exactMatches.length > 1) return null;

  const candidates = [answer.trim(), stripAnswerLead(answer)].filter(Boolean);
  for (const candidate of candidates) {
    const candidateNormalized = normalizeQuizChoiceText(candidate);
    const candidateExactMatches = normalizedChoices.filter((choice) => choice.normalized === candidateNormalized);
    if (candidateExactMatches.length === 1) return candidateExactMatches[0].index;
    if (candidateExactMatches.length > 1) return null;

    const labeled = candidate.match(/^(?:(?:choice|option)[\s_-]*)?([a-z]|\d{1,2})(?:\s*(?:[-–—:.)]\s*|\s+)(.*))?$/i);
    if (!labeled) continue;
    const token = labeled[1] ?? "";
    const index = /^[a-z]$/i.test(token) ? token.toLowerCase().charCodeAt(0) - 97 : Number(token) - 1;
    const visibleChoice = normalizedChoices[index];
    if (!visibleChoice) continue;
    const suffix = normalizeQuizChoiceText(labeled[2] ?? "");
    if (!suffix || matchesVisibleChoiceText(suffix, visibleChoice.normalized)) return index;
  }

  return null;
}

export function canonicalizeVisibleQuizAnswer(choices: string[], answer: string): string | null {
  const index = resolveVisibleQuizChoice(choices, answer);
  return index === null ? null : stripQuizChoiceLabel(choices[index] ?? "");
}

function stripAnswerLead(value: string): string {
  return value.trim().replace(/^(?:(?:the\s+)?(?:correct|right|canonical)\s+)?(?:answer|choice|option)\s*(?:is|:|=|-)?\s*/i, "").trim();
}

function matchesVisibleChoiceText(candidate: string, visibleChoice: string): boolean {
  if (candidate === visibleChoice) return true;
  if (!candidate.startsWith(`${visibleChoice} `)) return false;
  const remainder = candidate.slice(visibleChoice.length).trim();
  return /^(?:because|since|as|is|means|[([—–,:;])/i.test(remainder);
}

export function validateQuizV2(value: unknown): QuizV2 {
  try {
    return QuizV2Schema.parse(value);
  } catch (error) {
    throw new QuizDomainError(error instanceof Error ? error.message : "Quiz V2 is invalid", "QUIZ_INVALID");
  }
}

export function deriveQuizV2FromScenes(input: {
  episodeId: string;
  language: string;
  ageBand: QuizConfig["age_band"];
  format: QuizConfig["quiz_format"];
  scenes: Scene[];
}): QuizV2 {
  const grouped = new Map<number, Scene[]>();
  for (const scene of input.scenes) {
    const number = scene.quiz?.question_number;
    if (!number) continue;
    grouped.set(number, [...(grouped.get(number) ?? []), scene]);
  }
  if (!grouped.size) throw new QuizDomainError("Quiz scenes contain no numbered questions", "QUIZ_QUESTIONS_MISSING");

  const questions = [...grouped.entries()].sort(([a], [b]) => a - b).map(([number, questionScenes], index) => {
    const quizScenes = questionScenes.map((scene) => scene.quiz).filter((quiz): quiz is NonNullable<Scene["quiz"]> => Boolean(quiz));
    const question = quizScenes.find((quiz) => quiz.question.trim())?.question.trim() ?? "";
    const choicesText = (quizScenes.find((quiz) => quiz.choices.length > 0)?.choices ?? []).slice(0, QUIZ_MAX_CHOICES_PER_QUESTION);
    const answer = quizScenes.find((quiz) => quiz.answer.trim())?.answer.trim() ?? "";
    const explanation = quizScenes.find((quiz) => quiz.explanation.trim())?.explanation.trim() ?? "";
    if (!question || choicesText.length < QUIZ_MIN_CHOICES_PER_QUESTION || choicesText.length > QUIZ_MAX_CHOICES_PER_QUESTION || !answer || !explanation) {
      throw new QuizDomainError("Question " + number + " is missing question, choices (must have 2–3 choices: A, B, or C), canonical answer, or explanation", "QUIZ_QUESTION_INCOMPLETE");
    }
    const choices = choicesText.map((text, choiceIndex) => ({ id: "choice-" + String.fromCharCode(97 + choiceIndex), text: stripQuizChoiceLabel(text) }));
    const canonicalChoiceIndex = resolveVisibleQuizChoice(choices.map((choice) => choice.text), answer);
    if (canonicalChoiceIndex === null) throw new QuizDomainError("Question " + number + " answer \"" + answer + "\" does not match exactly one visible choice", "QUIZ_CANONICAL_ANSWER_INVALID");
    const normalizedChoices = choices.map((choice) => normalizeQuizChoiceText(choice.text));
    if (new Set(normalizedChoices).size !== normalizedChoices.length) throw new QuizDomainError("Question " + number + " contains duplicate visible choices", "QUIZ_DUPLICATE_CHOICE");
    const sourceIds = [...new Set(questionScenes.flatMap((scene) => scene.source_ids))];
    const visualOpportunity = quizScenes.find((quiz) => quiz.image_prompt.trim())?.image_prompt.trim() ?? "";
    const format = normalizeQuestionFormat(input.format);
    return {
      id: "question-" + String(index + 1).padStart(2, "0"),
      number: index + 1,
      format,
      difficulty: Math.min(5, 1 + Math.floor(index / Math.max(1, Math.ceil(grouped.size / 5)))),
      question,
      choices,
      correct_choice_id: choices[canonicalChoiceIndex].id,
      explanation,
      fun_fact: "",
      source_ids: sourceIds,
      visual_opportunity: visualOpportunity,
      validation: { semantic_status: "validated", source_coverage: sourceIds.length > 0, fact_locked: true },
    };
  });
  return validateQuizV2({ schema_version: 2, episode_id: input.episodeId, age_band: input.ageBand, language: input.language, questions });
}

function normalizeQuestionFormat(format: QuizConfig["quiz_format"]): QuizQuestionFormat {
  const candidate = format === "knowledge" ? "multiple_choice" : format;
  return QuizQuestionFormatSchema.parse(candidate);
}
