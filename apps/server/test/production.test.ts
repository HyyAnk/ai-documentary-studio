import { describe, expect, it } from "vitest";
import type { Episode, Scene } from "@studio/shared";
import { assessProduction, countWords, extractNarration, splitAtNarrativeBoundaries } from "../src/production.js";

describe("production assessment", () => {
  it("flags an abstract clip montage as not ready", () => {
    const assessment = assessProduction({
      episode: episode(),
      research: "# Research\n\nResearch has not started.",
      treatment: "# Treatment\n\nTreatment has not started.",
      visualBible: "# Visual Bible\n\nVisual development has not started.",
      script: "# Script\n\nThe future was a system. The road would become intelligent.",
      scenes: [scene(1, "The future was a system.", "same prompt", "")],
      fallbackWordsPerSecond: 2.3,
    });

    expect(assessment.rating).toBe("not_ready");
    expect(assessment.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["research_sources", "script_length", "factual_density", "visual_bible"]));
  });

  it("accepts a sourced, sequence-aware, continuity-locked plan", () => {
    const anchors = "In 1956 C01 changed the plan. In 1960 C02 proved 25 percent. In 1964 C03 recorded 30 vehicles. In 1971 C04 ended the program. In 1987 C05 changed standards. In 1997 C06 demonstrated the replacement.";
    const filler = Array.from({ length: 100 - countWords(anchors) }, (_, index) => `evidence${index + 1}`).join(" ");
    const narration = `${anchors} ${filler}`;
    const words = narration.split(/\s+/);
    const scenes = Array.from({ length: 6 }, (_, index) => {
      const start = Math.floor((words.length * index) / 6);
      const end = Math.floor((words.length * (index + 1)) / 6);
      return scene(index + 1, words.slice(start, end).join(" "), structuredPrompt(index + 1), `CB-${String(index + 1).padStart(2, "0")}`);
    });
    const assessment = assessProduction({
      episode: episode(),
      research: Array.from({ length: 6 }, (_, index) => `C0${index + 1} https://example.com/source-${index + 1}`).join("\n"),
      treatment: "# Treatment\n\n## Story structure\n\n" + Array.from({ length: 6 }, (_, index) => `## Sequence ${index + 1}\nTime budget and claim C0${index + 1}`).join("\n"),
      visualBible: "# Visual Bible\n\nContinuity bundle " + Array.from({ length: 6 }, (_, index) => `CB-${String(index + 1).padStart(2, "0")}`).join(" "),
      script: `# Script\n\n${narration}`,
      scenes,
      fallbackWordsPerSecond: 2.3,
    });

    expect(assessment.metrics.narration_word_count).toBe(100);
    expect(assessment.rating).toBe("production_ready");
    expect(assessment.score).toBeGreaterThanOrEqual(85);
  });
});

describe("narration utilities", () => {
  it("extracts narration without headings, visual notes, or claim comments", () => {
    const value = extractNarration("# Script\n\n## Open\n\n[Visual: a road]\n\n**Narrator:**\n\nA spoken line.\n\n<!-- Claims: C01 -->");
    expect(value).toBe("A spoken line.");
  });

  it("prefers sentence and clause boundaries when a beat exceeds its budget", () => {
    const chunks = splitAtNarrativeBoundaries("One short sentence. Another clause, followed by a final clause.", 5);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatch(/[.!?,]$/);
    expect(chunks.join(" ")).toContain("final clause");
  });
});

function episode(): Episode {
  return {
    episode_id: "episode_1", channel_id: "channel_1", slug: "episode", topic: { title: "Title", premise: "Premise", hook: "Hook" }, stage: "SCENE_READY",
    script_path: "channels/channel/episodes/episode/script.md", research_path: "channels/channel/episodes/episode/research.md", treatment_path: "channels/channel/episodes/episode/treatment.md", visual_bible_path: "channels/channel/episodes/episode/visual_bible.md", scene_plan_path: "channels/channel/episodes/episode/scene_plan.md", dialogue_script_path: "channels/channel/episodes/episode/dialogue_script.md", video_prompts_path: "channels/channel/episodes/episode/video_prompts.md",
    target_duration_minutes: 3, target_word_count: 100, narration_asset_path: "channels/channel/episodes/episode/assets/narration.wav", narration_generated_at: "2026-08-17T00:00:00.000Z", narration_duration_seconds: 180, narration_segment_count: 6, measured_narration_words_per_second: 100 / 180,
    created_at: "2026-08-17T00:00:00.000Z", updated_at: "2026-08-17T00:00:00.000Z",
  };
}

function scene(number: number, dialogue: string, prompt: string, bundle: string): Scene {
  return {
    scene_id: `scene_${number}`, episode_id: "episode_1", scene_number: number, duration_seconds: 7, dialogue, visual_prompt: prompt, transition_note: "Hard cut", continuity_note: "Keep the locked identity", sequence_id: `sequence-${number}`, sequence_title: `Sequence ${number}`, shot_id: `shot-${number}`, asset_type: number % 3 === 0 ? "archive" : number % 3 === 1 ? "ai_reconstruction" : "diagram", continuity_bundle_id: bundle, reference_asset_ids: [`REF-${number}`], source_ids: [`C0${number}`], reconstruction: number % 3 === 1, sound_cue: "Low road ambience", audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null,
  };
}

function structuredPrompt(number: number): string {
  return `CAMERA\nShot ${number}\nACTION\nVisible action ${number}\nLIGHTING\n5600K side light\nATMOSPHERE\n10% haze\nCONTINUITY\nCB-${String(number).padStart(2, "0")}`;
}
