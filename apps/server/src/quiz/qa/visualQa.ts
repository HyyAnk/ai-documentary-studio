import type { DirectorPlan, QuizAssetPlan, QuizIssue, QuizTimeline, QuizV2 } from "@studio/shared";
import { getQuizVisualTemplate } from "../visual/registry.js";
import { textLayout } from "../visual/candyArcade.js";

export function assessQuizVisualLayout(input: { quiz: QuizV2; director?: DirectorPlan | null; assetPlan?: QuizAssetPlan | null; timeline?: QuizTimeline | null }): QuizIssue[] {
  const issues: QuizIssue[] = [];
  if (!input.director) return issues;
  const template = getQuizVisualTemplate("candy_arcade");
  let previousPaletteId: string | undefined;
  for (const [index, question] of input.quiz.questions.entries()) {
    const beat = input.director.beats.find((candidate) => candidate.question_id === question.id);
    if (!beat) continue;
    const visual = template.resolveScene({ question, questionIndex: index, totalQuestions: input.quiz.questions.length, archetype: beat.archetype, requestedPalette: beat.palette_id, requestedLayout: beat.layout_id, requestedMotion: beat.motion_id, requestedTransition: beat.transition_id, previousPaletteId });
    if (previousPaletteId === visual.palette.id) issues.push(issue(question.id, "visual_palette_repeat", "warning", `Question ${question.number} repeats the previous Candy Arcade palette.`, "Select a different palette so consecutive questions are visually distinct."));
    previousPaletteId = visual.palette.id;
    if (!textLayout(question.question, "question").fits) issues.push(issue(question.id, "layout_question_overflow", "blocker", `Question ${question.number} exceeds the minimum readable Candy Arcade question tier.`, "Shorten the question or select a layout with more room before rendering."));
    for (const choice of question.choices) if (!textLayout(choice.text, "choice").fits) issues.push(issue(question.id, "layout_choice_overflow", "blocker", `Question ${question.number} has an answer choice that exceeds the minimum readable tier.`, "Shorten the choice text before rendering."));
    if (contrastRatio(visual.palette.surface, visual.palette.text) < 4.5) issues.push(issue(question.id, "visual_palette_contrast", "blocker", `Candy Arcade palette ${visual.palette.id} does not meet surface text contrast.`, "Adjust the template palette before rendering."));
    if (beat.asset_intents.includes("question_illustration") && !question.visual_opportunity.trim()) issues.push(issue(question.id, "visual_subject_missing", "blocker", `Question ${question.number} uses a media layout without a semantic visual subject.`, "Add a child-safe visual opportunity that matches the question before rendering."));
  }
  if (input.timeline) {
    for (const question of input.quiz.questions) {
      if (!input.timeline.events.some((event) => event.question_id === question.id && event.type === "countdown.start")) issues.push(issue(question.id, "thinking_bar_missing", "blocker", `Question ${question.number} has no timeline event for the visible Thinking Bar.`, "Compile the timeline with a countdown start for every question."));
    }
    issues.push(...motionBudgetIssues(input.timeline));
  }
  if (input.assetPlan) issues.push(...visualFairnessIssues(input.quiz, input.assetPlan));
  return issues;
}

function visualFairnessIssues(quiz: QuizV2, assetPlan: QuizAssetPlan): QuizIssue[] {
  const issues: QuizIssue[] = [];
  for (const question of quiz.questions) {
    const optionAssets = assetPlan.assets.filter((asset) => asset.question_id === question.id && asset.purpose === "answer_option");
    if (!optionAssets.length) continue;
    const groupId = optionAssets[0]?.consistency_group_id;
    const group = groupId ? assetPlan.consistency_groups.find((candidate) => candidate.group_id === groupId) : null;
    const expectedIds = optionAssets.map((asset) => asset.asset_id).sort();
    const actualIds = group?.asset_ids.slice().sort() ?? [];
    const mismatchedGroup = !group || optionAssets.some((asset) => asset.consistency_group_id !== groupId) || expectedIds.join("|") !== actualIds.join("|");
    if (mismatchedGroup) {
      issues.push({
        code: "VISUAL_ANSWER_LEAKAGE",
        severity: "blocker",
        message: `Question ${question.number} has visual answer options without one complete consistency group.`,
        next_action: "Regenerate the visual answer set with one shared style, framing, lighting, scale, contrast, saturation, and edge-treatment contract.",
        question_ids: [question.id],
        stage: "assets",
      });
      continue;
    }
    if (!group?.detail_level || !group.face_policy) {
      issues.push({
        code: "VISUAL_ANSWER_LEAKAGE",
        severity: "blocker",
        message: `Question ${question.number} visual answer set is missing the V3 detail and face-policy contract.`,
        next_action: "Regenerate the consistency group with explicit detail level and face policy before rendering.",
        question_ids: [question.id],
        stage: "assets",
      });
      continue;
    }
    issues.push({
      code: "needs_visual_review",
      severity: "warning",
      message: `Question ${question.number} visual answer set needs a manual fairness review after generation.`,
      next_action: "Verify that no option is uniquely realistic, saturated, cleanly framed, or otherwise highlighted before reveal.",
      question_ids: [question.id],
      stage: "assets",
    });
  }
  return issues;
}

function motionBudgetIssues(timeline: QuizTimeline): QuizIssue[] {
  // Ambient background drift is intentionally allowed to run beneath one
  // foreground entrance/reveal. It should not consume the foreground motion
  // budget or turn every scene handoff into a false positive.
  const major = timeline.events.filter((event) => ["question.enter", "choices.enter", "answer.reveal", "reward.play", "transition.start"].includes(event.type) && event.duration_seconds > 0);
  const points = [...new Set(major.flatMap((event) => [event.at_seconds, event.at_seconds + event.duration_seconds]))].sort((a, b) => a - b);
  for (const at of points) {
    const active = major.filter((event) => event.at_seconds <= at && event.at_seconds + event.duration_seconds > at + .001);
    if (active.length > 2) return [{ code: "visual_motion_budget", severity: "warning", message: `${active.length} major foreground animations overlap at ${at.toFixed(2)}s.`, next_action: "Stagger entrance, reveal, reward, or transition events so no more than two major motions compete.", question_ids: [...new Set(active.flatMap((event) => event.question_id ? [event.question_id] : []))], stage: "layout" }];
  }
  return [];
}

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace("#", "");
    const rgb = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255).map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
}

function issue(questionId: string, code: string, severity: "blocker" | "warning", message: string, nextAction: string): QuizIssue {
  return { code, severity, message, next_action: nextAction, question_ids: [questionId], stage: "layout" };
}
