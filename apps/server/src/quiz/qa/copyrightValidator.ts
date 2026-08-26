export type CopyrightViolation = {
  violated: boolean;
  category?: "LION_CUB" | "MARVEL_SUPERHERO" | "DC_SUPERHERO" | "GAME_IP" | "DISNEY_CORE";
  term?: string;
  reason?: string;
  questionNumber?: number;
};

export type CopyrightPatternDef = {
  pattern: RegExp;
  category: CopyrightViolation["category"];
  reason: string;
};

export const STRICT_COPYRIGHT_PATTERNS: CopyrightPatternDef[] = [
  // 1. Lion Cubs / The Lion King (Banned in any context, including nature/baby animal quizzes)
  {
    pattern: /(?:^|[^\p{L}\p{N}_])(sư\s+tử\s+con|lion\s+cubs?|baby\s+lions?|simba|vua\s+sư\s+tử|the\s+lion\s+king|mufasa|scar|timon|pumbaa)(?:$|[^\p{L}\p{N}_])/iu,
    category: "LION_CUB",
    reason: "Phrase 'lion cub' or 'Simba/The Lion King' is copyright-sensitive and strictly blocked by AI Image Filters.",
  },

  // 2. Marvel Superheroes
  {
    pattern: /(?:^|[^\p{L}\p{N}_])(spider[- ]?man|người\s+nhện|iron[- ]?man|người\s+sắt|captain\s+america|khổng\s+lồ\s+xanh|thần\s+sấm\s+thor|thor|hulk|thanos|wolverine|deadpool|doctor\s+strange|black\s+panther|avengers|groot)(?:$|[^\p{L}\p{N}_])/iu,
    category: "MARVEL_SUPERHERO",
    reason: "Marvel superhero characters violate copyright policy and are blocked by AI Image Filters.",
  },

  // 3. DC Superheroes
  {
    pattern: /(?:^|[^\p{L}\p{N}_])(batman|người\s+dơi|bruce\s+wayne|superman|siêu\s+nhân\s+(?:clark|dơi|nhện|sắt|gao)?|clark\s+kent|wonder\s+woman|nữ\s+thần\s+chiến\s+binh|joker|harley\s+quinn|the\s+flash|tia\s+chớp\s+flash|aquaman|green\s+lantern|justice\s+league)(?:$|[^\p{L}\p{N}_])/iu,
    category: "DC_SUPERHERO",
    reason: "DC superhero characters violate copyright policy and are blocked by AI Image Filters.",
  },

  // 4. Video Game Characters & Brands (Nintendo, Pokemon, Sega, Mojang...)
  {
    pattern: /(?:^|[^\p{L}\p{N}_])(pikachu|pok[eé]mon|pok[eé]ball|mario|nấm\s+lùn\s+mario|luigi|bowser|nhím\s+sonic|sonic|minecraft|creeper|roblox|fortnite|pac[- ]?man)(?:$|[^\p{L}\p{N}_])/iu,
    category: "GAME_IP",
    reason: "Video game characters (Game IPs) violate copyright policy and are blocked by AI Image Filters.",
  },

  // 5. Classic Disney/Pixar Characters
  {
    pattern: /(?:^|[^\p{L}\p{N}_])(mickey\s+mouse|chuột\s+mickey|donald\s+duck|vịt\s+donald|nữ\s+hoàng\s+băng\s+giá\s+elsa|elsa|olaf)(?:$|[^\p{L}\p{N}_])/iu,
    category: "DISNEY_CORE",
    reason: "Classic Disney characters are strictly moderated and blocked by AI Image Filters.",
  },
];

/**
 * Quét chuỗi văn bản để tìm vi phạm từ khóa bản quyền cấm.
 * LƯU Ý: Anime/Manga (Naruto, Goku, Doraemon, One Piece, Conan...) và "Sư tử" trưởng thành hoàn toàn hợp lệ.
 */
export function validateTextCopyright(text: string): CopyrightViolation {
  if (!text || !text.trim()) return { violated: false };

  for (const def of STRICT_COPYRIGHT_PATTERNS) {
    const match = text.match(def.pattern);
    if (match) {
      return {
        violated: true,
        category: def.category,
        term: match[1] || match[0],
        reason: def.reason,
      };
    }
  }

  return { violated: false };
}

/**
 * Kiểm tra kịch bản Quiz Markdown xem có câu hỏi nào chứa từ khóa cấm hay không.
 * Trả về thông tin vi phạm kèm theo số thứ tự câu hỏi để phục vụ re-prompt đích danh.
 */
export function validateQuizScriptCopyright(markdown: string): CopyrightViolation {
  if (!markdown || !markdown.trim()) return { violated: false };

  // Tách từng block câu hỏi: ## Question 1, ## Question 2... hoặc Question 1:
  const questionBlocks = markdown.split(/(?=^#{2,3}\s+Question\s+\d+|^Question\s+\d+[:.—])/gim);

  for (const block of questionBlocks) {
    const headingMatch = block.match(/(?:^#{2,3}\s+Question\s+|^Question\s+)(\d+)\b/im);
    const qNum = headingMatch ? Number(headingMatch[1]) : undefined;

    const check = validateTextCopyright(block);
    if (check.violated) {
      return {
        ...check,
        questionNumber: qNum,
      };
    }
  }

  return { violated: false };
}

/**
 * Kiểm tra tài liệu Research Quiz Markdown xem có claim hay ledger entry nào vi phạm không.
 */
export function validateQuizResearchCopyright(markdown: string): CopyrightViolation {
  return validateQuizScriptCopyright(markdown);
}
