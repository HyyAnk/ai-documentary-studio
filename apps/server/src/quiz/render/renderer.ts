import type { DirectorPlan, QuizConfig, QuizTimeline, QuizV2, Scene } from "@studio/shared";

export type QuizRenderInput = {
  quiz: QuizV2;
  director: DirectorPlan;
  timeline: QuizTimeline;
  scenes: Scene[];
  audioPath: string;
  theme: QuizConfig["visual_theme"];
  narrationDurationSeconds?: number;
  assets?: Record<string, string>;
};

export type PreparedQuizRender = { html: string; compositionFiles: Record<string, string>; durationSeconds: number; questionCount: number };
export type QuizRenderResult = { composition: string; durationSeconds: number };

export interface QuizRenderer {
  prepare(input: QuizRenderInput): Promise<PreparedQuizRender>;
  render(input: QuizRenderInput): Promise<QuizRenderResult>;
}
