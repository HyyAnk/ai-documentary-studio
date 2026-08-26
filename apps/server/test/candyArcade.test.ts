import { describe, expect, it } from "vitest";
import { AssetConsistencyGroupSchema, QuizV2Schema } from "@studio/shared";
import { compileQuizAssetPrompt } from "../src/quiz/assets/promptCompiler.js";
import { planQuizAssets } from "../src/quiz/assets/assetPlanner.js";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { assessQuizVisualLayout } from "../src/quiz/qa/visualQa.js";
import { buildCandyArcadeComposition, buildCandyArcadeCompositionBundle, candyArcadeHeroAreaRatio } from "../src/quiz/render/candyArcadeComposition.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";
import { ambientPhaseSeconds, candyArcadePalettes, candyArcadeTemplate, quizTimerState, resolveLayout, resolvePalette, textLayout, timelineProgress, visualAnswerState } from "../src/quiz/visual/candyArcade.js";

const quiz = QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "candy-demo",
  age_band: "7-9",
  language: "English",
  questions: [
    { id: "question-01", number: 1, format: "multiple_choice", difficulty: 1, question: "Which ocean is the largest on Earth?", choices: [{ id: "choice-a", text: "Pacific Ocean" }, { id: "choice-b", text: "Atlantic Ocean" }, { id: "choice-c", text: "Arctic Ocean" }], correct_choice_id: "choice-b", explanation: "The Pacific Ocean covers the largest area.", fun_fact: "", source_ids: ["C01"], visual_opportunity: "A bright globe with the Pacific Ocean", validation: { semantic_status: "validated", source_coverage: true, fact_locked: true } },
    { id: "question-02", number: 2, format: "odd_one_out", difficulty: 2, question: "Which animal can sprint the fastest?", choices: [{ id: "choice-a", text: "Cheetah" }, { id: "choice-b", text: "Turtle" }, { id: "choice-c", text: "Elephant" }], correct_choice_id: "choice-a", explanation: "Cheetahs sprint very quickly for short distances.", fun_fact: "", source_ids: ["C02"], visual_opportunity: "A friendly cheetah", validation: { semantic_status: "validated", source_coverage: true, fact_locked: true } },
  ],
});

describe("Candy Arcade visual template", () => {
  it("reserves AA-compliant colors for text on light cards and bright badges", () => {
    for (const palette of candyArcadePalettes) {
      expect(contrastRatio(palette.surfaceAccent, palette.surface), `${palette.id} surface accent`).toBeGreaterThanOrEqual(4.5);
      for (const background of [palette.accent, palette.answerBadge, palette.correct, palette.incorrect]) {
        expect(contrastRatio(palette.onAccent, background), `${palette.id} badge ink on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("uses reusable tokens and never auto-repeats a palette", () => {
    expect(candyArcadeTemplate.tokens.safeArea.left).toBeGreaterThan(0);
    expect(candyArcadeTemplate.tokens.typography.question.family).toContain("SVN-Hello Headline");
    expect(candyArcadeTemplate.tokens.typography.question.family).toContain("Fredoka");
    const first = resolvePalette("auto", 0);
    expect(resolvePalette("auto", 0, first.id).id).not.toBe(first.id);
  });

  it("mounts scene files without parent-traversal asset paths", () => {
    const director = createDefaultDirectorPlan(quiz);
    const timeline = compileQuizTimeline({ quiz, director, voicePlan: buildQuizVoicePlan(quiz) });
    const bundle = buildCandyArcadeCompositionBundle({ quiz, director, timeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: timeline.duration_seconds });

    expect(bundle.html).toContain('data-composition-src="compositions/candy-intro.html"');
    expect(bundle.html).toContain('class="clip sfx-clip"');
    expect(bundle.html).toContain('ui_pop.wav');
    expect(bundle.html).toContain('correct_ding.wav');
    expect(bundle.html).toContain('data-no-timeline');
    expect(Object.keys(bundle.files)).toContain("compositions/candy-intro.html");
    expect(Object.values(bundle.files).every((file) => file.includes("data-no-timeline"))).toBe(true);
    expect(Object.values(bundle.files).every((file) => !file.includes('src="../'))).toBe(true);
    expect(Object.values(bundle.files).every((file) => !file.includes("data-start="))).toBe(true);
    expect(Object.values(bundle.files).every((file) => !file.includes("data-track-index="))).toBe(true);
    expect(bundle.html.match(/data-composition-src=/g)).toHaveLength(Object.keys(bundle.files).length);
  });

  it("selects semantic layouts and deterministic readable text tiers", () => {
    expect(resolveLayout("auto", "illustrated_multiple_choice", "multiple_choice")).toBe("media_left_choices_right");
    expect(resolveLayout("auto", "illustrated_multiple_choice", "image_guess")).toBe("media_left_choices_right");
    expect(resolveLayout("auto", "visual_multiple_choice", "odd_one_out")).toBe("visual_choices_three");
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
    expect(heroPrompt.prompt).toContain("3D Pixar Animation");
    expect(heroPrompt.prompt).toContain("soft cinematic studio lighting");
    expect(heroPrompt.prompt).toContain("Face policy: natural_only");
    expect(heroPrompt.prompt).toContain("cinematic 3D environment");

    // Test other visual styles
    const vectorPrompt = compileQuizAssetPrompt(hero, undefined, "flat_vector");
    expect(vectorPrompt.prompt).toContain("2D Flat Vector");
    expect(vectorPrompt.prompt).toContain("vibrant modern vector landscape");

    const voxelPrompt = compileQuizAssetPrompt(hero, undefined, "voxel_lowpoly");
    expect(voxelPrompt.prompt).toContain("3D Voxel / Low-Poly");
    expect(voxelPrompt.prompt).toContain("3D voxel blocky environment");

    const plasticToyPrompt = compileQuizAssetPrompt(hero, undefined, "plastic_toy");
    expect(plasticToyPrompt.prompt).toContain("3D Glossy Vinyl Toy");
    expect(plasticToyPrompt.prompt).toContain("cute painted glossy eyes with expressive pupils");
    expect(plasticToyPrompt.prompt).toContain("Living creatures, characters, dinosaurs, and animals must have complete, expressive natural eyes");
    expect(plasticToyPrompt.cacheVersion).toContain("v3-expressive-faces");

    expect(assessQuizVisualLayout({ quiz, director }).filter((issue) => issue.severity === "blocker")).toEqual([]);
    const fairnessIssues = assessQuizVisualLayout({ quiz, director, assetPlan });
    expect(fairnessIssues.filter((issue) => issue.severity === "blocker")).toEqual([]);
    expect(fairnessIssues.some((issue) => issue.code === "needs_visual_review")).toBe(true);
  });

  it("keeps the reveal focused on the canonical answer card and drives the Thinking Bar from timeline ranges", () => {
    const director = createDefaultDirectorPlan(quiz);
    const voice = buildQuizVoicePlan(quiz);
    const timeline = compileQuizTimeline({ quiz, director, voicePlan: voice });
    const html = compositionSources({ quiz, director, timeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: timeline.duration_seconds });
    expect(html).not.toContain("reveal-panel");
    expect(html).toContain("Many more questions to explore");
    expect(html).toContain("--surface-accent:");
    expect(html).toContain("--on-accent:");
    expect(html).toContain(".fact-card span { color: var(--surface-accent);");
    expect(html).toContain(".timer-marker { position: absolute;");
    expect(html).toContain(".marker-star-svg {");
    expect(html).toContain(".intro-card > span, .outro-card > span { display: inline-flex; padding: 15px 23px; border-radius: 999px; background: #FF6277; color: #172A59;");
    expect(html).toContain(".intro-stars, .outro-stars { margin-top: 35px; color: #172A59;");
    expect(html).toContain("background: #29B9A8; color: #172A59;");
    expect(html).not.toContain("reveal-lockup");
    expect(html).toContain("timer-marker");
    expect(html).toContain('<div class="timer-progress"></div><span class="timer-marker" data-layout-allow-occlusion data-layout-allow-overlap>');
    expect(html).toContain('<b class="marker-val val-query" data-layout-allow-overlap>?</b><b class="marker-val val-5" data-layout-allow-overlap>5</b>');
    expect(html).not.toContain('<div class="timer-progress"><span class="timer-marker');
    expect(html).toContain("@keyframes quiz-timer-marker-slide");
    expect(html).toContain("layout-media_left_choices_right .game-stage");
    expect(html).toContain("<strong class=\"keyword-highlight\">");
    expect(candyArcadeHeroAreaRatio("media_left_choices_right")).toBeGreaterThan(.2);
    expect(html).toContain("transition-bubble_splash");
    expect(html).toContain("splash-brand");
    expect(html).toContain(".decor-7 { left: 30%; top: 8%;");
    expect(html).toContain('font-family: "SVN-Hello Headline"');
    expect(html).toContain('.question-title h1 { margin: 0; color: #342245; font-family: "Fredoka", "SVN-Hello Headline"');
    expect(html).toContain("is-final-scene");
    expect(html).toContain(".game-stage { position: relative; z-index: 3;");
    expect(html).toContain(".reward-fx { position: absolute; z-index: 7; inset: 0;");
    expect(html).toContain("hanging-wood-sign");
    expect(html).toContain("wood-sign-plank");
    expect(html).toContain("question-number-val");
    expect(html).toContain("@keyframes hanging-sign-sway");
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
    const html = compositionSources({ quiz: maximumQuiz, director, timeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: timeline.duration_seconds });
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

  it("applies the improved pacing, removes redundant reveal-panel, and sets outro pause and copy", () => {
    const director = createDefaultDirectorPlan(quiz);
    const voicePlan = buildQuizVoicePlan(quiz);
    const timeline = compileQuizTimeline({ quiz, director, voicePlan });
    const bundle = buildCandyArcadeCompositionBundle({ quiz, director, timeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: timeline.duration_seconds });
    const sources = [bundle.html, ...Object.values(bundle.files)].join("\n");

    // Requirement 1: No reveal-panel badge at bottom, fact-card is preserved
    expect(sources).not.toContain("reveal-panel");
    expect(sources).not.toContain("reveal-stamp");
    expect(sources).toContain("fact-card");

    // Requirement 2: Timing pacing - 2s lead before narration, 2s hold after explanation before transition
    const q1Enter = timeline.events.find((e) => e.type === "question.enter" && e.question_id === "question-01")!;
    const q1Narration = timeline.events.find((e) => e.segment_id === "question-01:question")!;
    expect(q1Narration.at_seconds - q1Enter.at_seconds).toBeGreaterThanOrEqual(2.0);

    const q1Explain = timeline.events.find((e) => e.segment_id === "question-01:explanation")!;
    const q1Transition = timeline.events.find((e) => e.type === "transition.start" && e.question_id === "question-01")!;
    expect(q1Transition.at_seconds - (q1Explain.at_seconds + q1Explain.duration_seconds)).toBeGreaterThanOrEqual(2.0);

    const q2Enter = timeline.events.find((e) => e.type === "question.enter" && e.question_id === "question-02")!;
    expect(q2Enter.at_seconds).toBeGreaterThanOrEqual(q1Transition.at_seconds + q1Transition.duration_seconds);

    // Requirement 3: Outro phrases have 1s pause after score prompt & copy is 'Many more questions to explore'
    const outroSegment = voicePlan.segments.find((s) => s.role === "outro")!;
    expect(outroSegment.phrases[0]?.text).toBe("How many did you get right?");
    expect(outroSegment.phrases[0]?.pause_after).toBe("long");
    expect(bundle.files["compositions/candy-outro.html"]).toContain("Many more questions to explore");
    expect(bundle.files["compositions/candy-outro.html"]).not.toContain("2 questions to explore");

    // Vietnamese outro copy check
    const vietnameseQuiz = { ...quiz, language: "Vietnamese" };
    const viVoice = buildQuizVoicePlan(vietnameseQuiz);
    const viOutro = viVoice.segments.find((s) => s.role === "outro")!;
    expect(viOutro.phrases[0]?.text).toBe("Bạn đúng được mấy câu?");
    expect(viOutro.phrases[0]?.pause_after).toBe("long");
    const viTimeline = compileQuizTimeline({ quiz: vietnameseQuiz, director, voicePlan: viVoice });
    const viBundle = buildCandyArcadeCompositionBundle({ quiz: vietnameseQuiz, director, timeline: viTimeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: viTimeline.duration_seconds });
    expect(viBundle.files["compositions/candy-outro.html"]).toContain("Còn nhiều câu hỏi thú vị phía trước");
    expect(viBundle.files["compositions/candy-outro.html"]).toContain("badge-cta");
    expect(viBundle.files["compositions/candy-outro.html"]).toContain("Đăng ký");
    expect(viBundle.files["compositions/candy-outro.html"]).toContain("Bình luận");

    // Outro hold test (5s hold after voice segment)
    const outroEvent = viTimeline.events.find((e) => e.segment_id === "outro")!;
    expect(viTimeline.duration_seconds - (outroEvent.at_seconds + outroEvent.duration_seconds)).toBeGreaterThanOrEqual(4.9);
  });
});

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels.map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return .2126 * red + .7152 * green + .0722 * blue;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + .05) / (darker + .05);
}

function compositionSources(input: Parameters<typeof buildCandyArcadeComposition>[0]): string {
  const bundle = buildCandyArcadeCompositionBundle(input);
  return [bundle.html, ...Object.values(bundle.files)].join("\n");
}
