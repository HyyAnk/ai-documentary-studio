import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateContrastSelfHealingCss, healCompositionContrast, patchCompositionFilesWithContrastFix } from "../src/quiz/qa/contrastHealer.js";
import type { HyperframesCheckReport } from "../src/quiz/qa/hyperframesQuality.js";

describe("Contrast Self-Healing & Auto-Correction", () => {
  it("generates core contrast-boosting CSS rules for accessibility", () => {
    const report: HyperframesCheckReport = {
      ok: false,
      contrast: {
        findings: [
          { severity: "error", message: "Contrast is 1.85:1; WCAG AA requires 3:1.", text: "space", ratio: 1.85, requiredRatio: 3, time: 50.75 },
        ],
      },
    };

    const css = generateContrastSelfHealingCss(report);
    expect(css).toContain(".keyword-highlight { color: #047857 !important;");
    expect(css).toContain(".answer-card:nth-child(4n+1) span, .visual-answer-card:nth-child(4n+1) span { color: #78350F !important;");
    expect(css).toContain(".answer-card > b, .visual-answer-label > b { color: #ffffff !important;");
    expect(css).toContain(".badge-comment, .badge-like, .badge-sub { color: #172a59 !important;");
    expect(css).toContain('[data-text*="space" i]');
  });

  it("patches HTML composition files in a directory hierarchy", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contrast-healer-test-"));
    try {
      const subDir = path.join(tempDir, "compositions");
      await fs.mkdir(subDir, { recursive: true });

      const indexHtml = path.join(tempDir, "index.html");
      const sceneHtml = path.join(subDir, "scene-1.html");

      await fs.writeFile(indexHtml, "<html><head><title>Test</title></head><body><main>Root</main></body></html>", "utf8");
      await fs.writeFile(sceneHtml, "<html><head><style>.old{}</style></head><body><main>Scene</main></body></html>", "utf8");

      const cssPatch = ".keyword-highlight { color: #047857 !important; }";
      const patchedCount = await patchCompositionFilesWithContrastFix(tempDir, cssPatch);

      expect(patchedCount).toBe(2);

      const updatedIndex = await fs.readFile(indexHtml, "utf8");
      const updatedScene = await fs.readFile(sceneHtml, "utf8");

      expect(updatedIndex).toContain('<style id="hyperframes-contrast-healer">');
      expect(updatedIndex).toContain(".keyword-highlight { color: #047857 !important; }");
      expect(updatedScene).toContain('<style id="hyperframes-contrast-healer">');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("runs healCompositionContrast end-to-end and updates composition files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contrast-healer-e2e-"));
    try {
      const htmlFile = path.join(tempDir, "index.html");
      await fs.writeFile(htmlFile, "<html><head></head><body><p>Hello</p></body></html>", "utf8");

      const report: HyperframesCheckReport = {
        ok: false,
        contrast: {
          findings: [
            { severity: "error", message: "Contrast is 1.85:1; WCAG AA requires 3:1.", text: "space", ratio: 1.85, requiredRatio: 3 },
          ],
        },
      };

      const result = await healCompositionContrast(tempDir, report);
      expect(result).toBe(true);

      const content = await fs.readFile(htmlFile, "utf8");
      expect(content).toContain('id="hyperframes-contrast-healer"');
      expect(content).toContain(".keyword-highlight { color: #047857 !important;");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
