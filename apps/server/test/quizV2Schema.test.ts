import { describe, expect, it } from "vitest";
import { DirectorPlanSchema, QuizAssessmentSchema, QuizTimelineSchema, QuizV2Schema } from "@studio/shared";

const choice = (id: string, text: string) => ({ id, text });

const validQuiz = () => QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "episode-1",
  age_band: "7-9",
  language: "English",
  questions: [
    {
      id: "q1",
      number: 1,
      format: "multiple_choice",
      difficulty: 2,
      question: "Which animal has stripes?",
      choices: [choice("a", "Tiger"), choice("b", "Elephant"), choice("c", "Dolphin")],
      correct_choice_id: "a",
      explanation: "Tigers have dark stripes across their fur.",
      fun_fact: "No two tigers have exactly the same stripe pattern.",
      source_ids: ["C01"],
      visual_opportunity: "Show a friendly tiger illustration",
      validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
    },
  ],
});

describe("Quiz V2 shared schemas", () => {
  it("accepts a valid canonical quiz", () => {
    expect(validQuiz().questions[0].correct_choice_id).toBe("a");
  });

  it("accepts the 50-question production ceiling", () => {
    const question = validQuiz().questions[0];
    const quiz = QuizV2Schema.parse({
      ...validQuiz(),
      questions: Array.from({ length: 50 }, (_, index) => ({ ...question, id: `q${index + 1}`, number: index + 1, source_ids: [`C${String(index + 1).padStart(2, "0")}`] })),
    });
    const beat = { question_id: "q1", archetype: "text_multiple_choice" as const, energy: "curious" as const, visual_density: "focused" as const, thinking_seconds: 5, beat_intents: ["thinking" as const], asset_intents: [], mascot_state: null, sfx_intents: [], transition_intent: "cut" as const, reward_intensity: "small" as const };
    const director = DirectorPlanSchema.parse({ schema_version: 2, episode_id: "episode-1", archetype_family: "quiz", beats: Array.from({ length: 50 }, (_, index) => ({ ...beat, question_id: `q${index + 1}` })) });
    expect(quiz.questions).toHaveLength(50);
    expect(director.beats).toHaveLength(50);
  });

  it("rejects a canonical answer that is not visible", () => {
    expect(() => QuizV2Schema.parse({ ...validQuiz(), questions: [{ ...validQuiz().questions[0], correct_choice_id: "z" }] })).toThrow("Canonical answer must reference a visible choice");
  });

  it("rejects duplicate choice IDs and normalized choice text", () => {
    const question = validQuiz().questions[0];
    expect(() => QuizV2Schema.parse({ ...validQuiz(), questions: [{ ...question, choices: [choice("a", "Tiger"), choice("a", "Lion"), choice("c", " tiger ")] }] })).toThrow(/duplicated|unique after normalization/);
  });

  it("rejects duplicate or non-sequential question identity", () => {
    const question = validQuiz().questions[0];
    expect(() => QuizV2Schema.parse({ ...validQuiz(), questions: [question, { ...question, id: "q2", number: 3 }] })).toThrow("Question numbers must be sequential");
  });

  it("rejects unsupported director archetypes and invalid timeline events", () => {
    expect(() => DirectorPlanSchema.parse({ schema_version: 2, episode_id: "episode-1", archetype_family: "quiz", beats: [{ question_id: "q1", archetype: "not_supported", energy: "curious", visual_density: "focused", thinking_seconds: 5, beat_intents: ["thinking"], asset_intents: [], mascot_state: null, sfx_intents: [], transition_intent: "cut", reward_intensity: "small" }] })).toThrow();
    expect(() => QuizTimelineSchema.parse({ schema_version: 2, episode_id: "episode-1", duration_seconds: 2, events: [{ event_id: "e1", type: "not_supported", at_seconds: 0, duration_seconds: 0, question_id: null, choice_id: null, segment_id: null, payload: {} }] })).toThrow();
  });

  it("rejects scores outside the production range", () => {
    expect(() => QuizAssessmentSchema.parse({ schema_version: 2, episode_id: "episode-1", assessed_at: new Date().toISOString(), score: 101, rating: "production_ready", categories: { semantic: 100, visual: 100, pacing: 100, audio: 100, variety: 100, render_integrity: 100 }, issues: [] })).toThrow();
  });

  it("accepts the optional Candy Arcade visual assessment only within its 100 point rubric", () => {
    expect(() => QuizAssessmentSchema.parse({ schema_version: 2, episode_id: "episode-1", assessed_at: new Date().toISOString(), score: 90, rating: "production_ready", categories: { semantic: 100, visual: 100, pacing: 100, audio: 100, variety: 100, render_integrity: 100 }, candy_arcade_visual: { pacing: 20, hierarchy: 15, asset_consistency: 15, motion: 15, reveal: 10, transition: 10, readability: 10, visual_variety: 5, total: 100 }, issues: [] })).not.toThrow();
    expect(() => QuizAssessmentSchema.parse({ schema_version: 2, episode_id: "episode-1", assessed_at: new Date().toISOString(), score: 90, rating: "production_ready", categories: { semantic: 100, visual: 100, pacing: 100, audio: 100, variety: 100, render_integrity: 100 }, candy_arcade_visual: { pacing: 21, hierarchy: 15, asset_consistency: 15, motion: 15, reveal: 10, transition: 10, readability: 10, visual_variety: 5, total: 101 }, issues: [] })).toThrow();
  });
});
