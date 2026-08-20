import { describe, expect, it } from "vitest";
import type { Episode, Scene } from "@studio/shared";
import { assessProduction, calibratedScriptTargetWords, countWords, extractNarration, extractNarrationForAudio, hasHumorPolicyMarker, scriptWordBounds, splitAtNarrativeBoundaries } from "../src/production.js";

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
    const scenes = Array.from({ length: 10 }, (_, index) => {
      const start = Math.floor((words.length * index) / 10);
      const end = Math.floor((words.length * (index + 1)) / 10);
      const current = scene(index + 1, words.slice(start, end).join(" "), structuredPrompt(index + 1), `CB-${String(index + 1).padStart(2, "0")}`);
      return index < 3 ? { ...current, editorial_overlay: { kind: "caption" as const, text: `Evidence ${index + 1}`, motion: "fade_up" as const, placement: "lower_third" as const, duration_seconds: 2, data: [], source_ids: [`C0${index + 1}`] } } : current;
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
    expect(assessment.metrics.overlay_coverage_ratio).toBe(0.3);
    expect(assessment.issues.some((issue) => issue.code === "overlay_coverage")).toBe(false);
    expect(assessment.rating).toBe("production_ready");
    expect(assessment.score).toBeGreaterThanOrEqual(85);
  });

  it("reports a missing shot plan without inventing shot-level failures", () => {
    const anchors = "In 1956 C01 changed the plan. In 1960 C02 proved 25 percent. In 1964 C03 recorded 30 vehicles. In 1971 C04 ended the program. In 1987 C05 changed standards. In 1997 C06 demonstrated the replacement.";
    const narration = `${anchors} ${Array.from({ length: 100 - countWords(anchors) }, (_, index) => `evidence${index + 1}`).join(" ")}`;
    const assessment = assessProduction({
      episode: episode(),
      research: Array.from({ length: 5 }, (_, index) => `C0${index + 1} https://example.com/source-${index + 1}`).join("\n"),
      treatment: Array.from({ length: 5 }, (_, index) => `## Sequence ${index + 1}\nTime budget and claim C0${index + 1}`).join("\n"),
      visualBible: "# Visual Bible\n\nContinuity bundle CB-01",
      script: `# Script\n\n${narration}`,
      scenes: [],
      fallbackWordsPerSecond: 2.3,
    });

    const codes = new Set(assessment.issues.map((issue) => issue.code));
    expect(codes.has("scene_plan")).toBe(true);
    expect(codes.has("duplicate_prompts")).toBe(false);
    expect(codes.has("prompt_structure")).toBe(false);
    expect(codes.has("continuity_coverage")).toBe(false);
    expect(codes.has("source_coverage")).toBe(false);
    expect(codes.has("narration_coverage")).toBe(false);
  });
});

describe("narration utilities", () => {
  it("calibrates the script gate to runtime instead of rejecting a natural 1300-word script", () => {
    const target = calibratedScriptTargetWords({ target_duration_minutes: 8, measured_narration_words_per_second: null }, 2.3);
    const bounds = scriptWordBounds(target);
    expect(target).toBe(1104);
    expect(1300).toBeGreaterThanOrEqual(bounds.lower);
    expect(1300).toBeLessThanOrEqual(bounds.upper);
    expect(1300).toBeGreaterThan(1050);
  });

  it("extracts narration without headings, visual notes, or claim comments", () => {
    const value = extractNarration("# Script\n\n## Open\n\n[Visual: a road]\n\n**Narrator:**\n\nA spoken line.\n\n<!-- Claims: C01 -->");
    expect(value).toBe("A spoken line.");
  });

  it("keeps humor comments out of the script while restoring them for audio", () => {
    const script = "A serious fact lands here. <!-- AUDIO_CUE: chuckle --> The future made a very confident promise. <!-- AUDIO_CUE: laugh -->";
    expect(extractNarration(script)).toBe("A serious fact lands here. The future made a very confident promise.");
    expect(extractNarrationForAudio(script)).toBe("A serious fact lands here. [chuckle] The future made a very confident promise. [laugh]");
    expect(countWords(extractNarration(script))).toBe(12);
    expect(countWords(extractNarrationForAudio(script))).toBe(12);
  });

  it("identifies legacy scripts that need the humor-policy pass", () => {
    expect(hasHumorPolicyMarker("# Script\n\nOld narration")).toBe(false);
    expect(hasHumorPolicyMarker("# Script\n\n<!-- HUMOR_POLICY: v1 -->\nNew narration")).toBe(true);
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
