import { pathToFileURL } from "node:url";
import type { DirectorPlan, QuizConfig, QuizTimeline, QuizV2 } from "@studio/shared";
import { getQuizVisualTemplate } from "../visual/registry.js";
import { ambientPhaseSeconds, motionCssClass, textLayout, visualAnswerState } from "../visual/candyArcade.js";
import type { QuizTemplateScene } from "../visual/types.js";

export type CandyArcadeCompositionInput = {
  quiz: QuizV2;
  director: DirectorPlan;
  timeline: QuizTimeline;
  theme: QuizConfig["visual_theme"];
  audioPath: string;
  narrationDurationSeconds: number;
  assets?: Record<string, string>;
};

type Copy = ReturnType<typeof quizCopy>;
type Phase = "question" | "choices" | "think" | "countdown" | "reveal" | "explain";

export const CANDY_ARCADE_LAYOUT_DIMENSIONS = {
  baseline: { width: 800, height: 284 },
  media_left_choices_right: { width: 840, height: 580 },
  media_top_choices_bottom: { width: 1500, height: 500, thinkHeight: 360 },
  visual_choices_three: { width: 501, height: 372, count: 3 },
} as const;

export function candyArcadeHeroAreaRatio(layout: keyof typeof CANDY_ARCADE_LAYOUT_DIMENSIONS, phase: Phase = "think"): number {
  const frameArea = 1920 * 1080;
  if (layout === "visual_choices_three") {
    const dimensions = CANDY_ARCADE_LAYOUT_DIMENSIONS.visual_choices_three;
    return Number(((dimensions.width * dimensions.height * dimensions.count) / frameArea).toFixed(4));
  }
  const dimensions = CANDY_ARCADE_LAYOUT_DIMENSIONS[layout];
  const height = layout === "media_top_choices_bottom" && (phase === "think" || phase === "explain") ? CANDY_ARCADE_LAYOUT_DIMENSIONS.media_top_choices_bottom.thinkHeight : dimensions.height;
  return Number(((dimensions.width * height) / frameArea).toFixed(4));
}

export function buildCandyArcadeComposition(input: CandyArcadeCompositionInput): string {
  const duration = Math.max(3, input.narrationDurationSeconds, input.timeline.duration_seconds);
  const copy = quizCopy(input.quiz.language);
  const template = getQuizVisualTemplate(input.theme);
  const events = input.timeline.events;
  const eventAt = (questionId: string, type: string, fallback: number) => events.find((event) => event.question_id === questionId && event.type === type)?.at_seconds ?? fallback;
  const eventOf = (questionId: string, type: string) => events.find((event) => event.question_id === questionId && event.type === type);
  const firstStart = input.quiz.questions[0] ? eventAt(input.quiz.questions[0].id, "question.enter", 0) : 0;
  const clips: string[] = [introClip(firstStart, input.quiz.questions.length, copy)];
  const outroStart = events.find((event) => event.type === "narration.segment" && event.segment_id === "outro")?.at_seconds;
  let previousPaletteId: string | undefined;

  input.quiz.questions.forEach((question, index) => {
    const beat = input.director.beats.find((candidate) => candidate.question_id === question.id);
    if (!beat) return;
    const visual = template.resolveScene({
      question,
      questionIndex: index,
      totalQuestions: input.quiz.questions.length,
      archetype: beat.archetype,
      requestedPalette: beat.palette_id,
      requestedLayout: beat.layout_id,
      requestedMotion: beat.motion_id,
      requestedTransition: beat.transition_id,
      previousPaletteId,
    });
    previousPaletteId = visual.palette.id;
    const nextQuestion = input.quiz.questions[index + 1];
    const start = eventAt(question.id, "question.enter", 0);
    const choicesStart = eventAt(question.id, "choices.enter", start + 1);
    const thinkingStart = eventAt(question.id, "countdown.start", choicesStart + 1);
    const revealStart = eventAt(question.id, "answer.reveal", thinkingStart + 8);
    const rewardStart = eventAt(question.id, "reward.play", revealStart + .8);
    const transition = eventOf(question.id, "transition.start");
    const end = Math.min(duration, nextQuestion ? eventAt(nextQuestion.id, "question.enter", duration) : transition?.at_seconds ?? outroStart ?? duration);
    if (end - start > .04) clips.push(questionClip({ start, choicesStart, thinkingStart, revealStart, rewardStart, end, question, questionIndex: index, count: input.quiz.questions.length, visual, copy, assets: input.assets ?? {}, isFinal: index === input.quiz.questions.length - 1 }));
    if (transition) clips.push(transitionClip({ start: transition.at_seconds, end: transition.at_seconds + transition.duration_seconds, visual, nextPalette: nextQuestion ? template.resolveScene({ question: nextQuestion, questionIndex: index + 1, totalQuestions: input.quiz.questions.length, archetype: input.director.beats.find((candidate) => candidate.question_id === nextQuestion.id)?.archetype ?? "text_multiple_choice", requestedPalette: input.director.beats.find((candidate) => candidate.question_id === nextQuestion.id)?.palette_id ?? "auto", requestedLayout: "auto", requestedMotion: "auto", requestedTransition: "auto", previousPaletteId: visual.palette.id }).palette : visual.palette }));
  });
  if (typeof outroStart === "number" && outroStart < duration - .04) clips.push(outroClip(outroStart, duration, input.quiz.questions.length, copy));

  const audioSrc = source(input.audioPath);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Candy Arcade Quiz</title><style>${candyArcadeCss()}</style></head><body><main id="stage" data-composition-id="quiz-v2-candy-arcade" data-no-timeline data-start="0" data-width="1920" data-height="1080" data-duration="${duration.toFixed(3)}" data-fps="30">${clips.filter(Boolean).join("\n")}<audio id="quiz-narration" class="clip" data-start="0" data-duration="${duration.toFixed(3)}" data-track-index="2" data-volume="1" src="${audioSrc}"></audio></main><script>window.__playerReady=true;window.__renderReady=true;</script></body></html>`;
}

function introClip(end: number, count: number, copy: Copy): string {
  if (end < .08) return "";
  return `<section id="candy-intro" class="clip candy-scene candy-intro" data-start="0" data-duration="${end.toFixed(3)}" data-track-index="0"><div class="intro-rays"></div><div class="intro-dot dot-a"></div><div class="intro-dot dot-b"></div><div class="intro-card"><span>QUIZ TIME</span><h1>${esc(copy.ready)}</h1><p>${count} ${esc(copy.questions(count))}</p><div class="intro-stars">✦&nbsp;&nbsp;★&nbsp;&nbsp;✦</div></div><div class="brand-mascot mascot-wave">✦</div></section>`;
}

function outroClip(start: number, end: number, count: number, copy: Copy): string {
  return `<section id="candy-outro" class="clip candy-scene candy-outro" data-start="${start.toFixed(3)}" data-duration="${Math.max(.04, end - start).toFixed(3)}" data-track-index="0"><div class="intro-rays"></div><div class="outro-blob blob-a"></div><div class="outro-blob blob-b"></div><div class="outro-card"><span>${esc(copy.scorePrompt)}</span><h1>${esc(copy.playAgain)}</h1><p>${count} ${esc(copy.questions(count))}</p><div class="outro-stars">★&nbsp;&nbsp;✦&nbsp;&nbsp;★</div></div></section>`;
}

function questionClip(input: { start: number; choicesStart: number; thinkingStart: number; revealStart: number; rewardStart: number; end: number; question: QuizV2["questions"][number]; questionIndex: number; count: number; visual: QuizTemplateScene; copy: Copy; assets: Record<string, string>; isFinal: boolean }): string {
  const { question, visual } = input;
  const questionLayout = textLayout(question.question, "question");
  const answer = question.choices.find((choice) => choice.id === question.correct_choice_id);
  const config = styleAttributes(visual, questionLayout, input.start, input.choicesStart, input.thinkingStart, input.revealStart, input.rewardStart, input.end);
  const classNames = ["clip", "candy-scene", "quiz-question-clip", `layout-${visual.layoutId}`, `archetype-${question.format}`, motionCssClass(visual.motionId), input.isFinal ? "is-final-scene" : ""].filter(Boolean).join(" ");
  const questionAsset = assetFor(input.assets, `asset-${question.id}-hero`, `asset-${question.id}-question`);
  const answers = answerCards(question, input.assets);
  const hero = visual.layoutId === "visual_choices_three" ? "" : imageCard(questionAsset, question.visual_opportunity || question.question, "hero-image", question.number);
  const visualAnswers = visual.layoutId === "visual_choices_three" ? visualAnswerCards(question, input.assets, input.questionIndex) : "";
  const body = `<div class="game-stage"><div class="question-title question-tier-${questionLayout.tier}"><h1>${highlightQuestionMarkup(question.question, question.visual_opportunity)}</h1></div>${hero}${visualAnswers || answers}<div class="phase-region">${thinkingBar({ start: input.thinkingStart, end: input.revealStart, copy: input.copy })}${revealPanel(input, answer?.text ?? "")}</div></div>`;
  const streak = input.questionIndex >= 2 ? " streak" : "";
  const streakCue = input.questionIndex >= 2 ? "<i aria-hidden=\"true\">✦</i>" : "";
  return `<section id="quiz-q${question.number}-${Math.round(input.start * 1000)}" class="${classNames}" ${config} data-start="${input.start.toFixed(3)}" data-duration="${Math.max(.04, input.end - input.start).toFixed(3)}" data-track-index="0"><div class="bg-gradient"></div><div class="bg-rays"></div><div class="bg-pattern pattern-circles"></div><div class="bg-pattern pattern-sprinkles"></div><div class="bg-shape shape-a" data-layout-allow-overflow></div>${sceneDecorations(input.questionIndex)}<header class="game-header"><div class="episode-progress${streak}"><span>${esc(input.copy.question)}</span><b>${question.number} / ${input.count}</b>${streakCue}</div></header>${body}${rewardFx(input.isFinal ? "big" : "small")}</section>`;
}

function transitionClip(input: { start: number; end: number; visual: QuizTemplateScene; nextPalette: QuizTemplateScene["palette"] }): string {
  if (input.end - input.start < .04) return "";
  const special = input.visual.transitionId === "lightning_brush";
  const body = special
    ? `<div class="brush brush-one"></div><div class="brush brush-two"></div><div class="transition-mark">✦</div>`
    : `<div class="splash-bed"></div><i class="splash-bubble splash-bubble-a"></i><i class="splash-bubble splash-bubble-b"></i><i class="splash-bubble splash-bubble-c"></i><i class="splash-bubble splash-bubble-d"></i><i class="splash-bubble splash-bubble-e"></i><i class="splash-bubble splash-bubble-f"></i><div class="splash-brand">✦</div><div class="splash-particles"><i>✦</i><i>•</i><i>✦</i><i>•</i></div><div class="splash-release"></div>`;
  return `<section id="candy-transition-${Math.round(input.start * 1000)}" class="clip candy-transition transition-${input.visual.transitionId}" data-layout-ignore style="--from:${input.visual.palette.accent};--to:${input.nextPalette.backgroundPrimary};--ink:${input.visual.palette.text};--clip-start:${input.start.toFixed(3)}s" data-start="${input.start.toFixed(3)}" data-duration="${(input.end - input.start).toFixed(3)}" data-track-index="1">${body}</section>`;
}

function rewardFx(intensity: "small" | "big"): string {
  const particles = intensity === "big" ? ["★", "✦", "★", "✦", "★", "✦", "★", "✦", "★"] : ["✦", "★", "✦", "★", "✦", "★", "✦"];
  return `<div class="reward-fx reward-${intensity}" data-layout-ignore>${particles.map((particle) => `<i>${particle}</i>`).join("")}</div>`;
}

function imageCard(asset: string | null, subject: string, className: string, seed: number): string {
  return `<figure class="image-card ${className}"><img src="${escAttr(asset ?? illustrationDataUri(subject, seed))}" alt="${escAttr(subject)}"><span class="image-shine"></span></figure>`;
}

export function highlightQuestionMarkup(question: string, visualOpportunity: string): string {
  const opportunityTokens = new Set(
    [...visualOpportunity.matchAll(/[\p{L}\p{N}]+/gu)]
      .map((match) => match[0]!.toLocaleLowerCase())
      .filter((token) => token.length >= 4 && !QUESTION_KEYWORD_STOP_WORDS.has(token)),
  );
  const questionTokens = [...question.matchAll(/[\p{L}\p{N}]+/gu)];
  const match = questionTokens.find((token) => opportunityTokens.has(token[0]!.toLocaleLowerCase()));
  if (!match || match.index === undefined) return esc(question);
  const end = match.index + match[0]!.length;
  return `${esc(question.slice(0, match.index))}<strong class="keyword-highlight">${esc(question.slice(match.index, end))}</strong>${esc(question.slice(end))}`;
}

const QUESTION_KEYWORD_STOP_WORDS = new Set([
  "about", "animal", "bright", "blue", "cartoon", "child", "clear", "colorful", "cool", "cute", "educational", "friendly", "globe",
  "green", "image", "illustration", "large", "object", "picture", "red", "scene", "showing", "simple", "soft", "subject", "warm", "with",
]);

function answerCards(question: QuizV2["questions"][number], assets: Record<string, string>): string {
  return `<div class="answer-grid answer-count-${question.choices.length}">${question.choices.map((choice, index) => {
    const state = "answer-" + visualAnswerState(choice.id, question.correct_choice_id, "reveal");
    const layout = textLayout(choice.text, "choice");
    const optionAsset = assetFor(assets, `asset-${question.id}-${choice.id}`);
    return `<div class="answer-card ${state} choice-tier-${layout.tier}"><b>${String.fromCharCode(65 + index)}</b>${optionAsset ? `<img src="${escAttr(optionAsset)}" alt="">` : ""}<span>${esc(choice.text)}</span>${state === "answer-correct" ? "<i class=\"answer-check\">✓</i>" : state === "answer-incorrect" ? "<i class=\"answer-cross\">×</i>" : ""}</div>`;
  }).join("")}</div>`;
}

function visualAnswerCards(question: QuizV2["questions"][number], assets: Record<string, string>, questionIndex: number): string {
  return `<div class="visual-answer-grid">${question.choices.map((choice, index) => {
    const state = "answer-" + visualAnswerState(choice.id, question.correct_choice_id, "reveal");
    const phaseSeconds = ambientPhaseSeconds("float", index, question.id);
    return `<div class="visual-answer-card ${state}" style="--item-phase:${phaseSeconds}s">${imageCard(assetFor(assets, `asset-${question.id}-${choice.id}`), choice.text, "option-image", index + question.number * 10)}<div class="visual-answer-label"><b>${String.fromCharCode(65 + index)}</b><span>${esc(choice.text)}</span></div>${state === "answer-correct" ? "<i class=\"answer-check\">✓</i>" : state === "answer-incorrect" ? "<i class=\"answer-cross\">×</i>" : ""}</div>`;
  }).join("")}</div>`;
}

function thinkingBar(input: { start: number; end: number; copy: Copy }): string {
  const style = `style="--timer-duration:${Math.max(.05, input.end - input.start).toFixed(3)}s"`;
  return `<div class="thinking-bar" ${style}><div class="thinking-label"><span>${esc(input.copy.think)}</span><b>?</b></div><div class="thinking-track" aria-label="Quiz timer" data-layout-allow-overflow><div class="timer-progress"></div><span class="timer-marker">?</span><div class="timer-sparkles" data-layout-ignore><i>✦</i><i>•</i><i>✦</i></div></div><small class="timer-caption">${esc(input.copy.lockIn)}</small></div>`;
}

function revealPanel(input: { question: QuizV2["questions"][number]; copy: Copy; isFinal: boolean }, answer: string): string {
  return `<div class="reveal-panel" aria-label="${escAttr(input.copy.correct)}"><div class="reveal-stamp">✓</div><strong>${esc(input.copy.correct)}</strong><span>${esc(answer)}</span><div class="reveal-sparkles"><i>✦</i><i>★</i><i>✦</i></div></div><div class="fact-card"><span>${esc(input.question.fun_fact ? input.copy.funFact : input.copy.why)}</span><p>${esc(input.question.fun_fact || input.question.explanation)}</p></div>`;
}

function sceneDecorations(questionIndex: number): string {
  const symbols = ["✦", "•", "○", "?", "✧", "⚡", "•"];
  return `<div class="scene-decor" data-layout-ignore aria-hidden="true">${symbols.map((symbol, index) => `<i class="decor-${index + 1}" style="--decor-phase:${ambientPhaseSeconds("drift", index, String(questionIndex))}s">${symbol}</i>`).join("")}</div>`;
}

function styleAttributes(visual: QuizTemplateScene, layout: ReturnType<typeof textLayout>, clipStart: number, choicesStart: number, thinkingStart: number, revealStart: number, rewardStart: number, clipEnd: number): string {
  const palette = visual.palette;
  return `style="--bg-primary:${palette.backgroundPrimary};--bg-secondary:${palette.backgroundSecondary};--accent:${palette.accent};--badge:${palette.answerBadge};--correct:${palette.correct};--incorrect:${palette.incorrect};--surface:${palette.surface};--ink:${palette.text};--muted:${palette.muted};--question-size:${layout.fontSize}px;--question-leading:${layout.lineHeight};--clip-start:${clipStart.toFixed(3)}s;--scene-duration:${Math.max(.04, clipEnd - clipStart).toFixed(3)}s;--choices-at:${Math.max(0, choicesStart - clipStart).toFixed(3)}s;--thinking-at:${Math.max(0, thinkingStart - clipStart).toFixed(3)}s;--reveal-at:${Math.max(0, revealStart - clipStart).toFixed(3)}s;--reward-at:${Math.max(0, rewardStart - clipStart).toFixed(3)}s;--choices-duration:${Math.max(.04, revealStart - choicesStart).toFixed(3)}s;--thinking-duration:${Math.max(.04, revealStart - thinkingStart).toFixed(3)}s;--reveal-duration:${Math.max(.04, rewardStart - revealStart).toFixed(3)}s;--ambient-phase:${ambientPhaseSeconds("drift", 0, String(clipStart))}s"`;
}

function assetFor(assets: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) if (assets[key]) return source(assets[key]);
  return null;
}

function source(value: string): string {
  if (/^(data:|https?:|file:)/i.test(value) || value.startsWith("./") || value.startsWith("../")) return value;
  return pathToFileURL(value).href;
}

function quizCopy(language: string) {
  const vietnamese = /^(vi|vietnamese|tiếng việt)/i.test(language.trim());
  return vietnamese
    ? { ready: "Sẵn sàng chơi chưa?", questions: (count: number) => count === 1 ? "câu hỏi" : "câu hỏi đầy bất ngờ", question: "Câu", getReady: "Quan sát thật kỹ nhé!", choose: "Chọn một đáp án", think: "Cùng suy nghĩ nào!", lockIn: "Chốt đáp án nhé!", time: "Sắp hết giờ!", correct: "Đúng rồi!", why: "Chính xác!", funFact: "Bạn có biết?", final: "Thử thách cuối", scorePrompt: "Bạn đúng được mấy câu?", playAgain: "Chơi lại nhé" }
    : { ready: "Ready to play?", questions: (count: number) => count === 1 ? "question" : "questions to explore", question: "Question", getReady: "Look closely and get ready!", choose: "Choose one", think: "Think it through!", lockIn: "Lock in your answer!", time: "Final seconds!", correct: "Correct answer!", why: "That's right!", funFact: "Did you know?", final: "Final challenge", scorePrompt: "How many did you get right?", playAgain: "Play again soon" };
}

function illustrationDataUri(subject: string, seed: number): string {
  const hue = (seed * 41) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 92% 66%)"/><stop offset="1" stop-color="hsl(${(hue + 55) % 360} 82% 48%)"/></linearGradient></defs><rect width="800" height="520" rx="58" fill="url(#g)"/><g opacity=".18" fill="#fff"><circle cx="91" cy="103" r="40"/><circle cx="694" cy="108" r="61"/><circle cx="707" cy="419" r="32"/></g>${fallbackSubjectArtwork(subject, hue)}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function fallbackSubjectArtwork(subject: string, hue: number): string {
  const value = subject.toLocaleLowerCase();
  if (/(ocean|pacific|earth|planet|globe)/.test(value)) return `<circle cx="400" cy="255" r="150" fill="#dff7ff"/><path d="M270 180c50-38 83 16 120 2s64-47 120-20 52 51 39 91c-22 69-97 123-176 128-79-6-135-59-146-117 3-38 8-58 43-84Z" fill="#35b7e6"/><path d="M315 183c34 11 43 43 74 38 35-5 46-41 91-29 31 8 53 24 67 48M266 266c53-25 68 20 110 13 48-8 58-41 108-27 25 7 44 18 61 37M300 328c49-22 82 13 123 4 35-8 59-36 91-13" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/><circle cx="454" cy="189" r="22" fill="#a6e368"/><path d="M328 262c20-31 54-36 76-15-24 8-42 33-49 58-28-6-44-21-27-43Z" fill="#a6e368"/>`;
  if (/cheetah/.test(value)) return `<path d="M158 320c70-14 102-66 177-53 76 13 110-34 176-11 42 15 82 50 102 83l-33 20-54-29-18 65-50-7-24-74-102 8-48 70-50-11 29-70-82 16Z" fill="#ffbf4c"/><circle cx="559" cy="259" r="63" fill="#ffbf4c"/><path d="M546 205l24-38 23 42M597 208l38-21-13 44" fill="#ffbf4c"/><circle cx="577" cy="247" r="7" fill="#26355b"/><circle cx="614" cy="247" r="7" fill="#26355b"/><path d="M582 275q17 14 34 0" stroke="#26355b" stroke-width="8" fill="none" stroke-linecap="round"/>${Array.from({ length: 13 }, (_, index) => `<circle cx="${235 + (index * 47) % 295}" cy="${278 + (index * 31) % 85}" r="9" fill="#74453c"/>`).join("")}`;
  if (/elephant/.test(value)) return `<circle cx="400" cy="260" r="143" fill="#aeb9ca"/><circle cx="279" cy="266" r="89" fill="#c8d2df"/><circle cx="521" cy="266" r="89" fill="#c8d2df"/><path d="M369 261c0 126 14 143 35 143s35-17 35-143v70c0 38 19 46 40 28" fill="none" stroke="#aeb9ca" stroke-width="43" stroke-linecap="round"/><circle cx="360" cy="237" r="10" fill="#243257"/><circle cx="440" cy="237" r="10" fill="#243257"/><path d="M374 280q26 20 52 0" stroke="#243257" stroke-width="9" fill="none" stroke-linecap="round"/>`;
  if (/turtle/.test(value)) return `<ellipse cx="394" cy="277" rx="151" ry="112" fill="#45bd72"/><path d="M286 276q108-108 216 0-108 108-216 0Z" fill="#7bd75b"/><path d="M320 236l72 42-72 42M468 236l-72 42 72 42" fill="none" stroke="#42a860" stroke-width="17" stroke-linejoin="round"/><circle cx="560" cy="274" r="50" fill="#8be171"/><circle cx="574" cy="264" r="8" fill="#243257"/><path d="M573 293h15" stroke="#243257" stroke-width="8" stroke-linecap="round"/><ellipse cx="262" cy="188" rx="47" ry="24" fill="#8be171"/><ellipse cx="262" cy="358" rx="47" ry="24" fill="#8be171"/>`;
  if (/(geometric|shapes)/.test(value)) return `<circle cx="253" cy="277" r="91" fill="#ffcf48" stroke="#fff" stroke-width="16"/><rect x="347" y="178" width="180" height="180" rx="22" fill="#5f70e8" stroke="#fff" stroke-width="16"/><path d="M614 161 741 380H487Z" fill="#4ed17a" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>`;
  if (/triangle/.test(value)) return `<path d="M400 103 654 401H146Z" fill="#ffd34d" stroke="#fff" stroke-width="18" stroke-linejoin="round"/>`;
  if (/square/.test(value)) return `<rect x="239" y="94" width="322" height="322" rx="24" fill="#5a69de" stroke="#fff" stroke-width="18"/>`;
  if (/circle|moon/.test(value)) return `<circle cx="400" cy="255" r="154" fill="#ffd34d" stroke="#fff" stroke-width="18"/><circle cx="347" cy="203" r="24" fill="#f0ab3d" opacity=".6"/><circle cx="452" cy="302" r="32" fill="#f0ab3d" opacity=".6"/>`;
  if (/comet/.test(value)) return `<path d="M185 360c121-20 200-90 287-218-22 128-82 223-211 276Z" fill="#fff4b0" opacity=".72"/><circle cx="514" cy="150" r="84" fill="#fff4b0"/><path d="M480 116l68 68M548 116l-68 68" stroke="#ff9c49" stroke-width="18" stroke-linecap="round"/>`;
  if (/(leaf|plant|carbon|dioxide|gas)/.test(value)) return `<path d="M390 416c6-143 59-228 167-286-7 117-55 223-167 286Z" fill="#6fd66a"/><path d="M388 416C299 346 255 263 254 143c111 39 165 129 134 273Z" fill="#9fe779"/><path d="M398 406 306 193M398 406 520 177" stroke="#2f9867" stroke-width="16" stroke-linecap="round"/>`;
  return `<circle cx="400" cy="255" r="160" fill="#fff" opacity=".94"/><path d="M400 156l31 63 70 10-51 50 12 70-62-33-62 33 12-70-51-50 70-10z" fill="hsl(${(hue + 35) % 360} 95% 52%)"/>`;
}

function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function escAttr(value: string): string { return esc(value); }

function candyArcadeCss(): string {
  return `
@font-face { font-family: "Candy Rounded"; src: local("Arial Rounded MT Bold"), local("Arial Rounded MT"), local("Trebuchet MS"); font-weight: 900; }
:root { font-family: "Candy Rounded", "Trebuchet MS", sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #16285c; }
#stage { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
.clip { position: absolute; inset: 0; }
.candy-scene { --depth-edge: rgba(13,35,71,.16); --depth-shadow: rgba(13,35,71,.22); isolation: isolate; overflow: hidden; padding: 60px 96px 54px; background: var(--bg-primary); color: var(--ink); }
.bg-gradient { position: absolute; z-index: 0; inset: 0; background: linear-gradient(135deg, var(--bg-primary), var(--bg-secondary)); }
.bg-gradient::after { position: absolute; top: 3%; left: 9%; width: 460px; height: 250px; border-radius: 50%; background: rgba(255,255,255,.16); content: ""; transform: rotate(-15deg); }
.bg-rays { position: absolute; z-index: 1; top: 45%; left: 50%; width: 1640px; height: 1640px; opacity: .13; background: repeating-conic-gradient(from 8deg, rgba(255,255,255,.9) 0 7deg, transparent 7deg 18deg); transform: translate(-50%,-50%); animation: ray-spin var(--scene-duration) linear var(--clip-start) 1 both; }
.bg-pattern { position: absolute; z-index: 1; opacity: .085; pointer-events: none; }
.pattern-circles { inset: 0; background-image: repeating-linear-gradient(45deg, transparent 0 23px, rgba(255,255,255,.9) 24px 27px, transparent 28px 52px); background-size: 82px 82px; animation: drift var(--scene-duration) linear var(--clip-start) 1 both; }
.pattern-sprinkles { right: -110px; bottom: -135px; width: 620px; height: 620px; border: 35px dotted rgba(255,255,255,.7); border-radius: 50%; transform: rotate(-14deg); }
.bg-shape { position: absolute; z-index: 1; border-radius: 48% 52% 43% 57%; background: rgba(255,255,255,.11); animation: ambient-drift var(--scene-duration) ease-in-out var(--clip-start) 1 alternate both; }
.shape-a { top: 17%; right: 7%; width: 310px; height: 190px; transform: rotate(-15deg); }
.shape-b { bottom: 10%; left: -4%; width: 360px; height: 250px; border-radius: 63% 37% 54% 46%; animation-delay: -7s; }
.shape-c { right: 24%; bottom: -8%; width: 290px; height: 210px; opacity: .7; animation-delay: -12s; }
.game-header { position: relative; z-index: 3; display: flex; align-items: center; justify-content: flex-start; }
.episode-progress { display: inline-flex; align-items: center; gap: 12px; width: max-content; padding: 13px 18px; border: 4px solid rgba(255,255,255,.73); border-radius: 999px; background: var(--surface); box-shadow: 0 9px 0 rgba(13,35,71,.2); font-size: 23px; font-weight: 900; }
.episode-progress b { padding-left: 12px; border-left: 3px solid rgba(21,42,87,.15); font-variant-numeric: tabular-nums; }
.game-stage { position: relative; z-index: 3; display: grid; justify-items: center; width: 1600px; margin: 20px auto 0; }
.question-title { max-width: 1550px; padding: 25px 58px 27px; border: 6px solid rgba(255,255,255,.84); border-radius: 43px; background: var(--surface); box-shadow: 0 18px 0 var(--depth-shadow); text-align: center; }
.question-title h1 { margin: 0; font-size: var(--question-size); font-weight: 900; line-height: var(--question-leading); letter-spacing: -2.4px; text-wrap: balance; text-shadow: 0 4px 0 rgba(13,35,71,.12); }
.keyword-highlight { color: var(--accent); text-shadow: 0 3px 0 rgba(13,35,71,.1); }
.image-card { position: relative; display: block; margin: 0; overflow: hidden; border: 12px solid #fff; border-radius: 42px; background: #fff; box-shadow: 0 20px 0 rgba(13,35,71,.2), 0 29px 44px rgba(13,35,71,.18); }
.image-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.image-shine { position: absolute; inset: 0; background: linear-gradient(125deg, rgba(255,255,255,.35), transparent 31%); pointer-events: none; }
.game-stage > .hero-image { width: ${CANDY_ARCADE_LAYOUT_DIMENSIONS.baseline.width}px; height: ${CANDY_ARCADE_LAYOUT_DIMENSIONS.baseline.height}px; margin-top: 20px; }
.hero-image img { transform-origin: center; animation: hero-ken-burn var(--scene-duration) ease-in-out var(--clip-start) 1 alternate both; }
.layout-media_left_choices_right .game-stage { grid-template-columns: minmax(0, 1.08fr) minmax(520px, .92fr); grid-template-areas: "title title" "hero answers" "phase phase"; align-items: center; column-gap: 42px; row-gap: 18px; }
.layout-media_left_choices_right .question-title { grid-area: title; width: 100%; }
.layout-media_left_choices_right .game-stage > .hero-image { grid-area: hero; width: 100%; height: 420px; margin-top: 0; }
.layout-media_left_choices_right .answer-grid { grid-area: answers; grid-template-columns: 1fr; width: 100%; margin-top: 0; gap: 18px; }
.layout-media_left_choices_right .answer-card { min-height: 112px; padding: 15px 22px 15px 16px; font-size: 30px; }
.layout-media_center_choices_side .game-stage { grid-template-columns: minmax(0, 1.08fr) minmax(520px, .92fr); grid-template-areas: "title title" "hero answers" "phase phase"; align-items: center; column-gap: 42px; row-gap: 18px; }
.layout-media_center_choices_side .question-title { grid-area: title; width: 100%; }
.layout-media_center_choices_side .game-stage > .hero-image { grid-area: hero; width: 100%; height: 420px; margin-top: 0; }
.layout-media_center_choices_side .answer-grid { grid-area: answers; grid-template-columns: 1fr; width: 100%; margin-top: 0; gap: 18px; }
.layout-media_center_choices_side .answer-card { min-height: 112px; padding: 15px 22px 15px 16px; font-size: 30px; }
.layout-media_top_choices_bottom .game-stage { grid-template-columns: 1fr; grid-template-areas: "title" "hero" "answers" "phase"; row-gap: 14px; }
.layout-media_top_choices_bottom .question-title { grid-area: title; width: 100%; }
.layout-media_top_choices_bottom .game-stage > .hero-image { grid-area: hero; width: 780px; height: 260px; margin-top: 0; }
.layout-media_top_choices_bottom .answer-grid { grid-area: answers; width: 1540px; margin-top: 0; }
.layout-media_top_choices_bottom .answer-card { min-height: 94px; padding: 12px 18px 12px 16px; font-size: 26px; }
.layout-media_top_choices_bottom .answer-grid { gap: 14px; }
.layout-visual_choices_three .game-stage { grid-template-columns: 1fr; grid-template-areas: "title" "answers" "phase"; row-gap: 14px; }
.layout-visual_choices_three .question-title { grid-area: title; width: 100%; }
.layout-visual_choices_three .visual-answer-grid { grid-area: answers; margin-top: 0; }
.phase-region { position: relative; grid-area: phase; width: 100%; height: 178px; }
.phase-region > .thinking-bar, .phase-region > .reveal-panel, .phase-region > .fact-card { position: absolute; top: 0; left: 50%; margin-top: 0; transform: translateX(-50%); }
.phase-region > .thinking-bar { width: min(1380px, 100%); min-height: 158px; }
.phase-region > .reveal-panel { width: min(1160px, 100%); }
.phase-region > .fact-card { width: min(1220px, 100%); }
.answer-grid { display: grid; gap: 24px; width: 1540px; margin-top: 25px; opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--choices-at)) both; }
.answer-count-2 { grid-template-columns: repeat(2, 1fr); }
.answer-count-3 { grid-template-columns: repeat(3, 1fr); }
.answer-count-4, .answer-count-5, .answer-count-6 { grid-template-columns: repeat(2, 1fr); }
.answer-card { position: relative; display: flex; align-items: center; min-height: 148px; gap: 19px; padding: 20px 30px 20px 20px; overflow: hidden; border: 5px solid rgba(17,39,84,.14); border-radius: 38px; background: var(--surface); box-shadow: 0 14px 0 var(--depth-shadow), inset 0 4px 0 rgba(255,255,255,.7); font-size: 34px; font-weight: 900; }
.answer-card::after { position: absolute; right: -35px; bottom: -41px; width: 118px; height: 118px; border-radius: 50%; background: var(--muted); content: ""; }
.answer-card > b, .visual-answer-label > b { position: relative; z-index: 1; display: grid; flex: 0 0 auto; place-items: center; width: 66px; height: 66px; border-radius: 23px; background: var(--badge); color: #fff; box-shadow: inset 0 -5px 0 rgba(13,35,71,.14); font-size: 35px; }
.answer-card:nth-child(2) > b { background: var(--accent); }
.answer-card:nth-child(3) > b { background: #F6B83D; }
.answer-card span { position: relative; z-index: 1; flex: 1 1 auto; min-width: 0; padding-right: 54px; line-height: 1.1; }
.answer-card img { position: relative; z-index: 1; width: 62px; height: 62px; border-radius: 18px; object-fit: cover; }
.choice-tier-long span, .choice-tier-very_long span { font-size: 28px; }
.answer-card.answer-correct { animation: correct-card-reveal .62s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reveal-at) + .14s) both; }
.answer-card.answer-incorrect { animation: incorrect-card-settle .38s ease-out calc(var(--clip-start) + var(--reveal-at)) both; }
.answer-check, .answer-cross { position: absolute; z-index: 2; top: 16px; right: 19px; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: var(--correct); color: #fff; box-shadow: 0 5px 0 rgba(13,35,71,.16); font-size: 31px; font-style: normal; opacity: 0; animation: status-pop .38s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reveal-at) + .16s) both; }
.answer-cross { background: var(--incorrect); }
.thinking-bar { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 18px 24px; width: 1380px; min-height: 164px; margin-top: 24px; padding: 24px 32px; border: 6px solid rgba(255,255,255,.88); border-radius: 42px; background: rgba(255,255,255,.95); box-shadow: 0 16px 0 var(--depth-shadow), inset 0 4px 0 rgba(255,255,255,.9); opacity: 0; animation: phase-hold var(--thinking-duration) steps(1,end) calc(var(--clip-start) + var(--thinking-at)) both; }
.thinking-label { display: flex; align-items: center; gap: 15px; font-size: 30px; font-weight: 900; }
.thinking-label b { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 19px; background: var(--accent); color: #fff; box-shadow: inset 0 -5px 0 rgba(13,35,71,.13); font-size: 37px; }
.thinking-track { position: relative; height: 48px; overflow: visible; border: 5px solid #fff; border-radius: 999px; background: #DDE8EF; box-shadow: inset 0 4px 0 rgba(13,35,71,.12), 0 7px 0 var(--depth-edge); }
.thinking-track::after { position: absolute; inset: 8px 12px; border-radius: inherit; background: repeating-linear-gradient(90deg, rgba(21,42,87,.12) 0 2px, transparent 2px 12.5%); content: ""; pointer-events: none; }
.timer-progress { position: absolute; inset: 0; overflow: visible; border-radius: inherit; background: linear-gradient(90deg, #2FBE79 0 56%, #F8CD49 78%, #F58A4B 100%); transform-origin: left center; animation: quiz-timer-drain var(--timer-duration) linear var(--clip-start) both; }
.timer-marker { position: absolute; top: 50%; left: 100%; display: grid; place-items: center; width: 76px; height: 76px; border: 7px solid #fff; border-radius: 50%; background: var(--accent); color: #fff; box-shadow: 0 8px 0 rgba(13,35,71,.24), inset 0 -5px 0 rgba(13,35,71,.14); font-size: 36px; font-weight: 900; font-style: normal; transform: translate(-50%,-50%); animation: quiz-timer-marker-slide var(--timer-duration) linear var(--clip-start) both; }
.timer-marker::after { position: absolute; inset: -10px; border: 3px dashed rgba(255,255,255,.68); border-radius: 50%; content: ""; transform: rotate(-8deg); }
.timer-sparkles { position: absolute; inset: -20px -14px; pointer-events: none; }
.timer-sparkles i { position: absolute; color: var(--accent); font-size: 24px; font-style: normal; animation: timer-sparkle var(--timer-duration) ease-in-out calc(var(--clip-start) + var(--ambient-phase)) 1 both; }
.timer-sparkles i:nth-child(1) { right: 7%; top: -17px; }.timer-sparkles i:nth-child(2) { right: 1%; bottom: -15px; color: #FFD34D; font-size: 18px; animation-delay: calc(var(--clip-start) + .55s); }.timer-sparkles i:nth-child(3) { left: 4%; top: -14px; color: #fff; animation-delay: calc(var(--clip-start) + 1.05s); }
.timer-caption { grid-column: 2; margin-top: -8px; color: rgba(21,42,87,.64); font-size: 19px; font-weight: 900; }
.reveal-panel { display: grid; justify-items: center; gap: 5px; margin-top: 18px; color: #fff; text-shadow: 0 7px 0 rgba(13,35,71,.18); opacity: 0; animation: phase-hold var(--reveal-duration) steps(1,end) calc(var(--clip-start) + var(--reveal-at)) both; }
.reveal-panel strong { font-size: 44px; animation: reveal-pop .46s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + .16s) both; }
.reveal-panel > span { font-size: 30px; font-weight: 900; animation: reveal-answer-in .4s cubic-bezier(.22,.8,.3,1) calc(var(--clip-start) + .25s) both; }
.reveal-stamp { display: grid; place-items: center; width: 88px; height: 88px; border: 7px solid #fff; border-radius: 50%; background: var(--correct); box-shadow: 0 9px 0 rgba(13,35,71,.24); font-size: 54px; animation: stamp-pop .5s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + .28s) both; }
.reveal-sparkles { display: flex; justify-content: center; gap: 46px; margin-top: 6px; color: #fff; font-size: 44px; }
.reveal-sparkles i { font-style: normal; }
.reveal-sparkles i:nth-child(2) { color: #ffd34d; transform: translateY(-12px); }
.fact-card { max-width: 1220px; margin-top: 22px; padding: 20px 38px 23px; border: 6px solid rgba(255,255,255,.79); border-radius: 35px; background: var(--surface); box-shadow: 0 15px 0 rgba(13,35,71,.18); text-align: center; opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--reward-at)) both; }
.fact-card span { color: var(--accent); font-size: 22px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; }
.fact-card p { margin: 8px 0 0; font-size: 30px; font-weight: 800; line-height: 1.24; }
.visual-answer-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 28px; width: 1560px; margin-top: 25px; opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--choices-at)) both; }
.visual-answer-card { position: relative; }
.option-image { width: 100%; height: 372px; border-width: 12px; border-radius: 40px; }
.visual-answer-label { position: relative; z-index: 2; display: flex; align-items: center; gap: 13px; min-height: 82px; margin: -28px 22px 0; padding: 12px 18px; border: 5px solid rgba(17,39,84,.13); border-radius: 28px; background: var(--surface); box-shadow: 0 11px 0 var(--depth-shadow), inset 0 4px 0 rgba(255,255,255,.72); font-size: 29px; font-weight: 900; }
.visual-answer-label > b { width: 48px; height: 48px; border-radius: 16px; font-size: 27px; }
.visual-answer-card.answer-correct .option-image { animation: visual-correct-reveal .62s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reveal-at) + .14s) both; }
.visual-answer-card.answer-incorrect { animation: incorrect-card-settle .38s ease-out calc(var(--clip-start) + var(--reveal-at)) both; }
.quiz-question-clip .hero-image { animation: hero-enter .62s cubic-bezier(.22,.8,.3,1) var(--clip-start) both, hero-float var(--scene-duration) ease-in-out calc(var(--clip-start) + .62s) 1 alternate both; }
.reward-fx { position: absolute; z-index: 4; inset: 0; color: #fff; pointer-events: none; text-shadow: 0 7px 0 rgba(13,35,71,.18); opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--reward-at)) both; }
.reward-fx i { position: absolute; font-size: 51px; font-style: normal; animation: star-burst .72s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reward-at)) both; }
.reward-fx i:nth-child(1) { left: 5%; top: 34%; }.reward-fx i:nth-child(2) { right: 6%; top: 38%; animation-delay: calc(var(--clip-start) + .06s); }.reward-fx i:nth-child(3) { left: 9%; bottom: 18%; animation-delay: calc(var(--clip-start) + .12s); }.reward-fx i:nth-child(4) { right: 10%; bottom: 16%; animation-delay: calc(var(--clip-start) + .18s); }.reward-fx i:nth-child(5) { left: 3%; top: 58%; animation-delay: calc(var(--clip-start) + .24s); }.reward-fx i:nth-child(6) { right: 3%; top: 61%; animation-delay: calc(var(--clip-start) + .3s); }.reward-fx i:nth-child(7) { left: 7%; bottom: 8%; animation-delay: calc(var(--clip-start) + .36s); }
.reward-fx i:nth-child(8) { right: 18%; top: 20%; animation-delay: calc(var(--clip-start) + .42s); }.reward-fx i:nth-child(9) { left: 20%; bottom: 23%; animation-delay: calc(var(--clip-start) + .48s); }
.reward-small i { font-size: 57px; }
.reward-big i { font-size: 71px; }
.episode-progress.streak { animation: progress-pop .52s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + .12s) both; }
.episode-progress.streak i { margin-left: 2px; color: #FFD34D; font-size: 24px; font-style: normal; }
.quiz-question-clip::after { position: absolute; z-index: 2; top: 58%; left: 50%; width: 980px; height: 440px; border: 26px solid rgba(255,255,255,.54); border-radius: 50%; content: ""; pointer-events: none; transform: translate(-50%,-50%) scale(.45); animation: reveal-impact .7s ease-out calc(var(--clip-start) + var(--reveal-at) + .04s) both; }
.is-final-scene .question-title { border-color: #FFD64D; box-shadow: 0 18px 0 rgba(255,212,77,.38); }
.quiz-question-clip .question-title { animation: title-enter .58s cubic-bezier(.18,1.42,.34,1) var(--clip-start) both; }
.layout-media_left_choices_right.quiz-question-clip .hero-image { animation: enter-from-left .66s cubic-bezier(.22,.8,.3,1) var(--clip-start) both, hero-float var(--scene-duration) ease-in-out calc(var(--clip-start) + .66s) 1 alternate both; }
.layout-media_top_choices_bottom.quiz-question-clip .hero-image { animation: enter-from-right .66s cubic-bezier(.22,.8,.3,1) var(--clip-start) both, hero-float var(--scene-duration) ease-in-out calc(var(--clip-start) + .66s) 1 alternate both; }
.candy-transition { position: absolute; z-index: 10; inset: 0; overflow: hidden; background: transparent; pointer-events: none; }
.transition-bubble_splash { background: transparent; }
.splash-bed { position: absolute; inset: 0; background: var(--from); opacity: 0; transform: scale(.96); animation: splash-bed .86s cubic-bezier(.22,.8,.3,1) var(--clip-start) both; }
.splash-bubble { position: absolute; display: block; width: 840px; height: 840px; border: 12px solid rgba(255,255,255,.72); border-radius: 46% 54% 58% 42%; background: var(--bubble-color, var(--from)); box-shadow: 0 22px 0 rgba(13,35,71,.16), inset 0 10px 0 rgba(255,255,255,.18); opacity: 0; transform: scale(.12) rotate(-12deg); animation: bubble-splash-attack .86s cubic-bezier(.18,1.42,.34,1) var(--clip-start) both; }
.splash-bubble-a { left: -210px; top: -280px; --bubble-color: var(--from); }.splash-bubble-b { right: -230px; top: -230px; --bubble-color: var(--to); animation-delay: calc(var(--clip-start) + .04s); }.splash-bubble-c { left: 220px; bottom: -380px; --bubble-color: var(--to); animation-delay: calc(var(--clip-start) + .08s); }.splash-bubble-d { right: 160px; bottom: -360px; --bubble-color: var(--from); animation-delay: calc(var(--clip-start) + .12s); }.splash-bubble-e { left: 590px; top: -430px; width: 700px; height: 700px; --bubble-color: var(--to); animation-delay: calc(var(--clip-start) + .16s); }.splash-bubble-f { right: 500px; bottom: -430px; width: 680px; height: 680px; --bubble-color: var(--from); animation-delay: calc(var(--clip-start) + .2s); }
.splash-brand { position: absolute; top: 50%; left: 50%; display: grid; place-items: center; width: 152px; height: 152px; border: 9px solid #fff; border-radius: 46px; background: var(--to); color: #fff; box-shadow: 0 18px 0 rgba(13,35,71,.27), inset 0 -8px 0 rgba(13,35,71,.12); font-size: 82px; opacity: 0; transform: translate(-50%,-50%) scale(0) rotate(-22deg); animation: splash-brand-hit .86s cubic-bezier(.18,1.42,.34,1) var(--clip-start) both; }
.splash-particles { position: absolute; top: 50%; left: 50%; color: #fff; font-size: 36px; text-shadow: 0 6px 0 rgba(13,35,71,.2); }
.splash-particles i { position: absolute; font-style: normal; opacity: 0; animation: splash-particle .6s ease-out calc(var(--clip-start) + .34s) both; }.splash-particles i:nth-child(1) { transform: translate(-190px,-80px); }.splash-particles i:nth-child(2) { transform: translate(170px,-115px); color: #FFD34D; animation-delay: calc(var(--clip-start) + .38s); }.splash-particles i:nth-child(3) { transform: translate(190px,90px); animation-delay: calc(var(--clip-start) + .42s); }.splash-particles i:nth-child(4) { transform: translate(-160px,110px); color: #FFD34D; animation-delay: calc(var(--clip-start) + .46s); }
.splash-release { position: absolute; inset: 0; border: 24px solid rgba(255,255,255,.34); opacity: 0; transform: scale(1.08); animation: splash-release .86s ease-out calc(var(--clip-start) + .42s) both; }
.brush { position: absolute; inset: -13% -35%; border-radius: 48% 52% 43% 57%; background: var(--from); transform: translateX(-115%) rotate(-8deg); animation: brush-wave .8s cubic-bezier(.25,.8,.35,1) var(--clip-start) both; }
.brush-two { background: var(--to); transform: translateX(-115%) rotate(8deg) scale(.82); animation-delay: calc(var(--clip-start) + .08s); }
.transition-lightning_brush .brush { border: 18px solid rgba(255,255,255,.38); }
.transition-mark { position: absolute; top: 50%; left: 50%; display: grid; place-items: center; width: 146px; height: 146px; border: 9px solid #fff; border-radius: 47px; background: var(--from); color: #fff; box-shadow: 0 18px 0 rgba(13,35,71,.25); font-size: 82px; transform: translate(-50%,-50%) scale(0) rotate(-26deg); animation: mark-pop .8s cubic-bezier(.18,1.42,.34,1) var(--clip-start) both; }
.candy-intro, .candy-outro { display: grid; place-items: center; background: #F6B83D; color: #172A59; }
.intro-rays { position: absolute; inset: -30%; opacity: .24; background: repeating-conic-gradient(from 8deg, rgba(255,255,255,.9) 0 9deg, transparent 9deg 19deg); animation: ray-spin 16s linear 0s 1 both; }
.intro-card, .outro-card { position: relative; z-index: 3; display: grid; justify-items: center; text-align: center; }
.intro-card > span, .outro-card > span { display: inline-flex; padding: 15px 23px; border-radius: 999px; background: #FF6277; color: #fff; box-shadow: 0 10px 0 rgba(13,35,71,.18); font-size: 25px; font-weight: 900; letter-spacing: 1.5px; }
.intro-card h1, .outro-card h1 { max-width: 1050px; margin: 29px 0 9px; font-size: 96px; line-height: 1.02; letter-spacing: -4px; }
.intro-card p, .outro-card p { margin: 0; font-size: 37px; font-weight: 900; }
.intro-stars, .outro-stars { margin-top: 35px; color: #fff; font-size: 43px; }
.intro-dot { position: absolute; border-radius: 50%; background: #fff; opacity: .47; }.dot-a { top: 126px; left: 250px; width: 158px; height: 158px; }.dot-b { right: 235px; bottom: 149px; width: 128px; height: 128px; }
.brand-mascot { position: absolute; z-index: 3; right: 255px; bottom: 95px; display: grid; place-items: center; width: 179px; height: 179px; border: 10px solid #fff; border-radius: 53px; background: #29B9A8; color: #fff; box-shadow: 0 20px 0 rgba(13,35,71,.2); font-size: 93px; transform: rotate(-8deg); }
.outro-blob { position: absolute; border-radius: 50%; background: rgba(255,255,255,.36); }.outro-blob.blob-a { top: 112px; left: 205px; width: 170px; height: 170px; }.outro-blob.blob-b { right: 220px; bottom: 130px; width: 205px; height: 205px; background: rgba(41,185,168,.36); }
.scene-decor { position: absolute; z-index: 2; inset: 0; pointer-events: none; color: rgba(255,255,255,.62); }
.scene-decor i { position: absolute; display: block; font-style: normal; animation: decor-drift var(--scene-duration) ease-in-out var(--clip-start) 1 alternate both; }
.decor-1 { top: 21%; left: 5%; font-size: 34px; color: var(--accent); }.decor-2 { top: 40%; left: 3%; font-size: 26px; }.decor-3 { top: 13%; right: 12%; font-size: 48px; color: var(--accent); }.decor-4 { right: 5%; bottom: 30%; font-size: 42px; color: rgba(255,255,255,.48); }.decor-5 { left: 18%; bottom: 11%; font-size: 31px; color: #FFD34D; }.decor-6 { right: 24%; top: 28%; font-size: 25px; color: #FFD34D; }.decor-7 { left: 30%; top: 8%; font-size: 18px; }
@keyframes ray-spin { to { transform: translate(-50%,-50%) rotate(360deg); } }
@keyframes drift { to { background-position: 230px 160px; } }
@keyframes ambient-drift { to { transform: translate(24px,-19px) rotate(8deg); } }
@keyframes hero-float { 50% { transform: translateY(-8px) rotate(1deg); } }
@keyframes answer-float { 50% { transform: translateY(-4px) rotate(.25deg); } }
@keyframes decor-drift { 50% { transform: translate(4px,-7px) rotate(2deg); } }
@keyframes title-enter { from { opacity: 0; transform: translateY(28px) scale(.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes hero-enter { from { opacity: 0; transform: translateY(42px) scale(.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes answer-enter { from { opacity: 0; transform: translateY(32px) scale(.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes enter-from-left { from { opacity: 0; transform: translateX(-60px) scale(.94); } to { opacity: 1; transform: translateX(0) scale(1); } }
@keyframes enter-from-right { from { opacity: 0; transform: translateX(60px) scale(.94); } to { opacity: 1; transform: translateX(0) scale(1); } }
@keyframes phase-enter { to { opacity: 1; } }
@keyframes phase-hold { 0%,100% { opacity: 0; } 1%,99% { opacity: 1; } }
@keyframes quiz-timer-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes quiz-timer-marker-slide { from { left: 100%; } to { left: 0%; } }
@keyframes timer-sparkle { 50% { transform: translateY(-4px) scale(1.16) rotate(12deg); opacity: .7; } }
@keyframes correct-card-reveal { 0% { transform: translateY(0) scale(1); } 55% { transform: translateY(-13px) scale(1.12); } 76% { transform: translateY(-2px) scale(1.015); } 100% { transform: translateY(-5px) scale(1.04); } }
@keyframes visual-correct-reveal { 0% { border-color: #fff; transform: translateY(0) scale(1); } 55% { border-color: var(--correct); transform: translateY(-13px) scale(1.12); } 100% { border-color: var(--correct); transform: translateY(-4px) scale(1.035); } }
@keyframes incorrect-card-settle { from { opacity: 1; transform: scale(1); } to { opacity: .52; transform: scale(.98); } }
@keyframes status-pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
@keyframes cross-pop { 0% { transform: scale(0); } 65% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes hero-reveal-push { from { transform: scale(1); } to { transform: scale(1.035); } }
@keyframes hero-ken-burn { from { transform: scale(1); } to { transform: scale(1.06); } }
@keyframes reveal-pop { from { opacity: 0; transform: scale(.7) rotate(-5deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes reveal-answer-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes stamp-pop { 0% { opacity: 0; transform: scale(0) rotate(-18deg); } 68% { opacity: 1; transform: scale(1.18) rotate(6deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes star-burst { from { opacity: 0; transform: translateY(28px) scale(.2) rotate(-28deg); } to { opacity: 1; transform: translateY(0) scale(1) rotate(0); } }
@keyframes reveal-impact { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.45); } 25% { opacity: .95; transform: translate(-50%,-50%) scale(1); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.12); } }
@keyframes progress-pop { 0% { transform: scale(1); } 58% { transform: scale(1.08); } 100% { transform: scale(1); } }
@keyframes brush-wave { 0% { transform: translateX(-115%); } 48% { transform: translateX(-10%); } 100% { transform: translateX(115%); } }
@keyframes mark-pop { 0%, 18% { transform: translate(-50%,-50%) scale(0) rotate(-26deg); } 52% { transform: translate(-50%,-50%) scale(1.15) rotate(8deg); } 74%, 100% { transform: translate(-50%,-50%) scale(1) rotate(0); } }
@keyframes splash-bed { 0%, 28% { opacity: 0; transform: scale(.96); } 48% { opacity: .94; transform: scale(1); } 78% { opacity: .94; } 100% { opacity: 0; transform: scale(1.04); } }
@keyframes bubble-splash-attack { 0% { opacity: 0; transform: scale(.12) rotate(-12deg); } 34% { opacity: 1; transform: scale(1.04) rotate(4deg); } 56% { opacity: 1; transform: scale(1.08) rotate(0); } 100% { opacity: 0; transform: scale(1.22) rotate(8deg); } }
@keyframes splash-brand-hit { 0%, 32% { opacity: 0; transform: translate(-50%,-50%) scale(0) rotate(-22deg); } 53% { opacity: 1; transform: translate(-50%,-50%) scale(1.16) rotate(8deg); } 67% { opacity: 1; transform: translate(-50%,-50%) scale(1) rotate(0); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(.92) rotate(0); } }
@keyframes splash-particle { 0% { opacity: 0; } 35% { opacity: 1; } 100% { opacity: 0; transform: translate(0,0) scale(.4); } }
@keyframes splash-release { 0%, 55% { opacity: 0; transform: scale(1.08); } 72% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(.98); } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; } }
`;
}
