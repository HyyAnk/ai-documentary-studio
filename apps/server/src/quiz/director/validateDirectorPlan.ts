import {
  DirectorPlanSchema,
  type DirectorPlan,
  type QuizIssue,
  type QuizV2,
} from "@studio/shared";

const minimumThinkingSeconds: Record<QuizV2["age_band"], number> = { "4-6": 7.2, "7-9": 6.8, "10-12": 6.5, family: 6.8 };

export function validateDirectorPlan(quiz: QuizV2, value: unknown): { plan: DirectorPlan | null; issues: QuizIssue[] } {
  const parsed = DirectorPlanSchema.safeParse(value);
  if (!parsed.success) {
    return {
      plan: null,
      issues: [{ code: "director_schema", severity: "blocker", message: parsed.error.issues.map((issue) => issue.message).join("; "), next_action: "Regenerate the Director plan using only the supported semantic enums.", question_ids: [], stage: "director" }],
    };
  }
  const plan = parsed.data;
  const issues: QuizIssue[] = [];
  const expected = new Set(quiz.questions.map((question) => question.id));
  const actual = new Set(plan.beats.map((beat) => beat.question_id));
  const missing = quiz.questions.filter((question) => !actual.has(question.id)).map((question) => question.id);
  const extra = plan.beats.filter((beat) => !expected.has(beat.question_id)).map((beat) => beat.question_id);
  if (plan.episode_id !== quiz.episode_id) issues.push({ code: "director_episode_mismatch", severity: "blocker", message: "Director plan belongs to a different episode than QuizV2.", next_action: "Regenerate the plan for the current episode.", question_ids: [], stage: "director" });
  if (missing.length || extra.length) issues.push({ code: "director_question_coverage", severity: "blocker", message: "Director coverage is incomplete. Missing: " + (missing.join(", ") || "none") + "; unexpected: " + (extra.join(", ") || "none") + ".", next_action: "Regenerate the plan while preserving every canonical question ID.", question_ids: [...missing, ...extra], stage: "director" });
  if (plan.midpoint_question_id && !expected.has(plan.midpoint_question_id)) issues.push({ code: "director_midpoint_unknown", severity: "blocker", message: "Director midpoint references an unknown question.", next_action: "Choose the midpoint from the canonical QuizV2 question IDs.", question_ids: [plan.midpoint_question_id], stage: "director" });
  if (plan.final_challenge_question_id && !expected.has(plan.final_challenge_question_id)) issues.push({ code: "director_final_challenge_unknown", severity: "blocker", message: "Director final challenge references an unknown question.", next_action: "Choose the final challenge from the canonical QuizV2 question IDs.", question_ids: [plan.final_challenge_question_id], stage: "director" });
  const archetypeCounts = new Map<string, number>();
  for (const beat of plan.beats) archetypeCounts.set(beat.archetype, (archetypeCounts.get(beat.archetype) ?? 0) + 1);
  const repeated = [...archetypeCounts.entries()].find(([, count]) => count > Math.ceil(quiz.questions.length * 0.6));
  if (repeated) issues.push({ code: "director_repeated_archetype", severity: "warning", message: repeated[0] + " is used for " + repeated[1] + " of " + quiz.questions.length + " questions.", next_action: "Vary the visual archetypes so the episode does not feel mechanically repeated.", question_ids: plan.beats.filter((beat) => beat.archetype === repeated[0]).map((beat) => beat.question_id), stage: "director" });
  const highEnergy = plan.beats.filter((beat) => beat.energy === "excited" || beat.energy === "triumphant");
  if (highEnergy.length > Math.ceil(quiz.questions.length * 0.45)) issues.push({ code: "director_flat_high_energy", severity: "warning", message: highEnergy.length + " beats use high energy, leaving too little contrast.", next_action: "Reserve high energy for reveals, midpoint, and final challenge.", question_ids: highEnergy.map((beat) => beat.question_id), stage: "director" });
  if (quiz.questions.length >= 5 && !plan.midpoint_question_id) issues.push({ code: "director_midpoint_missing", severity: "warning", message: "The episode has no marked midpoint moment.", next_action: "Mark one question as the visual or energy midpoint.", question_ids: [], stage: "director" });
  if (quiz.questions.length >= 3 && !plan.final_challenge_question_id) issues.push({ code: "director_final_challenge_missing", severity: "warning", message: "The episode has no marked final challenge.", next_action: "Mark the final challenge question and give it a distinct reward treatment.", question_ids: [], stage: "director" });
  for (const beat of plan.beats) {
    const question = quiz.questions.find((candidate) => candidate.id === beat.question_id);
    if (!question) continue;
    if (beat.thinking_seconds < minimumThinkingSeconds[quiz.age_band]) issues.push({ code: "director_thinking_too_short", severity: "blocker", message: "Question " + question.number + " has " + beat.thinking_seconds + "s of thinking time for age band " + quiz.age_band + ".", next_action: "Increase thinking time to at least " + minimumThinkingSeconds[quiz.age_band] + " seconds.", question_ids: [question.id], stage: "director" });
    if (beat.thinking_seconds > 20) issues.push({ code: "director_thinking_too_long", severity: "warning", message: "Question " + question.number + " has " + beat.thinking_seconds + "s of thinking time.", next_action: "Shorten the thinking beat unless the question needs a deliberate pause.", question_ids: [question.id], stage: "director" });
    if (!beat.beat_intents.includes("answer_reveal")) issues.push({ code: "director_reveal_missing", severity: "blocker", message: "Question " + question.number + " has no answer reveal intent.", next_action: "Add an answer_reveal beat intent before rendering.", question_ids: [question.id], stage: "director" });
  }
  return { plan, issues };
}

export function assertDirectorPlanValid(quiz: QuizV2, value: unknown): DirectorPlan {
  const result = validateDirectorPlan(quiz, value);
  const blockers = result.issues.filter((issue) => issue.severity === "blocker");
  if (!result.plan || blockers.length) throw new Error(blockers.map((issue) => issue.message).join(" "));
  return result.plan;
}
