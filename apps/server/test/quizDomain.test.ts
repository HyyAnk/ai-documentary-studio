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

  it("automatically rebalances choices so consecutive questions never share the same answer position", () => {
    const quiz = deriveQuizV2FromScenes({
      episodeId: "episode-1",
      language: "English",
      ageBand: "7-9",
      format: "multiple_choice",
      scenes: [scene(1, "Tiger"), scene(2, "Tiger"), scene(3, "Tiger"), scene(4, "Tiger"), scene(5, "Tiger")],
    });
    const correctIndices = quiz.questions.map((q) => q.choices.findIndex((c) => c.id === q.correct_choice_id));
    for (let i = 1; i < correctIndices.length; i++) {
      expect(correctIndices[i]).not.toBe(correctIndices[i - 1]);
    }
    // Verify each question's correct choice text remains "Tiger"
    for (const q of quiz.questions) {
      const correctChoice = q.choices.find((c) => c.id === q.correct_choice_id);
      expect(correctChoice?.text).toBe("Tiger");
    }
  });

  it("flags consecutive same answer position in QA assessment if manually constructed", () => {
    const rawQuiz = {
      schema_version: 2 as const,
      episode_id: "episode-1",
      age_band: "7-9" as const,
      language: "English",
      questions: [
        {
          id: "question-01",
          number: 1,
          format: "multiple_choice" as const,
          difficulty: 1,
          question: "Question 1",
          choices: [{ id: "choice-a", text: "Alpha" }, { id: "choice-b", text: "Beta" }, { id: "choice-c", text: "Gamma" }],
          correct_choice_id: "choice-a",
          explanation: "Explanation 1",
          fun_fact: "",
          source_ids: ["C01"],
          visual_opportunity: "Hero image",
          validation: { semantic_status: "validated" as const, source_coverage: true, fact_locked: true },
        },
        {
          id: "question-02",
          number: 2,
          format: "multiple_choice" as const,
          difficulty: 2,
          question: "Question 2",
          choices: [{ id: "choice-a", text: "One" }, { id: "choice-b", text: "Two" }, { id: "choice-c", text: "Three" }],
          correct_choice_id: "choice-a",
          explanation: "Explanation 2",
          fun_fact: "",
          source_ids: ["C02"],
          visual_opportunity: "Hero image",
          validation: { semantic_status: "validated" as const, source_coverage: true, fact_locked: true },
        },
      ],
    };
    const assessment = assessQuiz({ quiz: rawQuiz });
    expect(assessment.issues.some((issue) => issue.code === "quiz_consecutive_same_answer_position" && issue.severity === "warning")).toBe(true);
  });

  it("flags answer-position bias when correct answers are heavily concentrated in one position", () => {
    const rawQuiz = {
      schema_version: 2 as const,
      episode_id: "episode-1",
      age_band: "7-9" as const,
      language: "English",
      questions: Array.from({ length: 6 }, (_, index) => ({
        id: `question-0${index + 1}`,
        number: index + 1,
        format: "multiple_choice" as const,
        difficulty: 1,
        question: `Question ${index + 1}`,
        choices: [{ id: "choice-a", text: "Alpha" }, { id: "choice-b", text: "Beta" }, { id: "choice-c", text: "Gamma" }],
        correct_choice_id: index < 5 ? "choice-a" : "choice-b",
        explanation: `Explanation ${index + 1}`,
        fun_fact: "",
        source_ids: [`C0${index + 1}`],
        visual_opportunity: "Hero image",
        validation: { semantic_status: "validated" as const, source_coverage: true, fact_locked: true },
      })),
    };
    const assessment = assessQuiz({ quiz: rawQuiz });
    expect(assessment.issues.some((issue) => issue.code === "quiz_answer_position_bias" && issue.severity === "warning")).toBe(true);
  });

  it("blocks a media question without a semantic visual subject", () => {
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [scene(1)] });
    const assessment = assessQuiz({ quiz, director: createDefaultDirectorPlan(quiz) });
    expect(assessment.issues.some((issue) => issue.code === "visual_subject_missing" && issue.severity === "blocker")).toBe(true);
  });

  it("limits choices to a maximum of 3 (A, B, C) and rejects fewer than 2 choices", () => {
    // 4 choices should be sliced down to 3
    const sceneWith4Choices = scene(1, "Tiger");
    sceneWith4Choices.quiz = {
      ...sceneWith4Choices.quiz!,
      choices: ["Tiger", "Dolphin", "Elephant", "Leopard"],
    };
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [sceneWith4Choices] });
    expect(quiz.questions[0].choices).toHaveLength(3);
    expect(quiz.questions[0].choices.map((c) => c.text)).toEqual(["Tiger", "Dolphin", "Elephant"]);

    // 1 choice should throw QUIZ_QUESTION_INCOMPLETE
    const sceneWith1Choice = scene(1, "Tiger");
    sceneWith1Choice.quiz = {
      ...sceneWith1Choice.quiz!,
      choices: ["Tiger"],
    };
    expect(() => deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "multiple_choice", scenes: [sceneWith1Choice] })).toThrow("missing question, choices");
  });

  it("handles true_false quiz format with strictly 2 choices and normalizes 3 choices", () => {
    // Exact 2 choices for true_false
    const trueFalseScene = scene(1, "True");
    trueFalseScene.quiz = {
      ...trueFalseScene.quiz!,
      choices: ["True", "False"],
      answer: "True",
    };
    const quiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "true_false", scenes: [trueFalseScene] });
    expect(quiz.questions[0].format).toBe("true_false");
    expect(quiz.questions[0].choices).toHaveLength(2);
    expect(quiz.questions[0].choices.map((c) => c.text)).toEqual(["True", "False"]);
    expect(quiz.questions[0].correct_choice_id).toBe("choice-a");

    // 3 choices normalized down to 2 choices for true_false without throwing schema validation error
    const threeChoiceTfScene = scene(1, "False");
    threeChoiceTfScene.quiz = {
      ...threeChoiceTfScene.quiz!,
      choices: ["True", "False", "Neither"],
      answer: "False",
    };
    const normalizedQuiz = deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "true_false", scenes: [threeChoiceTfScene] });
    expect(normalizedQuiz.questions[0].format).toBe("true_false");
    expect(normalizedQuiz.questions[0].choices).toHaveLength(2);
    expect(normalizedQuiz.questions[0].correct_choice_id).toBe("choice-b");

    // 1 choice throws for true_false
    const singleChoiceTfScene = scene(1, "True");
    singleChoiceTfScene.quiz = {
      ...singleChoiceTfScene.quiz!,
      choices: ["True"],
      answer: "True",
    };
    expect(() => deriveQuizV2FromScenes({ episodeId: "episode-1", language: "English", ageBand: "7-9", format: "true_false", scenes: [singleChoiceTfScene] })).toThrow("must have exactly 2 choices: True/False");
  });
});
