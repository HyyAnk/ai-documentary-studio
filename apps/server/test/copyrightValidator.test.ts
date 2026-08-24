import { describe, expect, it } from "vitest";
import {
  validateTextCopyright,
  validateQuizScriptCopyright,
  validateQuizResearchCopyright,
} from "../src/quiz/qa/copyrightValidator.js";
import { validateQuizScript } from "../src/tasks.js";
import { assessQuiz } from "../src/quiz/qa/quizAssessment.js";
import type { QuizV2 } from "@studio/shared";

describe("Copyright and IP Blacklist Validator", () => {
  describe("Lion Cub vs Adult Lion", () => {
    it("flags 'sư tử con' and variations as violations", () => {
      expect(validateTextCopyright("Sư tử con rất đáng yêu").violated).toBe(true);
      expect(validateTextCopyright("Đoán tên con non: sư tử con").category).toBe("LION_CUB");
      expect(validateTextCopyright("A playful lion cub running in the grass").violated).toBe(true);
      expect(validateTextCopyright("Baby lion in the jungle").violated).toBe(true);
      expect(validateTextCopyright("Simba là nhân vật hoạt hình").violated).toBe(true);
      expect(validateTextCopyright("Vua Sư Tử của thảo nguyên").violated).toBe(true);
      expect(validateTextCopyright("The Lion King story").violated).toBe(true);
    });

    it("allows adult 'sư tử' and nature terms without violation", () => {
      expect(validateTextCopyright("Sư tử là loài săn mồi đỉnh cao của thảo nguyên").violated).toBe(false);
      expect(validateTextCopyright("Sư tử đực có chiếc bờm rất oai vệ").violated).toBe(false);
      expect(validateTextCopyright("Sư tử cái đảm nhận việc săn mồi chính trong đàn").violated).toBe(false);
      expect(validateTextCopyright("Đàn sư tử châu Phi đang nghỉ ngơi dưới gốc cây").violated).toBe(false);
      expect(validateTextCopyright("Chúa sơn lâm sư tử gầm vang").violated).toBe(false);
      expect(validateTextCopyright("A majestic African lion resting in the shade").violated).toBe(false);
    });
  });

  describe("Marvel and DC Superheroes", () => {
    it("flags Marvel superheroes as violations", () => {
      expect(validateTextCopyright("Người Nhện có khả năng bắn tơ").violated).toBe(true);
      expect(validateTextCopyright("Người Nhện có khả năng bắn tơ").category).toBe("MARVEL_SUPERHERO");
      expect(validateTextCopyright("Spider-Man can crawl on walls").violated).toBe(true);
      expect(validateTextCopyright("Iron Man trong bộ giáp đỏ vàng").violated).toBe(true);
      expect(validateTextCopyright("Người Sắt chế tạo vũ khí").violated).toBe(true);
      expect(validateTextCopyright("Captain America và chiếc khiên tròn").violated).toBe(true);
      expect(validateTextCopyright("Khổng lồ xanh Hulk rất khỏe").violated).toBe(true);
      expect(validateTextCopyright("Thần sấm Thor sử dụng búa Mjolnir").violated).toBe(true);
      expect(validateTextCopyright("Thanos thu thập các viên đá vô cực").violated).toBe(true);
    });

    it("flags DC superheroes as violations", () => {
      expect(validateTextCopyright("Người Dơi bảo vệ thành phố Gotham").violated).toBe(true);
      expect(validateTextCopyright("Người Dơi bảo vệ thành phố Gotham").category).toBe("DC_SUPERHERO");
      expect(validateTextCopyright("Batman drives the batmobile").violated).toBe(true);
      expect(validateTextCopyright("Superman bay lượn trên bầu trời").violated).toBe(true);
      expect(validateTextCopyright("Wonder Woman nữ thần chiến binh").violated).toBe(true);
      expect(validateTextCopyright("Joker là kẻ thù nguy hiểm").violated).toBe(true);
      expect(validateTextCopyright("The Flash chạy với tốc độ ánh sáng").violated).toBe(true);
    });
  });

  describe("Game IPs vs Anime/Manga Whitelist", () => {
    it("flags Game IPs as violations", () => {
      expect(validateTextCopyright("Pikachu phóng ra dòng điện 10 vạn vôn").violated).toBe(true);
      expect(validateTextCopyright("Pikachu phóng ra dòng điện 10 vạn vôn").category).toBe("GAME_IP");
      expect(validateTextCopyright("Thợ sửa ống nước Mario ăn nấm").violated).toBe(true);
      expect(validateTextCopyright("Nấm lùn Mario vượt chướng ngại vật").violated).toBe(true);
      expect(validateTextCopyright("Nhím Sonic chạy siêu nhanh").violated).toBe(true);
      expect(validateTextCopyright("Minecraft Creeper phát nổ").violated).toBe(true);
      expect(validateTextCopyright("Roblox và Fortnite").violated).toBe(true);
    });

    it("ALLOWS Anime and Manga characters without violation", () => {
      expect(validateTextCopyright("Naruto là ninja của làng Lá muốn trở thành Hokage").violated).toBe(false);
      expect(validateTextCopyright("Songoku biến hình thành Super Saiyan cấp 3").violated).toBe(false);
      expect(validateTextCopyright("Goku cùng bạn bè tìm kiếm 7 viên ngọc rồng").violated).toBe(false);
      expect(validateTextCopyright("Doraemon có chiếc túi thần kỳ chứa nhiều bảo bối").violated).toBe(false);
      expect(validateTextCopyright("Nobita hậu đậu nhưng bắn súng rất giỏi").violated).toBe(false);
      expect(validateTextCopyright("Luffy ăn trái ác quỷ cao su trong One Piece").violated).toBe(false);
      expect(validateTextCopyright("Thám tử lừng danh Conan phá án bằng nơ đổi giọng").violated).toBe(false);
    });
  });

  describe("Quiz Script Markdown Validation and Quality Gate", () => {
    it("identifies the exact question number containing a prohibited term", () => {
      const markdown = [
        "<!-- HUMOR_POLICY: v1 -->",
        "# Baby Animals Quiz",
        "",
        "## Question 1 — Baby Penguin",
        "Chim cánh cụt con sống ở đâu?",
        "Choices: A. Nam Cực, B. Sa mạc, C. Rừng rậm",
        "Answer: A. Nam Cực",
        "Guess what!",
        "",
        "## Question 2 — Sư tử con",
        "Đố bạn sư tử con mới sinh có đặc điểm gì?",
        "Choices: A. Có đốm mờ, B. Có bờm to, C. Biết bơi",
        "Answer: A. Có đốm mờ",
        "Guess what!",
        "",
        "## Question 3 — Baby Elephant",
        "Voi con uống sữa mẹ bằng cách nào?",
        "Choices: A. Dùng miệng, B. Dùng vòi, C. Dùng tai",
        "Answer: A. Dùng miệng",
        "Guess what!",
      ].join("\n");

      const result = validateQuizScriptCopyright(markdown);
      expect(result.violated).toBe(true);
      expect(result.questionNumber).toBe(2);
      expect(result.category).toBe("LION_CUB");

      expect(() => validateQuizScript(markdown, 3)).toThrowError(
        /Quiz script quality gate failed: Question 2 contains prohibited term 'sư tử con'/i
      );
    });

    it("passes cleanly when script uses safe baby animals or anime characters", () => {
      const markdown = [
        "<!-- HUMOR_POLICY: v1 -->",
        "# Safe Animals and Anime Quiz",
        "",
        "## Question 1 — Kangaroo Joey",
        "Chuột túi con sống ở đâu?",
        "Choices: A. Trong túi mẹ, B. Trên cây, C. Dưới nước",
        "Answer: A. Trong túi mẹ",
        "Guess what! Correct answer is A.",
        "",
        "## Question 2 — Naruto Quiz",
        "Món ăn yêu thích của Naruto là gì?",
        "Choices: A. Mì Ramen, B. Cơm nắm, C. Bánh ngọt",
        "Answer: A. Mì Ramen",
        "Guess what! Correct answer is A.",
        "",
        "## Question 3 — African Lion",
        "Loài sư tử châu Phi sống thành từng bầy gọi là gì?",
        "Choices: A. Đàn (Pride), B. Đội, C. Nhóm",
        "Answer: A. Đàn (Pride)",
        "Guess what! Correct answer is A.",
      ].join("\n");

      const result = validateQuizScriptCopyright(markdown);
      expect(result.violated).toBe(false);
      expect(() => validateQuizScript(markdown, 3)).not.toThrow();
    });
  });

  describe("Quiz Assessment Semantic Gate", () => {
    it("flags blocker issue when question contains Spider-Man or lion cub", () => {
      const mockQuiz: QuizV2 = {
        schema_version: 2,
        episode_id: "ep-test",
        format: "multiple_choice",
        age_band: "7-9",
        language: "vi",
        questions: [
          {
            id: "q-1",
            number: 1,
            format: "multiple_choice",
            question: "Ai là Người Nhện bắn tơ?",
            choices: [
              { id: "choice-1", text: "Peter Parker" },
              { id: "choice-2", text: "Bruce Wayne" },
              { id: "choice-3", text: "Clark Kent" },
            ],
            correct_choice_id: "choice-1",
            explanation: "Peter Parker là Người Nhện.",
            visual_opportunity: "Spider-Man swinging between buildings",
            source_ids: ["C01"],
            validation: { fact_locked: true },
          },
        ],
      };

      const assessment = assessQuiz({ quiz: mockQuiz });
      const copyrightIssue = assessment.issues.find((i) => i.code === "semantic_copyright_violation");
      expect(copyrightIssue).toBeDefined();
      expect(copyrightIssue?.severity).toBe("blocker");
      expect(copyrightIssue?.question_ids).toContain("q-1");
    });
  });
});
