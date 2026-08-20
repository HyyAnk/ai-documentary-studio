import { VoicePlanSchema, type QuizV2, type VoicePhrase, type VoiceSegmentRole, type VoicePlan } from "@studio/shared";

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
  const normalized = text.trim().replace(/\s+/g, " ");
  const chunks = role === "question" ? splitQuestionPhrases(normalized) : splitPunctuationPhrases(normalized);
  return chunks.map((phrase, index) => ({
    text: phrase,
    delivery: role === "reveal" ? "emphasis" : role === "fun_fact" || role === "explanation" ? "warm" : role === "outro" || role === "intro" ? "playful" : role === "question" && index === chunks.length - 1 ? "question_end" : index === 1 ? "emphasis" : "normal",
    pause_after: index === chunks.length - 1 ? "none" : role === "question" ? "phrase" : role === "reveal" ? "anticipation" : "micro",
  }));
}

function splitQuestionPhrases(text: string): string[] {
  const punctuation = splitPunctuationPhrases(text);
  if (punctuation.length > 1) return punctuation;
  const words = text.split(" ");
  if (words.length < 7) return [text];
  const preferred = words.findIndex((word, index) => index >= 2 && index <= words.length - 3 && /^(is|are|can|does|do|has|have|will|was|were)$/i.test(word.replace(/^[^A-Za-z]+/, "")));
  const splitAt = preferred > 0 ? preferred : Math.round(words.length / 2);
  return [words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" ")];
}

function splitPunctuationPhrases(text: string): string[] {
  const parts = text.split(/(?<=[,;:])\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

function voiceCopy(language: string) {
  if (/^(vi|vietnamese|tiếng việt)/i.test(language.trim())) {
    return {
      intro: "Sẵn sàng cho một quiz thật vui chưa?",
      question: (_number: number, text: string) => text,
      choices: (choices: string[]) => choices.length < 2 ? choices[0] : `${choices.slice(0, -1).join(", ")} hay ${choices.at(-1)}?`,
      thinking: ["Bạn sẵn sàng chưa? Chọn đáp án nào!", "Suy nghĩ nhanh nhé!", "Giữ đáp án trong đầu nào!", "Chốt đáp án thôi!"],
      reveal: (answer: string) => `${answer}!`,
      explanation: (text: string) => text,
      fact: (text: string) => text,
      midpoint: "",
      outro: "Bạn đúng được mấy câu? Tuyệt lắm! Chơi lại sớm nhé!",
    };
  }
  return {
    intro: "Ready for a bright quiz? Here we go!",
    question: (_number: number, text: string) => text,
    choices: (choices: string[]) => choices.length < 2 ? choices[0] : `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}?`,
    thinking: ["Ready? Pick your answer!", "Think fast!", "Keep your answer in mind!", "Lock it in!"],
    reveal: (answer: string) => `${answer}!`,
    explanation: (text: string) => text,
    fact: (text: string) => text,
    midpoint: "",
    outro: "How many did you get right? Great game! Play again soon!",
  };
}
