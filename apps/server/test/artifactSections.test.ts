import { describe, expect, it } from "vitest";
import { extractArtifactSectionNumbers, missingArtifactSectionNumbers } from "../src/artifactSections.js";

describe("artifact section numbering", () => {
  it("keeps sequence and question numbering distinct", () => {
    const markdown = "## Sequence 1 — Opening\n\n## Question 2 — Reveal\n\n## 3. Closing";

    expect(extractArtifactSectionNumbers(markdown, "sequence")).toEqual([1, 3]);
    expect(extractArtifactSectionNumbers(markdown, "question")).toEqual([2, 3]);
  });

  it("reports the exact continuity bundle IDs missing from an upstream artifact", () => {
    const markdown = "## Continuity bundle CB-01 — One\n\n## Continuity bundle CB-05 — Five";

    expect(missingArtifactSectionNumbers(markdown, [1, 2, 3, 4, 5, 6], "continuity_bundle")).toEqual([2, 3, 4, 6]);
  });

  it("recognizes level 3 headings and alternate bundle number shapes", () => {
    const markdown = "### Continuity bundle CB-1: First\n\n### Continuity bundle CB_03 — Third\n\n### Question 4 — Fourth";

    expect(extractArtifactSectionNumbers(markdown, "continuity_bundle")).toEqual([1, 3]);
    expect(extractArtifactSectionNumbers(markdown, "question")).toEqual([4]);
  });
});
