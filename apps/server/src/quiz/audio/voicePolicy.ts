import type { QuizV2, VoicePlan } from "@studio/shared";

/**
 * The QA gate measures only the duration of spoken voice segments. Keep this
 * policy in one place so synthesis, cache invalidation, and QA use the same
 * age-band contract.
 */
export function quizVoiceTargetWordsPerSecond(ageBand: QuizV2["age_band"]): number {
  return { "4-6": 1.9, "7-9": 2.1, "10-12": 2.25, family: 2.2 }[ageBand];
}

/** Leave a small measurement/rounding margin below the hard QA target. */
export function quizVoicePacingLimit(targetWordsPerSecond: number): number {
  return Number((targetWordsPerSecond * 0.97).toFixed(3));
}

export function quizVoiceWordsPerSecond(voicePlan: VoicePlan): number {
  const spoken = voicePlan.segments.filter((segment) => segment.role !== "countdown");
  const words = spoken.reduce((total, segment) => total + countQuizVoiceWords(segment.text), 0);
  const duration = spoken.reduce((total, segment) => total + (segment.duration_seconds ?? 0), 0);
  return words / Math.max(0.1, duration);
}

export function quizVoicePlanNeedsRegeneration(input: {
  voicePlan: VoicePlan | null;
  ageBand: QuizV2["age_band"];
  assessmentIssueCodes?: Iterable<string>;
}): boolean {
  if (!input.voicePlan) return true;
  const issueCodes = new Set(input.assessmentIssueCodes ?? []);
  return quizVoiceWordsPerSecond(input.voicePlan) > quizVoiceTargetWordsPerSecond(input.ageBand)
    || issueCodes.has("voice_pace_fast")
    || issueCodes.has("voice_pace_unsafe");
}

export function countQuizVoiceWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
