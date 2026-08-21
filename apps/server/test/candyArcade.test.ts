import { describe, expect, it } from "vitest";
import { AssetConsistencyGroupSchema, QuizV2Schema } from "@studio/shared";
import { compileQuizAssetPrompt } from "../src/quiz/assets/promptCompiler.js";
import { planQuizAssets } from "../src/quiz/assets/assetPlanner.js";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { assessQuizVisualLayout } from "../src/quiz/qa/visualQa.js";
import { buildCandyArcadeComposition, candyArcadeHeroAreaRatio } from "../src/quiz/render/candyArcadeComposition.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";
import { ambientPhaseSeconds, candyArcadeTemplate, quizTimerState, resolveLayout, resolvePalette, textLayout, timelineProgress, visualAnswerState } from "../src/quiz/visual/candyArcade.js";

const quiz = QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "candy-demo",
  age_band: "7-9",
  language: "English",
  questions: [
    { id: "question-01", number: 1, format: "multiple_choice", difficulty: 1, question: "Which ocean is the largest on Earth?", choices: [{ id: "choice-a", text: "Pacific Ocean" }, { id: "choice-b", text: "Atlantic Ocean" }, { id: "choice-c", text: "Arctic Ocean" }], correct_choice_id: "choice-b", explanation: "The Pacific Ocean covers the largest area.", fun_fact: "", source_ids: ["C01"], visual_opportunity: "A bright globe with the Pacific Ocean", validation: { semantic_status: "validated", source_coverage: true, fact_locked: true } },
    { id: "question-02", number: 2, format: "image_guess", difficulty: 2, question: "Which animal can sprint the fastest?", choices: [{ id: "choice-a", text: "Cheetah" }, { id: "choice-b", text: "Turtle" }, { id: "choice-c", text: "Elephant" }], correct_choice_id: "choice-a", explanation: "Cheetahs sprint very quickly for short distances.", fun_fact: "", source_ids: ["C02"], visual_opportunity: "A friendly cheetah", validation: { semantic_status: "validated", source_coverage: true, fact_locked: true } },
  ],
});

describe("Candy Arcade visual template", () => {
  it("uses reusable tokens and never auto-repeats a palette", () => {
    expect(candyArcadeTemplate.tokens.safeArea.left).toBeGreaterThan(0);
    expect(candyArcadeTemplate.tokens.typography.question.family).toContain("Arial Rounded");
    const first = resolvePalette("auto", 0);
    expect(resolvePalette("auto", 0, first.id).id).not.toBe(first.id);
  });

  it("selects semantic layouts and deterministic readable text tiers", () => {
    expect(resolveLayout("auto", "illustrated_multiple_choice", "multiple_choice")).toBe("media_top_choices_bottom");
    expect(resolveLayout("auto", "visual_multiple_choice", "image_guess")).toBe("visual_choices_three");
    expect(textLayout("Which ocean is the largest on Earth?", "question").fits).toBe(true);
    expect(textLayout("x".repeat(190), "question").fits).toBe(false);
  });

  it("maps answer state only from the canonical QuizV2 choice", () => {
    expect(visualAnswerState("choice-b", "choice-b", "reveal")).toBe("correct");
    expect(visualAnswerState("choice-a", "choice-b", "reveal")).toBe("incorrect");
    expect(visualAnswerState("choice-a", "choice-b", "idle")).toBe("idle");
  });

  it("derives thinking and transition progress from timeline time", () => {
    expect(timelineProgress(10, 20, 10)).toBe(0);
    expect(timelineProgress(10, 20, 15)).toBe(.5);
    expect(timelineProgress(10, 20, 32)).toBe(1);
  });

  it("couples timer fill and marker to one seek-deterministic normalized value", () => {
    for (const value of [0, .1, .25, .5, .75, .9, 1]) {
      const state = quizTimerState(10, 20, 10 + value * 10);
      expect(state.boundary).toBe(state.remaining);
      expect(quizTimerState(10, 20, 10 + value * 10)).toEqual(state);
    }
    for (const fps of [24, 30, 60]) {
      const samples = Array.from({ length: fps * 2 + 1 }, (_, index) => quizTimerState(0, 2, index / fps).boundary);
      expect(samples.every((value, index) => index === 0 || value <= samples[index - 1]!)).toBe(true);
    }
  });

  it("assigns stable ambient phases without runtime randomness", () => {
    expect(ambientPhaseSeconds("float", 1, "question-02")).toBe(ambientPhaseSeconds("float", 1, "question-02"));
    expect(ambientPhaseSeconds("float", 1, "question-02")).not.toBe(ambientPhaseSeconds("float", 2, "question-02"));
    expect(ambientPhaseSeconds("none", 4, "question-02")).toBe(0);
  });

  it("compiles purpose-specific image prompts and checks visual layout semantically", () => {
    const director = createDefaultDirectorPlan(quiz);
    const visualBeat = director.beats[1];
    expect(visualBeat.layout_id).toBe("visual_choices_three");
    const assetPlan = planQuizAssets(quiz, director);
    const option = assetPlan.assets.find((asset) => asset.asset_id === "asset-question-02-choice-a")!;
    const group = assetPlan.consistency_groups.find((candidate) => candidate.group_id === option.consistency_group_id)!;
    const prompt = compileQuizAssetPrompt(option, group);
    expect(prompt.prompt).toContain("consistent with the other answer options");
    expect(prompt.prompt).toContain("Every option in this set must share this exact art direction");
    expect(prompt.prompt).toContain("No words");
    expect(group.face_policy).toBe("natural_only");
    expect(prompt.prompt).toContain("face policy natural_only");
    expect(prompt.prompt).toContain("Use facial features only when naturally present in the subject");
    const { face_policy: _facePolicy, ...groupWithoutFacePolicy } = group;
    expect(AssetConsistencyGroupSchema.parse(groupWithoutFacePolicy).face_policy).toBe("natural_only");
    const hero = assetPlan.assets.find((asset) => asset.asset_id === "asset-question-01-hero")!;
    const heroPrompt = compileQuizAssetPrompt(hero);
    expect(heroPrompt.prompt).toContain("polished 3D clay-like illustration");
    expect(heroPrompt.prompt).toContain("gentle upper-left highlight");
    expect(heroPrompt.prompt).toContain("Face policy: none");
    expect(assessQuizVisualLayout({ quiz, director }).filter((issue) => issue.severity === "blocker")).toEqual([]);
    const fairnessIssues = assessQuizVisualLayout({ quiz, director, assetPlan });
    expect(fairnessIssues.filter((issue) => issue.severity === "blocker")).toEqual([]);
    expect(fairnessIssues.some((issue) => issue.code === "needs_visual_review")).toBe(true);
  });

  it("keeps the reveal focused on the canonical answer card and drives the Thinking Bar from timeline ranges", () => {
    const director = createDefaultDirectorPlan(quiz);
    const voice = buildQuizVoicePlan(quiz);
    const timeline = compileQuizTimeline({ quiz, director, voicePlan: voice });
    const html = buildCandyArcadeComposition({ quiz, director, timeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: timeline.duration_seconds });
    expect(html).toContain("reveal-sparkles");
    expect(html).not.toContain("reveal-lockup");
    expect(html).toContain("timer-marker");
    expect(html).toContain('<div class="timer-progress"></div><span class="timer-marker">?</span>');
    expect(html).not.toContain('<div class="timer-progress"><span class="timer-marker">?</span></div>');
    expect(html).toContain("@keyframes quiz-timer-marker-slide");
    expect(html).toContain("layout-media_left_choices_right .game-stage");
    expect(html).toContain("layout-media_top_choices_bottom .game-stage");
    expect(html).toContain("<strong class=\"keyword-highlight\">");
    expect(candyArcadeHeroAreaRatio("media_left_choices_right")).toBeGreaterThan(.2);
    expect(candyArcadeHeroAreaRatio("media_top_choices_bottom", "choices")).toBeGreaterThan(.3);
    expect(html).toContain("transition-bubble_splash");
    expect(html).toContain("splash-brand");
    expect(html).toContain(".decor-7 { left: 30%; top: 8%;");
    expect(html).toContain("is-final-scene");
    expect(html).not.toContain("is-final::after");
    expect(html).toContain(".reward-fx { position: absolute; z-index: 4; inset: 0;");
  });

  it("keeps the 50-question maximum to one scene and one hero image per question", () => {
    const maximumQuiz = QuizV2Schema.parse({
      ...quiz,
      episode_id: "candy-maximum",
      questions: Array.from({ length: 50 }, (_, index) => ({
        ...quiz.questions[0]!,
        id: `question-${String(index + 1).padStart(2, "0")}`,
        number: index + 1,
        question: `Which simple machine is shown in challenge ${index + 1}?`,
      })),
    });
    const director = createDefaultDirectorPlan(maximumQuiz);
    const timeline = compileQuizTimeline({ quiz: maximumQuiz, director, voicePlan: buildQuizVoicePlan(maximumQuiz) });
    const html = buildCandyArcadeComposition({ quiz: maximumQuiz, director, timeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: timeline.duration_seconds });
    expect((html.match(/<section id="quiz-q/g) ?? [])).toHaveLength(50);
    expect((html.match(/class="image-card hero-image"/g) ?? [])).toHaveLength(50);
    expect(html).toContain("ray-spin 150s");
    expect(html).not.toContain("repeat:-1");
    expect(html).not.toContain("filter:");
    expect(html).not.toContain("clip-path");
  });

  it("creates one complete visual-answer consistency group and blocks missing group metadata", () => {
    const director = createDefaultDirectorPlan(quiz);
    const plan = planQuizAssets(quiz, director);
    const group = plan.consistency_groups[0]!;
    expect(group.asset_ids).toHaveLength(3);
    expect(plan.assets.filter((asset) => asset.consistency_group_id === group.group_id)).toHaveLength(3);
    const broken = { ...plan, assets: plan.assets.map((asset) => asset.consistency_group_id ? { ...asset, consistency_group_id: null } : asset) };
    expect(assessQuizVisualLayout({ quiz, director, assetPlan: broken }).some((issue) => issue.code === "VISUAL_ANSWER_LEAKAGE" && issue.severity === "blocker")).toBe(true);
  });
});
