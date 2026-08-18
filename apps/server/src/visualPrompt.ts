/** Keep post-production disclosure and editorial graphics out of footage prompts. */
export function stripEditorialOverlayInstructions(prompt: string): string {
  return prompt
    .replace(/\s*lower-left(?:\s+label)?\s*(?::\s*)?`?\s*reconstruction\s*[—-]\s*ai\s+visualization`?\.?/gi, "")
    .replace(/\s*lower-right(?:\s+(?:label|evidence\s+marker))?\s*(?::\s*)?`?\s*(?:fact|fact\/inference|inference)[^.`\n]*`?\.?/gi, "")
    .replace(/\s*;?\s*causal\s+overlays?\s+labeled\s+`?[^`.\n]+`?\.?/gi, "")
    .replace(/,?\s*visible\s+reconstruction\s+labels?/gi, "")
    .replace(/\s+reconstruction\s+labels?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
