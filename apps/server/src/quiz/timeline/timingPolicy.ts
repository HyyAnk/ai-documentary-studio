import type { QuizAgeBand } from "@studio/shared";

export type QuizTimingPolicy = {
  intro_minimum_seconds: number;
  question_entrance_seconds: number;
  question_narration_lead_seconds: number;
  choices_enter_delay_seconds: number;
  choice_entrance_seconds: number;
  choice_stagger_seconds: number;
  choice_settle_seconds: number;
  narration_gap_seconds: number;
  question_to_choices_pause_seconds: number;
  thinking_settle_seconds: number;
  post_prompt_thinking_seconds: number;
  reveal_delay_seconds: number;
  reveal_seconds: number;
  reveal_voice_lead_seconds: number;
  reveal_hold_seconds: number;
  reward_seconds: Record<"small" | "medium" | "big", number>;
  explanation_lead_seconds: number;
  explanation_hold_seconds: number;
  fact_hold_seconds: number;
  transition_seconds: number;
  transition_overlap_seconds: number;
  outro_hold_seconds: number;
  minimum_thinking_seconds: number;
  maximum_thinking_seconds: number;
  countdown_seconds: number;
  fallback_words_per_second: number;
};

export function timingPolicyForAgeBand(ageBand: QuizAgeBand): QuizTimingPolicy {
  return {
    intro_minimum_seconds: 2.6,
    question_entrance_seconds: 0.95,
    question_narration_lead_seconds: 2.0,
    choices_enter_delay_seconds: 0.48,
    choice_entrance_seconds: 0.58,
    choice_stagger_seconds: 0.14,
    choice_settle_seconds: 0.08,
    narration_gap_seconds: 0.08,
    question_to_choices_pause_seconds: 1.0,
    thinking_settle_seconds: 0.1,
    post_prompt_thinking_seconds: 1.0,
    reveal_delay_seconds: 0.05,
    reveal_seconds: 0.58,
    reveal_voice_lead_seconds: 0.12,
    reveal_hold_seconds: 0.24,
    reward_seconds: { small: 0.42, medium: 0.58, big: 0.86 },
    explanation_lead_seconds: 0.08,
    explanation_hold_seconds: 2.0,
    fact_hold_seconds: 2.0,
    transition_seconds: 0.86,
    transition_overlap_seconds: 0,
    outro_hold_seconds: 5.0,
    minimum_thinking_seconds: { "4-6": 7.2, "7-9": 6.8, "10-12": 6.5, family: 6.8 }[ageBand],
    maximum_thinking_seconds: { "4-6": 8.5, "7-9": 8, "10-12": 7.8, family: 8 }[ageBand],
    countdown_seconds: 5,
    fallback_words_per_second: 2.05,
  };
}
