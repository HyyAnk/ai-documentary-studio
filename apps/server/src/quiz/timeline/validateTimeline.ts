import { QuizTimelineSchema, type QuizIssue, type QuizTimeline, type QuizV2 } from "@studio/shared";

export function validateQuizTimeline(quiz: QuizV2, timeline: unknown): QuizIssue[] {
  const parsed = QuizTimelineSchema.safeParse(timeline);
  if (!parsed.success) return [{ code: "timeline_schema", severity: "blocker", message: parsed.error.issues.map((issue) => issue.message).join("; "), next_action: "Recompile the timeline from the current Quiz, Director plan, and measured audio durations.", question_ids: [], stage: "timeline" }];
  const value = parsed.data;
  const issues: QuizIssue[] = [];
  const questionIds = new Set(quiz.questions.map((question) => question.id));
  const questionEnters = new Map<string, number>();
  for (const event of value.events) {
    if (event.question_id && !questionIds.has(event.question_id)) issues.push({ code: "timeline_unknown_question", severity: "blocker", message: "Timeline event " + event.event_id + " references unknown question " + event.question_id + ".", next_action: "Recompile the timeline from the current QuizV2 artifact.", question_ids: [event.question_id], stage: "timeline" });
    if (event.type === "question.enter" && event.question_id) questionEnters.set(event.question_id, event.at_seconds);
    if (event.type === "answer.reveal" && event.question_id) {
      const question = quiz.questions.find((candidate) => candidate.id === event.question_id);
      const canonical = String(event.payload.canonical_choice_id ?? event.choice_id ?? "");
      if (question && canonical !== question.correct_choice_id) issues.push({ code: "timeline_canonical_answer_mismatch", severity: "blocker", message: "Question " + question.number + " reveals " + canonical + ", but QuizV2 defines " + question.correct_choice_id + " as the canonical answer.", next_action: "Regenerate or repair the Director/timeline before rendering.", question_ids: [question.id], stage: "timeline" });
      const thinking = value.events.find((candidate) => candidate.type === "countdown.start" && candidate.question_id === event.question_id);
      if (thinking && event.at_seconds < thinking.at_seconds + thinking.duration_seconds) issues.push({ code: "timeline_reveal_before_thinking", severity: "blocker", message: "Question " + (question?.number ?? event.question_id) + " reveals before thinking time ends.", next_action: "Increase the reveal timestamp or recompile with the timing policy.", question_ids: [event.question_id], stage: "timeline" });
    }
    if (event.type === "reward.play" && event.question_id) {
      const reveal = value.events.find((candidate) => candidate.type === "answer.reveal" && candidate.question_id === event.question_id);
      if (reveal && event.at_seconds < reveal.at_seconds) issues.push({ code: "timeline_reward_before_reveal", severity: "blocker", message: "Question " + event.question_id + " rewards before its answer reveal.", next_action: "Recompile the timeline so reward follows the canonical reveal.", question_ids: [event.question_id], stage: "timeline" });
    }
    if (event.type === "narration.segment" && event.segment_id && event.at_seconds + event.duration_seconds > value.duration_seconds + 0.001) issues.push({ code: "timeline_audio_out_of_bounds", severity: "blocker", message: "Narration segment " + event.segment_id + " extends beyond the timeline duration.", next_action: "Recompile the timeline with measured audio durations.", question_ids: event.question_id ? [event.question_id] : [], stage: "timeline" });
  }
  const ordered = [...questionEnters.entries()].sort(([, a], [, b]) => a - b).map(([id]) => id);
  const expected = quiz.questions.map((question) => question.id);
  if (ordered.join("|") !== expected.join("|")) issues.push({ code: "timeline_question_order", severity: "blocker", message: "Timeline question order does not match QuizV2.", next_action: "Recompile the timeline from the ordered QuizV2 questions.", question_ids: expected, stage: "timeline" });
  return issues;
}

export function assertQuizTimelineValid(quiz: QuizV2, timeline: QuizTimeline): QuizTimeline {
  const issues = validateQuizTimeline(quiz, timeline);
  const blockers = issues.filter((issue) => issue.severity === "blocker");
  if (blockers.length) throw new Error(blockers.map((issue) => issue.message).join(" "));
  return timeline;
}
