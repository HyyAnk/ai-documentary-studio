import { nowIso, QuizAssessmentSchema, type DirectorPlan, type QuizAssessment, type QuizAssetPlan, type QuizIssue, type QuizTimeline, type QuizV2, type VoicePlan } from "@studio/shared";
import { validateDirectorPlan } from "../director/validateDirectorPlan.js";
import { validateQuizTimeline } from "../timeline/validateTimeline.js";
import { assessQuizVisualLayout } from "./visualQa.js";
import { quizVoiceTargetWordsPerSecond, quizVoiceWordsPerSecond } from "../audio/voicePolicy.js";
import { validateTextCopyright } from "./copyrightValidator.js";

export type QuizAssessmentInput = {
  quiz: QuizV2;
  director?: DirectorPlan | null;
  assetPlan?: QuizAssetPlan | null;
  resolvedAssets?: Array<{ asset_id: string; path: string; source: string }>;
  voicePlan?: VoicePlan | null;
  timeline?: QuizTimeline | null;
  measuredAudio?: boolean;
  renderIntegrity?: boolean;
  staticIntervalThresholdSeconds?: number;
};

export function assessQuiz(input: QuizAssessmentInput): QuizAssessment {
  const issues: QuizIssue[] = [];
  const add = (issue: QuizIssue) => issues.push(issue);
  const semanticProblems = input.quiz.questions.flatMap((question) => {
    const result: QuizIssue[] = [];
    if (!question.validation.fact_locked) result.push({ code: "semantic_fact_unlocked", severity: "blocker", message: "Question " + question.number + " is not fact locked.", next_action: "Validate the canonical answer and explanation before directing or rendering.", question_ids: [question.id], stage: "semantic" });
    if (!question.source_ids.length) result.push({ code: "semantic_sources_missing", severity: "blocker", message: "Question " + question.number + " has no source IDs.", next_action: "Attach source IDs from the research ledger before rendering.", question_ids: [question.id], stage: "semantic" });
    const textToScan = `${question.question} ${question.choices.map((c) => c.text).join(" ")} ${question.explanation} ${question.visual_opportunity ?? ""}`;
    const copyright = validateTextCopyright(textToScan);
    if (copyright.violated) {
      result.push({
        code: "semantic_copyright_violation",
        severity: "blocker",
        message: `Question ${question.number} contains prohibited term '${copyright.term}' (${copyright.reason}).`,
        next_action: "Regenerate this question using a safe alternative subject without using copyrighted characters or lion cubs.",
        question_ids: [question.id],
        stage: "semantic",
      });
    }
    if (question.question.length > 100) result.push({ code: "layout_question_long", severity: "warning", message: "Question " + question.number + " exceeds the recommended child-friendly limit (100 characters).", next_action: "Shorten the question to be direct, punchy, and under 10 words.", question_ids: [question.id], stage: "layout" });
    if (question.explanation.length > 150) result.push({ code: "layout_explanation_long", severity: "warning", message: "Question " + question.number + " explanation exceeds the recommended child-friendly limit (150 characters).", next_action: "Shorten the explanation to strictly 1 punchy sentence under 18 words with a fun fact.", question_ids: [question.id], stage: "layout" });
    if (question.choices.some((choice) => choice.text.length > 100)) result.push({ code: "layout_choice_long", severity: "warning", message: "Question " + question.number + " contains a long answer choice.", next_action: "Shorten the choice text so it remains readable on a 16:9 card.", question_ids: [question.id], stage: "layout" });
    return result;
  });
  semanticProblems.forEach(add);
  const positionCounts = new Map<number, number>();
  for (const question of input.quiz.questions) {
    const correctIndex = question.choices.findIndex((choice) => choice.id === question.correct_choice_id);
    if (correctIndex >= 0) positionCounts.set(correctIndex, (positionCounts.get(correctIndex) ?? 0) + 1);
  }
  const mostCommonPosition = Math.max(0, ...positionCounts.values());
  if (input.quiz.questions.length >= 5 && mostCommonPosition / input.quiz.questions.length > .6) {
    const dominantPosition = [...positionCounts.entries()].find(([, count]) => count === mostCommonPosition)?.[0] ?? 0;
    add({
      code: "quiz_answer_position_bias",
      severity: "warning",
      message: `Correct answers are concentrated in choice ${String.fromCharCode(65 + dominantPosition)} (${mostCommonPosition}/${input.quiz.questions.length}).`,
      next_action: "Rebalance or deterministically shuffle visible choices while preserving the canonical answer mapping.",
      question_ids: input.quiz.questions.filter((question) => question.choices.findIndex((choice) => choice.id === question.correct_choice_id) === dominantPosition).map((question) => question.id),
      stage: "semantic",
    });
  }
  if (input.director) validateDirectorPlan(input.quiz, input.director).issues.forEach(add);
  assessQuizVisualLayout({ quiz: input.quiz, director: input.director, assetPlan: input.assetPlan, timeline: input.timeline }).forEach(add);
  if (input.assetPlan) {
    const resolved = new Set((input.resolvedAssets ?? []).map((asset) => asset.asset_id));
    for (const asset of input.assetPlan.assets) {
      if (!resolved.has(asset.asset_id)) add({ code: "asset_required_unresolved", severity: "blocker", message: "Required asset " + asset.asset_id + " is unresolved.", next_action: "Resolve the exact semantic asset before rendering.", question_ids: asset.question_id ? [asset.question_id] : [], stage: "assets" });
    }
  }
  if (input.resolvedAssets) {
    for (const asset of input.resolvedAssets as Array<{ asset_id: string; path: string; source: string; degraded?: boolean; fallback_tier?: number; question_id?: string }>) {
      if (asset.degraded || asset.fallback_tier === 3 || asset.source === "fallback") {
        add({
          code: "asset_fallback_degraded",
          severity: "warning",
          message: `Asset ${asset.asset_id} used Tier 3 deterministic fallback.`,
          next_action: "Operator review recommended: check placeholder visual readability or regenerate image with an AI provider.",
          question_ids: asset.question_id ? [asset.question_id] : [],
          stage: "assets",
        });
      }
    }
  }
  if (input.voicePlan && input.measuredAudio === false) add({ code: "voice_measurement_missing", severity: "blocker", message: "Voice segments exist but measured narration durations are missing.", next_action: "Synthesize narration through Chatterbox and persist measured WAV durations.", question_ids: [], stage: "voice" });
  if (input.voicePlan && input.measuredAudio && input.voicePlan.segments.every((segment) => segment.duration_seconds !== null)) {
    const wordsPerSecond = quizVoiceWordsPerSecond(input.voicePlan);
    const target = quizVoiceTargetWordsPerSecond(input.quiz.age_band);
    if (wordsPerSecond > target + 0.45) add({ code: "voice_pace_unsafe", severity: "blocker", message: `Measured narration is ${wordsPerSecond.toFixed(2)} words per second for ${input.quiz.age_band}.`, next_action: `Regenerate paced quiz voice at or below ${target.toFixed(2)} words per second before rendering.`, question_ids: [], stage: "voice" });
    else if (wordsPerSecond > target) add({ code: "voice_pace_fast", severity: "warning", message: `Measured narration is ${wordsPerSecond.toFixed(2)} words per second for ${input.quiz.age_band}.`, next_action: `Slow the question and explanation delivery to ${target.toFixed(2)} words per second or below.`, question_ids: [], stage: "voice" });
  }
  if (input.timeline) validateQuizTimeline(input.quiz, input.timeline).forEach(add);
  if (input.timeline) {
    const [minimumCycle, maximumCycle] = questionCycleRangeSeconds(input.quiz.age_band);
    const starts = input.quiz.questions.map((question) => input.timeline!.events.find((event) => event.type === "question.enter" && event.question_id === question.id)?.at_seconds).filter((start): start is number => start !== undefined);
    const rushed = input.quiz.questions.flatMap((question, index) => {
      const start = starts[index];
      const nextStart = starts[index + 1];
      const transition = input.timeline!.events.find((event) => event.type === "transition.start" && event.question_id === question.id);
      const end = nextStart ?? (transition ? transition.at_seconds + transition.duration_seconds : input.timeline!.duration_seconds);
      return typeof start === "number" && (end - start < minimumCycle || end - start > maximumCycle) ? [question] : [];
    });
    if (rushed.length) add({ code: "pacing_question_cycle_outside_target", severity: "warning", message: `${rushed.length} question cycle${rushed.length === 1 ? " is" : "s are"} outside the ${minimumCycle}–${maximumCycle}s target for ${input.quiz.age_band}.`, next_action: "Adjust narration overlap, thinking, reveal, or explanation duration before rendering.", question_ids: rushed.map((question) => question.id), stage: "timeline" });
    const threshold = input.staticIntervalThresholdSeconds ?? 2.5;
    const activeVisualIntervals = input.timeline.events
      .filter((event) => ["background.motion", "question.enter", "choices.enter", "countdown.start", "answer.reveal", "reward.play", "fact.enter", "transition.start"].includes(event.type) && event.duration_seconds > 0)
      .map((event) => ({ start: event.at_seconds, end: event.at_seconds + event.duration_seconds, questionId: event.question_id }))
      .sort((left, right) => left.start - right.start);
    let coveredThrough = 0;
    for (const interval of activeVisualIntervals) {
      if (interval.start - coveredThrough > threshold) {
        add({ code: "visual_static_interval", severity: "warning", message: "The gameplay timeline contains a " + (interval.start - coveredThrough).toFixed(1) + "s visually static interval.", next_action: "Add a meaningful visual beat or confirm that the pause is intentional.", question_ids: interval.questionId ? [interval.questionId] : [], stage: "layout" });
        break;
      }
      coveredThrough = Math.max(coveredThrough, interval.end);
    }
  }
  if (input.renderIntegrity === false) add({ code: "render_integrity_missing", severity: "blocker", message: "Rendered video evidence is missing or invalid.", next_action: "Run post-render FFprobe verification before marking the episode ready.", question_ids: [], stage: "render" });
  const categories = {
    semantic: categoryScore(issues, "semantic", 25),
    visual: categoryScore(issues, "layout", 20),
    pacing: categoryScore(issues, "timeline", 15),
    audio: categoryScore(issues, "voice", 15),
    variety: categoryScore(issues, "director", 10),
    render_integrity: categoryScore(issues, "render", 15),
  };
  const score = Math.round((categories.semantic * 25 + categories.visual * 20 + categories.pacing * 15 + categories.audio * 15 + categories.variety * 10 + categories.render_integrity * 15) / 100);
  const candyArcadeVisual = candyArcadeVisualScore(issues);
  const hasBlocker = issues.some((issue) => issue.severity === "blocker");
  const rating = !hasBlocker && score >= 85 && candyArcadeVisual.total >= 85 ? "production_ready" : score >= 70 ? "needs_review" : "not_ready";
  return QuizAssessmentSchema.parse({ schema_version: 2, episode_id: input.quiz.episode_id, assessed_at: nowIso(), score, rating, categories, candy_arcade_visual: candyArcadeVisual, issues });
}

function questionCycleRangeSeconds(ageBand: QuizV2["age_band"]): [number, number] {
  const ranges: Record<QuizV2["age_band"], [number, number]> = { "4-6": [15, 22], "7-9": [14, 20], "10-12": [13, 19], family: [14, 20] };
  return ranges[ageBand];
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function categoryScore(issues: QuizIssue[], stage: QuizIssue["stage"], weight: number): number {
  const relevant = issues.filter((issue) => issue.stage === stage);
  const penalty = relevant.reduce((sum, issue) => sum + (issue.severity === "blocker" ? 35 : issue.severity === "warning" ? 12 : 2), 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty * Math.max(1, weight / 10))));
}

function candyArcadeVisualScore(issues: QuizIssue[]) {
  const penalty = (codes: string[], maximum: number, warning = 2, blocker = maximum) => {
    const related = issues.filter((issue) => codes.includes(issue.code));
    return Math.max(0, maximum - related.reduce((sum, issue) => sum + (issue.severity === "blocker" ? blocker : issue.severity === "warning" ? warning : 0), 0));
  };
  const pacing = penalty(["pacing_question_cycle_outside_target", "voice_pace_fast", "voice_pace_unsafe"], 20, 2, 10);
  const hierarchy = penalty(["layout_question_overflow", "layout_choice_overflow", "layout_question_long", "layout_choice_long", "layout_explanation_long"], 15, 3, 15);
  const assetConsistency = penalty(["VISUAL_ANSWER_LEAKAGE", "needs_visual_review"], 15, 1, 15);
  const motion = penalty(["visual_motion_budget", "visual_static_interval"], 15, 3, 15);
  const reveal = penalty(["timeline_canonical_answer_mismatch", "timeline_reveal_before_thinking", "timeline_reward_before_reveal"], 10, 3, 10);
  const transition = penalty(["timeline_question_order"], 10, 2, 10);
  const readability = penalty(["layout_question_overflow", "layout_choice_overflow", "visual_palette_contrast"], 10, 3, 10);
  const visualVariety = penalty(["visual_palette_repeat", "director_repeated_archetype"], 5, 1, 5);
  return { pacing, hierarchy, asset_consistency: assetConsistency, motion, reveal, transition, readability, visual_variety: visualVariety, total: pacing + hierarchy + assetConsistency + motion + reveal + transition + readability + visualVariety };
}
