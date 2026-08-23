import { describe, expect, it, vi } from "vitest";
import type { VoicePlan, QuizV2 } from "@studio/shared";
import { healQuizVoicePacingWithLLM } from "../src/quiz/audio/voicePacingHealer.js";
import { countQuizVoiceWords, quizVoiceTargetWordsPerSecond } from "../src/quiz/audio/voicePolicy.js";
import type { LLMClient } from "../src/utils/promptSanitizer.js";

describe("Quiz Self-Healing & Auto-Retry", () => {
  it("heals voice pacing by rephrasing fast segments with LLM client", async () => {
    // Segment with 15 words in 5 seconds = 3.0 words/second (exceeds 2.4 wps for age 4-6)
    const longText = "Welcome everybody to today super exciting quiz game about very cute and awesome wild animals";
    const voicePlan: VoicePlan = {
      schema_version: 1,
      segments: [
        {
          segment_id: "seg-01",
          role: "intro",
          question_id: null,
          text: longText,
          phrases: [{ text: longText, delivery: "normal", pause_after: "none" }],
          duration_seconds: 5.0,
        },
        {
          segment_id: "seg-02",
          role: "question",
          question_id: "question-01",
          text: "Which animal has stripes?",
          phrases: [{ text: "Which animal has stripes?", delivery: "normal", pause_after: "none" }],
          duration_seconds: 3.5, // 4 words in 3.5s = 1.14 wps (safe)
        },
      ],
    };

    const targetWps = quizVoiceTargetWordsPerSecond("4-6"); // 2.4
    expect(countQuizVoiceWords(longText) / 5.0).toBeGreaterThan(targetWps);

    // Mock LLM client that returns a concise 6-word version
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      startThread: vi.fn().mockResolvedValue("thread-1"),
      deleteThread: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((event, handler) => {
        if (event === "notification") {
          setTimeout(() => {
            handler({
              method: "item/agentMessage/delta",
              params: { threadId: "thread-1", delta: "Welcome to our fun animal quiz!" },
            });
            handler({
              method: "turn/completed",
              params: { threadId: "thread-1", turn: { status: "completed" } },
            });
          }, 10);
        }
      }),
      off: vi.fn(),
      startTurn: vi.fn().mockResolvedValue("turn-1"),
      interruptTurn: vi.fn().mockResolvedValue(undefined),
    } as unknown as LLMClient;

    const result = await healQuizVoicePacingWithLLM({
      voicePlan,
      ageBand: "4-6",
      targetWordsPerSecond: targetWps,
      client: mockClient,
    });

    expect(result.healed).toBe(true);
    expect(result.healedSegmentIds).toEqual(["seg-01"]);
    expect(result.voicePlan.segments[0].text).toBe("Welcome to our fun animal quiz!");
    expect(result.voicePlan.segments[0].duration_seconds).toBeNull(); // Fresh re-synthesis needed
    expect(result.voicePlan.segments[1].text).toBe("Which animal has stripes?"); // Untouched
  });

  it("leaves segments untouched when pace is already within limits", async () => {
    const voicePlan: VoicePlan = {
      schema_version: 1,
      segments: [
        {
          segment_id: "seg-01",
          role: "question",
          question_id: "question-01",
          text: "Which animal has stripes?",
          phrases: [{ text: "Which animal has stripes?", delivery: "normal", pause_after: "none" }],
          duration_seconds: 4.0, // 4 words / 4s = 1.0 wps (< 2.4)
        },
      ],
    };

    const result = await healQuizVoicePacingWithLLM({
      voicePlan,
      ageBand: "4-6",
      targetWordsPerSecond: quizVoiceTargetWordsPerSecond("4-6"),
      client: {} as LLMClient,
    });

    expect(result.healed).toBe(false);
    expect(result.healedSegmentIds).toEqual([]);
    expect(result.voicePlan.segments[0].duration_seconds).toBe(4.0);
  });
});
