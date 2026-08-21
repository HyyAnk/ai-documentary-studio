export type ArtifactSectionKind = "sequence" | "question" | "continuity_bundle";

/**
 * Read the canonical numeric identifiers from second-level artifact headings.
 * The generators use headings such as `## Sequence 6 — ...` and
 * `## Continuity bundle CB-06 — ...`, but accepting the older `## 6. ...`
 * shape keeps existing episodes recoverable.
 */
export function extractArtifactSectionNumbers(markdown: string, kind: ArtifactSectionKind): number[] {
  const numbers: number[] = [];
  const headingPattern = /^##\s+([^\r\n]+)$/gim;
  for (const match of markdown.matchAll(headingPattern)) {
    const title = match[1]?.trim() ?? "";
    const number = parseArtifactSectionNumber(title, kind);
    if (number !== null) numbers.push(number);
  }
  return numbers;
}

export function missingArtifactSectionNumbers(markdown: string, expected: number[], kind: ArtifactSectionKind): number[] {
  const available = new Set(extractArtifactSectionNumbers(markdown, kind));
  return expected.filter((number) => !available.has(number));
}

export function formatArtifactSectionNumbers(numbers: number[]): string {
  return numbers.map((number) => String(number).padStart(2, "0")).join(", ");
}

export function parseArtifactSectionNumber(title: string, kind: ArtifactSectionKind): number | null {
  const match = kind === "continuity_bundle"
    ? title.match(/\bCB[-_ ]?0*(\d+)\b/i)
    : kind === "question"
      ? title.match(/^(?:question\s*)?0*(\d+)(?=\s|[.)—:-]|$)/i)
      : title.match(/^(?:(?:sequence|section|part)\s*)?0*(\d+)(?=\s|[.)—:-]|$)/i);
  const number = Number(match?.[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function contiguousArtifactNumbers(numbers: number[]): boolean {
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  return unique.every((number, index) => number === index + 1);
}
