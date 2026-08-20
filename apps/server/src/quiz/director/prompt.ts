import type { QuizV2 } from "@studio/shared";

export function buildQuizDirectorPrompt(quiz: QuizV2, channelDna: string, timingPolicy: string): string {
  return [
    "Return JSON only. Do not include markdown fences or commentary.",
    "You are the creative director for the complete episode, not an editor of individual facts.",
    "Preserve every canonical question ID, question text, choice text, correct answer, explanation, and source ID exactly.",
    "Never invent new answer options and never change facts. Choose presentation only.",
    "Use only the supported archetype, energy, density, beat, asset, mascot, SFX, transition, and reward enums.",
    "Evaluate episode-level variation: avoid repeated archetypes, include a midpoint moment, and distinguish the final challenge.",
    "Respect the age band, avoid frightening imagery, avoid strobing, avoid manipulative urgency, and prefer visual storytelling over text-only repetition.",
    "Quiz facts: " + JSON.stringify(quiz),
    "Channel DNA: " + channelDna,
    "Timing policy: " + timingPolicy,
    "Return an object with schema_version 2, episode_id, archetype_family, beats, midpoint_question_id, and final_challenge_question_id. Beats reference question_id only and must not copy fact fields.",
  ].join("\n\n");
}
