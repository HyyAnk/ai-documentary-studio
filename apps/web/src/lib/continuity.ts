export type ContinuityBundle = {
  bundle_id: string;
  bundle_number: number;
  title: string;
  section: string;
  anchor_prompt: string;
};

export function parseContinuityBundles(markdown: string): ContinuityBundle[] {
  const heading = /^##\s+Continuity bundle\s+(CB-(\d{2,}))(?:\s*[—-]\s*(.*))?\s*$/gim;
  const matches = [...markdown.matchAll(heading)];
  return matches.map((match, index) => {
    const section = markdown.slice(match.index ?? 0, matches[index + 1]?.index ?? markdown.length).trim();
    const nextField = "\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?[A-Z][^\\n:]{1,80}(?:\\*\\*)?\\s*:";
    const anchor = section.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?Anchor-frame prompt(?:\\*\\*)?\\s*:\\s*([\\s\\S]*?)(?=${nextField}|\\n##\\s|$)`, "i"))?.[1]?.trim().replace(/\s+/g, " ") ?? "";
    return { bundle_id: match[1].toUpperCase(), bundle_number: Number(match[2]), title: match[3]?.trim() || match[1].toUpperCase(), section, anchor_prompt: anchor };
  }).filter((bundle) => Number.isInteger(bundle.bundle_number) && bundle.anchor_prompt.length > 0);
}
