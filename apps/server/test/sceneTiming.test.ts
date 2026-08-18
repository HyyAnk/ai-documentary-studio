import { describe, expect, it } from "vitest";
import { packBeatsIntoScenes, type Beat } from "../src/sceneTiming.js";

const beat = (dialogue: string, continuity_key: string): Beat => ({
  dialogue,
  visual_prompt: `CAMERA\n${continuity_key} shot`,
  continuity_key,
  transition_note: "",
  continuity_note: `Keep ${continuity_key} continuity`,
  sequence_id: "sequence-1",
  sequence_title: "Sequence 1",
  shot_id: `shot-${continuity_key}`,
  asset_type: "ai_reconstruction",
  continuity_bundle_id: "CB-01",
  reference_asset_ids: [],
  source_ids: ["C01"],
  reconstruction: true,
  sound_cue: "",
  editorial_overlay: { kind: "none", text: "", motion: "none", placement: "lower_third", duration_seconds: null, data: [], source_ids: [] },
});

describe("scene timing", () => {
  it("packs matching continuity until the duration budget is full", () => {
    const scenes = packBeatsIntoScenes([
      beat("one two three four five six seven eight", "factory"),
      beat("nine ten eleven twelve thirteen fourteen fifteen sixteen", "factory"),
      beat("seventeen eighteen nineteen twenty", "street"),
    ], 8, 2.3, "episode_1");

    expect(scenes).toHaveLength(2);
    expect(scenes[0].dialogue).toContain("sixteen");
    expect(scenes[1].dialogue).toBe("seventeen eighteen nineteen twenty");
    expect(scenes[0].visual_prompt).toContain("SHOT PLAN");
    expect(scenes[0].visual_prompt).toContain("3.5s HARD CUT");
    expect(scenes[0].visual_prompt).toContain("7.0s total");
    expect(scenes.every((scene) => scene.duration_seconds <= 8)).toBe(true);
  });

  it("never combines different continuity keys", () => {
    const scenes = packBeatsIntoScenes([
      beat("one two", "same-place"),
      beat("three four", "new-place"),
    ], 8, 2.3, "episode_1");

    expect(scenes).toHaveLength(2);
    expect(scenes.map((scene) => scene.dialogue)).toEqual(["one two", "three four"]);
  });

  it("splits a beat that exceeds the scene limit", () => {
    const dialogue = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
    const scenes = packBeatsIntoScenes([beat(dialogue, "long-shot")], 4, 2.3, "episode_1");

    expect(scenes.length).toBeGreaterThan(1);
    expect(scenes.every((scene) => scene.duration_seconds <= 4)).toBe(true);
    expect(scenes.map((scene) => scene.dialogue).join(" ")).toBe(dialogue);
  });

  it("keeps editorial overlays separate from the footage prompt", () => {
    const scenes = packBeatsIntoScenes([{ ...beat("In 1956 the program changed", "timeline"), editorial_overlay: { kind: "timeline", text: "1956 — Firebird II", motion: "draw_on", placement: "upper_left", duration_seconds: 3, data: [], source_ids: ["C01"] } }], 8, 2.3, "episode_1");

    expect(scenes[0].visual_prompt).not.toContain("AI VISUALIZATION");
    expect(scenes[0].editorial_overlay).toMatchObject({ kind: "timeline", text: "1956 — Firebird II", motion: "draw_on" });
  });
});
