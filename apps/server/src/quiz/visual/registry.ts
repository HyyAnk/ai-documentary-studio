import type { QuizVisualTheme } from "@studio/shared";
import { candyArcadeTemplate } from "./candyArcade.js";
import type { QuizVisualTemplate } from "./types.js";

const templates: Record<string, QuizVisualTemplate> = { candy_arcade: candyArcadeTemplate };

export function getQuizVisualTemplate(theme: QuizVisualTheme): QuizVisualTemplate {
  // Existing theme values deliberately resolve to the first production-grade
  // template until they receive their own template implementation.
  return templates[theme] ?? candyArcadeTemplate;
}
