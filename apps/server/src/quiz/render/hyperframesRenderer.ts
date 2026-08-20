import type { PreparedQuizRender, QuizRenderInput, QuizRenderResult, QuizRenderer } from "./renderer.js";
import { buildQuizV2Composition } from "./buildComposition.js";

export class HyperframesRenderer implements QuizRenderer {
  async prepare(input: QuizRenderInput): Promise<PreparedQuizRender> {
    return {
      html: buildQuizV2Composition({
        quiz: input.quiz,
        director: input.director,
        timeline: input.timeline,
        theme: input.theme,
        audioPath: input.audioPath,
        narrationDurationSeconds: input.narrationDurationSeconds ?? input.timeline.duration_seconds,
        assets: input.assets,
      }),
      durationSeconds: input.narrationDurationSeconds ?? input.timeline.duration_seconds,
      questionCount: input.quiz.questions.length,
    };
  }

  async render(input: QuizRenderInput): Promise<QuizRenderResult> {
    const prepared = await this.prepare(input);
    return { composition: prepared.html, durationSeconds: prepared.durationSeconds };
  }
}
