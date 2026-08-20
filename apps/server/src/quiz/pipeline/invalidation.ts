export type QuizArtifactStage = "research" | "quiz" | "director" | "assets" | "asset_resolution" | "voice" | "timeline" | "render" | "qa";

const downstream: Record<QuizArtifactStage, QuizArtifactStage[]> = {
  research: ["quiz", "director", "assets", "asset_resolution", "voice", "timeline", "render", "qa"],
  quiz: ["director", "assets", "asset_resolution", "voice", "timeline", "render", "qa"],
  director: ["assets", "asset_resolution", "voice", "timeline", "render", "qa"],
  assets: ["asset_resolution", "voice", "timeline", "render", "qa"],
  asset_resolution: ["voice", "timeline", "render", "qa"],
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
