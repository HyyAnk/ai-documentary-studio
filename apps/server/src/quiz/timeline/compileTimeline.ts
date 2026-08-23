import { QuizTimelineSchema, type DirectorPlan, type QuizTimeline, type QuizV2, type VoicePlan } from "@studio/shared";
import { timingPolicyForAgeBand, type QuizTimingPolicy } from "./timingPolicy.js";

export type TimelineCompileInput = {
  quiz: QuizV2;
  director: DirectorPlan;
  voicePlan: VoicePlan;
  audioDurations?: Record<string, number>;
  timing?: Partial<QuizTimingPolicy>;
};

export function compileQuizTimeline(input: TimelineCompileInput): QuizTimeline {
  const policy = { ...timingPolicyForAgeBand(input.quiz.age_band), ...input.timing };
  const events: QuizTimeline["events"] = [];
  let cursor = 0;
  let sequence = 0;
  const scheduled = new Set<string>();
  const add = (event: Omit<QuizTimeline["events"][number], "event_id">) => {
    events.push({ ...event, event_id: "event-" + String(++sequence).padStart(4, "0") });
  };
  const durationFor = (segmentId: string, fallbackText: string): number => {
    const measured = input.audioDurations?.[segmentId];
    if (typeof measured === "number" && Number.isFinite(measured) && measured >= 0) return round(measured);
    const words = fallbackText.trim().split(/\s+/).filter(Boolean).length;
    return round(Math.max(0.25, words / policy.fallback_words_per_second));
  };
  const scheduleNarration = (segmentId: string, at: number, text: string, questionId: string | null): number => {
    const duration = durationFor(segmentId, text);
    add({ type: "narration.segment", at_seconds: at, duration_seconds: duration, question_id: questionId, choice_id: null, segment_id: segmentId, payload: {} });
    scheduled.add(segmentId);
    return duration;
  };
  const intro = input.voicePlan.segments.find((segment) => segment.role === "intro");
  add({ type: "background.enter", at_seconds: 0, duration_seconds: 0, question_id: null, choice_id: null, segment_id: null, payload: { theme: input.director.archetype_family } });
  const introEnd = intro ? scheduleNarration(intro.segment_id, cursor, intro.text, null) : 0;
  cursor = round(Math.max(policy.intro_minimum_seconds, introEnd));
  if (cursor > 0) add({ type: "background.motion", at_seconds: 0, duration_seconds: cursor, question_id: null, choice_id: null, segment_id: null, payload: { layers: ["sunburst", "pattern", "ambient_shapes"] } });
  for (const [questionIndex, question] of input.quiz.questions.entries()) {
    const beat = input.director.beats.find((candidate) => candidate.question_id === question.id);
    if (!beat) throw new Error("Question " + question.id + " has no Director beat");
    const midpoint = input.voicePlan.segments.find((segment) => segment.role === "midpoint" && segment.question_id === question.id);
    if (midpoint) {
      add({ type: "mascot.state", at_seconds: cursor, duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { state: "encourage", interlude: "midpoint" } });
      cursor += scheduleNarration(midpoint.segment_id, cursor, midpoint.text, question.id);
      cursor = round(cursor + policy.transition_seconds);
    }
    const questionStart = cursor;
    add({ type: "question.enter", at_seconds: questionStart, duration_seconds: policy.question_entrance_seconds, question_id: question.id, choice_id: null, segment_id: null, payload: { archetype: beat.archetype, energy: beat.energy } });
    const questionSegment = input.voicePlan.segments.find((segment) => segment.segment_id === question.id + ":question");
    const questionNarrationAt = round(questionStart + policy.question_narration_lead_seconds);
    const questionNarrationDuration = questionSegment ? scheduleNarration(questionSegment.segment_id, questionNarrationAt, questionSegment.text, question.id) : 0;
    const questionNarrationEnd = round(questionNarrationAt + questionNarrationDuration);
    // Let the title land under the outgoing bubble release, but wait until
    // that release has cleared before animating the answer cards. This keeps
    // the intentional scene momentum without stacking three foreground acts.
    const incomingTransitionClearance = questionIndex > 0 ? policy.transition_overlap_seconds + .05 : 0;
    const choicesStart = round(questionStart + Math.max(policy.choices_enter_delay_seconds, incomingTransitionClearance));
    add({ type: "choices.enter", at_seconds: choicesStart, duration_seconds: policy.choice_entrance_seconds + Math.max(0, question.choices.length - 1) * policy.choice_stagger_seconds, question_id: question.id, choice_id: null, segment_id: null, payload: { choice_ids: question.choices.map((choice) => choice.id) } });
    const choiceSegment = input.voicePlan.segments.find((segment) => segment.segment_id === question.id + ":choice");
    let choiceNarrationEnd = round(choicesStart + policy.choice_settle_seconds);
    if (choiceSegment) {
      const choiceAt = round(Math.max(choicesStart + policy.choice_settle_seconds, questionNarrationEnd + policy.narration_gap_seconds));
      const choiceDuration = scheduleNarration(choiceSegment.segment_id, choiceAt, choiceSegment.text, question.id);
      if (choiceDuration >= 4) add({ type: "mascot.state", at_seconds: round(choiceAt + choiceDuration / 2), duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { state: "curious", phase: "choices_pulse" } });
      choiceNarrationEnd = round(choiceAt + choiceDuration);
    }
    const thinkingStart = round(choiceNarrationEnd + policy.thinking_settle_seconds);
    const thinkingSegment = input.voicePlan.segments.find((segment) => segment.segment_id === question.id + ":thinking");
    const thinkingNarrationDuration = thinkingSegment ? scheduleNarration(thinkingSegment.segment_id, thinkingStart, thinkingSegment.text, question.id) : 0;
    const thinkingNarrationEnd = round(thinkingStart + thinkingNarrationDuration);
    const earliestCountdownStart = round(thinkingNarrationEnd + policy.post_prompt_thinking_seconds);
    const minRequiredThinkingSeconds = round(earliestCountdownStart + policy.countdown_seconds - thinkingStart);
    const thinkingSeconds = round(Math.min(policy.maximum_thinking_seconds, Math.max(policy.minimum_thinking_seconds, beat.thinking_seconds, minRequiredThinkingSeconds)));
    add({ type: "countdown.start", at_seconds: thinkingStart, duration_seconds: thinkingSeconds, question_id: question.id, choice_id: null, segment_id: null, payload: { seconds: thinkingSeconds } });
    add({ type: "mascot.state", at_seconds: thinkingStart, duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { state: "thinking", phase: "thinking_start" } });
    const countdownStart = round(Math.max(thinkingStart + thinkingSeconds - policy.countdown_seconds, earliestCountdownStart));
    const thinkingPulseAt = round(thinkingStart + Math.max(1.4, (countdownStart - thinkingStart) / 2));
    if (thinkingPulseAt < countdownStart - 0.18) add({ type: "mascot.state", at_seconds: thinkingPulseAt, duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { state: "encourage", phase: "thinking_pulse" } });
    for (let tick = 0; tick < policy.countdown_seconds; tick += 1) {
      add({ type: "countdown.tick", at_seconds: round(countdownStart + tick), duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { value: policy.countdown_seconds - tick } });
    }
    const countdownSegment = input.voicePlan.segments.find((segment) => segment.segment_id === question.id + ":countdown");
    const countdownNarrationDuration = countdownSegment ? scheduleNarration(countdownSegment.segment_id, countdownStart, countdownSegment.text, question.id) : 0;
    const countdownNarrationEnd = round(countdownStart + countdownNarrationDuration);
    const revealAt = round(Math.max(thinkingStart + thinkingSeconds + policy.reveal_delay_seconds, countdownNarrationEnd + policy.narration_gap_seconds, countdownStart + policy.countdown_seconds + policy.reveal_delay_seconds));
    const correctChoice = question.choices.find((choice) => choice.id === question.correct_choice_id);
    add({ type: "answer.reveal", at_seconds: revealAt, duration_seconds: policy.reveal_seconds, question_id: question.id, choice_id: question.correct_choice_id, segment_id: null, payload: { canonical_choice_id: question.correct_choice_id, answer_text: correctChoice?.text ?? "" } });
    add({ type: "answer.dim_wrong", at_seconds: revealAt, duration_seconds: policy.reveal_seconds, question_id: question.id, choice_id: null, segment_id: null, payload: { wrong_choice_ids: question.choices.filter((choice) => choice.id !== question.correct_choice_id).map((choice) => choice.id) } });
    const revealSegment = input.voicePlan.segments.find((segment) => segment.segment_id === question.id + ":reveal");
    let revealNarrationEnd = revealAt + policy.reveal_seconds;
    if (revealSegment) {
      const revealNarrationAt = round(revealAt + policy.reveal_voice_lead_seconds);
      revealNarrationEnd = revealNarrationAt + scheduleNarration(revealSegment.segment_id, revealNarrationAt, revealSegment.text, question.id);
    }
    const rewardAt = round(revealAt + policy.reveal_seconds);
    add({ type: "reward.play", at_seconds: rewardAt, duration_seconds: policy.reward_seconds[beat.reward_intensity], question_id: question.id, choice_id: question.correct_choice_id, segment_id: null, payload: { intensity: beat.reward_intensity } });
    const explanationSegment = input.voicePlan.segments.find((segment) => segment.segment_id === question.id + ":explanation");
    let postReveal = Math.max(revealNarrationEnd + policy.reveal_hold_seconds, rewardAt + policy.reward_seconds[beat.reward_intensity] + policy.explanation_lead_seconds);
    if (explanationSegment) {
      const explanationAt = postReveal;
      const explanationDuration = scheduleNarration(explanationSegment.segment_id, explanationAt, explanationSegment.text, question.id);
      add({ type: "mascot.state", at_seconds: explanationAt, duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { state: "point", phase: "explanation_start" } });
      if (explanationDuration >= 4) add({ type: "mascot.state", at_seconds: round(explanationAt + explanationDuration / 2), duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { state: "encourage", phase: "explanation_pulse" } });
      postReveal = explanationAt + explanationDuration;
    }
    postReveal = round(postReveal + policy.explanation_hold_seconds);
    const factSegment = input.voicePlan.segments.find((segment) => segment.segment_id === question.id + ":fact");
    if (factSegment) {
      const factAt = postReveal;
      const factDuration = scheduleNarration(factSegment.segment_id, factAt, factSegment.text, question.id);
      add({ type: "fact.enter", at_seconds: factAt, duration_seconds: factDuration, question_id: question.id, choice_id: null, segment_id: factSegment.segment_id, payload: {} });
      postReveal = round(factAt + factDuration + policy.fact_hold_seconds);
    }
    add({ type: "mascot.state", at_seconds: rewardAt, duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { state: beat.mascot_state } });
    add({ type: "sfx.play", at_seconds: rewardAt, duration_seconds: 0, question_id: question.id, choice_id: null, segment_id: null, payload: { intents: beat.sfx_intents } });
    add({ type: "transition.start", at_seconds: postReveal, duration_seconds: policy.transition_seconds, question_id: question.id, choice_id: null, segment_id: null, payload: { intent: beat.transition_intent } });
    add({ type: "background.motion", at_seconds: questionStart, duration_seconds: round(postReveal - questionStart), question_id: question.id, choice_id: null, segment_id: null, payload: { layers: ["sunburst", "pattern", "ambient_shapes", "hero_float"] } });
    cursor = round(postReveal + Math.max(.05, policy.transition_seconds - policy.transition_overlap_seconds));
  }
  const outro = input.voicePlan.segments.find((segment) => segment.role === "outro");
  if (outro) {
    const outroStart = cursor;
    cursor = round(cursor + scheduleNarration(outro.segment_id, cursor, outro.text, null));
    add({ type: "background.motion", at_seconds: outroStart, duration_seconds: round(cursor - outroStart), question_id: null, choice_id: null, segment_id: null, payload: { layers: ["sunburst", "ambient_shapes"] } });
  }
  const missingNarration = input.voicePlan.segments.filter((segment) => !scheduled.has(segment.segment_id));
  if (missingNarration.length) throw new Error("Timeline omitted voice segments: " + missingNarration.map((segment) => segment.segment_id).join(", "));
  const sorted = events.map((event, index) => ({ event, index })).sort((a, b) => a.event.at_seconds - b.event.at_seconds || a.index - b.index).map(({ event }) => ({ ...event, at_seconds: round(event.at_seconds), duration_seconds: round(event.duration_seconds) }));
  return QuizTimelineSchema.parse({ schema_version: 2, episode_id: input.quiz.episode_id, duration_seconds: Math.max(0.1, round(cursor)), events: sorted });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
