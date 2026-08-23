import { describe, expect, it } from "vitest";
import { QuizV2Schema } from "@studio/shared";
import { BgmRegistry, defaultBgmRegistry } from "../src/quiz/audio/bgmRegistry.js";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { buildCandyArcadeCompositionBundle } from "../src/quiz/render/candyArcadeComposition.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";

const quiz = QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "bgm-demo",
  age_band: "7-9",
  language: "English",
  questions: [
    {
      id: "question-01",
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
      explanation: "The Pacific Ocean is the largest ocean on Earth.",
      fun_fact: "It covers more than 30% of Earth's surface!",
      source_ids: ["S01"],
      visual_opportunity: "Globe showing vast blue ocean",
      validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
    },
    {
      id: "question-02",
      number: 2,
      format: "image_guess",
      difficulty: 1,
      question: "What animal is known as the king of the jungle?",
      choices: [
        { id: "choice-a", text: "Lion" },
        { id: "choice-b", text: "Tiger" },
        { id: "choice-c", text: "Bear" },
      ],
      correct_choice_id: "choice-a",
      explanation: "Lions are often called the king of the jungle.",
      fun_fact: "Lions live in groups called prides!",
      source_ids: ["S02"],
      visual_opportunity: "Majestic friendly lion cartoon",
      validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
    },
  ],
});

describe("BGM Registry and Audio Pipeline", () => {
  it("loads BGM manifest with BPM groups and accurate metadata", () => {
    const registry = new BgmRegistry();
    const tracks = registry.getTracks();
    expect(tracks.length).toBeGreaterThanOrEqual(2);

    const upbeat = registry.getTracks("120_bpm_upbeat");
    const gentle = registry.getTracks("100_bpm_gentle");

    expect(upbeat.length).toBeGreaterThan(0);
    expect(gentle.length).toBeGreaterThan(0);

    for (const track of upbeat) {
      expect(track.bpm).toBeGreaterThan(110);
      expect(track.category).toBe("120_bpm_upbeat");
    }

    for (const track of gentle) {
      expect(track.bpm).toBeLessThan(110);
      expect(track.category).toBe("100_bpm_gentle");
    }
  });

  it("resolves single-track BGM schedule for standard length episode", () => {
    const registry = defaultBgmRegistry;
    const schedule = registry.resolveBgmSchedule(175, { bpmPreference: "120_bpm_upbeat" });

    expect(schedule.length).toBe(1);
    expect(schedule[0]?.startSeconds).toBe(0);
    expect(schedule[0]?.durationSeconds).toBe(175);
    expect(schedule[0]?.volume).toBe(0.18);
    expect(schedule[0]?.bpm).toBeGreaterThan(110);
  });

  it("resolves multi-track BGM schedule for long-form episodes (> 200s)", () => {
    const registry = defaultBgmRegistry;
    const schedule = registry.resolveBgmSchedule(380, { bpmPreference: "120_bpm_upbeat" });

    expect(schedule.length).toBeGreaterThanOrEqual(2);
    expect(schedule[0]?.startSeconds).toBe(0);
    expect(schedule[1]?.startSeconds).toBeGreaterThan(0);

    const totalCovered = schedule.reduce((sum, item) => sum + item.durationSeconds, 0);
    expect(totalCovered).toBeCloseTo(380, 1);
  });

  it("integrates BGM clip into Candy Arcade HTML composition bundle", () => {
    const director = createDefaultDirectorPlan(quiz);
    const timeline = compileQuizTimeline({ quiz, director, voicePlan: buildQuizVoicePlan(quiz) });
    const bundle = buildCandyArcadeCompositionBundle({
      quiz,
      director,
      timeline,
      theme: "candy_arcade",
      audioPath: "./narration.wav",
      narrationDurationSeconds: timeline.duration_seconds,
    });

    // Check BGM tag
    expect(bundle.html).toContain('class="clip bgm-clip"');
    expect(bundle.html).toContain('data-track-index="4"');
    expect(bundle.html).toContain('data-volume="0.18"');

    // Check narration and SFX tracks coexist cleanly
    expect(bundle.html).toContain('id="quiz-narration"');
    expect(bundle.html).toContain('data-track-index="2"');
    expect(bundle.html).toContain('class="clip sfx-clip"');
    expect(bundle.html).toContain('data-track-index="3"');
  });
});
