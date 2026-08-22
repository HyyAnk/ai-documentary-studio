import type { DirectorArchetype, QuizLayoutId, QuizMotionId, QuizPaletteId, QuizTransitionId, QuizV2 } from "@studio/shared";

export type QuizVisualTokens = {
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  radius: { card: number; pill: number; media: number; badge: number };
  typography: Record<"question" | "answer" | "badge" | "label" | "counter" | "fact" | "interstitial", { family: string; weight: number; size: number; lineHeight: number; letterSpacing: number; shadow: string }>;
  shadow: { card: string; lift: string; sticker: string; glow: string };
  motion: { enterMs: number; staggerMs: number; revealMs: number; transitionMs: number; ambientSeconds: number; easing: Record<"pop" | "out" | "soft" | "linear", string> };
  zIndex: { background: number; ambient: number; content: number; mascot: number; overlay: number; transition: number };
  safeArea: { top: number; right: number; bottom: number; left: number };
};

export type QuizPalette = {
  id: Exclude<QuizPaletteId, "auto">;
  backgroundPrimary: string;
  backgroundSecondary: string;
  accent: string;
  /** Accent reserved for text/icons placed on the light card surface. */
  surfaceAccent: string;
  /** High-contrast ink for labels placed on bright badges and timer markers. */
  onAccent: string;
  answerBadge: string;
  correct: string;
  incorrect: string;
  surface: string;
  text: string;
  muted: string;
};

export type QuizVisualStyleBible = {
  id: string;
  bright: boolean;
  highSaturation: boolean;
  contrast: "medium_high";
  lighting: "clean";
  composition: "large_subject_simple_background";
  audience: "children";
  safety: "positive";
};

export type QuizTemplateContext = {
  question: QuizV2["questions"][number];
  questionIndex: number;
  totalQuestions: number;
  archetype: DirectorArchetype;
  requestedPalette: QuizPaletteId;
  requestedLayout: QuizLayoutId;
  requestedMotion: QuizMotionId;
  requestedTransition: QuizTransitionId;
  previousPaletteId?: string;
};

export type QuizTemplateScene = {
  palette: QuizPalette;
  layoutId: Exclude<QuizLayoutId, "auto">;
  motionId: Exclude<QuizMotionId, "auto">;
  transitionId: Exclude<QuizTransitionId, "auto">;
};

export type QuizVisualTemplate = {
  id: string;
  displayName: string;
  tokens: QuizVisualTokens;
  styleBible: QuizVisualStyleBible;
  palettes: readonly QuizPalette[];
  resolveScene(context: QuizTemplateContext): QuizTemplateScene;
};

export type TextTier = "short" | "medium" | "long" | "very_long" | "overflow";

export type TextLayout = { tier: TextTier; fontSize: number; lineHeight: number; maxLines: number; fits: boolean };
