export type QuizArtifactStage = "research" | "quiz" | "director" | "assets" | "voice" | "timeline" | "render" | "qa";

const downstream: Record<QuizArtifactStage, QuizArtifactStage[]> = {
  research: ["quiz", "director", "assets", "voice", "timeline", "render", "qa"],
  quiz: ["director", "assets", "voice", "timeline", "render", "qa"],
  director: ["assets", "timeline", "render", "qa"],
  assets: ["render", "qa"],
  voice: ["timeline", "render", "qa"],
  timeline: ["render", "qa"],
  render: ["qa"],
  qa: [],
};

export function invalidateQuizArtifacts(changed: QuizArtifactStage): QuizArtifactStage[] {
  return [...downstream[changed]];
}

export function shouldInvalidateQuizArtifact(changed: QuizArtifactStage, target: QuizArtifactStage): boolean {
  return downstream[changed].includes(target);
}
