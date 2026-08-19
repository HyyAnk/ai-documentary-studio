import { describe, expect, it } from "vitest";
import { buildQuizComposition } from "../src/tasks.js";
import type { Scene } from "@studio/shared";

const scene = (number: number, question: string, answer: string): Scene => ({
  scene_id: `quiz_scene_${number}`,
  episode_id: "ep_quiz",
  scene_number: number,
  duration_seconds: 5,
  dialogue: `${question} The answer is ${answer}.`,
  visual_prompt: "CAMERA\nA bright card.\nACTION\nCards appear.\nLIGHTING\nSoft.\nATMOSPHERE\nPlayful.\nCONTINUITY\nQuiz palette.",
  transition_note: "",
  continuity_note: "Quiz palette",
  sequence_id: `sequence-${number}`,
  sequence_title: `Question ${number}`,
  shot_id: `shot-${number}`,
  asset_type: "ai_reconstruction",
  continuity_bundle_id: `CB-${String(number).padStart(2, "0")}`,
  reference_asset_ids: [],
  source_ids: [`C0${number}`],
  reconstruction: true,
  sound_cue: "",
  editorial_overlay: { kind: "none", text: "", motion: "none", placement: "lower_third", duration_seconds: null, data: [], source_ids: [] },
  quiz: { phase: "question", question_number: number, question, choices: ["One", "Two", "Three"], answer, explanation: `Because ${answer} is correct.`, image_prompt: "" },
  audio_asset_path: null,
  audio_generated_at: null,
  audio_duration_seconds: null,
});

describe("Quiz HyperFrames composition", () => {
  it("uses structured question content and keeps the narration duration as the timeline", () => {
    const html = buildQuizComposition({ question_count: 2, quiz_format: "multiple_choice", age_band: "7-9", visual_theme: "candy_pop" }, [scene(1, "Which color is on a traffic light?", "Red"), scene(2, "Which planet is red?", "Mars")], "D:/audio/narration.wav", 14.2);
    expect(html).toContain('data-duration="14.200"');
    expect(html).toContain("Which color is on a traffic light?");
    expect(html).toContain("Mars");
    expect(html).toContain("id=\"quiz-narration\"");
    expect(html).toContain("data-no-timeline");
  });
});
