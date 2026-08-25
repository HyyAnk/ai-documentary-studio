/**
 * Speech Text Normalizer and Sanitizer
 *
 * Normalizes script and dialogue text into voice-safe spoken forms before TTS synthesis.
 * Eliminates accidental pause/sentence breaks caused by periods in abbreviations,
 * scientific names (e.g. "T. rex" -> "T-rex"), honorifics, titles, and common acronyms.
 */

/**
 * Normalizes abbreviations, titles, scientific names, and acronyms to prevent TTS engines
 * from reading them disjointedly or mistaking periods for sentence boundaries.
 */
export function sanitizeTextForSpeech(text: string): string {
  if (!text) return "";

  let spoken = text;

  // 1. Specific multi-letter or multi-dot abbreviations (MUST run before generic single-letter rule)
  // Note: Avoid trailing \b after a period '.' because '.' is not a word character.
  spoken = spoken
    .replace(/\bv\.v\.(\.)?(?=\s|[.,!?;:]|$)/gi, "vân vân")
    .replace(/\bv\.\.\.v\.\.\.(?=\s|[.,!?;:]|$)/gi, "vân vân")
    .replace(/\be\.g\.,?\s*/gi, "for example, ")
    .replace(/\bi\.e\.,?\s*/gi, "that is, ")
    .replace(/\betc\.(?=\s|[.,!?;:]|$)/gi, "et cetera")
    .replace(/\bvs\.(?=\s|[.,!?;:]|$)/gi, "versus")
    .replace(/\bU\.S\.A\.(?=\s|[.,!?;:]|$)/gi, "USA")
    .replace(/\bU\.S\.(?=\s|[.,!?;:]|$)/gi, "US")
    .replace(/\bU\.K\.(?=\s|[.,!?;:]|$)/gi, "UK")
    .replace(/\bNo\.\s*(\d+)/gi, "Number $1");

  // 2. English titles and honorifics
  spoken = spoken
    .replace(/\bDr\.\s*/gi, "Doctor ")
    .replace(/\bMr\.\s*/gi, "Mister ")
    .replace(/\bMrs\.\s*/gi, "Missus ")
    .replace(/\bMs\.\s*/gi, "Miss ")
    .replace(/\bProf\.\s*/gi, "Professor ")
    .replace(/\bSt\.\s+/gi, "Saint ");

  // 3. Vietnamese titles, degrees, and abbreviations
  spoken = spoken
    .replace(/\bTS\.\s*/g, "Tiến sĩ ")
    .replace(/\bThS\.\s*/g, "Thạc sĩ ")
    .replace(/\bPGS\.\s*/g, "Phó Giáo sư ")
    .replace(/\bGS\.\s*/g, "Giáo sư ")
    .replace(/\bBS\.\s*/g, "Bác sĩ ")
    .replace(/\bTP\.\s*HCM(?=\s|[.,!?;:]|$)/gi, "Thành phố Hồ Chí Minh")
    .replace(/\bTP\.\s*Hà Nội(?=\s|[.,!?;:]|$)/gi, "Thành phố Hà Nội")
    .replace(/\bTP\.\s*/g, "Thành phố ");

  // 4. Scientific & single-letter abbreviations (e.g. "T. rex" -> "T-rex", "E. coli" -> "E-coli", "C. elegans" -> "C-elegans")
  spoken = spoken.replace(/(?:^|(?<=[\s"'(]))([A-Za-z])\.\s*([a-zA-Z]+)\b/g, "$1-$2");

  return spoken.replace(/\s+/g, " ").trim();
}

/**
 * Smart boundary splitter that breaks text into performance phrases
 * without splitting single-letter initials, known abbreviations, or decimals.
 */
export function splitSmartPunctuationPhrases(text: string): string[] {
  const sanitized = sanitizeTextForSpeech(text);
  if (!sanitized) return [];

  // Split on punctuation followed by whitespace, avoiding splitting within decimals (e.g. 3.14)
  const parts = sanitized
    .split(/(?<!\d)(?<=[.?!,;:])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 1 ? parts : [sanitized];
}
