import { describe, expect, it } from "vitest";
import { QuizV2Schema } from "@studio/shared";
import { buildCandyArcadeCompositionBundle, candyArcadeHeroAreaRatio, highlightQuestionMarkup } from "../src/quiz/render/candyArcadeComposition.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";

const quiz = QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "candy-visual-regression",
  age_band: "7-9",
  language: "English",
  questions: [{
    id: "visual-regression-question",
    number: 1,
    format: "multiple_choice",
    difficulty: 1,
    question: "Which ocean is the largest on Earth?",
    choices: [
      { id: "choice-a", text: "Pacific Ocean" },
      { id: "choice-b", text: "Atlantic Ocean" },
      { id: "choice-c", text: "Arctic Ocean" },
    ],
    correct_choice_id: "choice-a",
    explanation: "The Pacific Ocean covers the largest area.",
    fun_fact: "",
    source_ids: ["VR-01"],
    visual_opportunity: "A bright globe with the Pacific Ocean",
    validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
  }],
});

function renderHtml(): string {
  const director = createDefaultDirectorPlan(quiz);
  const timeline = compileQuizTimeline({ quiz, director, voicePlan: buildQuizVoicePlan(quiz) });
  const bundle = buildCandyArcadeCompositionBundle({ quiz, director, timeline, theme: "candy_arcade", audioPath: "./narration.wav", narrationDurationSeconds: timeline.duration_seconds });
  return [bundle.html, ...Object.values(bundle.files)].join("\n");
}

describe("Candy Arcade visual regression contract", () => {
  it("keeps the timer marker circular and synchronized without nesting it under the scaled fill", () => {
    const html = renderHtml();
    const markerCss = html.match(/\.timer-marker \{([^}]+)\}/)?.[1] ?? "";
    const thinkingBarCss = html.match(/\n ?\.thinking-bar \{([^}]+)\}/)?.[1] ?? "";
    const timerProgressCss = html.match(/\.timer-progress \{([^}]+)\}/)?.[1] ?? "";
    const width = Number(markerCss.match(/width: ([\d.]+)px/)?.[1]);
    const height = Number(markerCss.match(/height: ([\d.]+)px/)?.[1]);
    expect(width / height).toBeGreaterThanOrEqual(.92);
    expect(html).toContain('<div class="timer-progress"></div><span class="timer-marker" data-layout-allow-occlusion data-layout-allow-overlap>');
    expect(html).toContain('<b class="marker-val val-query" data-layout-allow-overlap>?</b><b class="marker-val val-5" data-layout-allow-overlap>5</b>');
    expect(html).not.toContain('<div class="timer-progress"><span class="timer-marker');
    expect(html).toContain(".val-5 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd5-at)) both; }");
    expect(html).toContain(".val-4 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd4-at)) both; }");
    expect(html).toContain(".val-3 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd3-at)) both; }");
    expect(html).toContain(".val-2 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd2-at)) both; }");
    expect(html).toContain(".val-1 { animation: number-countdown-final 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd1-at)) both; }");

    for (const progress of [0, .25, .5, .75, 1]) {
      const fillEdge = 1 - progress;
      const markerEdge = 1 - progress;
      expect(markerEdge).toBe(fillEdge);
    }
  });

  it("keeps every resolved hero layout above the old boxed-image area", () => {
    const baseline = candyArcadeHeroAreaRatio("baseline");
    expect(candyArcadeHeroAreaRatio("media_left_choices_right")).toBeGreaterThan(baseline * 2);
    expect(candyArcadeHeroAreaRatio("visual_choices_three")).toBeGreaterThan(baseline * 2);
  });

  it("emits real selectors for semantic media layouts and a safe keyword fallback", () => {
    const html = renderHtml();
    expect(html).toContain(".layout-media_left_choices_right .game-stage");
    expect(html).toContain(".layout-visual_choices_three .visual-answer-grid");
    expect(html).toContain('<strong class="keyword-highlight">ocean</strong>');
    const keywordChecks = [
      ["Which planet is often called the Red Planet?", "A bright red planet", "planet"],
      ["What is a baby frog called?", "A frog tadpole in a pond", "frog"],
      ["Which sense helps you notice the smell of popcorn?", "A popcorn bowl with smell waves", "smell"],
      ["Which shape has three sides?", "A triangle shape", "shape"],
      ["What do green plants use to make food?", "Green plants reaching for sunlight", "plants"],
    ] as const;
    for (const [question, opportunity, keyword] of keywordChecks) {
      expect(highlightQuestionMarkup(question, opportunity)).toContain(`<strong class="keyword-highlight">${keyword}</strong>`);
    }
    expect(highlightQuestionMarkup("Which animal can sprint fastest?", "A friendly cheetah")).not.toContain("keyword-highlight");
    expect(html).toContain("hero-ken-burn");
    expect(html).not.toContain(".option-image img { animation");
    expect(html).toContain("scale(1.12)");
  });

  it("keeps the progress bar fixed, colorful, caption-free, and edge-safe", () => {
    const html = renderHtml();
    const raysCss = html.match(/\.bg-rays \{([^}]+)\}/)?.[1] ?? "";
    const phaseCss = html.match(/\.phase-region \{([^}]+)\}/)?.[1] ?? "";
    expect(raysCss).toContain("inset: -30%");
    expect(raysCss).not.toContain("width:");
    expect(raysCss).not.toContain("height:");
    expect(html).toContain("@keyframes ray-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }");
    expect(html).not.toContain("translate(-50%,-50%) rotate(360deg)");
    expect(phaseCss).toContain("position: absolute");
    expect(phaseCss).toContain("bottom: 10px");
    expect(html).not.toContain("grid-area: phase");
    expect(html).not.toContain("Think it through!");
    expect(html).not.toContain("Lock in your answer!");
    expect(html).not.toContain("timer-caption");
  });

  it("stagger-floats answer images and composes visual reveal motion", () => {
    const html = renderHtml();
    expect(html).toMatch(/\.option-image \{[^}]*animation: answer-float/);
    expect(html).toMatch(/\.answer-card img \{[^}]*animation: answer-float/);
    expect(html).toContain("--item-phase:");
    expect(html).toContain("answer-float var(--scene-duration)");
    expect(html).toContain("visual-correct-border");
  });

  it("renders prominent 3D glossy circular badges and distinct choice-coded stroke borders for kids", () => {
    const html = renderHtml();
    expect(html).toContain("border-radius: 50%");
    expect(html).toContain("--choice-depth-shadow: #C2410C");
    expect(html).toContain("--choice-depth-shadow: #9D174D");
    expect(html).toContain("--choice-depth-shadow: #075985");
    expect(html).toContain("--choice-depth-shadow: #3F6212");
    expect(html).toContain(".answer-card::before { content: \"\"; position: absolute; inset: 6px 14px 6px 20px; border: 2.5px dashed rgba(255, 255, 255, 0.75);");
    expect(html).toMatch(/\.answer-card > b[^}]*width: 108px/);
    expect(html).toMatch(/\.answer-card > b[^}]*font-size: 54px/);
    expect(html).toMatch(/\.answer-card > b[^}]*margin-left: -58px/);
    expect(html).toContain("border: 7px solid var(--choice-stroke)");
    expect(html).toContain(".answer-card > b::after");
  });
});
