import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DirectorPlan, QuizConfig, QuizTimeline, QuizV2 } from "@studio/shared";
import { getQuizVisualTemplate } from "../visual/registry.js";
import { ambientPhaseSeconds, motionCssClass, textLayout, visualAnswerState } from "../visual/candyArcade.js";
import type { QuizTemplateScene } from "../visual/types.js";
import { defaultBgmRegistry } from "../audio/bgmRegistry.js";


export type CandyArcadeCompositionInput = {
  quiz: QuizV2;
  director: DirectorPlan;
  timeline: QuizTimeline;
  theme: QuizConfig["visual_theme"];
  audioPath: string;
  narrationDurationSeconds: number;
  assets?: Record<string, string>;
};

export type CandyArcadeCompositionBundle = {
  html: string;
  files: Record<string, string>;
};

type Copy = ReturnType<typeof quizCopy>;
type Phase = "question" | "choices" | "think" | "countdown" | "reveal" | "explain";

export const CANDY_ARCADE_LAYOUT_DIMENSIONS = {
  baseline: { width: 800, height: 284 },
  media_left_choices_right: { width: 840, height: 580 },
  visual_choices_three: { width: 501, height: 500, count: 3 },
} as const;

export function candyArcadeHeroAreaRatio(layout: keyof typeof CANDY_ARCADE_LAYOUT_DIMENSIONS): number {
  const frameArea = 1920 * 1080;
  if (layout === "visual_choices_three") {
    const dimensions = CANDY_ARCADE_LAYOUT_DIMENSIONS.visual_choices_three;
    return Number(((dimensions.width * dimensions.height * dimensions.count) / frameArea).toFixed(4));
  }
  const dimensions = CANDY_ARCADE_LAYOUT_DIMENSIONS[layout];
  return Number(((dimensions.width * dimensions.height) / frameArea).toFixed(4));
}

export function buildCandyArcadeComposition(input: CandyArcadeCompositionInput): string {
  return buildCandyArcadeCompositionBundle(input).html;
}

export function buildCandyArcadeCompositionBundle(input: CandyArcadeCompositionInput): CandyArcadeCompositionBundle {
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

  const scenes = clips.filter(Boolean).map(toSubComposition);
  const audioSrc = source(input.audioPath);
  const narrationDuration = input.narrationDurationSeconds > 0 ? input.narrationDurationSeconds : duration;
  const bgmClips = buildBgmClips(duration, input.assets, outroStart);
  const sfxClips = buildSfxClips(events, input.assets);
  const audioTags = [
    `<audio id="quiz-narration" class="clip" data-start="0" data-duration="${narrationDuration.toFixed(3)}" data-track-index="2" data-volume="1" src="${audioSrc}"></audio>`,
    ...bgmClips,
    ...sfxClips,
  ].join("\n");

  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Candy Arcade Quiz</title><style>${candyArcadeCss()}</style></head><body><main id="stage" data-composition-id="quiz-v2-candy-arcade" data-no-timeline data-start="0" data-width="1920" data-height="1080" data-duration="${duration.toFixed(3)}" data-fps="30">${scenes.map(subCompositionMount).join("\n")}\n${audioTags}</main><script>window.__playerReady=true;window.__renderReady=true;</script></body></html>`,
    files: Object.fromEntries(scenes.map((scene) => [`compositions/${scene.id}.html`, scene.html])),
  };
}

type SubComposition = {
  id: string;
  start: string;
  duration: string;
  trackIndex: string;
  html: string;
};

function toSubComposition(clip: string): SubComposition {
  const openingTag = clip.match(/^<section\b[^>]*>/)?.[0];
  if (!openingTag) throw new Error("Candy Arcade clip must start with a section element");
  const id = requiredAttribute(openingTag, "id");
  const start = requiredAttribute(openingTag, "data-start");
  const duration = requiredAttribute(openingTag, "data-duration");
  const trackIndex = requiredAttribute(openingTag, "data-track-index");
  const sceneRoot = openingTag
    .replace(/\sdata-start="[^"]*"/g, "")
    .replace(/\sdata-duration="[^"]*"/g, "")
    .replace(/\sdata-track-index="[^"]*"/g, "")
    .replace(/>$/, ` data-composition-id="${id}" data-no-timeline data-width="1920" data-height="1080">`);
  const body = rootRelativeSubCompositionAssets(clip.replace(openingTag, sceneRoot));
  return { id, start, duration, trackIndex, html: `<template id="${id}-template">${body}</template>` };
}

function requiredAttribute(tag: string, name: string): string {
  const value = tag.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];
  if (!value) throw new Error(`Candy Arcade clip is missing ${name}`);
  return value;
}

function rootRelativeSubCompositionAssets(html: string): string {
  return html
    .replace(/\b(src|poster)="\.\//g, "$1=\"")
    .replace(/url\("\.\//g, 'url("');
}

function subCompositionMount(scene: SubComposition): string {
  return `<div id="${scene.id}-mount" data-composition-id="${scene.id}" data-composition-src="compositions/${scene.id}.html" data-start="${scene.start}" data-duration="${scene.duration}" data-track-index="${scene.trackIndex}" data-no-timeline></div>`;
}

function introClip(end: number, count: number, copy: Copy): string {
  if (end < .08) return "";
  return `<section id="candy-intro" class="clip candy-scene candy-intro" data-start="0" data-duration="${end.toFixed(3)}" data-track-index="0"><div class="intro-rays"></div><div class="intro-dot dot-a"></div><div class="intro-dot dot-b"></div><div class="intro-card"><span>QUIZ TIME</span><h1>${esc(copy.ready)}</h1><p>${count} ${esc(copy.questions(count))}</p><div class="intro-stars" data-layout-ignore aria-hidden="true">✦&nbsp;&nbsp;★&nbsp;&nbsp;✦</div></div><div class="brand-mascot mascot-wave" data-layout-ignore aria-hidden="true">✦</div></section>`;
}

function outroClip(start: number, end: number, count: number, copy: Copy): string {
  return `<section id="candy-outro" class="clip candy-scene candy-outro" data-start="${start.toFixed(3)}" data-duration="${Math.max(.04, end - start).toFixed(3)}" data-track-index="0"><div class="intro-rays"></div><div class="outro-blob blob-a"></div><div class="outro-blob blob-b"></div><div class="outro-card"><span>${esc(copy.scorePrompt)}</span><h1>${esc(copy.playAgain)}</h1><p>${esc(copy.exploreMore)}</p><div class="outro-cta-badges"><span class="badge-cta badge-comment">💬 ${esc(copy.ctaComment)}</span><span class="badge-cta badge-like">👍 ${esc(copy.ctaLike)}</span><span class="badge-cta badge-sub">🔔 ${esc(copy.ctaSubscribe)}</span></div><div class="outro-stars" data-layout-ignore aria-hidden="true">★&nbsp;&nbsp;✦&nbsp;&nbsp;★</div></div></section>`;
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
  const body = `<div class="game-stage" data-layout-allow-overflow><div class="question-title question-tier-${questionLayout.tier}" data-layout-allow-occlusion><div class="question-card-inner"><div class="q-badge-star" data-layout-ignore aria-hidden="true"><span class="star-shape">★</span><i class="star-sparkle star-sp-1">✦</i><i class="star-sparkle star-sp-2">•</i></div><div class="q-decor-corner q-decor-top-right" data-layout-ignore aria-hidden="true"><span class="corner-gem">✦</span></div><div class="q-decor-corner q-decor-bottom-right" data-layout-ignore aria-hidden="true"><span class="corner-petal">✿</span></div><h1>${highlightQuestionMarkup(question.question, question.visual_opportunity)}</h1></div></div>${hero}${visualAnswers || answers}<div class="phase-region">${thinkingBar({ clipStart: input.start, revealStart: input.revealStart })}${revealPanel(input)}</div></div>`;
  return `<section id="quiz-q${question.number}-${Math.round(input.start * 1000)}" class="${classNames}" ${config} data-start="${input.start.toFixed(3)}" data-duration="${Math.max(.04, input.end - input.start).toFixed(3)}" data-track-index="0"><div class="bg-gradient"></div><div class="bg-rays"></div><div class="bg-pattern pattern-circles"></div><div class="bg-pattern pattern-sprinkles"></div><div class="bg-shape shape-a" data-layout-allow-overflow></div>${sceneDecorations(input.questionIndex)}<header class="game-header" data-layout-allow-occlusion><div class="hanging-wood-sign" data-layout-allow-occlusion><div class="hanging-ropes" aria-hidden="true"><span class="wood-rope rope-left"></span><span class="wood-rope rope-right"></span></div><div class="wood-sign-plank"><span class="rope-bracket bracket-left" aria-hidden="true"></span><span class="rope-bracket bracket-right" aria-hidden="true"></span><div class="wood-inner-panel"><span class="question-number-val">${question.number}</span></div><span class="wood-sign-star star-tl" data-layout-ignore aria-hidden="true">✦</span><span class="wood-sign-star star-br" data-layout-ignore aria-hidden="true">★</span></div></div></header>${body}${rewardFx(input.isFinal ? "big" : "small")}</section>`;
}

function transitionClip(input: { start: number; end: number; visual: QuizTemplateScene; nextPalette: QuizTemplateScene["palette"] }): string {
  if (input.end - input.start < .04) return "";
  const special = input.visual.transitionId === "lightning_brush";
  const body = special
    ? `<div class="brush brush-one" data-layout-allow-occlusion data-layout-allow-overflow></div><div class="brush brush-two" data-layout-allow-occlusion data-layout-allow-overflow></div><div class="transition-mark" data-layout-ignore aria-hidden="true">✦</div>`
    : `<div class="splash-bed" data-layout-allow-occlusion data-layout-allow-overflow></div><i class="splash-bubble splash-bubble-a" data-layout-allow-occlusion data-layout-allow-overflow></i><i class="splash-bubble splash-bubble-b" data-layout-allow-occlusion data-layout-allow-overflow></i><i class="splash-bubble splash-bubble-c" data-layout-allow-occlusion data-layout-allow-overflow></i><i class="splash-bubble splash-bubble-d" data-layout-allow-occlusion data-layout-allow-overflow></i><i class="splash-bubble splash-bubble-e" data-layout-allow-occlusion data-layout-allow-overflow></i><i class="splash-bubble splash-bubble-f" data-layout-allow-occlusion data-layout-allow-overflow></i><div class="splash-brand" data-layout-ignore aria-hidden="true">✦</div><div class="splash-particles" data-layout-ignore aria-hidden="true"><i>✦</i><i>•</i><i>✦</i><i>•</i></div><div class="splash-release" data-layout-allow-occlusion data-layout-allow-overflow></div>`;
  return `<section id="candy-transition-${Math.round(input.start * 1000)}" class="clip candy-transition transition-${input.visual.transitionId}" data-layout-ignore data-layout-allow-occlusion data-layout-allow-overflow style="--from:${input.visual.palette.accent};--to:${input.nextPalette.backgroundPrimary};--ink:${input.visual.palette.text};--clip-start:${input.start.toFixed(3)}s" data-start="${input.start.toFixed(3)}" data-duration="${(input.end - input.start).toFixed(3)}" data-track-index="1">${body}</section>`;
}

function rewardFx(intensity: "small" | "big"): string {
  const particles = intensity === "big" ? ["★", "✦", "★", "✦", "★", "✦", "★", "✦", "★"] : ["✦", "★", "✦", "★", "✦", "★", "✦"];
  return `<div class="reward-fx reward-${intensity}" data-layout-ignore aria-hidden="true">${particles.map((particle) => `<i>${particle}</i>`).join("")}</div>`;
}

function imageCard(asset: string | null, subject: string, className: string, seed: number): string {
  return `<figure class="image-card ${className}" data-layout-allow-overflow><img src="${escAttr(asset ?? illustrationDataUri(subject, seed))}" alt="${escAttr(subject)}"><span class="image-shine"></span></figure>`;
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
    const phaseSeconds = ambientPhaseSeconds("float", index, question.id);
    return `<div class="answer-card ${state} choice-tier-${layout.tier}" style="--item-phase:${phaseSeconds}s" data-layout-allow-occlusion data-layout-allow-overflow><b>${String.fromCharCode(65 + index)}</b>${optionAsset ? `<img src="${escAttr(optionAsset)}" alt="">` : ""}<span>${esc(choice.text)}</span>${state === "answer-correct" ? "<i class=\"answer-check\" data-layout-ignore aria-hidden=\"true\">✓</i>" : state === "answer-incorrect" ? "<i class=\"answer-cross\" data-layout-ignore aria-hidden=\"true\">×</i>" : ""}</div>`;
  }).join("")}</div>`;
}

function visualAnswerCards(question: QuizV2["questions"][number], assets: Record<string, string>, questionIndex: number): string {
  return `<div class="visual-answer-grid">${question.choices.map((choice, index) => {
    const state = "answer-" + visualAnswerState(choice.id, question.correct_choice_id, "reveal");
    const phaseSeconds = ambientPhaseSeconds("float", index, question.id);
    return `<div class="visual-answer-card ${state}" style="--item-phase:${phaseSeconds}s" data-layout-allow-occlusion data-layout-allow-overflow>${imageCard(assetFor(assets, `asset-${question.id}-${choice.id}`), choice.text, "option-image", index + question.number * 10)}<div class="visual-answer-label" data-layout-allow-overflow><b>${String.fromCharCode(65 + index)}</b><span>${esc(choice.text)}</span></div>${state === "answer-correct" ? "<i class=\"answer-check\" data-layout-ignore aria-hidden=\"true\">✓</i>" : state === "answer-incorrect" ? "<i class=\"answer-cross\" data-layout-ignore aria-hidden=\"true\">×</i>" : ""}</div>`;
  }).join("")}</div>`;
}

function thinkingBar(input: { clipStart: number; revealStart: number }): string {
  const duration = Math.max(.05, input.revealStart - input.clipStart);
  const cd5 = Math.max(0, duration - 5);
  const cd4 = Math.max(0, duration - 4);
  const cd3 = Math.max(0, duration - 3);
  const cd2 = Math.max(0, duration - 2);
  const cd1 = Math.max(0, duration - 1);
  const queryDuration = cd5;
  const style = `style="--timer-duration:${duration.toFixed(3)}s;--cd-query-dur:${queryDuration.toFixed(3)}s;--cd5-at:${cd5.toFixed(3)}s;--cd4-at:${cd4.toFixed(3)}s;--cd3-at:${cd3.toFixed(3)}s;--cd2-at:${cd2.toFixed(3)}s;--cd1-at:${cd1.toFixed(3)}s"`;
  const starSvg = `<svg class="marker-star-svg" viewBox="0 0 100 100" aria-hidden="true" data-layout-ignore><defs><linearGradient id="markerStarGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFE043" /><stop offset="45%" stop-color="#FF961F" /><stop offset="100%" stop-color="#FF3366" /></linearGradient><linearGradient id="markerStarStroke" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFFFFF" /><stop offset="60%" stop-color="#FFF4B8" /><stop offset="100%" stop-color="#FFD633" /></linearGradient></defs><path d="M50 11 Q59 20 68 29.5 Q80 33 91 41 Q86 53 79.5 63.5 Q80 77 75.5 88.5 Q63 87 50 85 Q37 87 24.5 88.5 Q20 77 20.5 63.5 Q14 53 9 41 Q20 33 32 29.5 Q41 20 50 11 Z" fill="rgba(13,35,71,0.35)" /><path class="star-outer" d="M50 7 Q59 16 68 25.5 Q80 29 91 37 Q86 49 79.5 59.5 Q80 73 75.5 84.5 Q63 83 50 81 Q37 83 24.5 84.5 Q20 73 20.5 59.5 Q14 49 9 37 Q20 29 32 25.5 Q41 16 50 7 Z" fill="url(#markerStarGrad)" stroke="url(#markerStarStroke)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" /></svg>`;
  return `<div class="thinking-bar" ${style}><div class="thinking-track" aria-label="Quiz timer" data-layout-allow-overflow><div class="timer-milestones" data-layout-ignore aria-hidden="true"><span class="milestone-star star-1">★</span><span class="milestone-star star-2">★</span><span class="milestone-star star-3">★</span><span class="milestone-star star-4">★</span></div><div class="timer-progress"></div><span class="timer-marker" data-layout-allow-occlusion>${starSvg}<b class="marker-val val-query">?</b><b class="marker-val val-5">5</b><b class="marker-val val-4">4</b><b class="marker-val val-3">3</b><b class="marker-val val-2">2</b><b class="marker-val val-1">1</b></span><div class="timer-sparkles" data-layout-ignore aria-hidden="true"><i>✦</i><i>•</i><i>✦</i></div></div></div>`;
}

function revealPanel(input: { question: QuizV2["questions"][number]; copy: Copy; isFinal: boolean }): string {
  return `<div class="fact-card" data-layout-allow-occlusion><span>${esc(input.question.fun_fact ? input.copy.funFact : input.copy.why)}</span><p>${esc(input.question.fun_fact || input.question.explanation)}</p></div>`;
}

function sceneDecorations(questionIndex: number): string {
  const symbols = ["✦", "•", "○", "?", "✧", "⚡", "•"];
  return `<div class="scene-decor" data-layout-ignore aria-hidden="true">${symbols.map((symbol, index) => `<i class="decor-${index + 1}" style="--decor-phase:${ambientPhaseSeconds("drift", index, String(questionIndex))}s">${symbol}</i>`).join("")}</div>`;
}

function styleAttributes(visual: QuizTemplateScene, layout: ReturnType<typeof textLayout>, clipStart: number, choicesStart: number, thinkingStart: number, revealStart: number, rewardStart: number, clipEnd: number): string {
  const palette = visual.palette;
  const timerDuration = Math.max(.04, revealStart - clipStart);
  return `style="--bg-primary:${palette.backgroundPrimary};--bg-secondary:${palette.backgroundSecondary};--accent:${palette.accent};--surface-accent:${palette.surfaceAccent};--on-accent:${palette.onAccent};--badge:${palette.answerBadge};--correct:${palette.correct};--incorrect:${palette.incorrect};--surface:${palette.surface};--ink:${palette.text};--muted:${palette.muted};--question-size:${layout.fontSize}px;--question-leading:${layout.lineHeight};--clip-start:${clipStart.toFixed(3)}s;--scene-duration:${Math.max(.04, clipEnd - clipStart).toFixed(3)}s;--choices-at:${Math.max(0, choicesStart - clipStart).toFixed(3)}s;--thinking-at:${Math.max(0, thinkingStart - clipStart).toFixed(3)}s;--reveal-at:${Math.max(0, revealStart - clipStart).toFixed(3)}s;--reward-at:${Math.max(0, rewardStart - clipStart).toFixed(3)}s;--choices-duration:${Math.max(.04, revealStart - choicesStart).toFixed(3)}s;--timer-duration:${timerDuration.toFixed(3)}s;--reveal-duration:${Math.max(.04, rewardStart - revealStart).toFixed(3)}s;--ambient-phase:${ambientPhaseSeconds("drift", 0, String(clipStart))}s"`;
}

function assetFor(assets: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) if (assets[key]) return source(assets[key]);
  return null;
}

function source(value: string): string {
  if (/^(data:|https?:|file:)/i.test(value) || value.startsWith("./") || value.startsWith("../")) return value;
  return pathToFileURL(value).href;
}

function buildBgmClips(duration: number, assets?: Record<string, string>, outroStart?: number): string[] {
  const schedule = defaultBgmRegistry.resolveBgmSchedule(duration, { assets, bpmPreference: "120_bpm_upbeat" });
  const totalClips = schedule.length;

  return schedule.map((item, index) => {
    const isFirstClip = index === 0;
    const isFinalClip = index === totalClips - 1;
    const clipStart = item.startSeconds;
    const clipDuration = item.durationSeconds;
    const baseVolume = item.volume;

    const points: Array<{ t: number; v: number }> = [];

    // Subtle 0.5s fade-in at the beginning of the audio track
    if (isFirstClip) {
      const fadeInDur = Math.min(0.5, clipDuration * 0.2);
      if (fadeInDur > 0.05) {
        points.push({ t: 0, v: 0 });
        points.push({ t: Number(fadeInDur.toFixed(3)), v: baseVolume });
      } else {
        points.push({ t: 0, v: baseVolume });
      }
    } else {
      const fadeInDur = Math.min(0.6, clipDuration * 0.2);
      if (fadeInDur > 0.05) {
        points.push({ t: 0, v: 0 });
        points.push({ t: Number(fadeInDur.toFixed(3)), v: baseVolume });
      } else {
        points.push({ t: 0, v: baseVolume });
      }
    }

    if (isFinalClip) {
      // Smooth fade-out towards the end of the video
      let fadeOutSeconds = 2.5;
      if (typeof outroStart === "number" && outroStart > clipStart && outroStart < duration - 0.5) {
        const outroDur = duration - outroStart;
        fadeOutSeconds = Math.max(2.0, Math.min(4.0, outroDur));
      }
      fadeOutSeconds = Math.min(fadeOutSeconds, clipDuration * 0.5);

      const fadeStartLocal = Math.max(0, clipDuration - fadeOutSeconds);
      const lastPoint = points[points.length - 1];
      if (lastPoint && fadeStartLocal > lastPoint.t) {
        points.push({ t: Number(fadeStartLocal.toFixed(3)), v: baseVolume });
      }
      points.push({ t: Number(clipDuration.toFixed(3)), v: 0 });
    } else {
      const fadeOutSeconds = Math.min(0.6, clipDuration * 0.2);
      const fadeStartLocal = Math.max(0, clipDuration - fadeOutSeconds);
      const lastPoint = points[points.length - 1];
      if (lastPoint && fadeStartLocal > lastPoint.t) {
        points.push({ t: Number(fadeStartLocal.toFixed(3)), v: baseVolume });
      }
      points.push({ t: Number(clipDuration.toFixed(3)), v: 0 });
    }

    const automation = {
      version: 1,
      lanes: [
        {
          target: "volume",
          points,
        },
      ],
    };

    const automationAttr = `data-automation="${escAttr(JSON.stringify(automation))}"`;

    return `<audio id="${item.id}" class="clip bgm-clip" data-start="${item.startSeconds.toFixed(3)}" data-duration="${item.durationSeconds.toFixed(3)}" data-track-index="4" data-volume="${item.volume.toFixed(2)}" ${automationAttr} src="${item.src}"></audio>`;
  });
}

function buildSfxClips(events: QuizTimeline["events"], assets?: Record<string, string>): string[] {
  const clips: string[] = [];

  for (const event of events) {
    const timeMs = Math.round(event.at_seconds * 1000);
    const eventSlug = event.type.replaceAll(".", "-");
    const id = `sfx-${eventSlug}-${timeMs}`;

    if (event.type === "choices.enter") {
      const src = sfxSource("ui_pop.wav", assets);
      clips.push(`<audio id="${id}" class="clip sfx-clip" data-start="${event.at_seconds.toFixed(3)}" data-duration="0.120" data-track-index="3" data-volume="0.55" src="${src}"></audio>`);
    } else if (event.type === "countdown.tick") {
      const isFinalTick = event.payload?.value === 1;
      const filename = isFinalTick ? "countdown_final.wav" : "countdown_tick.wav";
      const dur = isFinalTick ? "0.350" : "0.080";
      const vol = isFinalTick ? "0.60" : "0.45";
      const src = sfxSource(filename, assets);
      clips.push(`<audio id="${id}" class="clip sfx-clip" data-start="${event.at_seconds.toFixed(3)}" data-duration="${dur}" data-track-index="3" data-volume="${vol}" src="${src}"></audio>`);
    } else if (event.type === "reward.play") {
      const isBig = event.payload?.intensity === "big";
      const filename = isBig ? "correct_triumph.wav" : "correct_ding.wav";
      const dur = isBig ? "1.500" : "1.100";
      const src = sfxSource(filename, assets);
      clips.push(`<audio id="${id}" class="clip sfx-clip" data-start="${event.at_seconds.toFixed(3)}" data-duration="${dur}" data-track-index="3" data-volume="0.75" src="${src}"></audio>`);
    } else if (event.type === "transition.start") {
      const isLightning = event.payload?.intent === "zoom" || event.payload?.intent === "lightning";
      const filename = isLightning ? "lightning_brush.wav" : "bubble_splash.wav";
      const dur = isLightning ? "0.700" : "0.650";
      const src = sfxSource(filename, assets);
      clips.push(`<audio id="${id}" class="clip sfx-clip" data-start="${event.at_seconds.toFixed(3)}" data-duration="${dur}" data-track-index="3" data-volume="0.60" src="${src}"></audio>`);
    }
  }

  return clips;
}

function sfxSource(filename: string, assets?: Record<string, string>): string {
  const intentKey = filename.replace(/\.wav$/, "");
  if (assets?.[`sfx:${intentKey}`]) return source(assets[`sfx:${intentKey}`]);
  if (assets?.[filename]) return source(assets[filename]);
  return `./sfx/${filename}`;
}

function quizCopy(language: string) {
  const vietnamese = /^(vi|vietnamese|tiếng việt)/i.test(language.trim());
  return vietnamese
    ? { ready: "Sẵn sàng chơi chưa?", questions: (count: number) => count === 1 ? "câu hỏi" : "câu hỏi đầy bất ngờ", question: "Câu", getReady: "Quan sát thật kỹ nhé!", choose: "Chọn một đáp án", time: "Sắp hết giờ!", correct: "Đúng rồi!", why: "Bạn có biết?", funFact: "Bạn có biết?", final: "Thử thách cuối", scorePrompt: "Bạn đúng được mấy câu?", playAgain: "Chơi lại nhé", exploreMore: "Còn nhiều câu hỏi thú vị phía trước", ctaComment: "Bình luận", ctaLike: "Thích", ctaSubscribe: "Đăng ký" }
    : { ready: "Ready to play?", questions: (count: number) => count === 1 ? "question" : "questions to explore", question: "Question", getReady: "Look closely and get ready!", choose: "Choose one", time: "Final seconds!", correct: "That's right!", why: "Did you know?", funFact: "Did you know?", final: "Final challenge", scorePrompt: "How many did you get right?", playAgain: "Play again soon", exploreMore: "Many more questions to explore", ctaComment: "Comment", ctaLike: "Like", ctaSubscribe: "Subscribe" };
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

let cachedHeadlineFontBase64: string | null = null;

function getHeadlineFontBase64(): string {
  if (cachedHeadlineFontBase64 !== null) return cachedHeadlineFontBase64;
  const candidates = [
    path.resolve(process.cwd(), "assets", "fonts", "SVN-Hello Headline.otf"),
    path.resolve(process.cwd(), "templates", "fonts", "SVN-Hello Headline.otf"),
    path.resolve(process.cwd(), "..", "assets", "fonts", "SVN-Hello Headline.otf"),
    path.resolve(process.cwd(), "..", "..", "assets", "fonts", "SVN-Hello Headline.otf"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedHeadlineFontBase64 = fs.readFileSync(candidate).toString("base64");
        return cachedHeadlineFontBase64;
      }
    } catch {}
  }
  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    const probe = path.join(curr, "assets", "fonts", "SVN-Hello Headline.otf");
    try {
      if (fs.existsSync(probe)) {
        cachedHeadlineFontBase64 = fs.readFileSync(probe).toString("base64");
        return cachedHeadlineFontBase64;
      }
    } catch {}
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  cachedHeadlineFontBase64 = "";
  return cachedHeadlineFontBase64;
}

function candyArcadeCss(): string {
  const fontBase64 = getHeadlineFontBase64();
  const fontSources = [
    ...(fontBase64 ? [`url("data:font/otf;base64,${fontBase64}") format("opentype")`] : []),
    `url("./fonts/SVN-Hello Headline.otf") format("opentype")`,
    `local("SVN-Hello Headline")`,
  ].join(", ");

  return `
@font-face {
  font-family: "SVN-Hello Headline";
  src: ${fontSources};
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Fredoka";
  src: url("./fonts/Fredoka-VariableFont_wdth,wght.ttf") format("truetype"),
       local("Fredoka");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Baloo 2";
  src: url("./fonts/Baloo2-VariableFont_wght.ttf") format("truetype"),
       local("Baloo 2"), local("Baloo2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Nunito";
  src: url("./fonts/Nunito-VariableFont_wght.ttf") format("truetype"),
       local("Nunito");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
:root { font-family: "Fredoka", "Nunito", "Trebuchet MS", sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #16285c; }
#stage { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
.clip { position: absolute; inset: 0; }
.candy-scene { --depth-edge: rgba(13,35,71,.16); --depth-shadow: rgba(13,35,71,.22); isolation: isolate; overflow: hidden; padding: 48px 80px 16px; background: var(--bg-primary); color: var(--ink); }
.bg-gradient { position: absolute; z-index: 0; inset: 0; background: linear-gradient(135deg, var(--bg-primary), var(--bg-secondary)); }
.bg-gradient::after { position: absolute; z-index: 0; top: 3%; left: 9%; width: 460px; height: 250px; border-radius: 50%; background: rgba(255,255,255,.16); content: ""; transform: rotate(-15deg); }
.bg-rays { position: absolute; z-index: 1; inset: -30%; opacity: .065; background: repeating-conic-gradient(from 8deg, rgba(255,255,255,.9) 0 7deg, transparent 7deg 18deg); animation: ray-spin 150s linear var(--clip-start) infinite both; }
.bg-pattern { position: absolute; z-index: 1; opacity: .085; pointer-events: none; }
.pattern-circles { inset: 0; background-image: repeating-linear-gradient(45deg, transparent 0 23px, rgba(255,255,255,.9) 24px 27px, transparent 28px 52px); background-size: 82px 82px; animation: drift var(--scene-duration) linear var(--clip-start) 1 both; }
.pattern-sprinkles { right: -110px; bottom: -135px; width: 620px; height: 620px; border: 35px dotted rgba(255,255,255,.7); border-radius: 50%; transform: rotate(-14deg); }
.bg-shape { position: absolute; z-index: 1; border-radius: 48% 52% 43% 57%; background: rgba(255,255,255,.11); animation: ambient-drift var(--scene-duration) ease-in-out var(--clip-start) 1 alternate both; }
.shape-a { top: 17%; right: 7%; width: 310px; height: 190px; transform: rotate(-15deg); }
.shape-b { bottom: 10%; left: -4%; width: 360px; height: 250px; border-radius: 63% 37% 54% 46%; animation-delay: -7s; }
.shape-c { right: 24%; bottom: -8%; width: 290px; height: 210px; opacity: .7; animation-delay: -12s; }
.game-header { position: absolute; z-index: 6; top: 0; left: 40px; }
.hanging-wood-sign { position: relative; z-index: 6; display: flex; flex-direction: column; align-items: center; width: 250px; transform-origin: 50% 0; animation: hanging-sign-enter .64s cubic-bezier(.18,1.42,.34,1) var(--clip-start) both, hanging-sign-sway 4.8s ease-in-out calc(var(--clip-start) + .64s) infinite alternate both; }
.hanging-ropes { position: relative; display: flex; justify-content: space-between; width: 170px; height: 44px; pointer-events: none; }
.wood-rope { width: 9px; height: 100%; border-radius: 4px; background: repeating-linear-gradient(135deg, #D4A373 0px, #D4A373 5px, #A75C1C 5px, #A75C1C 10px); box-shadow: 2px 2px 5px rgba(13,35,71,.28); }
.wood-sign-plank { position: relative; width: 240px; height: 150px; min-height: 150px; padding: 10px; border: 6.5px solid #48200A; border-radius: 34px; background: linear-gradient(180deg, #A25324 0%, #823E17 50%, #642B0D 100%); box-shadow: inset 0 4px 0 rgba(255,215,120,.5), inset 0 -5px 0 rgba(35,14,5,.6), 0 12px 0 var(--depth-shadow), 0 22px 32px rgba(10,25,60,.24); display: grid; place-items: center; }
.rope-bracket { position: absolute; top: -9px; width: 24px; height: 16px; border: 4px solid #331505; border-radius: 8px; background: #FFC436; box-shadow: inset 0 2px 0 #FFF, 0 2px 4px rgba(0,0,0,.3); }
.bracket-left { left: 28px; }
.bracket-right { right: 28px; }
.wood-inner-panel { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 108px; border-radius: 22px; border: 4px solid #3E1A07; background: linear-gradient(180deg, #6F3010 0%, #522208 100%); box-shadow: inset 0 4px 8px rgba(0,0,0,.55), inset 0 -3px 0 rgba(255,215,120,.22); }
.question-number-val { font-family: "Fredoka", "SVN-Hello Headline", "Baloo 2", "Nunito", sans-serif; font-size: 74px; font-weight: 900; line-height: 1; color: #FFFDF0; text-shadow: 0 4px 0 #331505, 0 8px 18px rgba(0,0,0,.5); letter-spacing: -1px; }
.wood-sign-star { position: absolute; pointer-events: none; }
.wood-sign-star.star-tl { top: -10px; left: -10px; color: #FFD43F; font-size: 26px; text-shadow: 0 0 12px rgba(255,212,63,.85); transform: rotate(-15deg); }
.wood-sign-star.star-br { bottom: -10px; right: -10px; color: #FFB703; font-size: 28px; text-shadow: 0 3px 0 #331505; transform: rotate(15deg); }
.game-stage { position: relative; z-index: 3; display: grid; justify-items: center; align-content: start; width: 1580px; min-height: 945px; margin: 12px 40px 0 auto; }
.question-title { position: relative; z-index: 3; max-width: 1440px; width: 100%; justify-self: end; margin-left: auto; text-align: center; }
.question-card-inner { position: relative; display: block; padding: 26px 64px 28px; border: 7px solid #FFC938; border-radius: 42px; background: linear-gradient(180deg, #FFFFFF 0%, #FFFDF7 28%, #FFF8EA 100%); box-shadow: inset 0 4px 0 rgba(255,255,255,0.95), inset 0 8px 0 rgba(56,189,248,0.25), inset 0 -5px 0 rgba(245,166,35,0.22), 0 16px 0 var(--depth-shadow), 0 26px 42px rgba(10,25,60,0.16); }
.question-title h1 { margin: 0; color: #342245; font-family: "Fredoka", "SVN-Hello Headline", "Baloo 2", "Nunito", sans-serif; font-size: var(--question-size); font-weight: 800; line-height: var(--question-leading); letter-spacing: -0.5px; text-wrap: balance; text-shadow: 0 2px 0 rgba(255,255,255,0.8), 0 3px 0 rgba(16,35,75,0.08); }
.keyword-highlight { color: #047857; text-shadow: 0 1px 0 rgba(255,255,255,0.8); }
.q-badge-star { position: absolute; top: -26px; left: -18px; z-index: 5; display: grid; place-items: center; width: 68px; height: 68px; border: 4.5px solid #fff; border-radius: 22px; background: linear-gradient(145deg, #FFDD44 0%, #FFA826 100%); color: #fff; box-shadow: 0 8px 0 rgba(13,35,71,0.22), 0 12px 20px rgba(13,35,71,0.18); transform: rotate(-10deg); animation: star-wobble 3.6s ease-in-out infinite alternate; }
.star-shape { font-size: 42px; line-height: 1; text-shadow: 0 2px 0 rgba(180,100,0,0.4); }
.star-sparkle { position: absolute; font-style: normal; pointer-events: none; }
.star-sp-1 { top: -10px; right: -12px; color: #5CE1E6; font-size: 24px; text-shadow: 0 0 8px rgba(92,225,230,0.8); animation: sparkle-blink 2s ease-in-out infinite; }
.star-sp-2 { bottom: -6px; left: -10px; color: #FF66A1; font-size: 18px; animation: sparkle-blink 2s ease-in-out infinite 0.7s; }
.q-decor-corner { position: absolute; z-index: 4; pointer-events: none; }
.q-decor-top-right { top: -12px; right: 18px; color: #FFD43F; font-size: 28px; text-shadow: 0 0 10px rgba(255,212,63,0.7); animation: sparkle-blink 2.4s ease-in-out infinite 0.3s; }
.q-decor-bottom-right { bottom: -14px; right: 14px; color: #C084FC; font-size: 30px; text-shadow: 0 3px 0 rgba(13,35,71,0.14); transform: rotate(12deg); }
.image-card { position: relative; z-index: 3; display: block; margin: 0; overflow: hidden; border: 12px solid #fff; border-radius: 42px; background: #fff; box-shadow: 0 20px 0 rgba(13,35,71,.2), 0 29px 44px rgba(13,35,71,.18); }
.image-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.image-shine { position: absolute; z-index: 4; inset: 0; background: linear-gradient(125deg, rgba(255,255,255,.35), transparent 31%); pointer-events: none; }
.game-stage > .hero-image { width: ${CANDY_ARCADE_LAYOUT_DIMENSIONS.baseline.width}px; height: ${CANDY_ARCADE_LAYOUT_DIMENSIONS.baseline.height}px; margin-top: 39px; }
.hero-image img { transform-origin: center; animation: hero-ken-burn var(--scene-duration) ease-in-out var(--clip-start) 1 alternate both; }
.layout-media_left_choices_right .game-stage { grid-template-columns: minmax(0, 1.08fr) minmax(520px, .92fr); grid-template-areas: "title title" "hero answers"; align-items: start; column-gap: 42px; row-gap: 35px; }
.layout-media_left_choices_right .question-title { grid-area: title; width: 100%; max-width: 1440px; justify-self: end; margin-left: auto; }
.layout-media_left_choices_right .game-stage > .hero-image { grid-area: hero; width: 100%; height: 580px; margin-top: 0; }
.layout-media_left_choices_right .answer-grid { grid-area: answers; grid-template-columns: 1fr; width: 100%; margin-top: 0; gap: 16px; }
.answer-card:nth-child(4n+1), .visual-answer-card:nth-child(4n+1) { --choice-stroke: #FF3366; --choice-stroke-shadow: #B80D35; --choice-badge-grad: linear-gradient(145deg, #FF6B8B 0%, #E60039 100%); --choice-badge-border: #FFFFFF; --choice-bg-tint: linear-gradient(180deg, #FFFFFF 0%, #FFF5F7 100%); }
.answer-card:nth-child(4n+2), .visual-answer-card:nth-child(4n+2) { --choice-stroke: #0284C7; --choice-stroke-shadow: #035380; --choice-badge-grad: linear-gradient(145deg, #38BDF8 0%, #0077B6 100%); --choice-badge-border: #FFFFFF; --choice-bg-tint: linear-gradient(180deg, #FFFFFF 0%, #F0F9FF 100%); }
.answer-card:nth-child(4n+3), .visual-answer-card:nth-child(4n+3) { --choice-stroke: #EA580C; --choice-stroke-shadow: #9A3412; --choice-badge-grad: linear-gradient(145deg, #FBBF24 0%, #EA580C 100%); --choice-badge-border: #FFFFFF; --choice-bg-tint: linear-gradient(180deg, #FFFFFF 0%, #FFFBEB 100%); }
.answer-card:nth-child(4n), .visual-answer-card:nth-child(4n) { --choice-stroke: #059669; --choice-stroke-shadow: #065F46; --choice-badge-grad: linear-gradient(145deg, #34D399 0%, #059669 100%); --choice-badge-border: #FFFFFF; --choice-bg-tint: linear-gradient(180deg, #FFFFFF 0%, #ECFDF5 100%); }
.layout-media_left_choices_right .answer-card { min-height: 136px; margin-left: 44px; padding: 12px 28px 12px 14px; font-size: 32px; border-radius: 999px; }
.layout-media_left_choices_right .answer-card > b { width: 92px; height: 92px; margin-left: -44px; font-size: 46px; border-width: 5.5px; }
.layout-visual_choices_three .game-stage { grid-template-columns: 1fr; grid-template-areas: "title" "answers"; align-items: start; row-gap: 35px; }
.layout-visual_choices_three .question-title { grid-area: title; width: 100%; max-width: 1440px; justify-self: end; margin-left: auto; }
.layout-visual_choices_three .visual-answer-grid { grid-area: answers; width: 1560px; margin-top: 0; gap: 28px; }
.phase-region { position: absolute; z-index: 5; left: 50%; bottom: 10px; width: 100%; height: 110px; transform: translateX(-50%); }
.phase-region > .thinking-bar, .phase-region > .fact-card { position: absolute; z-index: 5; bottom: 0; left: 50%; margin-top: 0; transform: translateX(-50%); }
.phase-region > .thinking-bar { width: min(82vw, 1540px); min-height: 84px; }
.phase-region > .fact-card { width: min(1220px, 100%); }
.answer-grid { position: relative; z-index: 3; display: grid; gap: 24px; width: 1540px; margin-top: 28px; opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--choices-at)) both; }
.answer-count-2 { grid-template-columns: repeat(2, 1fr); }
.answer-count-3 { grid-template-columns: repeat(3, 1fr); }
.answer-count-4, .answer-count-5, .answer-count-6 { grid-template-columns: repeat(2, 1fr); }
.answer-card { position: relative; z-index: 3; display: flex; align-items: center; min-height: 148px; gap: 20px; margin-left: 48px; padding: 14px 34px 14px 16px; overflow: visible; border: 6px solid var(--choice-stroke); border-radius: 999px; background: var(--choice-bg-tint); box-shadow: 0 14px 0 var(--depth-shadow), inset 0 4px 0 rgba(255,255,255,.9), 0 8px 24px rgba(10,25,60,.14); font-size: 34px; font-weight: 900; }
.answer-card::after { position: absolute; right: -35px; bottom: -41px; width: 118px; height: 118px; border-radius: 50%; background: var(--muted); content: ""; opacity: .35; pointer-events: none; }
.answer-card > b, .visual-answer-label > b { position: relative; z-index: 4; display: grid; flex: 0 0 auto; place-items: center; width: 100px; height: 100px; margin-left: -48px; border: 6px solid var(--choice-badge-border); border-radius: 50%; background: var(--choice-badge-grad); color: #FFFFFF; box-shadow: 0 10px 0 var(--choice-stroke-shadow), 0 12px 24px rgba(10,25,60,.32), -4px 6px 14px rgba(0,0,0,0.18), inset 0 -6px 0 rgba(0,0,0,0.22), inset 0 4px 0 rgba(255,255,255,0.6); font-family: "Fredoka", "SVN-Hello Headline", "Baloo 2", "Nunito", sans-serif; font-size: 50px; font-weight: 900; line-height: 1; text-shadow: 0 4px 0 rgba(13,35,71,.45); letter-spacing: -0.5px; }
.answer-card > b::after, .visual-answer-label > b::after { position: absolute; top: 3px; left: 10px; right: 10px; height: 42%; border-radius: 50% 50% 35% 35%; background: linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.2) 65%, rgba(255,255,255,0) 100%); content: ""; pointer-events: none; z-index: 5; }
.answer-card span { position: relative; z-index: 4; flex: 1 1 auto; min-width: 0; padding-right: 48px; line-height: 1.1; color: #1E293B; }
.answer-card img { position: relative; z-index: 4; width: 62px; height: 62px; border-radius: 18px; object-fit: cover; animation: answer-float var(--scene-duration) ease-in-out calc(var(--clip-start) + var(--item-phase)) 1 alternate both; }
.choice-tier-long span, .choice-tier-very_long span { font-size: 28px; }
.answer-card.answer-correct { animation: correct-card-reveal .62s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reveal-at) + .14s) both; border-color: var(--correct) !important; box-shadow: 0 16px 0 rgba(22,101,52,.35), 0 0 30px rgba(39,185,108,.45), inset 0 4px 0 rgba(255,255,255,.95) !important; }
.answer-card.answer-correct > b { background: linear-gradient(145deg, #4ADE80 0%, #16A34A 100%) !important; box-shadow: 0 10px 0 #15803D, 0 12px 24px rgba(22,163,74,.45), inset 0 4px 0 rgba(255,255,255,.6), inset 0 -6px 0 rgba(0,0,0,0.22) !important; }
.answer-card.answer-incorrect { animation: incorrect-card-settle .38s ease-out calc(var(--clip-start) + var(--reveal-at)) both; opacity: .45; }
.answer-check, .answer-cross { position: absolute; z-index: 6; top: 14px; right: 20px; display: grid; place-items: center; width: 54px; height: 54px; border: 4px solid #FFFFFF; border-radius: 50%; background: var(--correct); color: #FFFFFF; box-shadow: 0 6px 0 rgba(13,35,71,.22), 0 4px 12px rgba(0,0,0,0.18); font-size: 34px; font-weight: 900; font-style: normal; opacity: 0; animation: status-pop .38s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reveal-at) + .16s) both; }
.answer-cross { background: var(--incorrect); }
.thinking-bar { position: relative; z-index: 5; isolation: isolate; display: flex; align-items: center; justify-content: center; width: min(82vw, 1540px); min-height: 84px; margin: 0 auto; padding: 6px 0; border: 0; border-radius: 9999px; background: transparent; box-shadow: none; opacity: 0; animation: phase-hold var(--timer-duration) steps(1,end) var(--clip-start) both, timer-exit-fade .28s cubic-bezier(.22,.8,.3,1) calc(var(--clip-start) + var(--timer-duration) - .28s) both; }
.thinking-track { position: relative; z-index: 0; width: 100%; height: 58px; overflow: visible; border: 6px solid rgba(255,255,255,.98); border-radius: 9999px; background: rgba(18,38,80,.62); box-shadow: inset 0 3px 6px rgba(255,255,255,.35), inset 0 -4px 8px rgba(0,0,0,.22), 0 8px 22px rgba(13,35,71,.35), 0 0 20px rgba(255,255,255,.25); }
.timer-milestones { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.milestone-star { position: absolute; top: 50%; font-size: 24px; line-height: 1; color: #FFE66D; text-shadow: 0 0 10px rgba(255,230,109,.95), 0 2px 4px rgba(0,0,0,.4); transform: translate(-50%,-50%); animation: quizProgressStarTwinkle 2.4s ease-in-out infinite; }
.milestone-star.star-1 { left: 20%; animation-delay: 0s; }
.milestone-star.star-2 { left: 40%; animation-delay: .6s; }
.milestone-star.star-3 { left: 60%; animation-delay: 1.2s; }
.milestone-star.star-4 { left: 80%; animation-delay: 1.8s; }
.timer-progress { position: absolute; top: 0; left: 0; bottom: 0; width: 100%; border-radius: 9999px; overflow: hidden; background: linear-gradient(90deg, #ff4f5e 0%, #ff7a45 20%, #ffc83d 42%, #6fa9ff 70%, #28d5d0 100%); background-size: 1540px 100%; background-position: left center; z-index: 1; animation: quiz-timer-drain var(--timer-duration) linear var(--clip-start) both; }
.timer-progress::after { position: absolute; top: 0; left: 0; right: 0; height: 50%; border-radius: 9999px 9999px 0 0; background: linear-gradient(to bottom, rgba(255,255,255,.38) 0%, rgba(255,255,255,.1) 40%, rgba(255,255,255,0) 70%); content: ""; pointer-events: none; z-index: 2; }
.timer-marker { position: absolute; top: 50%; left: 100%; display: grid; place-items: center; width: 176px; height: 176px; border: none; background: transparent; transform: translate(-50%,-50%); animation: quiz-timer-marker-slide var(--timer-duration) linear var(--clip-start) both, quizProgressMarkerPulse 2.4s ease-in-out infinite; z-index: 6; }
.marker-star-svg { position: absolute; inset: -8px; width: 192px; height: 192px; overflow: visible; pointer-events: none; z-index: 4; }
.marker-val { position: absolute; inset: 0; display: grid; place-items: center; font-family: "Fredoka", "SVN-Hello Headline", "Baloo 2", "Nunito", sans-serif; font-size: 64px; font-weight: 900; line-height: 1; color: #FFFFFF; text-shadow: 0 3px 6px rgba(120,20,45,.75), 0 0 12px rgba(255,255,255,.6); opacity: 0; pointer-events: none; z-index: 7; transform: translateY(-2px); }
.val-query { opacity: 1; animation: query-hold var(--cd-query-dur) steps(1,end) var(--clip-start) both; }
.val-5 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd5-at)) both; }
.val-4 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--cd4-at)) both; }
.val-3 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd3-at)) both; }
.val-2 { animation: number-countdown-tick 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd2-at)) both; }
.val-1 { animation: number-countdown-final 1s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--cd1-at)) both; }
.timer-sparkles { position: absolute; inset: -20px -14px; pointer-events: none; z-index: 8; }
.timer-sparkles i { position: absolute; color: #FFE66D; font-size: 26px; font-style: normal; text-shadow: 0 0 10px rgba(255,230,109,.95); animation: timer-sparkle var(--timer-duration) ease-in-out calc(var(--clip-start) + var(--ambient-phase)) 1 both; }
.timer-sparkles i:nth-child(1) { right: 6%; top: -18px; }
.timer-sparkles i:nth-child(2) { right: 1%; bottom: -16px; color: #5CE1E6; font-size: 22px; animation-delay: calc(var(--clip-start) + .55s); }
.timer-sparkles i:nth-child(3) { left: 4%; top: -16px; color: #fff; animation-delay: calc(var(--clip-start) + 1.05s); }
.fact-card { position: relative; z-index: 5; max-width: 1220px; margin-top: 14px; padding: 22px 44px 26px; border: 6px solid rgba(255,255,255,.85); border-radius: 38px; background: var(--surface); box-shadow: 0 16px 0 rgba(13,35,71,.18), 0 22px 36px rgba(10,25,60,.14); text-align: center; opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--reward-at)) both; }
.fact-card span { color: var(--surface-accent); font-size: 24px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; }
.fact-card p { margin: 8px 0 0; font-family: "Fredoka", "SVN-Hello Headline", "Baloo 2", "Nunito", sans-serif; font-size: 38px; font-weight: 900; line-height: 1.22; letter-spacing: -0.3px; }
.visual-answer-grid { position: relative; z-index: 3; display: grid; grid-template-columns: repeat(3,1fr); gap: 28px; width: 1560px; margin-top: 28px; opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--choices-at)) both; }
.visual-answer-card { position: relative; z-index: 3; }
.option-image { width: 100%; height: 500px; border-width: 12px; border-radius: 40px; animation: answer-float var(--scene-duration) ease-in-out calc(var(--clip-start) + var(--item-phase)) 1 alternate both; }
.visual-answer-label { position: relative; z-index: 4; display: flex; align-items: center; gap: 16px; min-height: 94px; margin: -36px 18px 0 38px; padding: 12px 26px 12px 14px; overflow: visible; border: 5.5px solid var(--choice-stroke); border-radius: 999px; background: var(--choice-bg-tint); box-shadow: 0 12px 0 var(--depth-shadow), inset 0 4px 0 rgba(255,255,255,.9), 0 8px 20px rgba(10,25,60,.12); font-size: 32px; font-weight: 900; }
.visual-answer-label > b { width: 80px; height: 80px; margin-left: -38px; border-radius: 50%; border: 5px solid var(--choice-badge-border); font-size: 42px; }
.visual-answer-label span { color: #1E293B; }
.visual-answer-card.answer-correct { animation: visual-correct-card-reveal .62s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reveal-at) + .14s) both; }
.visual-answer-card.answer-correct .visual-answer-label { border-color: var(--correct) !important; box-shadow: 0 14px 0 rgba(22,101,52,.35), 0 0 28px rgba(39,185,108,.4), inset 0 4px 0 rgba(255,255,255,.95) !important; }
.visual-answer-card.answer-correct .visual-answer-label > b { background: linear-gradient(145deg, #4ADE80 0%, #16A34A 100%) !important; box-shadow: 0 10px 0 #15803D, 0 12px 24px rgba(22,163,74,.45), inset 0 4px 0 rgba(255,255,255,.6), inset 0 -6px 0 rgba(0,0,0,0.22) !important; }
.visual-answer-card.answer-correct .option-image { animation: answer-float var(--scene-duration) ease-in-out calc(var(--clip-start) + var(--item-phase)) 1 alternate both, visual-correct-border .62s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reveal-at) + .14s) both; }
.visual-answer-card.answer-incorrect { animation: incorrect-card-settle .38s ease-out calc(var(--clip-start) + var(--reveal-at)) both; opacity: .45; }
.quiz-question-clip .hero-image { animation: hero-enter .62s cubic-bezier(.22,.8,.3,1) var(--clip-start) both, hero-float var(--scene-duration) ease-in-out calc(var(--clip-start) + .62s) 1 alternate both; }
.reward-fx { position: absolute; z-index: 7; inset: 0; color: #fff; pointer-events: none; text-shadow: 0 7px 0 rgba(13,35,71,.18); opacity: 0; animation: phase-enter .01s steps(1,end) calc(var(--clip-start) + var(--reward-at)) both; }
.reward-fx i { position: absolute; font-size: 51px; font-style: normal; animation: star-burst .72s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + var(--reward-at)) both; }
.reward-fx i:nth-child(1) { left: 5%; top: 34%; }.reward-fx i:nth-child(2) { right: 6%; top: 38%; animation-delay: calc(var(--clip-start) + .06s); }.reward-fx i:nth-child(3) { left: 9%; bottom: 18%; animation-delay: calc(var(--clip-start) + .12s); }.reward-fx i:nth-child(4) { right: 10%; bottom: 16%; animation-delay: calc(var(--clip-start) + .18s); }.reward-fx i:nth-child(5) { left: 3%; top: 58%; animation-delay: calc(var(--clip-start) + .24s); }.reward-fx i:nth-child(6) { right: 3%; top: 61%; animation-delay: calc(var(--clip-start) + .3s); }.reward-fx i:nth-child(7) { left: 7%; bottom: 8%; animation-delay: calc(var(--clip-start) + .36s); }
.reward-fx i:nth-child(8) { right: 18%; top: 20%; animation-delay: calc(var(--clip-start) + .42s); }.reward-fx i:nth-child(9) { left: 20%; bottom: 23%; animation-delay: calc(var(--clip-start) + .48s); }
.reward-small i { font-size: 57px; }
.reward-big i { font-size: 71px; }
.episode-progress.streak { animation: progress-pop .52s cubic-bezier(.18,1.42,.34,1) calc(var(--clip-start) + .12s) both; }
.episode-progress.streak i { margin-left: 2px; color: var(--surface-accent); font-size: 24px; font-style: normal; }
.quiz-question-clip::after { position: absolute; z-index: 2; top: 58%; left: 50%; width: 980px; height: 440px; border: 26px solid rgba(255,255,255,.54); border-radius: 50%; content: ""; pointer-events: none; transform: translate(-50%,-50%) scale(.45); animation: reveal-impact .7s ease-out calc(var(--clip-start) + var(--reveal-at) + .04s) both; }
.is-final-scene .question-card-inner { border-color: #FF708A; box-shadow: inset 0 4px 0 rgba(255,255,255,0.95), inset 0 8px 0 rgba(255,182,193,0.35), inset 0 -5px 0 rgba(230,60,90,0.25), 0 16px 0 rgba(230,60,90,0.32), 0 26px 42px rgba(10,25,60,0.2); }
.quiz-question-clip .question-title { animation: question-card-enter 0.52s cubic-bezier(0.18, 1.42, 0.34, 1) var(--clip-start) both, question-card-float 4.2s ease-in-out calc(var(--clip-start) + 0.52s) infinite alternate both; }
.layout-media_left_choices_right.quiz-question-clip .hero-image { animation: enter-from-left .66s cubic-bezier(.22,.8,.3,1) var(--clip-start) both, hero-float var(--scene-duration) ease-in-out calc(var(--clip-start) + .66s) 1 alternate both; }
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
.intro-rays { position: absolute; z-index: 0; inset: -30%; opacity: .12; background: repeating-conic-gradient(from 8deg, rgba(255,255,255,.9) 0 9deg, transparent 9deg 19deg); animation: ray-spin 150s linear 0s infinite both; }
.intro-card, .outro-card { position: relative; z-index: 3; display: grid; justify-items: center; text-align: center; }
.intro-card > span, .outro-card > span { display: inline-flex; padding: 15px 23px; border-radius: 999px; background: #FF6277; color: #172A59; box-shadow: 0 10px 0 rgba(13,35,71,.18); font-size: 25px; font-weight: 900; letter-spacing: 1.5px; }
.intro-card h1, .outro-card h1 { max-width: 1050px; margin: 29px 0 9px; font-size: 96px; line-height: 1.02; letter-spacing: -4px; }
.intro-card p, .outro-card p { margin: 0; font-size: 37px; font-weight: 900; }
.intro-stars, .outro-stars { margin-top: 35px; color: #172A59; font-size: 43px; }
.outro-cta-badges { display: flex; gap: 18px; margin-top: 24px; align-items: center; justify-content: center; }
.badge-cta { display: inline-flex; align-items: center; gap: 8px; padding: 10px 22px; border-radius: 999px; background: #FFFFFF; color: #172A59; font-size: 24px; font-weight: 900; box-shadow: 0 8px 0 rgba(13,35,71,.18); border: 3px solid #172A59; }
.badge-comment { background: #29B9A8; color: #172A59; }
.badge-like { background: #FF6277; color: #172A59; }
.badge-sub { background: #FFC436; color: #172A59; }
.intro-dot { position: absolute; z-index: 1; border-radius: 50%; background: #fff; opacity: .47; }.dot-a { top: 126px; left: 250px; width: 158px; height: 158px; }.dot-b { right: 235px; bottom: 149px; width: 128px; height: 128px; }
.brand-mascot { position: absolute; z-index: 4; right: 255px; bottom: 95px; display: grid; place-items: center; width: 179px; height: 179px; border: 10px solid #fff; border-radius: 53px; background: #29B9A8; color: #172A59; box-shadow: 0 20px 0 rgba(13,35,71,.2); font-size: 93px; transform: rotate(-8deg); }
.outro-blob { position: absolute; z-index: 1; border-radius: 50%; background: rgba(255,255,255,.36); }.outro-blob.blob-a { top: 112px; left: 205px; width: 170px; height: 170px; }.outro-blob.blob-b { right: 220px; bottom: 130px; width: 205px; height: 205px; background: rgba(41,185,168,.36); }
.scene-decor { position: absolute; z-index: 2; inset: 0; pointer-events: none; color: rgba(255,255,255,.62); }
.scene-decor i { position: absolute; display: block; font-style: normal; animation: decor-drift var(--scene-duration) ease-in-out var(--clip-start) 1 alternate both; }
.decor-1 { top: 21%; left: 5%; font-size: 34px; color: var(--accent); }.decor-2 { top: 40%; left: 3%; font-size: 26px; }.decor-3 { top: 13%; right: 12%; font-size: 48px; color: var(--accent); }.decor-4 { right: 5%; bottom: 30%; font-size: 42px; color: rgba(255,255,255,.48); }.decor-5 { left: 18%; bottom: 11%; font-size: 31px; color: #FFD34D; }.decor-6 { right: 24%; top: 28%; font-size: 25px; color: #FFD34D; }.decor-7 { left: 30%; top: 8%; font-size: 18px; }
 @keyframes ray-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes drift { to { background-position: 230px 160px; } }
@keyframes ambient-drift { to { transform: translate(24px,-19px) rotate(8deg); } }
@keyframes hero-float { 50% { transform: translateY(-8px) rotate(1deg); } }
@keyframes answer-float { 50% { transform: translateY(-4px) rotate(.25deg); } }
@keyframes decor-drift { 50% { transform: translate(4px,-7px) rotate(2deg); } }
@keyframes question-card-enter { from { opacity: 0; transform: translateY(24px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes question-card-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes hanging-sign-enter { 0% { transform: translateY(-70px) rotate(5deg); opacity: 0; } 70% { transform: translateY(5px) rotate(-2deg); } 100% { transform: translateY(0) rotate(0deg); opacity: 1; } }
@keyframes hanging-sign-sway { 0% { transform: rotate(-1.8deg) translateY(0); } 50% { transform: rotate(0.3deg) translateY(-1px); } 100% { transform: rotate(1.8deg) translateY(0); } }
@keyframes star-wobble { 0% { transform: rotate(-10deg) scale(1); } 100% { transform: rotate(2deg) scale(1.05); } }
@keyframes sparkle-blink { 0%, 100% { opacity: 0.4; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
@keyframes title-enter { from { opacity: 0; transform: translateY(28px) scale(.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes hero-enter { from { opacity: 0; transform: translateY(42px) scale(.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes answer-enter { from { opacity: 0; transform: translateY(32px) scale(.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes enter-from-left { from { opacity: 0; transform: translateX(-60px) scale(.94); } to { opacity: 1; transform: translateX(0) scale(1); } }
@keyframes enter-from-right { from { opacity: 0; transform: translateX(60px) scale(.94); } to { opacity: 1; transform: translateX(0) scale(1); } }
@keyframes phase-enter { to { opacity: 1; } }
@keyframes phase-hold { 0%,100% { opacity: 0; } 1%,99% { opacity: 1; } }
@keyframes quiz-timer-drain { from { width: 100%; } to { width: 0%; } }
@keyframes quiz-timer-marker-slide { from { left: 100%; } to { left: 0%; } }
@keyframes query-hold { 0%, 99% { opacity: 1; } 100% { opacity: 0; } }
@keyframes number-countdown-tick { 0% { opacity: 0; transform: scale(1.7) rotate(-10deg); text-shadow: 0 0 16px rgba(255,255,255,1), 0 4px 0 rgba(13,35,71,.3); } 20% { opacity: 1; transform: scale(1.08) rotate(0deg); text-shadow: 0 0 10px rgba(255,230,120,.9), 0 3px 0 rgba(13,35,71,.25); } 82% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.72); } }
@keyframes number-countdown-final { 0% { opacity: 0; transform: scale(2) rotate(-15deg); text-shadow: 0 0 24px rgba(255,50,50,1), 0 4px 0 rgba(13,35,71,.35); } 20% { opacity: 1; transform: scale(1.22) rotate(0deg); text-shadow: 0 0 16px rgba(255,40,40,1), 0 3px 0 rgba(13,35,71,.3); } 45% { transform: scale(0.95); } 70% { transform: scale(1.18); } 85% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.6); } }
@keyframes quiz-timer-danger { 0%, 55% { box-shadow: inset 0 3px 0 rgba(255,255,255,.3); } 70% { box-shadow: inset 0 3px 0 rgba(255,255,255,.6), 0 0 16px rgba(255,167,38,.6); } 85% { box-shadow: inset 0 3px 0 rgba(255,255,255,.8), 0 0 24px rgba(255,87,34,.8); } 100% { box-shadow: inset 0 3px 0 rgba(255,255,255,.9), 0 0 32px rgba(244,67,54,.9); } }
@keyframes timer-marker-danger { 0%, 55% { transform: translate(-50%,-50%) scale(1); background: var(--accent); } 65% { transform: translate(-50%,-50%) scale(1.08); background: #FFA726; box-shadow: 0 8px 0 rgba(13,35,71,.24), 0 0 16px rgba(255,167,38,.7); } 78% { transform: translate(-50%,-50%) scale(1.14); background: #FF5722; box-shadow: 0 8px 0 rgba(13,35,71,.24), 0 0 24px rgba(255,87,34,.85); } 88% { transform: translate(-50%,-50%) scale(1.05); background: #F44336; } 94% { transform: translate(-50%,-50%) scale(1.22); background: #E53935; box-shadow: 0 8px 0 rgba(13,35,71,.24), 0 0 32px rgba(229,57,53,1); } 100% { transform: translate(-50%,-50%) scale(1.1); background: #D32F2F; } }
@keyframes timer-urgency-glow { 0%, 55% { box-shadow: inset 0 4px 0 rgba(13,35,71,.12), 0 7px 0 var(--depth-edge), 0 0 24px rgba(255,255,255,.22); } 70% { box-shadow: inset 0 4px 0 rgba(13,35,71,.12), 0 7px 0 var(--depth-edge), 0 0 32px rgba(255,167,38,.55); } 85% { box-shadow: inset 0 4px 0 rgba(13,35,71,.12), 0 7px 0 var(--depth-edge), 0 0 44px rgba(255,87,34,.78); } 100% { box-shadow: inset 0 4px 0 rgba(13,35,71,.12), 0 7px 0 var(--depth-edge), 0 0 56px rgba(244,67,54,.95); } }
@keyframes timer-exit-fade { from { opacity: 1; transform: translateX(-50%) scale(1); } to { opacity: 0; transform: translateX(-50%) scale(.96); } }
@keyframes reveal-enter-smooth { from { opacity: 0; transform: translateY(16px) scale(.92); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes timer-sparkle { 50% { transform: translateY(-4px) scale(1.16) rotate(12deg); opacity: .7; } }
@keyframes correct-card-reveal { 0% { transform: translateY(0) scale(1); } 55% { transform: translateY(-13px) scale(1.12); } 76% { transform: translateY(-2px) scale(1.015); } 100% { transform: translateY(-5px) scale(1.04); } }
 @keyframes visual-correct-card-reveal { 0% { transform: translateY(0) scale(1); } 55% { transform: translateY(-13px) scale(1.12); } 100% { transform: translateY(-4px) scale(1.035); } }
 @keyframes visual-correct-border { 0% { border-color: #fff; } 55%,100% { border-color: var(--correct); } }
@keyframes incorrect-card-settle { from { opacity: 1; transform: scale(1); } to { opacity: .52; transform: scale(.98); } }
@keyframes status-pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
@keyframes cross-pop { 0% { transform: scale(0); } 65% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes hero-reveal-push { from { transform: scale(1); } to { transform: scale(1.035); } }
@keyframes hero-ken-burn { from { transform: scale(1); } to { transform: scale(1.06); } }
@keyframes reveal-pop { from { opacity: 0; transform: scale(.7) rotate(-5deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes reveal-answer-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes stamp-pop { 0% { opacity: 0; transform: scale(0) rotate(-18deg); } 68% { opacity: 1; transform: scale(1.18) rotate(6deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes star-burst { from { opacity: 0; transform: translateY(28px) scale(.2) rotate(-28deg); } to { opacity: 1; transform: translateY(0) scale(1) rotate(0); } }
@keyframes quizProgressStarTwinkle { 0%, 100% { opacity: 0.65; transform: translate(-50%, -50%) scale(0.95); } 50% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); } }
@keyframes quizProgressMarkerPulse { 0%, 100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); } 25% { transform: translate(-50%, -50%) scale(1.12) rotate(4deg); } 55% { transform: translate(-50%, -50%) scale(0.96) rotate(-3deg); } 75% { transform: translate(-50%, -50%) scale(1.05) rotate(1deg); } }
@media (prefers-reduced-motion: reduce) { .milestone-star { animation: none; } }
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
