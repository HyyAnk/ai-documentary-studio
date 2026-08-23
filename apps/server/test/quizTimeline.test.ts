import { describe, expect, it } from "vitest";
import { QuizV2Schema } from "@studio/shared";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";
import { validateQuizTimeline } from "../src/quiz/timeline/validateTimeline.js";

function quiz(count: number) {
  return QuizV2Schema.parse({
    schema_version: 2,
    episode_id: "timeline-episode",
    age_band: "7-9",
    language: "English",
    questions: Array.from({ length: count }, (_, index) => ({
      id: "question-" + String(index + 1).padStart(2, "0"),
      number: index + 1,
      format: index === 1 ? "true_false" : "multiple_choice",
      difficulty: Math.min(5, index + 1),
      question: "Which choice belongs to question " + (index + 1) + "?",
      choices: index === 1 ? [{ id: "choice-a", text: "True" }, { id: "choice-b", text: "False" }] : [{ id: "choice-a", text: "Correct " + (index + 1) }, { id: "choice-b", text: "Other " + (index + 1) }, { id: "choice-c", text: "Another " + (index + 1) }],
      correct_choice_id: "choice-a",
      explanation: "The first choice is canonical for question " + (index + 1) + ".",
      fun_fact: index % 2 ? "A small fun fact." : "",
      source_ids: ["C" + String(index + 1).padStart(2, "0")],
      visual_opportunity: "",
      validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
    })),
  });
}

describe("deterministic Quiz timeline compiler", () => {
  it("produces ordered events with canonical reveals after thinking and rewards", () => {
    const value = quiz(3);
    const timeline = compileQuizTimeline({ quiz: value, director: createDefaultDirectorPlan(value), voicePlan: buildQuizVoicePlan(value) });
    expect(timeline.duration_seconds).toBeGreaterThan(0);
    expect(timeline.events.every((event) => event.at_seconds >= 0)).toBe(true);
    expect(timeline.events.every((event, index) => index === 0 || event.at_seconds >= timeline.events[index - 1].at_seconds)).toBe(true);
    for (const question of value.questions) {
      const thinking = timeline.events.find((event) => event.type === "countdown.start" && event.question_id === question.id);
      const reveal = timeline.events.find((event) => event.type === "answer.reveal" && event.question_id === question.id);
      const reward = timeline.events.find((event) => event.type === "reward.play" && event.question_id === question.id);
      expect(reveal?.at_seconds ?? 0).toBeGreaterThanOrEqual((thinking?.at_seconds ?? 0) + (thinking?.duration_seconds ?? 0));
      expect(reward?.at_seconds ?? 0).toBeGreaterThanOrEqual(reveal?.at_seconds ?? 0);
      expect(reveal?.payload.canonical_choice_id).toBe(question.correct_choice_id);
    }
    expect(validateQuizTimeline(value, timeline)).toEqual([]);
  });

  it("is structurally deterministic for identical input and measured audio", () => {
    const value = quiz(8);
    const voice = buildQuizVoicePlan(value);
    const durations = Object.fromEntries(voice.segments.map((segment) => [segment.segment_id, 0.8]));
    const input = { quiz: value, director: createDefaultDirectorPlan(value), voicePlan: voice, audioDurations: durations };
    expect(compileQuizTimeline(input)).toEqual(compileQuizTimeline(input));
  });

  it("keeps compact child-friendly question cycles and schedules every voice segment", () => {
    const value = quiz(10);
    const voice = buildQuizVoicePlan(value);
    const timeline = compileQuizTimeline({ quiz: value, director: createDefaultDirectorPlan(value), voicePlan: voice });
    const narrationIds = new Set(timeline.events.filter((event) => event.type === "narration.segment").map((event) => event.segment_id));
    expect(timeline.duration_seconds).toBeGreaterThan(130);
    expect(timeline.duration_seconds).toBeLessThan(300);
    expect([...narrationIds].sort()).toEqual(voice.segments.map((segment) => segment.segment_id).sort());
    for (const [index, question] of value.questions.entries()) {
      const start = timeline.events.find((event) => event.type === "question.enter" && event.question_id === question.id)?.at_seconds ?? 0;
      const next = value.questions[index + 1];
      const end = next
        ? timeline.events.find((event) => event.type === "question.enter" && event.question_id === next.id)?.at_seconds ?? 0
        : timeline.events.find((event) => event.type === "transition.start" && event.question_id === question.id)?.at_seconds ?? timeline.duration_seconds;
      expect(end - start).toBeGreaterThanOrEqual(14);
      expect(end - start).toBeLessThanOrEqual(30);
    }
  });

  it("catches a wrong answer reveal before render", () => {
    const value = quiz(3);
    const timeline = compileQuizTimeline({ quiz: value, director: createDefaultDirectorPlan(value), voicePlan: buildQuizVoicePlan(value) });
    const wrong = { ...timeline, events: timeline.events.map((event) => event.type === "answer.reveal" && event.question_id === "question-02" ? { ...event, choice_id: "choice-b", payload: { ...event.payload, canonical_choice_id: "choice-b" } } : event) };
    expect(validateQuizTimeline(value, wrong).some((issue) => issue.code === "timeline_canonical_answer_mismatch")).toBe(true);
  });

  it("scales to a thirty-question episode without cross-question answer leakage", () => {
    const value = quiz(30);
    const timeline = compileQuizTimeline({ quiz: value, director: createDefaultDirectorPlan(value), voicePlan: buildQuizVoicePlan(value) });
    const reveals = timeline.events.filter((event) => event.type === "answer.reveal");
    expect(reveals).toHaveLength(30);
    expect(reveals.every((event) => event.question_id && event.payload.canonical_choice_id === "choice-a")).toBe(true);
  });
});
