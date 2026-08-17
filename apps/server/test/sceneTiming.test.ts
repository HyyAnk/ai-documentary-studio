import { describe, expect, it } from "vitest";
import { packBeatsIntoScenes, type Beat } from "../src/sceneTiming.js";

const beat = (dialogue: string, continuity_key: string): Beat => ({
  dialogue,
  visual_prompt: `CAMERA\n${continuity_key} shot`,
  continuity_key,
  transition_note: "",
  continuity_note: `Keep ${continuity_key} continuity`,
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
});
