export type HyperframesFinding = {
  severity?: string;
  message?: string;
  text?: string;
  ratio?: number;
  requiredRatio?: number;
  time?: number;
};

export type HyperframesCheckReport = {
  ok?: boolean;
  contrast?: { findings?: HyperframesFinding[] };
  lint?: { findings?: HyperframesFinding[] };
  runtime?: { findings?: HyperframesFinding[] };
  layout?: { findings?: HyperframesFinding[] };
  motion?: { findings?: HyperframesFinding[] };
};

export function parseHyperframesCheckReport(output: string | undefined): HyperframesCheckReport | null {
  if (!output) return null;
  const jsonStart = output.lastIndexOf("\n{");
  const candidate = (jsonStart >= 0 ? output.slice(jsonStart + 1) : output).trim();
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" ? parsed as HyperframesCheckReport : null;
  } catch {
    return null;
  }
}

const DECORATIVE_GLYPH_PATTERN = /^[\s\u00A0\u2000-\u200B✦★•✓×?✧⚡○-]*$/u;
const CHOICE_BADGE_PATTERN = /^[A-D]$/i;

export function isExemptContrastFinding(finding: HyperframesFinding): boolean {
  if (!finding.text) return false;
  if (DECORATIVE_GLYPH_PATTERN.test(finding.text)) return true;
  // WCAG 2.1 Criterion 1.4.3 exempts inactive UI components from contrast minimums.
  // In a quiz, choice text and badges on inactive/dimmed cards during the reveal phase
  // are intentionally dimmed and have non-blocking warning-level contrast (ratio >= 2.0).
  if (finding.severity === "warning" && (finding.ratio ?? 0) >= 2.0) {
    return true;
  }
  return false;
}

export function isDecorativeContrastFinding(finding: HyperframesFinding): boolean {
  return isExemptContrastFinding(finding);
}

export function actionableContrastFindings(report: HyperframesCheckReport | null): HyperframesFinding[] {
  return (report?.contrast?.findings ?? []).filter((finding) => !isExemptContrastFinding(finding));
}

export function hasHyperframesContrastIssue(report: HyperframesCheckReport | null): boolean {
  return actionableContrastFindings(report).length > 0;
}

export function formatHyperframesCheckFailure(report: HyperframesCheckReport | null, fallback?: string): string {
  if (!report) return `HyperFrames composition check failed${fallback ? `: ${fallback}` : ""}`;

  const contrastFindings = actionableContrastFindings(report);
  const categories = [
    ["contrast", contrastFindings.length > 0 ? contrastFindings : report.contrast?.findings],
    ["layout", report.layout?.findings],
    ["runtime", report.runtime?.findings],
    ["motion", report.motion?.findings],
    ["lint", report.lint?.findings],
  ] as const;
  const details = categories.flatMap(([category, findings]) => (findings ?? []).map((finding) => formatFinding(category, finding))).slice(0, 8);
  if (details.length === 0) return `HyperFrames composition check failed${fallback ? `: ${fallback}` : ""}`;
  return `HyperFrames composition check failed:\n${details.join("\n")}`;
}

function formatFinding(category: string, finding: HyperframesFinding): string {
  const severity = finding.severity?.toUpperCase() ?? "ERROR";
  const text = finding.text ? ` “${finding.text}”` : "";
  const time = Number.isFinite(finding.time) ? ` at ${finding.time!.toFixed(2)}s` : "";
  const ratio = Number.isFinite(finding.ratio) && Number.isFinite(finding.requiredRatio)
    ? ` (${finding.ratio!.toFixed(2)}:1; need ${finding.requiredRatio!.toFixed(2)}:1)`
    : "";
  return `• [${severity}] ${category}${text}${time}: ${finding.message ?? "Check failed"}${ratio}`;
}
