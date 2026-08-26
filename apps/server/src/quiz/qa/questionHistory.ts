import {
  type QuestionHistoryEntry,
  type QuestionHistoryCheckItem,
  type QuestionHistoryCheckResult,
  type QuizQuestion,
  nowIso,
} from "@studio/shared";

/**
 * Chuẩn hóa chuỗi văn bản câu hỏi: loại bỏ dấu câu, chuyển chữ thường, xóa khoảng trắng thừa.
 */
export function normalizeQuestionText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tính toán độ tương đồng giữa 2 chuỗi văn bản câu hỏi dựa trên Jaccard Token và Bigram Dice Coefficient.
 */
export function calculateQuestionSimilarity(textA: string, textB: string): number {
  const normA = normalizeQuestionText(textA);
  const normB = normalizeQuestionText(textB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  // 1. Token Jaccard Similarity
  const tokensA = new Set(normA.split(" ").filter((w) => w.length > 1));
  const tokensB = new Set(normB.split(" ").filter((w) => w.length > 1));

  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersectionCount++;
  }
  const unionCount = new Set([...tokensA, ...tokensB]).size;
  const jaccard = unionCount > 0 ? intersectionCount / unionCount : 0;

  // 2. Character Bigram Dice Coefficient
  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  };
  const bigramsA = getBigrams(normA.replace(/\s/g, ""));
  const bigramsB = getBigrams(normB.replace(/\s/g, ""));

  let bigramIntersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) bigramIntersection++;
  }
  const totalBigrams = bigramsA.size + bigramsB.size;
  const dice = totalBigrams > 0 ? (2 * bigramIntersection) / totalBigrams : 0;

  return Math.max(jaccard, dice);
}

/**
 * Kiểm tra xem câu hỏi hiện tại có bị trùng với một câu hỏi trong lịch sử hay không.
 */
export function evaluateQuestionMatch(
  currentText: string,
  historyText: string,
  currentAnswer?: string,
  historyAnswer?: string,
): { isDuplicate: boolean; similarity: number; reason: string } {
  const normCurrent = normalizeQuestionText(currentText);
  const normHistory = normalizeQuestionText(historyText);

  if (normCurrent === normHistory) {
    return {
      isDuplicate: true,
      similarity: 1.0,
      reason: "Trùng khớp 100% nội dung câu hỏi",
    };
  }

  let similarity = calculateQuestionSimilarity(currentText, historyText);

  const normCurrentAns = currentAnswer ? normalizeQuestionText(currentAnswer) : "";
  const normHistoryAns = historyAnswer ? normalizeQuestionText(historyAnswer) : "";
  const answersMatch = normCurrentAns && normHistoryAns && (normCurrentAns === normHistoryAns || normCurrentAns.includes(normHistoryAns) || normHistoryAns.includes(normCurrentAns));

  if (answersMatch && similarity >= 0.5) {
    similarity = Math.max(similarity, 0.85);
    return {
      isDuplicate: true,
      similarity: Number(similarity.toFixed(2)),
      reason: `Cùng đáp án chính và ý tưởng câu hỏi tương tự (${Math.round(similarity * 100)}%)`,
    };
  }

  if (similarity >= 0.75) {
    return {
      isDuplicate: true,
      similarity: Number(similarity.toFixed(2)),
      reason: `Độ tương đồng cao (${Math.round(similarity * 100)}%)`,
    };
  }

  return {
    isDuplicate: false,
    similarity: Number(similarity.toFixed(2)),
    reason: "",
  };
}

/**
 * Loại bỏ các câu hỏi quá hạn (TTL) khỏi danh sách lịch sử.
 */
export function pruneQuestionHistory(
  entries: QuestionHistoryEntry[],
  ttlDays = 30,
  nowMs = Date.now(),
): QuestionHistoryEntry[] {
  const cutOff = nowMs - ttlDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => {
    const entryTime = new Date(entry.rendered_at).getTime();
    return !Number.isNaN(entryTime) && entryTime >= cutOff;
  });
}

/**
 * Thực hiện đối chiếu toàn bộ danh sách câu hỏi của một Episode với lịch sử.
 */
export function checkQuestionsAgainstHistory(
  episodeId: string,
  questions: QuizQuestion[],
  historyEntries: QuestionHistoryEntry[],
  passThreshold = 2,
): QuestionHistoryCheckResult {
  const validHistory = historyEntries.filter((entry) => entry.episode_id !== episodeId);

  const items: QuestionHistoryCheckItem[] = questions.map((question) => {
    const currentCorrectChoice = question.choices.find((c) => c.id === question.correct_choice_id)?.text || "";

    let bestMatchEntry: QuestionHistoryEntry | null = null;
    let highestSimilarity = 0;
    let matchReason = "";
    let isDupe = false;

    for (const entry of validHistory) {
      const result = evaluateQuestionMatch(
        question.question,
        entry.question_text,
        currentCorrectChoice,
        entry.correct_answer,
      );

      if (result.similarity > highestSimilarity) {
        highestSimilarity = result.similarity;
        if (result.isDuplicate) {
          bestMatchEntry = entry;
          matchReason = result.reason;
          isDupe = true;
        }
      }
    }

    return {
      current_question_id: question.id,
      current_question_text: question.question,
      current_choices: question.choices.map((c) => c.text),
      current_correct_answer: currentCorrectChoice,
      matched_entry: isDupe ? bestMatchEntry : null,
      similarity_score: highestSimilarity,
      match_reason: matchReason,
      status: isDupe ? ("duplicate" as const) : ("passed" as const),
    };
  });

  const duplicateCount = items.filter((item) => item.status === "duplicate").length;
  const passed = duplicateCount <= passThreshold;

  return {
    episode_id: episodeId,
    checked_at: nowIso(),
    total_questions: questions.length,
    duplicate_count: duplicateCount,
    pass_threshold: passThreshold,
    passed,
    items,
  };
}