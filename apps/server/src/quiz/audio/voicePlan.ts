import { VoicePlanSchema, type QuizV2, type VoicePhrase, type VoiceSegmentRole, type VoicePlan } from "@studio/shared";
import { sanitizeTextForSpeech, splitSmartPunctuationPhrases, canSplitBetweenWords } from "../../utils/speechSanitizer.js";

export function buildQuizVoicePlan(quiz: QuizV2): VoicePlan {
  const copy = voiceCopy(quiz.language);
  const segments: VoicePlan["segments"] = [
    { segment_id: "intro", role: "intro", question_id: null, text: copy.intro, duration_seconds: null, phrases: performancePhrases(copy.intro, "intro") },
  ];
  quiz.questions.forEach((question, index) => {
    const answer = question.choices.find((choice) => choice.id === question.correct_choice_id)?.text ?? "";
    segments.push(
      withPhrases({ segment_id: question.id + ":question", role: "question", question_id: question.id, text: copy.question(question.number, question.question), duration_seconds: null }),
      withPhrases({ segment_id: question.id + ":choice", role: "choice", question_id: question.id, text: copy.choices(question.choices.map((choice) => choice.text)), duration_seconds: null }),
      withPhrases({ segment_id: question.id + ":thinking", role: "thinking_prompt", question_id: question.id, text: copy.thinking[index % copy.thinking.length]!, duration_seconds: null }),
      withPhrases({ segment_id: question.id + ":reveal", role: "reveal", question_id: question.id, text: copy.reveal(answer), duration_seconds: null }),
      withPhrases({ segment_id: question.id + ":explanation", role: "explanation", question_id: question.id, text: copy.explanation(question.explanation), duration_seconds: null }),
      ...(question.fun_fact ? [withPhrases({ segment_id: question.id + ":fact", role: "fun_fact" as const, question_id: question.id, text: copy.fact(question.fun_fact), duration_seconds: null })] : []),
    );
  });
  segments.push(withPhrases({ segment_id: "outro", role: "outro", question_id: null, text: copy.outro, duration_seconds: null }));
  return VoicePlanSchema.parse({ schema_version: 2, episode_id: quiz.episode_id, segments });
}

function withPhrases(segment: Omit<VoicePlan["segments"][number], "phrases">): VoicePlan["segments"][number] {
  return { ...segment, phrases: performancePhrases(segment.text, segment.role) };
}

export function performancePhrases(text: string, role: VoiceSegmentRole): VoicePhrase[] {
  const normalized = sanitizeTextForSpeech(text.trim().replace(/\s+/g, " "));
  const chunks = role === "question" ? splitQuestionPhrases(normalized) : role === "choice" ? splitChoicePhrases(normalized) : splitPunctuationPhrases(normalized);
  return chunks.map((phrase, index) => ({
    text: phrase,
    delivery: role === "reveal" ? "emphasis" : role === "fun_fact" || role === "explanation" ? "warm" : role === "outro" || role === "intro" || role === "thinking_prompt" ? "playful" : role === "question" && index === chunks.length - 1 ? "question_end" : index === 1 ? "emphasis" : "normal",
    pause_after: index === chunks.length - 1 ? "none" : role === "outro" && index === 0 ? "long" : role === "question" ? "phrase" : role === "reveal" ? "anticipation" : "micro",
  }));
}

function splitQuestionPhrases(text: string): string[] {
  const punctuation = splitPunctuationPhrases(text);
  if (punctuation.length > 1) return punctuation;
  const words = text.split(" ").filter(Boolean);
  if (words.length <= 12) return [text];

  const midpoint = Math.round(words.length / 2);
  let bestSplit = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 3; i <= words.length - 3; i++) {
    if (!canSplitBetweenWords(words[i - 1]!, words[i]!)) continue;
    const word = words[i]!.replace(/^[^A-Za-zÀ-ỹ]+/, "").toLowerCase();
    const isConjunction = /^(and|or|but|because|although|when|while|which|that|who|whom|where|if|as|và|nhưng|hoặc|bởi|vì|khi|nếu|mà)$/i.test(word);
    const score = (isConjunction ? 0 : 5) + Math.abs(i - midpoint);
    if (score < bestScore) {
      bestScore = score;
      bestSplit = i;
    }
  }

  if (bestSplit > 0) {
    return [words.slice(0, bestSplit).join(" "), words.slice(bestSplit).join(" ")];
  }
  return [text];
}

export function splitChoicePhrases(text: string): string[] {
  const commaParts = text.split(/(?<=,)\s+/).map((part) => part.trim()).filter(Boolean);
  if (commaParts.length <= 1) return splitPunctuationPhrases(text);

  const phrases: string[] = [];
  let current: string[] = [];
  for (const [index, part] of commaParts.entries()) {
    current.push(part);
    const wordsBeforeBoundary = current.join(" ").split(/\s+/).filter(Boolean).length;
    const wordsAfterBoundary = commaParts.slice(index + 1).join(" ").split(/\s+/).filter(Boolean).length;
    if (wordsAfterBoundary >= 3 && wordsBeforeBoundary >= 3) {
      phrases.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) phrases.push(current.join(" "));
  return phrases.length > 1 ? phrases : [text];
}

export function splitPunctuationPhrases(text: string): string[] {
  return splitSmartPunctuationPhrases(text);
}

function voiceCopy(language: string) {
  if (/^(vi|vietnamese|tiếng việt)/i.test(language.trim())) {
    return {
      intro: "Sẵn sàng chưa? Xem bạn trả lời đúng được bao nhiêu câu nhé!",
      question: (_number: number, text: string) => text,
      choices: (choices: string[]) => choices.length < 2 ? choices[0] : `${choices.slice(0, -1).join(", ")} hay ${choices.at(-1)}?`,
      thinking: ["Chọn nhanh nào!", "Đáp án là gì nhỉ?", "Nhanh tay nào!", "Bạn chọn cái nào?"],
      reveal: (answer: string) => `Đúng rồi! Chính là ${answer}!`,
      explanation: (text: string) => text,
      fact: (text: string) => text,
      midpoint: "",
      outro: "Bạn đúng được mấy câu? Hãy bình luận số điểm của bạn bên dưới nhé! Nhớ nhấn Thích và Đăng ký kênh để đón xem những thử thách tiếp theo. Hẹn gặp lại các bạn!",
    };
  }
  return {
    intro: "Ready to test your brain? Let's jump right in!",
    question: (_number: number, text: string) => text,
    choices: (choices: string[]) => choices.length < 2 ? choices[0] : `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}?`,
    thinking: ["Pick fast!", "Which one?", "What's your guess?", "Choose now!"],
    reveal: (answer: string) => `That's right! It's ${answer}!`,
    explanation: (text: string) => text,
    fact: (text: string) => text,
    midpoint: "",
    outro: "How many did you get right? Leave your score in the comments below! Remember to like and subscribe for more fun quizzes. See you next time!",
  };
}
