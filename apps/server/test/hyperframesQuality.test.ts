import { describe, expect, it } from "vitest";
import { formatHyperframesCheckFailure, hasHyperframesContrastIssue, parseHyperframesCheckReport } from "../src/quiz/qa/hyperframesQuality.js";

describe("HyperFrames quality reporting", () => {
  it("turns a JSON contrast finding into an actionable render error", () => {
    const report = parseHyperframesCheckReport(`[INFO] compiler ready\n${JSON.stringify({
      ok: false,
      contrast: { findings: [{ severity: "error", message: "Contrast is 1.41:1; WCAG AA requires 3:1.", text: "✦", ratio: 1.41, requiredRatio: 3, time: 56.69 }] },
    })}`);

    expect(hasHyperframesContrastIssue(report)).toBe(true);
    expect(formatHyperframesCheckFailure(report)).toContain("“✦” at 56.69s");
    expect(formatHyperframesCheckFailure(report)).toContain("need 3.00:1");
  });

  it("does not block a successful check that only has non-contrast findings", () => {
    const report = parseHyperframesCheckReport(JSON.stringify({
      ok: true,
      lint: { findings: [{ severity: "warning", message: "Track is dense" }] },
      contrast: { findings: [] },
    }));

    expect(hasHyperframesContrastIssue(report)).toBe(false);
  });
});
