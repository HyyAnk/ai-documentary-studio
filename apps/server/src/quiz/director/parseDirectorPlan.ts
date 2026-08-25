import type { DirectorPlan, QuizV2 } from "@studio/shared";
import { assertDirectorPlanValid } from "./validateDirectorPlan.js";

export function parseDirectorPlanOutput(output: string, quiz: QuizV2): DirectorPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Director output must be valid JSON");
  }
  return assertDirectorPlanValid(quiz, parsed);
}

export function createDefaultDirectorPlan(quiz: QuizV2): DirectorPlan {
  const minimumThinking: Record<QuizV2["age_band"], number> = { "4-6": 7.5, "7-9": 7, "10-12": 6.8, family: 7 };
  const beats: DirectorPlan["beats"] = quiz.questions.map((question, index): DirectorPlan["beats"][number] => {
    const archetype = question.format === "image_guess" || question.format === "odd_one_out" ? "visual_multiple_choice" : question.format === "true_false" ? "true_false" : index % 3 === 1 ? "illustrated_multiple_choice" : "text_multiple_choice";
    const isFinal = index === quiz.questions.length - 1;
    const isMidpoint = index === Math.floor(quiz.questions.length / 2);
    const beatIntents: DirectorPlan["beats"][number]["beat_intents"] = ["question_enter", "choice_reveal", "thinking", "countdown", "answer_reveal", "explanation", ...(question.fun_fact ? ["fun_fact" as const] : []), ...(isFinal ? ["celebrate" as const] : []), "transition"];
    return {
      question_id: question.id,
      archetype: isFinal ? "final_challenge" : archetype,
      energy: isFinal ? "triumphant" : isMidpoint ? "excited" : index % 2 ? "playful" : "curious",
      visual_density: isFinal ? "burst" : index % 2 ? "lively" : "focused",
      palette_id: (["lime", "aqua", "sunny", "purple", "pink", "orange", "red", "blue"] as const)[index % 8],
      layout_id: archetype === "visual_multiple_choice" ? "visual_choices_three" : "media_left_choices_right",
      motion_id: (["enter.pop", "enter.slideUp", "enter.scale"] as const)[index % 3],
      transition_id: isFinal ? "lightning_brush" : "bubble_splash",
      thinking_seconds: minimumThinking[quiz.age_band] + (isFinal ? .6 : 0),
      beat_intents: beatIntents,
      asset_intents: archetype === "visual_multiple_choice" ? ["choice_illustration"] : ["question_illustration"],
      mascot_state: isFinal ? "celebrate" : index % 2 ? "thinking" : "curious",
      sfx_intents: isFinal ? ["countdown_final", "correct_big", "score_gain"] : ["countdown_tick", index % 2 ? "correct_medium" : "correct_small"],
      transition_intent: isFinal ? "zoom" : index % 2 ? "slide" : "cut",
      reward_intensity: isFinal ? "big" : index % 3 === 0 ? "medium" : "small",
    };
  });
  return { schema_version: 2, episode_id: quiz.episode_id, archetype_family: "candy_arcade", beats, midpoint_question_id: quiz.questions[Math.floor(quiz.questions.length / 2)]?.id ?? null, final_challenge_question_id: quiz.questions.at(-1)?.id ?? null };
}
