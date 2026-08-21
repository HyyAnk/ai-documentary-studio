import { describe, expect, it } from "vitest";
import type { Scene } from "@studio/shared";
import { createDefaultDirectorPlan, parseDirectorPlanOutput } from "../src/quiz/director/parseDirectorPlan.js";
import { validateDirectorPlan } from "../src/quiz/director/validateDirectorPlan.js";
import { deriveQuizV2FromScenes, resolveVisibleQuizChoice } from "../src/quiz/domain/quiz.js";
import { assessQuiz } from "../src/quiz/qa/quizAssessment.js";

const scene = (number: number, answer = "Tiger"): Scene => ({
  scene_id: "scene-" + number,
  episode_id: "episode-1",
  scene_number: number,
  duration_seconds: 6,
  dialogue: "Question " + number,
  visual_prompt: "CAMERA\nCard\nACTION\nShow\nLIGHTING\nSoft\nATMOSPHERE\nPlayful\nCONTINUITY\nSame",
  transition_note: "",
  continuity_note: "Same",
  sequence_id: "sequence-" + number,
  sequence_title: "Question " + number,
  shot_id: "shot-" + number,
  asset_type: "ai_reconstruction",
  continuity_bundle_id: "CB-" + number,
  reference_asset_ids: [],
  source_ids: ["C0" + number],
  reconstruction: true,
  sound_cue: "",
  editorial_overlay: { kind: "none", text: "", motion: "none", placement: "lower_third", duration_seconds: null, data: [], source_ids: [] },
  quiz: { phase: "question", question_number: number, question: "Which animal has stripes?", choices: ["Tiger", "Dolphin", "Elephant"], answer, explanation: "Tigers have stripes.", image_prompt: "" },
  audio_asset_path: null,
  audio_generated_at: null,
  audio_duration_seconds: null,
});

describe("Quiz V2 domain and Director", () => {
  it("derives facts with stable choice IDs and canonical answer mapping", () => {
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [scene(1), scene(2)] });
    expect(quiz.questions.map((question) => question.id)).toEqual(["question-01", "question-02"]);
    expect(quiz.questions[0].correct_choice_id).toBe("choice-a");
    expect(quiz.questions[1].source_ids).toEqual(["C02"]);
  });

  it("blocks a legacy scene answer that is not one visible choice", () => {
    expect(() => deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [scene(1, "Lion")] })).toThrow("does not match exactly one visible choice");
  });

  it("normalizes a labeled answer to the referenced visible choice", () => {
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [scene(1, "A — Tiger")] });
    expect(quiz.questions[0].correct_choice_id).toBe("choice-a");
    expect(resolveVisibleQuizChoice(["Lever", "Inclined plane", "Pulley"], "B — Inclined plane")).toBe(1);
    expect(resolveVisibleQuizChoice(["A. Lever", "B. Inclined plane", "C. Pulley"], "B — Inclined plane")).toBe(1);
    expect(resolveVisibleQuizChoice(["A. Lever", "B. Second-class lever", "C. Third-class lever"], "B — Second-class lever.")).toBe(1);
    expect(resolveVisibleQuizChoice(["Lever", "Inclined plane", "Pulley"], "Option B")).toBe(1);
    expect(resolveVisibleQuizChoice(["Lever", "Inclined plane", "Pulley"], "The correct answer is B — Inclined plane")).toBe(1);
    expect(resolveVisibleQuizChoice(["Lever", "Inclined plane", "Pulley"], "2")).toBe(1);
    expect(resolveVisibleQuizChoice(["Lever", "Inclined plane", "Pulley"], "Answer: Inclined plane")).toBe(1);
    expect(resolveVisibleQuizChoice(["Lever", "Inclined plane", "Pulley"], "B — Wedge")).toBeNull();
  });

  it("strips labels from generated choices before storing canonical Quiz V2 facts", () => {
    const labeled = scene(1, "B — Inclined plane");
    labeled.quiz = { ...labeled.quiz!, choices: ["A. Lever", "B. Inclined plane", "C. Pulley"] };
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [labeled] });
    expect(quiz.questions[0].choices.map((choice) => choice.text)).toEqual(["Lever", "Inclined plane", "Pulley"]);
    expect(quiz.questions[0].correct_choice_id).toBe("choice-b");
  });

  it("creates an episode-level plan without copying fact fields", () => {
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [scene(1), scene(2), scene(3)] });
    const plan = createDefaultDirectorPlan(quiz);
    expect(plan.beats).toHaveLength(3);
    expect(plan.beats.at(-1)?.archetype).toBe("final_challenge");
    expect(() => parseDirectorPlanOutput(JSON.stringify({ ...plan, beats: [{ ...plan.beats[0], question: "mutated fact" }, ...plan.beats.slice(1)] }), quiz)).toThrow();
  });

  it("reports poor episode variation and thinking time as actionable issues", () => {
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "4-6", format: "multiple_choice", scenes: [scene(1), scene(2), scene(3), scene(4), scene(5)] });
    const plan = createDefaultDirectorPlan(quiz);
    const result = validateDirectorPlan(quiz, { ...plan, midpoint_question_id: null, beats: plan.beats.map((beat) => ({ ...beat, archetype: "text_multiple_choice", thinking_seconds: 2 })) });
    expect(result.issues.some((issue) => issue.code === "director_thinking_too_short")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "director_repeated_archetype")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "director_midpoint_missing")).toBe(true);
  });

  it("flags answer-position bias before a quiz is rendered", () => {
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: Array.from({ length: 5 }, (_, index) => scene(index + 1)) });
    const assessment = assessQuiz({ quiz });
    expect(assessment.issues.some((issue) => issue.code === "quiz_answer_position_bias" && issue.severity === "warning")).toBe(true);
  });

  it("blocks a media question without a semantic visual subject", () => {
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [scene(1)] });
    const assessment = assessQuiz({ quiz, director: createDefaultDirectorPlan(quiz) });
    expect(assessment.issues.some((issue) => issue.code === "visual_subject_missing" && issue.severity === "blocker")).toBe(true);
  });
});
