import type { QuizLayoutId, QuizMotionId, QuizPaletteId, QuizTransitionId } from "@studio/shared";
import type { QuizPalette, QuizTemplateContext, QuizTemplateScene, QuizVisualTemplate, TextLayout, TextTier } from "./types.js";

const roundedFont = '"Nunito", "Trebuchet MS", sans-serif';
const headlineFont = '"Fredoka", "SVN-Hello Headline", "Baloo 2", "Nunito", "Trebuchet MS", sans-serif';

export const candyArcadeTokens: QuizVisualTemplate["tokens"] = {
  spacing: { xs: 12, sm: 20, md: 32, lg: 48, xl: 72, xxl: 104 },
  radius: { card: 38, pill: 999, media: 42, badge: 25 },
  typography: {
    question: { family: headlineFont, weight: 800, size: 58, lineHeight: 1.18, letterSpacing: -0.5, shadow: "0 2px 0 rgba(255, 255, 255, .8), 0 3px 0 rgba(16, 35, 75, .08)" },
    answer: { family: roundedFont, weight: 900, size: 34, lineHeight: 1.1, letterSpacing: -0.6, shadow: "none" },
    badge: { family: roundedFont, weight: 900, size: 36, lineHeight: 1, letterSpacing: 0, shadow: "none" },
    label: { family: roundedFont, weight: 900, size: 23, lineHeight: 1.1, letterSpacing: 0.4, shadow: "none" },
    counter: { family: roundedFont, weight: 900, size: 27, lineHeight: 1, letterSpacing: 0.2, shadow: "none" },
    fact: { family: headlineFont, weight: 900, size: 38, lineHeight: 1.22, letterSpacing: -0.3, shadow: "none" },
    interstitial: { family: roundedFont, weight: 900, size: 96, lineHeight: 1.02, letterSpacing: -3.2, shadow: "0 7px 0 rgba(13, 35, 71, .12)" },
  },
  shadow: { card: "0 18px 0 rgba(13, 35, 71, .18)", lift: "0 25px 36px rgba(13, 35, 71, .22)", sticker: "0 10px 0 rgba(13, 35, 71, .24)", glow: "0 0 0 8px rgba(255,255,255,.22), 0 0 42px rgba(255,255,255,.55)" },
  motion: { enterMs: 440, staggerMs: 120, revealMs: 550, transitionMs: 920, ambientSeconds: 14, easing: { pop: "cubic-bezier(.18,1.42,.34,1)", out: "cubic-bezier(.22,.8,.3,1)", soft: "cubic-bezier(.4,0,.2,1)", linear: "linear" } },
  zIndex: { background: 0, ambient: 1, decor: 2, content: 3, header: 4, phaseRegion: 5, statusBadge: 6, reward: 7, mascot: 4, overlay: 8, transition: 10 },
  safeArea: { top: 64, right: 96, bottom: 58, left: 96 },
};

export const candyArcadePalettes = [
  { id: "lime", backgroundPrimary: "#99D93E", backgroundSecondary: "#31B87A", accent: "#FF6C78", surfaceAccent: "#C0394B", onAccent: "#0F172A", answerBadge: "#FF6C78", correct: "#27B96C", incorrect: "#7B8DA1", surface: "#FFFDF7", text: "#152A57", muted: "#E8F5DF" },
  { id: "aqua", backgroundPrimary: "#21C8CF", backgroundSecondary: "#1973CF", accent: "#FF7A63", surfaceAccent: "#BE4B3A", onAccent: "#0F172A", answerBadge: "#F6517C", correct: "#26B96C", incorrect: "#7B8DA1", surface: "#FFFDF7", text: "#102D5B", muted: "#DDF9F7" },
  { id: "sunny", backgroundPrimary: "#FFD23F", backgroundSecondary: "#FF9D31", accent: "#E94F6D", surfaceAccent: "#B63D54", onAccent: "#0F172A", answerBadge: "#EF5A5A", correct: "#25B56D", incorrect: "#7B8DA1", surface: "#FFFDF8", text: "#19325B", muted: "#FFF2B4" },
  { id: "purple", backgroundPrimary: "#9A66E6", backgroundSecondary: "#594DDC", accent: "#FFAA42", surfaceAccent: "#A64C00", onAccent: "#0F172A", answerBadge: "#F35B86", correct: "#33C777", incorrect: "#7B8DA1", surface: "#FFFEFF", text: "#1C2459", muted: "#E9E0FF" },
  { id: "pink", backgroundPrimary: "#FF82AF", backgroundSecondary: "#E94F8A", accent: "#FFD44D", surfaceAccent: "#8B6500", onAccent: "#0F172A", answerBadge: "#9075E6", correct: "#29B86C", incorrect: "#7B8DA1", surface: "#FFFDFD", text: "#2A235A", muted: "#FFE4EF" },
  { id: "orange", backgroundPrimary: "#FF964F", backgroundSecondary: "#EF5A62", accent: "#3BC7C9", surfaceAccent: "#007C82", onAccent: "#0F172A", answerBadge: "#2DADB7", correct: "#21B56A", incorrect: "#7B8DA1", surface: "#FFFDF8", text: "#1A315D", muted: "#FFE5C9" },
  { id: "red", backgroundPrimary: "#F15B68", backgroundSecondary: "#C93D78", accent: "#FFD047", surfaceAccent: "#9A6100", onAccent: "#0F172A", answerBadge: "#F7A53D", correct: "#28B86D", incorrect: "#7B8DA1", surface: "#FFFDFC", text: "#2A2150", muted: "#FFE0E4" },
  { id: "blue", backgroundPrimary: "#438CE8", backgroundSecondary: "#2A55C8", accent: "#FFCE45", surfaceAccent: "#8C6600", onAccent: "#0F172A", answerBadge: "#F06174", correct: "#2FC177", incorrect: "#7B8DA1", surface: "#FCFEFF", text: "#132A58", muted: "#DCEBFF" },
] as const satisfies readonly QuizPalette[];

export const candyArcadeStyleBible: QuizVisualTemplate["styleBible"] = {
  id: "candy-arcade-v2",
  bright: true,
  highSaturation: true,
  contrast: "medium_high",
  lighting: "clean",
  composition: "large_subject_simple_background",
  audience: "children",
  safety: "positive",
};

export const candyArcadeTemplate: QuizVisualTemplate = {
  id: "candy_arcade",
  displayName: "Candy Arcade",
  tokens: candyArcadeTokens,
  styleBible: candyArcadeStyleBible,
  palettes: candyArcadePalettes,
  resolveScene(context) {
    const palette = resolvePalette(context.requestedPalette, context.questionIndex, context.previousPaletteId);
    return {
      palette,
      layoutId: resolveLayout(context.requestedLayout, context.archetype, context.question.format),
      motionId: resolveMotion(context.requestedMotion, context.questionIndex),
      transitionId: resolveTransition(context.requestedTransition),
    };
  },
};

export function resolvePalette(requested: QuizPaletteId, questionIndex: number, previousPaletteId?: string): QuizPalette {
  const explicit = requested === "auto" ? undefined : candyArcadePalettes.find((palette) => palette.id === requested);
  if (explicit) return explicit;
  const start = questionIndex % candyArcadePalettes.length;
  for (let offset = 0; offset < candyArcadePalettes.length; offset += 1) {
    const candidate = candyArcadePalettes[(start + offset) % candyArcadePalettes.length];
    if (candidate.id !== previousPaletteId) return candidate;
  }
  return candyArcadePalettes[start];
}

export function resolveLayout(requested: QuizLayoutId, archetype: string, format: string): Exclude<QuizLayoutId, "auto"> {
  if (requested !== "auto") return requested;
  if (archetype === "visual_multiple_choice" || format === "odd_one_out") return "visual_choices_three";
  return "media_left_choices_right";
}

export function resolveMotion(requested: QuizMotionId, questionIndex: number): Exclude<QuizMotionId, "auto"> {
  if (requested !== "auto") return requested;
  return (["enter.pop", "enter.slideUp", "enter.scale"] as const)[questionIndex % 3];
}

export function resolveTransition(requested: QuizTransitionId): Exclude<QuizTransitionId, "auto"> {
  return requested === "auto" ? "bubble_splash" : requested;
}

export function textTier(value: string, role: "question" | "choice"): TextTier {
  const length = [...value.trim()].length;
  const limits = role === "question" ? [42, 78, 128, 176] : [18, 34, 58, 82];
  if (length <= limits[0]) return "short";
  if (length <= limits[1]) return "medium";
  if (length <= limits[2]) return "long";
  if (length <= limits[3]) return "very_long";
  return "overflow";
}

export function textLayout(value: string, role: "question" | "choice"): TextLayout {
  const tier = textTier(value, role);
  const options = role === "question"
    ? { short: [58, 1.18, 2], medium: [52, 1.2, 2], long: [46, 1.22, 3], very_long: [40, 1.24, 3], overflow: [36, 1.25, 4] }
    : { short: [34, 1.1, 2], medium: [30, 1.12, 2], long: [26, 1.15, 3], very_long: [24, 1.16, 3], overflow: [24, 1.16, 3] };
  const [fontSize, lineHeight, maxLines] = options[tier];
  return { tier, fontSize, lineHeight, maxLines, fits: tier !== "overflow" };
}

export function motionCssClass(motion: QuizMotionId): string {
  return "motion-" + (motion === "auto" ? "enter-pop" : motion.replaceAll(".", "-"));
}

export function timelineProgress(startSeconds: number, endSeconds: number, currentSeconds: number): number {
  if (endSeconds <= startSeconds) return 1;
  return Math.max(0, Math.min(1, (currentSeconds - startSeconds) / (endSeconds - startSeconds)));
}

export type QuizTimerState = {
  progress: number;
  remaining: number;
  boundary: number;
};

/**
 * The single source of truth for the on-screen timer. Consumers must derive
 * both the fill edge and the token position from this state; no frame delta
 * or previous render state is involved.
 */
export function quizTimerState(startSeconds: number, endSeconds: number, currentSeconds: number): QuizTimerState {
  const progress = timelineProgress(startSeconds, endSeconds, currentSeconds);
  const remaining = 1 - progress;
  return { progress, remaining, boundary: remaining };
}

export type AmbientMotionKind = "float" | "breathe" | "drift" | "tilt" | "none";

export function ambientPhaseSeconds(kind: AmbientMotionKind, itemIndex: number, questionId = ""): number {
  if (kind === "none") return 0;
  const hash = [...questionId].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 997, 17);
  const base = (Math.abs(hash) + Math.max(0, itemIndex) * 37) % 97;
  return Number(((base / 97) * ambientPeriodSeconds(kind)).toFixed(3));
}

export function ambientPeriodSeconds(kind: AmbientMotionKind): number {
  if (kind === "float") return 3.6;
  if (kind === "breathe") return 4.2;
  if (kind === "drift") return 6.4;
  if (kind === "tilt") return 5.1;
  return 0;
}

export function visualAnswerState(choiceId: string, canonicalChoiceId: string, phase: "idle" | "reveal" | "explain"): "idle" | "correct" | "incorrect" {
  if (phase === "idle") return "idle";
  return choiceId === canonicalChoiceId ? "correct" : "incorrect";
}
