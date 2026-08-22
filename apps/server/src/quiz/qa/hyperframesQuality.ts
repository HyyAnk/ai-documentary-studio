type HyperframesFinding = {
  severity?: string;
  message?: string;
  text?: string;
  ratio?: number;
  requiredRatio?: number;
  time?: number;
};

type HyperframesCheckReport = {
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

export function hasHyperframesContrastIssue(report: HyperframesCheckReport | null): boolean {
  return (report?.contrast?.findings?.length ?? 0) > 0;
}

export function formatHyperframesCheckFailure(report: HyperframesCheckReport | null, fallback?: string): string {
  if (!report) return `HyperFrames composition check failed${fallback ? `: ${fallback}` : ""}`;

  const categories = [
    ["contrast", report.contrast?.findings],
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
