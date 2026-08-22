import { describe, expect, it } from "vitest";
import { isContentFilterError, extractFilterReason, sanitizePromptRuleBased } from "../src/utils/promptSanitizer.js";
import { RepositoryError } from "../src/repository.js";

describe("promptSanitizer", () => {
  it("identifies content filter errors correctly", () => {
    const error1 = new RepositoryError(
      "gpti2.store API failed (400): Your prompt was rejected by the content filter, which did not report a category. Common causes: violent or sexual wording, real people, or copyrighted characters. Rephrase and try again.",
      "IMAGE_CONTENT_FILTER_REJECTED",
    );
    expect(isContentFilterError(error1)).toBe(true);

    const error2 = new Error("Safety filter triggered: prompt violates policy");
    expect(isContentFilterError(error2)).toBe(true);

    const error3 = new Error("Connection timeout");
    expect(isContentFilterError(error3)).toBe(false);

    const error4 = new RepositoryError("Quota exceeded", "RATE_LIMIT_EXCEEDED");
    expect(isContentFilterError(error4)).toBe(false);
  });

  it("extracts filter reason from error", () => {
    const error = new Error("Your prompt was rejected by the content filter, which did not report a category.");
    expect(extractFilterReason(error)).toContain("rejected by the content filter");
  });

  it("scrubs obvious trigger words with rule-based sanitizer", () => {
    const prompt = "A bloody battlefield with dead soldiers and guns firing in combat.";
    const cleaned = sanitizePromptRuleBased(prompt);
    expect(cleaned).not.toContain("bloody");
    expect(cleaned).not.toContain("dead");
    expect(cleaned).not.toContain("guns");
    expect(cleaned).toContain("crimson-toned dramatic");
    expect(cleaned).toContain("fallen");
    expect(cleaned).toContain("cinematic prop");
  });
});
