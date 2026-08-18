export type ContinuityBundle = {
  bundle_id: string;
  bundle_number: number;
  title: string;
  section: string;
  anchor_prompt: string;
};

const bundleHeading = /^##\s+Continuity bundle\s+(CB-(\d{2,}))(?:\s*[—-]\s*(.*))?\s*$/gim;

export function parseContinuityBundles(markdown: string): ContinuityBundle[] {
  const matches = [...markdown.matchAll(bundleHeading)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end).trim();
    const bundleId = match[1].toUpperCase();
    const prompt = extractLabeledField(section, "Anchor-frame prompt");
    return {
      bundle_id: bundleId,
      bundle_number: Number(match[2]),
      title: match[3]?.trim() || bundleId,
      section,
      anchor_prompt: prompt,
    };
  }).filter((bundle) => Number.isInteger(bundle.bundle_number) && bundle.anchor_prompt.length > 0);
}

function extractLabeledField(section: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?[A-Z][^\\n:]{1,80}(?:\\*\\*)?\\s*:|\\n##\\s|$)`, "i"));
  return match?.[1]?.trim().replace(/\s+/g, " ") ?? "";
}

export function continuityBundleId(bundleNumber: number): string {
  return `CB-${String(bundleNumber).padStart(2, "0")}`;
}
