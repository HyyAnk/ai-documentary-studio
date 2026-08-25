import { describe, expect, it } from "vitest";
import { sanitizeTextForSpeech, splitSmartPunctuationPhrases, canSplitBetweenWords } from "../src/utils/speechSanitizer.js";
import { performancePhrases, splitPunctuationPhrases } from "../src/quiz/audio/voicePlan.js";
import { splitAtNarrativeBoundaries } from "../src/production.js";

describe("Speech Sanitizer & Text Normalization", () => {
  describe("sanitizeTextForSpeech", () => {
    it("normalizes single-letter scientific abbreviations like T. rex and E. coli into hyphenated spoken words", () => {
      expect(sanitizeTextForSpeech("Khủng long T. rex là loài săn mồi đỉnh cao.")).toBe("Khủng long T-rex là loài săn mồi đỉnh cao.");
      expect(sanitizeTextForSpeech("T. Rex and E. coli and C. elegans are studied.")).toBe("T-Rex and E-coli and C-elegans are studied.");
      expect(sanitizeTextForSpeech("Loài T. rex có lực cắn rất mạnh.")).toBe("Loài T-rex có lực cắn rất mạnh.");
    });

    it("normalizes English titles, honorifics, and abbreviations", () => {
      expect(sanitizeTextForSpeech("Dr. Watson and Mr. Holmes met Mrs. Hudson.")).toBe("Doctor Watson and Mister Holmes met Missus Hudson.");
      expect(sanitizeTextForSpeech("Prof. Charles lives in St. Louis.")).toBe("Professor Charles lives in Saint Louis.");
      expect(sanitizeTextForSpeech("Cats vs. dogs, e.g., playful pets, i.e., good companions etc.")).toBe("Cats versus dogs, for example, playful pets, that is, good companions et cetera");
      expect(sanitizeTextForSpeech("Episode No. 1 is in the U.S. and U.K. today.")).toBe("Episode Number 1 is in the US and UK today.");
    });

    it("normalizes Vietnamese academic titles, degrees, and abbreviations", () => {
      expect(sanitizeTextForSpeech("Báo cáo của TS. Hùng và ThS. Lan.")).toBe("Báo cáo của Tiến sĩ Hùng và Thạc sĩ Lan.");
      expect(sanitizeTextForSpeech("Kính gửi PGS. TS. Nguyễn Văn A và GS. Lê.")).toBe("Kính gửi Phó Giáo sư Tiến sĩ Nguyễn Văn A và Giáo sư Lê.");
      expect(sanitizeTextForSpeech("BS. Minh công tác tại TP. HCM.")).toBe("Bác sĩ Minh công tác tại Thành phố Hồ Chí Minh.");
      expect(sanitizeTextForSpeech("Nhiều loại quả như cam, quýt, bưởi v.v.")).toBe("Nhiều loại quả như cam, quýt, bưởi vân vân");
      expect(sanitizeTextForSpeech("Danh sách gồm A, B, C v...v...")).toBe("Danh sách gồm A, B, C vân vân");
    });

    it("preserves numerical decimals without breaking numbers", () => {
      expect(sanitizeTextForSpeech("Số Pi xấp xỉ 3.14 và tốc độ tăng 2.5%")).toBe("Số Pi xấp xỉ 3.14 và tốc độ tăng 2.5%");
    });
  });

  describe("splitSmartPunctuationPhrases", () => {
    it("does not split phrases at single-letter abbreviations or dinosaur names", () => {
      const input = "Khủng long T. rex rất to lớn. Chúng sống ở thời kỳ Phấn trắng.";
      const phrases = splitSmartPunctuationPhrases(input);
      expect(phrases).toHaveLength(2);
      expect(phrases[0]).toBe("Khủng long T-rex rất to lớn.");
      expect(phrases[1]).toBe("Chúng sống ở thời kỳ Phấn trắng.");
    });

    it("does not split on titles like Dr. or decimal numbers", () => {
      const input = "Hôm nay Dr. Strange có bài giảng lúc 3.14 giờ. Bạn có tham gia không?";
      const phrases = splitSmartPunctuationPhrases(input);
      expect(phrases).toHaveLength(2);
      expect(phrases[0]).toContain("Doctor Strange");
      expect(phrases[0]).toContain("3.14");
    });
  });

  describe("voicePlan integration", () => {
    it("generates performance phrases without fragmenting T. rex into isolated single letter segments", () => {
      const phrases = performancePhrases("T. rex là loài khủng long bạo chúa, đúng không?", "question");
      const phraseTexts = phrases.map((p) => p.text);
      expect(phraseTexts.some((t) => t.includes("T-rex"))).toBe(true);
      expect(phraseTexts.every((t) => t !== "T.")).toBe(true);
    });

    it("splitPunctuationPhrases safely handles multiple abbreviations", () => {
      const result = splitPunctuationPhrases("Xem TS. Nam và Dr. Jane phân tích hóa thạch T. rex! Thật kỳ diệu!");
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("Tiến sĩ Nam");
      expect(result[0]).toContain("Doctor Jane");
      expect(result[0]).toContain("T-rex");
    });
  });

  describe("production narration splitting integration", () => {
    it("splitAtNarrativeBoundaries does not break on T. rex", () => {
      const text = "Khủng long T. rex là một trong những kẻ săn mồi đáng sợ nhất lịch sử Trái Đất.";
      const chunks = splitAtNarrativeBoundaries(text, 50);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toContain("T-rex");
    });
  });

  describe("canSplitBetweenWords & Collocation Protection", () => {
    it("disallows splitting after intensifiers like too, very, so, quá, rất", () => {
      expect(canSplitBetweenWords("too", "high")).toBe(false);
      expect(canSplitBetweenWords("very", "fast")).toBe(false);
      expect(canSplitBetweenWords("so", "loud")).toBe(false);
      expect(canSplitBetweenWords("quá", "cao")).toBe(false);
      expect(canSplitBetweenWords("rất", "nhanh")).toBe(false);
    });

    it("disallows splitting after articles, determiners and prepositions", () => {
      expect(canSplitBetweenWords("the", "moon")).toBe(false);
      expect(canSplitBetweenWords("a", "tiger")).toBe(false);
      expect(canSplitBetweenWords("những", "ngôi")).toBe(false);
      expect(canSplitBetweenWords("for", "humans")).toBe(false);
      expect(canSplitBetweenWords("in", "the")).toBe(false);
      expect(canSplitBetweenWords("trong", "rừng")).toBe(false);
    });

    it("keeps short questions with too high intact without mid-clause splitting", () => {
      const phrases = performancePhrases("Dogs hear sounds too high for humans.", "question");
      expect(phrases).toHaveLength(1);
      expect(phrases[0]?.text).toBe("Dogs hear sounds too high for humans.");
    });

    it("keeps short Vietnamese and English questions intact without breaking collocations", () => {
      const viPhrases = performancePhrases("Loài báo săn chạy rất nhanh trên đồng cỏ.", "question");
      expect(viPhrases).toHaveLength(1);
      expect(viPhrases[0]?.text).toBe("Loài báo săn chạy rất nhanh trên đồng cỏ.");
    });
  });
});
