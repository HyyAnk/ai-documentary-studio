export type ContinuityBundle = {
  bundle_id: string;
  bundle_number: number;
  title: string;
  section: string;
  anchor_prompt: string;
};

export function parseContinuityBundles(markdown: string): ContinuityBundle[] {
  const heading = /^#{2,3}\s+Continuity bundle\s+(CB[-_ ]?0*(\d+))(?:\s*[:.—-]\s*(.*))?\s*$/gim;
  const matches = [...markdown.matchAll(heading)];
  return matches.map((match, index) => {
    const section = markdown.slice(match.index ?? 0, matches[index + 1]?.index ?? markdown.length).trim();
    const nextFieldPattern = "\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:Reference asset slots|Allowed (?:shot|camera)?\\s*variation|Era|Setting|Location|Subjects|Objects|Wardrobe|Palette|Lighting|Texture|Atmosphere|Continuity bundle)(?:\\*\\*)?\\s*:";
    const variations = ["Anchor-frame prompt", "Anchor frame prompt", "Anchor prompt"];
    const pattern = variations.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const matchAnchor = section.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${pattern})(?:\\*\\*)?\\s*:\\s*([\\s\\S]*?)(?=${nextFieldPattern}|\\n#{2,3}\\s|$)`, "i"));
    let anchor = matchAnchor?.[1]?.trim() ?? "";
    const codeBlock = anchor.match(/^```(?:[a-z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/i);
    if (codeBlock) anchor = codeBlock[1].trim();
    anchor = anchor.replace(/\s+/g, " ");
    const bundleNumber = Number(match[2]);
    const bundleId = `CB-${String(bundleNumber).padStart(2, "0")}`;
    return { bundle_id: bundleId, bundle_number: bundleNumber, title: match[3]?.trim() || bundleId, section, anchor_prompt: anchor };
  }).filter((bundle) => Number.isInteger(bundle.bundle_number) && bundle.anchor_prompt.length > 0);
}
