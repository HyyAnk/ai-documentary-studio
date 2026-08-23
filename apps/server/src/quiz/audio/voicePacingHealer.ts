import type { QuizV2, VoicePlan, VoiceSegment } from "@studio/shared";
import { countQuizVoiceWords } from "./voicePolicy.js";
import { executeSinglePromptText, type LLMClient } from "../../utils/promptSanitizer.js";
import type { StudioLogger } from "../../logger.js";

export type VoicePacingHealingResult = {
  voicePlan: VoicePlan;
  healed: boolean;
  healedSegmentIds: string[];
};

/**
 * Proactively inspects each voice segment and uses Antigravity / Codex LLM
 * to rephrase wordy segments so spoken pacing conforms to the age-band contract.
 */
export async function healQuizVoicePacingWithLLM(input: {
  voicePlan: VoicePlan;
  ageBand: QuizV2["age_band"];
  targetWordsPerSecond: number;
  client?: LLMClient;
  logger?: StudioLogger;
  channelId?: string;
  episodeId?: string;
}): Promise<VoicePacingHealingResult> {
  if (!input.client) {
    return { voicePlan: input.voicePlan, healed: false, healedSegmentIds: [] };
  }

  const targetPace = input.targetWordsPerSecond;
  const segments: VoiceSegment[] = [];
  const healedSegmentIds: string[] = [];

  for (const segment of input.voicePlan.segments) {
    if (segment.role === "countdown" || !segment.duration_seconds || segment.duration_seconds <= 0) {
      segments.push(segment);
      continue;
    }

    const currentWords = countQuizVoiceWords(segment.text);
    const pace = currentWords / segment.duration_seconds;

    // If segment exceeds safe pacing limit
    if (pace > targetPace) {
      const targetWordBudget = Math.max(2, Math.floor(segment.duration_seconds * targetPace * 0.9));
      input.logger?.info(
        `Segment ${segment.segment_id} (${segment.role}) paced too fast (${pace.toFixed(2)} wps > ${targetPace} wps target, ${currentWords} words). Rephrasing with LLM to ~${targetWordBudget} words...`,
        { profileId: input.channelId ?? "", workerId: input.episodeId ?? "", step: "voice_pacing_heal" }
      );

      const prompt = [
        `You are an expert children's educational content writer and voice director.`,
        ``,
        `A quiz narration voice line was spoken too fast (${pace.toFixed(2)} words/sec for age band "${input.ageBand}", limit is ${targetPace} words/sec).`,
        `Original Spoken Text: "${segment.text}"`,
        `Role: ${segment.role}`,
        `Current word count: ${currentWords} words`,
        `Target word budget: At most ${targetWordBudget} words`,
        ``,
        `TASK:`,
        `Rewrite this spoken line in the same language to be punchy, clear, natural, and friendly for children aged ${input.ageBand}.`,
        `It MUST contain NO MORE THAN ${targetWordBudget} words while preserving the essential question, clue, answer, or explanation meaning.`,
        ``,
        `OUTPUT FORMAT: Return ONLY the rewritten spoken text. No quotes, explanations, prefixes, or commentary.`,
      ].join("\n");

      try {
        const rawResult = await executeSinglePromptText(input.client, prompt, {
          modelOverride: "flash",
          timeoutMs: 30_000,
        });

        let cleaned = rawResult.trim();
        cleaned = cleaned.replace(/^```(?:[a-z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/i, "$1").trim();
        if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
          cleaned = cleaned.slice(1, -1).trim();
        }
        cleaned = cleaned.replace(/^(?:Rewritten|Script|Spoken line|Text)\s*:\s*/i, "").trim();

        const rewrittenWords = countQuizVoiceWords(cleaned);
        if (cleaned.length >= 3 && rewrittenWords <= currentWords) {
          input.logger?.info(
            `Segment ${segment.segment_id} successfully rephrased from ${currentWords} words to ${rewrittenWords} words: "${cleaned}"`,
            { profileId: input.channelId ?? "", workerId: input.episodeId ?? "", step: "voice_pacing_heal" }
          );
          segments.push({
            ...segment,
            text: cleaned,
            phrases: [{ text: cleaned, delivery: "normal", pause_after: "none" }],
            duration_seconds: null, // Reset duration so it gets freshly synthesized and measured
          });
          healedSegmentIds.push(segment.segment_id);
          continue;
        }
      } catch (err) {
        input.logger?.warn(
          `Failed to rephrase voice segment ${segment.segment_id} with LLM: ${err instanceof Error ? err.message : String(err)}`,
          { profileId: input.channelId ?? "", workerId: input.episodeId ?? "", step: "voice_pacing_heal" }
        );
      }
    }

    segments.push(segment);
  }

  return {
    voicePlan: { ...input.voicePlan, segments },
    healed: healedSegmentIds.length > 0,
    healedSegmentIds,
  };
}
