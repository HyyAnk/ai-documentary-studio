import type { DirectorPlan, QuizAssessment, QuizAssetPlan, QuizTimeline, QuizV2, VoicePlan } from "@studio/shared";
import { assessQuiz } from "./quizAssessment.js";

export type QuizRenderPreflightInput = {
  quiz: QuizV2;
  director: DirectorPlan;
  assetPlan: QuizAssetPlan;
  resolvedAssets: Array<{ asset_id: string; path: string; source: string }>;
  voicePlan: VoicePlan;
  timeline: QuizTimeline;
  measuredAudio: boolean;
};

export function preflightQuizRender(input: QuizRenderPreflightInput): { ok: boolean; assessment: QuizAssessment } {
  const assessment = assessQuiz({ ...input, renderIntegrity: true });
  return { ok: !assessment.issues.some((issue) => issue.severity === "blocker"), assessment };
}
