import { describe, expect, it } from "vitest";
import {
  calculateQuestionSimilarity,
  checkQuestionsAgainstHistory,
  evaluateQuestionMatch,
  normalizeQuestionText,
  pruneQuestionHistory,
} from "../src/quiz/qa/questionHistory.js";
import type { QuestionHistoryEntry, QuizQuestion } from "@studio/shared";

describe("Question History & Similarity Checking", () => {
  it("normalizes question text accurately", () => {
    expect(normalizeQuestionText("  Đố bạn: Con gì chạy nhanh nhất thế giới?!  ")).toBe(
      "đố bạn con gì chạy nhanh nhất thế giới"
    );
  });

  it("calculates similarity accurately", () => {
    const identical = calculateQuestionSimilarity(
      "Hành tinh nào lớn nhất Hệ Mặt Trời?",
      "Hành tinh nào lớn nhất Hệ Mặt Trời?"
    );
    expect(identical).toBe(1);

    const highSim = calculateQuestionSimilarity(
      "Đố bạn con gì chạy nhanh nhất trên cạn?",
      "Loài động vật nào chạy nhanh nhất trên cạn?"
    );
    expect(highSim).toBeGreaterThan(0.5);

    const lowSim = calculateQuestionSimilarity(
      "Đố bạn con gì chạy nhanh nhất?",
      "Thủ đô của nước Pháp là gì?"
    );
    expect(lowSim).toBeLessThan(0.3);
  });

  it("evaluates exact and fuzzy duplicate matches correctly", () => {
    const exact = evaluateQuestionMatch(
      "Loài chim nào không biết bay?",
      "Loài chim nào không biết bay?",
      "Chim cánh cụt",
      "Chim cánh cụt"
    );
    expect(exact.isDuplicate).toBe(true);
    expect(exact.similarity).toBe(1.0);

    const similarWithSameAnswer = evaluateQuestionMatch(
      "Con chim nào bơi giỏi nhưng không thể bay?",
      "Loài chim nào bơi giỏi mà không biết bay?",
      "Chim cánh cụt",
      "Chim cánh cụt"
    );
    expect(similarWithSameAnswer.isDuplicate).toBe(true);
    expect(similarWithSameAnswer.similarity).toBeGreaterThanOrEqual(0.8);
  });

  it("prunes old question history based on TTL (30 days)", () => {
    const nowMs = 1700000000000;
    const dayMs = 24 * 60 * 60 * 1000;

    const entries: QuestionHistoryEntry[] = [
      {
        question_id: "q-1",
        question_text: "Câu hỏi 10 ngày trước",
        normalized_question: "câu hỏi 10 ngày trước",
        choices: ["A", "B"],
        correct_answer: "A",
        episode_id: "ep-1",
        episode_title: "Ep 1",
        channel_id: "ch-1",
        rendered_at: new Date(nowMs - 10 * dayMs).toISOString(),
      },
      {
        question_id: "q-2",
        question_text: "Câu hỏi 40 ngày trước (quá hạn)",
        normalized_question: "câu hỏi 40 ngày trước",
        choices: ["A", "B"],
        correct_answer: "B",
        episode_id: "ep-2",
        episode_title: "Ep 2",
        channel_id: "ch-1",
        rendered_at: new Date(nowMs - 40 * dayMs).toISOString(),
      },
    ];

    const pruned = pruneQuestionHistory(entries, 30, nowMs);
    expect(pruned.length).toBe(1);
    expect(pruned[0].question_id).toBe("q-1");
  });

  it("checks episode questions against history and enforces pass_threshold", () => {
    const historyEntries: QuestionHistoryEntry[] = [
      {
        question_id: "hist-1",
        question_text: "Con báo săn chạy nhanh nhất đúng không?",
        normalized_question: "con báo săn chạy nhanh nhất đúng không",
        choices: ["Đúng", "Sai"],
        correct_answer: "Đúng",
        episode_id: "ep-old-1",
        episode_title: "Động vật siêu tốc",
        channel_id: "ch-1",
        rendered_at: new Date().toISOString(),
      },
      {
        question_id: "hist-2",
        question_text: "Hành tinh nào gần Mặt Trời nhất?",
        normalized_question: "hành tinh nào gần mặt trời nhất",
        choices: ["Sao Thủy", "Sao Kim", "Sao Hỏa", "Trái Đất"],
        correct_answer: "Sao Thủy",
        episode_id: "ep-old-2",
        episode_title: "Khám phá Vũ trụ",
        channel_id: "ch-1",
        rendered_at: new Date().toISOString(),
      },
    ];

    const currentQuestions: QuizQuestion[] = [
      {
        id: "q-1",
        number: 1,
        format: "true_false",
        difficulty: 1,
        question: "Con báo săn chạy nhanh nhất đúng không?",
        choices: [
          { id: "choice_a", text: "Đúng" },
          { id: "choice_b", text: "Sai" },
        ],
        correct_choice_id: "choice_a",
        explanation: "Báo săn là động vật chạy nhanh nhất trên cạn.",
        fun_fact: "Tốc độ lên tới 120km/h.",
        source_ids: [],
        visual_opportunity: "",
        validation: { semantic_status: "validated", source_coverage: false, fact_locked: true },
      },
      {
        id: "q-2",
        number: 2,
        format: "multiple_choice_text",
        difficulty: 2,
        question: "Hành tinh nào gần Mặt Trời nhất trong Hệ Mặt Trời?",
        choices: [
          { id: "choice_a", text: "Sao Thủy" },
          { id: "choice_b", text: "Sao Kim" },
          { id: "choice_c", text: "Sao Hỏa" },
          { id: "choice_d", text: "Trái Đất" },
        ],
        correct_choice_id: "choice_a",
        explanation: "Sao Thủy là hành tinh gần nhất.",
        fun_fact: "Nhiệt độ thay đổi rất lớn.",
        source_ids: [],
        visual_opportunity: "",
        validation: { semantic_status: "validated", source_coverage: false, fact_locked: true },
      },
      {
        id: "q-3",
        number: 3,
        format: "multiple_choice_text",
        difficulty: 2,
        question: "Loài cá nào lớn nhất đại dương?",
        choices: [
          { id: "choice_a", text: "Cá mập voi" },
          { id: "choice_b", text: "Cá voi xanh" },
          { id: "choice_c", text: "Cá heo" },
          { id: "choice_d", text: "Cá đuối" },
        ],
        correct_choice_id: "choice_a",
        explanation: "Cá mập voi là loài cá lớn nhất.",
        fun_fact: "Nó chỉ ăn sinh vật phù du.",
        source_ids: [],
        visual_opportunity: "",
        validation: { semantic_status: "validated", source_coverage: false, fact_locked: true },
      },
    ];

    // Threshold = 1 -> Duplicate count = 2 -> Failed
    const resultFail = checkQuestionsAgainstHistory("ep-new", currentQuestions, historyEntries, 1);
    expect(resultFail.duplicate_count).toBe(2);
    expect(resultFail.passed).toBe(false);

    // Threshold = 2 -> Duplicate count = 2 -> Passed
    const resultPass = checkQuestionsAgainstHistory("ep-new", currentQuestions, historyEntries, 2);
    expect(resultPass.duplicate_count).toBe(2);
    expect(resultPass.passed).toBe(true);
  });
});