import { describe, expect, it } from "vitest";
import { QuizV2Schema } from "@studio/shared";
import { buildQuizVoicePlan, splitChoicePhrases } from "../src/quiz/audio/voicePlan.js";
import { MIN_QUIZ_VOICE_SLOWDOWN_TEMPO, quizVoiceFingerprint, quizVoicePaceCorrectionTempo, quizVoiceTempo, voicePerformanceConfig } from "../src/quiz/audio/voiceSynthesis.js";
import { quizVoicePacingLimit, quizVoicePlanNeedsRegeneration, quizVoiceTargetWordsPerSecond, quizVoiceWordsPerSecond } from "../src/quiz/audio/voicePolicy.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { assessQuiz } from "../src/quiz/qa/quizAssessment.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";
import { timingPolicyForAgeBand } from "../src/quiz/timeline/timingPolicy.js";

const quiz = QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "paced-quiz",
  age_band: "7-9",
  language: "English",
  questions: Array.from({ length: 3 }, (_, index) => ({
    id: `question-${index + 1}`,
    number: index + 1,
    format: "multiple_choice" as const,
    difficulty: 2,
    question: "Which animal has stripes?",
    choices: [{ id: "choice-a", text: "Tiger" }, { id: "choice-b", text: "Dolphin" }, { id: "choice-c", text: "Rabbit" }],
    correct_choice_id: "choice-a",
    explanation: "Tigers have stripes on their fur.",
    fun_fact: index === 1 ? "Each tiger has a different stripe pattern." : "",
    source_ids: ["C01"],
    visual_opportunity: "",
    validation: { semantic_status: "validated" as const, source_coverage: true, fact_locked: true },
  })),
});

describe("Quiz V2 pacing", () => {
  it("centralizes the Candy Arcade V2 timing targets", () => {
    const timing = timingPolicyForAgeBand("7-9");
    expect(timing.question_entrance_seconds).toBeGreaterThanOrEqual(.8);
    expect(timing.question_entrance_seconds).toBeLessThanOrEqual(1.2);
    expect(timing.minimum_thinking_seconds).toBeGreaterThanOrEqual(6);
    expect(timing.maximum_thinking_seconds).toBeLessThanOrEqual(8.5);
    expect(timing.reveal_seconds).toBeGreaterThanOrEqual(.4);
    expect(timing.reveal_seconds).toBeLessThanOrEqual(.7);
    expect(timing.transition_seconds).toBeGreaterThanOrEqual(.65);
    expect(timing.transition_seconds).toBeLessThanOrEqual(.95);
  });

  it("centralizes age-band voice targets and leaves a rounding safety margin", () => {
    expect(quizVoiceTargetWordsPerSecond("4-6")).toBe(2.4);
    expect(quizVoiceTargetWordsPerSecond("7-9")).toBe(2.5);
    expect(quizVoiceTargetWordsPerSecond("10-12")).toBe(2.6);
    expect(quizVoiceTargetWordsPerSecond("family")).toBe(2.5);
    expect(quizVoicePacingLimit(quizVoiceTargetWordsPerSecond("4-6"))).toBeLessThan(2.4);
  });

  it("writes conversational child-friendly prompts and slows narrative roles", () => {
    const voice = buildQuizVoicePlan(quiz);
    expect(voice.segments.some((segment) => segment.role === "thinking_prompt")).toBe(true);
    expect(voice.segments.find((segment) => segment.role === "question")?.phrases.length).toBeGreaterThan(0);
    expect(voice.segments.find((segment) => segment.segment_id === "question-2:fact")?.text).toBe(quiz.questions[1]?.fun_fact);
    expect(quizVoiceTempo("question")).toBeGreaterThanOrEqual(1);
    expect(quizVoiceTempo("choice")).toBeGreaterThanOrEqual(1);
    expect(quizVoiceTempo("reveal")).toBeGreaterThanOrEqual(1);
    expect(quizVoiceTempo("thinking_prompt")).toBeGreaterThanOrEqual(1);
    expect(quizVoiceTempo("explanation")).toBeGreaterThanOrEqual(1);
    expect(quizVoiceTempo("explanation")).toBeLessThan(quizVoiceTempo("question"));
    expect(quizVoiceTempo("countdown")).toBe(1);
  });

  it("keeps short choice lists in one prosodic TTS phrase and calms reveals", () => {
    const voice = buildQuizVoicePlan(quiz);
    const choice = voice.segments.find((segment) => segment.role === "choice");
    expect(choice?.phrases).toHaveLength(1);
    expect(choice?.phrases[0]?.text).toContain("Tiger, Dolphin, or Rabbit?");
    expect(splitChoicePhrases("Elephant, Giraffe, or Tiger?")).toEqual(["Elephant, Giraffe, or Tiger?"]);
    expect(splitChoicePhrases("Choose the best answer, then explain why it fits.")).toEqual(["Choose the best answer,", "then explain why it fits."]);
    expect(voice.segments.find((segment) => segment.role === "reveal")?.text).toBe("It's Tiger!");
    expect(voicePerformanceConfig(DEFAULT_CONFIG.audio_generation, "reveal").exaggeration).toBe(.78);
  });

  it("never slows a voice segment below the audible correction floor", () => {
    const pacingLimit = quizVoicePacingLimit(quizVoiceTargetWordsPerSecond(quiz.age_band));
    expect(quizVoicePaceCorrectionTempo(pacingLimit, pacingLimit)).toBe(1);
    for (const actual of [pacingLimit + .1, 3, 10, 100, Number.POSITIVE_INFINITY]) {
      expect(quizVoicePaceCorrectionTempo(actual, pacingLimit)).toBeGreaterThanOrEqual(MIN_QUIZ_VOICE_SLOWDOWN_TEMPO);
    }
    expect(quizVoicePaceCorrectionTempo(100, pacingLimit)).toBe(MIN_QUIZ_VOICE_SLOWDOWN_TEMPO);
  });

  it("flags measured speech that is too fast for the selected age band", () => {
    const voice = buildQuizVoicePlan(quiz);
    const measured = { ...voice, segments: voice.segments.map((segment) => ({ ...segment, duration_seconds: segment.role === "countdown" ? 1 : 0.25 })) };
    const timeline = compileQuizTimeline({ quiz, director: createDefaultDirectorPlan(quiz), voicePlan: measured });
    const assessment = assessQuiz({ quiz, director: createDefaultDirectorPlan(quiz), voicePlan: measured, timeline, measuredAudio: true, renderIntegrity: true });
    expect(assessment.issues.some((issue) => issue.code === "voice_pace_unsafe" && issue.severity === "blocker")).toBe(true);
    expect(assessment.candy_arcade_visual?.pacing).toBeLessThan(20);
  });

  it("forces stale fast voice plans through regeneration", () => {
    const fast = { ...buildQuizVoicePlan(quiz), segments: buildQuizVoicePlan(quiz).segments.map((segment) => ({ ...segment, duration_seconds: segment.role === "countdown" ? 1 : 0.25 })) };
    expect(quizVoiceWordsPerSecond(fast)).toBeGreaterThan(quizVoiceTargetWordsPerSecond(quiz.age_band));
    expect(quizVoicePlanNeedsRegeneration({ voicePlan: fast, ageBand: quiz.age_band })).toBe(true);
    expect(quizVoicePlanNeedsRegeneration({ voicePlan: buildQuizVoicePlan(quiz), ageBand: quiz.age_band, assessmentIssueCodes: ["voice_pace_unsafe"] })).toBe(true);
  });

  it("adds an encouragement visual beat during the extended thinking pause", () => {
    const timeline = compileQuizTimeline({ quiz, director: createDefaultDirectorPlan(quiz), voicePlan: buildQuizVoicePlan(quiz) });
    for (const question of quiz.questions) {
      const thinking = timeline.events.find((event) => event.type === "countdown.start" && event.question_id === question.id)!;
      const pulse = timeline.events.find((event) => event.type === "mascot.state" && event.question_id === question.id && event.payload.phase === "thinking_pulse");
      expect(pulse?.at_seconds ?? 0).toBeGreaterThan(thinking.at_seconds);
      expect(pulse?.at_seconds ?? 0).toBeLessThan(thinking.at_seconds + thinking.duration_seconds);
    }
  });

  it("uses the compact overlapping game-show beat model instead of serial narration waits", () => {
    const voice = buildQuizVoicePlan(quiz);
    const durations = Object.fromEntries(voice.segments.map((segment) => [segment.segment_id, segment.role === "question" ? 3.2 : segment.role === "choice" ? 2.6 : segment.role === "explanation" ? 3.2 : 1]));
    const timeline = compileQuizTimeline({ quiz, director: createDefaultDirectorPlan(quiz), voicePlan: voice, audioDurations: durations });
    const q1 = quiz.questions[0]!;
    const enter = timeline.events.find((event) => event.type === "question.enter" && event.question_id === q1.id)!;
    const narration = timeline.events.find((event) => event.segment_id === q1.id + ":question")!;
    const choices = timeline.events.find((event) => event.type === "choices.enter" && event.question_id === q1.id)!;
    const thinking = timeline.events.find((event) => event.type === "countdown.start" && event.question_id === q1.id)!;
    expect(narration.at_seconds).toBeGreaterThanOrEqual(enter.at_seconds + 2.0);
    expect(choices.at_seconds).toBeLessThanOrEqual(narration.at_seconds);
    expect(thinking.duration_seconds).toBeGreaterThanOrEqual(6.5);
    expect(thinking.duration_seconds).toBeLessThanOrEqual(8.5);
  });

  it("keeps a deterministic five-question Golden Demo timeline below the 140 second gate", () => {
    const golden = QuizV2Schema.parse({ ...quiz, questions: Array.from({ length: 5 }, (_, index) => ({ ...quiz.questions[index % quiz.questions.length]!, id: `golden-${index + 1}`, number: index + 1, fun_fact: "" })) });
    const voice = buildQuizVoicePlan(golden);
    const durations = Object.fromEntries(voice.segments.map((segment) => [segment.segment_id, segment.role === "intro" || segment.role === "outro" ? 3.8 : segment.role === "question" ? 3.8 : segment.role === "choice" ? 3 : segment.role === "thinking_prompt" ? 1.1 : segment.role === "countdown" ? 2.1 : segment.role === "reveal" ? 1.5 : 3.5]));
    const timeline = compileQuizTimeline({ quiz: golden, director: createDefaultDirectorPlan(golden), voicePlan: voice, audioDurations: durations });
    expect(timeline.duration_seconds).toBeLessThanOrEqual(140);
  });

  it("waits for the transition to finish completely before the next question enters", () => {
    const timeline = compileQuizTimeline({ quiz, director: createDefaultDirectorPlan(quiz), voicePlan: buildQuizVoicePlan(quiz) });
    const transition = timeline.events.find((event) => event.type === "transition.start" && event.question_id === quiz.questions[0]?.id)!;
    const nextEntrance = timeline.events.find((event) => event.type === "question.enter" && event.question_id === quiz.questions[1]?.id)!;
    const nextNarration = timeline.events.find((event) => event.segment_id === quiz.questions[1]?.id + ":question")!;
    expect(nextEntrance.at_seconds).toBeGreaterThanOrEqual(transition.at_seconds + transition.duration_seconds);
    expect(nextNarration.at_seconds).toBeGreaterThanOrEqual(nextEntrance.at_seconds + 2.0);
  });

  it("adds a visual acknowledgement while long answer choices are being read", () => {
    const timeline = compileQuizTimeline({ quiz, director: createDefaultDirectorPlan(quiz), voicePlan: buildQuizVoicePlan(quiz), audioDurations: Object.fromEntries(buildQuizVoicePlan(quiz).segments.map((segment) => [segment.segment_id, segment.role === "choice" ? 6 : 1])) });
    expect(timeline.events.some((event) => event.type === "mascot.state" && event.payload.phase === "choices_pulse")).toBe(true);
  });
});
