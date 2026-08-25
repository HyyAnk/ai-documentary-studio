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

export const NO_SPLIT_AFTER_WORDS = new Set([
  // English intensifiers & degree modifiers (MUST stay attached to adjective/adverb)
  "too", "very", "so", "more", "most", "less", "least", "really", "quite", "pretty",
  "extremely", "super", "fairly", "highly", "deeply", "terribly", "awfully", "hardly",
  "nearly", "almost", "just", "much", "way", "far",
  // Vietnamese intensifiers & degree modifiers (MUST stay attached to adjective/adverb)
  "quá", "rất", "cực", "vô", "hết", "khá", "hơi", "thật", "càng", "quá_đỗi", "thêm",
  // English determiners & articles (MUST stay attached to noun/modifier)
  "the", "a", "an", "this", "that", "these", "those", "my", "your", "his", "her",
  "its", "our", "their", "each", "every", "all", "some", "any", "no", "both",
  "neither", "either", "another", "such",
  // Vietnamese determiners & classifiers (MUST stay attached to noun/modifier)
  "những", "các", "mỗi", "từng", "mọi", "một", "hai", "ba", "bốn", "năm",
  "con", "cái", "chiếc", "loài", "loại", "người", "vật", "tấm", "bức", "cây", "quả", "trái",
  // English prepositions (MUST stay attached to complement noun phrase)
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "about", "into",
  "onto", "through", "over", "under", "between", "among", "behind", "across",
  "without", "like", "as", "during", "before", "after", "than", "upon", "within", "towards",
  // Vietnamese prepositions (MUST stay attached to complement noun phrase)
  "ở", "tại", "trên", "trong", "dưới", "cho", "với", "của", "bởi", "từ",
  "đến", "vào", "qua", "giữa", "như", "về", "cùng", "bằng", "trước", "sau", "theo",
  // Auxiliaries & modal / tense markers
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "is", "are", "am", "was", "were", "do", "does", "did", "have", "has", "had",
  "đã", "sẽ", "đang", "vừa", "mới", "sắp", "cần", "phải", "được", "bị", "hãy", "chớ", "đừng", "nên",
]);

export const NO_SPLIT_BEFORE_WORDS = new Set([
  // Vietnamese post-modifiers & question/exclamation particles
  "nhất", "hơn", "quá", "lắm", "nào", "gì", "sao", "nhỉ", "nhé", "hả", "chăng", "thay",
  // English post-modifiers & particles
  "enough", "ago", "away", "apart",
]);

/**
 * Validates whether a natural speech pause/split is grammatically allowed between two adjacent words.
 * Returns false if left word is an intensifier/article/preposition or right word is a bound particle.
 */
export function canSplitBetweenWords(left: string, right: string): boolean {
  const cleanLeft = left.replace(/^[^A-Za-zÀ-ỹ0-9]+|[^A-Za-zÀ-ỹ0-9]+$/g, "").toLowerCase();
  const cleanRight = right.replace(/^[^A-Za-zÀ-ỹ0-9]+|[^A-Za-zÀ-ỹ0-9]+$/g, "").toLowerCase();
  if (!cleanLeft || !cleanRight) return true;
  if (NO_SPLIT_AFTER_WORDS.has(cleanLeft)) return false;
  if (NO_SPLIT_BEFORE_WORDS.has(cleanRight)) return false;
  return true;
}

