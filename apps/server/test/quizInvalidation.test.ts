import { describe, expect, it } from "vitest";
import { invalidateQuizArtifacts } from "../src/quiz/pipeline/invalidation.js";

describe("Quiz V2 invalidation graph", () => {
  it("invalidates only downstream artifacts", () => {
    expect(invalidateQuizArtifacts("quiz")).toEqual(["director", "assets", "voice", "timeline", "render", "qa"]);
    expect(invalidateQuizArtifacts("assets")).toEqual(["render", "qa"]);
    expect(invalidateQuizArtifacts("timeline")).toEqual(["render", "qa"]);
    expect(invalidateQuizArtifacts("qa")).toEqual([]);
  });
});
