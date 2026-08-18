import { describe, expect, it } from "vitest";
import { stripEditorialOverlayInstructions } from "../src/visualPrompt.js";

describe("visual prompt sanitization", () => {
  it("removes disclosure and evidence markers from footage prompts", () => {
    const prompt = "ATMOSPHERE\n12% grain. Lower-left: `RECONSTRUCTION — AI VISUALIZATION`. Lower-right evidence marker FACT — C05. CONTINUITY\nKeep the road stable.";
    const clean = stripEditorialOverlayInstructions(prompt);

    expect(clean).not.toMatch(/AI VISUALIZATION|Lower-left|Lower-right|evidence marker|FACT —/i);
    expect(clean).toContain("CONTINUITY");
  });

  it("removes causal overlay instructions without touching the visual action", () => {
    const prompt = "ACTION\nVehicles enter the prepared lane. CONTINUITY\nKeep the causal overlays labeled `INFERENCE — C08/C11`.";
    const clean = stripEditorialOverlayInstructions(prompt);

    expect(clean).toContain("Vehicles enter the prepared lane");
    expect(clean).not.toMatch(/causal overlays|INFERENCE/i);
  });
});
