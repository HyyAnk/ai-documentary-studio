import fs from "node:fs/promises";
import path from "node:path";
import type { HyperframesCheckReport } from "./hyperframesQuality.js";
import { actionableContrastFindings } from "./hyperframesQuality.js";

/**
 * Generates an accessibility and contrast-boosting CSS patch
 * based on findings reported by HyperFrames check.
 */
export function generateContrastSelfHealingCss(report: HyperframesCheckReport | null): string {
  const findings = actionableContrastFindings(report);
  const rules: string[] = [];

  // Always include foundational contrast boosts when healing is triggered
  rules.push(
    "/* Contrast Self-Healing Core Overrides */",
    ".keyword-highlight { color: #047857 !important; text-shadow: 0 1px 0 rgba(255,255,255,0.9) !important; font-weight: 900 !important; }",
    ".question-title h1 { color: #1e1b4b !important; text-shadow: 0 2px 0 rgba(255,255,255,0.9), 0 3px 0 rgba(16,35,75,0.12) !important; }",
    ".answer-card span, .visual-answer-label span { color: #0f172a !important; }",
    ".answer-card > b, .visual-answer-label > b { color: #0f172a !important; text-shadow: none !important; }",
    ".fact-card p { color: #1e293b !important; }",
    ".fact-card span { color: #0f766e !important; }",
    ".question-number-val { color: #ffffff !important; text-shadow: 0 3px 0 #1f0b02, 0 5px 12px rgba(0,0,0,0.75) !important; }",
    ".marker-val { color: #ffffff !important; text-shadow: 0 2px 4px rgba(0,0,0,0.85) !important; }",
    ".mini-badge { color: #ffffff !important; text-shadow: 0 1px 2px rgba(0,0,0,0.4) !important; }",
    ".choice span { color: #0f172a !important; }",
    ".badge-cta { color: #172a59 !important; border-color: #172a59 !important; }",
    ".badge-comment, .badge-like, .badge-sub { color: #172a59 !important; }"
  );

  // If specific text findings were reported, target elements specifically
  for (const finding of findings) {
    if (!finding.text) continue;
    const textSnippet = finding.text.trim().toLowerCase();
    if (textSnippet.length > 0) {
      rules.push(
        `/* Specific contrast boost for text "${finding.text}" */`,
        `[data-text*="${finding.text}" i] { color: #0f172a !important; text-shadow: 0 1px 0 #ffffff !important; }`
      );
    }
  }

  return rules.join("\n");
}

/**
 * Injects a contrast-healing CSS block into all HTML composition files in renderRoot.
 */
export async function patchCompositionFilesWithContrastFix(renderRoot: string, cssPatch: string): Promise<number> {
  const htmlFiles: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".html")) {
          htmlFiles.push(fullPath);
        }
      }
    } catch {
      // Directory may not exist or be accessible
    }
  }

  await scanDir(renderRoot);

  let patchedCount = 0;
  const patchBlock = `\n<style id="hyperframes-contrast-healer">\n${cssPatch}\n</style>\n`;

  for (const file of htmlFiles) {
    try {
      let content = await fs.readFile(file, "utf8");
      if (content.includes('id="hyperframes-contrast-healer"')) {
        // Replace existing patch
        content = content.replace(/<style id="hyperframes-contrast-healer">[\s\S]*?<\/style>/, patchBlock.trim());
      } else if (content.includes("</head>")) {
        content = content.replace("</head>", `${patchBlock}</head>`);
      } else if (content.includes("</body>")) {
        content = content.replace("</body>", `${patchBlock}</body>`);
      } else {
        content += patchBlock;
      }
      await fs.writeFile(file, content, "utf8");
      patchedCount++;
    } catch {
      // Continue to next file
    }
  }

  return patchedCount;
}

/**
 * Analyzes contrast report, generates healing CSS, and patches composition files.
 */
export async function healCompositionContrast(renderRoot: string, report: HyperframesCheckReport | null): Promise<boolean> {
  const cssPatch = generateContrastSelfHealingCss(report);
  const count = await patchCompositionFilesWithContrastFix(renderRoot, cssPatch);
  return count > 0;
}
