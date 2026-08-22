export type ContinuityBundle = {
  bundle_id: string;
  bundle_number: number;
  title: string;
  section: string;
  anchor_prompt: string;
};

const bundleHeading = /^#{2,3}\s+Continuity bundle\s+(CB[-_ ]?0*(\d+))(?:\s*[:.—-]\s*(.*))?\s*$/gim;

export function parseContinuityBundles(markdown: string): ContinuityBundle[] {
  const matches = [...markdown.matchAll(bundleHeading)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end).trim();
    const bundleNumber = Number(match[2]);
    const bundleId = continuityBundleId(bundleNumber);
    const prompt = extractLabeledField(section, "Anchor-frame prompt");
    return {
      bundle_id: bundleId,
      bundle_number: bundleNumber,
      title: match[3]?.trim() || bundleId,
      section,
      anchor_prompt: prompt,
    };
  }).filter((bundle) => Number.isInteger(bundle.bundle_number) && bundle.anchor_prompt.length > 0);
}

function extractLabeledField(section: string, label: string): string {
  const variations = [label, label.replace(/-/g, " "), label.replace(/-frame/i, "")];
  const pattern = variations.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const nextFieldPattern = "\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:Reference asset slots|Allowed (?:shot|camera)?\\s*variation|Era|Setting|Location|Subjects|Objects|Wardrobe|Palette|Lighting|Texture|Atmosphere|Continuity bundle)(?:\\*\\*)?\\s*:";
  const match = section.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${pattern})(?:\\*\\*)?\\s*:\\s*([\\s\\S]*?)(?=${nextFieldPattern}|\\n#{2,3}\\s|$)`, "i"));
  let text = match?.[1]?.trim() ?? "";
  const codeBlock = text.match(/^```(?:[a-z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/i);
  if (codeBlock) text = codeBlock[1].trim();
  return text.replace(/\s+/g, " ");
}

export function continuityBundleId(bundleNumber: number): string {
  return `CB-${String(bundleNumber).padStart(2, "0")}`;
}

export function replaceBundleAnchorPrompt(markdown: string, bundleNumber: number, newPrompt: string): string {
  const matches = [...markdown.matchAll(bundleHeading)];
  const targetIndex = matches.findIndex((m) => Number(m[2]) === bundleNumber);
  if (targetIndex === -1) return markdown;

  const match = matches[targetIndex];
  const start = match.index ?? 0;
  const end = matches[targetIndex + 1]?.index ?? markdown.length;
  const section = markdown.slice(start, end);

  const variations = ["Anchor-frame prompt", "Anchor frame prompt", "Anchor prompt"];
  const pattern = variations.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const nextFieldPattern = "\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:Reference asset slots|Allowed (?:shot|camera)?\\s*variation|Era|Setting|Location|Subjects|Objects|Wardrobe|Palette|Lighting|Texture|Atmosphere|Continuity bundle)(?:\\*\\*)?\\s*:";

  const regex = new RegExp(`((?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${pattern})(?:\\*\\*)?\\s*:\\s*)([\\s\\S]*?)(?=${nextFieldPattern}|\\n#{2,3}\\s|$)`, "i");

  if (!regex.test(section)) return markdown;

  const updatedSection = section.replace(regex, `$1${newPrompt}\n`);
  return markdown.slice(0, start) + updatedSection + markdown.slice(end);
}
