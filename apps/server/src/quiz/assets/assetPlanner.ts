import { QuizAssetPlanSchema, type DirectorPlan, type QuizAssetPlan, type QuizImageStyle, type QuizV2 } from "@studio/shared";
import { QUIZ_STYLE_CONTRACTS } from "./promptCompiler.js";

export const QUIZ_ASSET_SUBJECT_MAX_LENGTH = 180;

export function planQuizAssets(quiz: QuizV2, director: DirectorPlan, visualStyle: QuizImageStyle = "pixar_3d"): QuizAssetPlan {
  const contract = QUIZ_STYLE_CONTRACTS[visualStyle] || QUIZ_STYLE_CONTRACTS.pixar_3d;
  const assets: QuizAssetPlan["assets"] = [];
  const consistencyGroups: QuizAssetPlan["consistency_groups"] = [];
  for (const beat of director.beats) {
    const question = quiz.questions.find((candidate) => candidate.id === beat.question_id);
    if (!question) continue;
    if (beat.asset_intents.includes("question_illustration") && (question.visual_opportunity || question.question)) {
      assets.push({
        asset_id: "asset-" + question.id + "-hero",
        question_id: question.id,
        subject: compactQuizAssetSubject(question.visual_opportunity || "", question.question),
        purpose: "hero_question_image",
        style: "cute_illustration",
        aspect_ratio: "16:9",
        transparent_background: false,
        required: true,
        semantic_key: question.id + ":hero_question_image",
        consistency_group_id: null,
      });
    }
    if (beat.asset_intents.includes("choice_illustration")) {
      const groupId = question.id + ":visual-answer-set";
      const optionAssetIds = question.choices.map((choice) => "asset-" + question.id + "-" + choice.id);
      consistencyGroups.push({
        group_id: groupId,
        question_id: question.id,
        purpose: "visual_answer_set",
        style_family: contract.styleFamily,
        rendering_medium: contract.renderingMedium,
        lighting: contract.lighting,
        framing: "one centered subject, eye-level, full silhouette visible",
        background_treatment: contract.optionBackground,
        subject_scale: "subject fills roughly 68 percent of the square frame",
        contrast: "medium-high and matched across every option",
        saturation: "bright but matched across every option",
        edge_treatment: contract.edgeTreatment,
        detail_level: contract.detailLevel,
        face_policy: "natural_only",
        asset_ids: optionAssetIds,
      });
      question.choices.forEach((choice) => assets.push({
        asset_id: "asset-" + question.id + "-" + choice.id,
        question_id: question.id,
        subject: choice.text,
        purpose: "answer_option",
        style: "cute_illustration",
        aspect_ratio: "1:1",
        transparent_background: true,
        required: true,
        semantic_key: question.id + ":choice:" + choice.id,
        consistency_group_id: groupId,
      }));
    }
  }
  return QuizAssetPlanSchema.parse({ schema_version: 2, episode_id: quiz.episode_id, assets, consistency_groups: consistencyGroups });
}

/**
 * Image prompts can contain a complete camera/style brief, while the asset
 * schema deliberately keeps `subject` short and semantic. Preserve the first
 * complete descriptive clauses, then safely trim on a word boundary; the
 * prompt compiler supplies the shared visual-style contract separately.
 */
export function compactQuizAssetSubject(value: string, fallback: string): string {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const source = normalized || fallback.normalize("NFKC").replace(/\s+/g, " ").trim() || "Quiz subject";
  if (source.length <= QUIZ_ASSET_SUBJECT_MAX_LENGTH) return source;

  const clauses = source.split(/(?<=[,;:.!?])\s+/u);
  let compact = "";
  for (const clause of clauses) {
    const candidate = compact ? `${compact} ${clause}` : clause;
    if (candidate.length > QUIZ_ASSET_SUBJECT_MAX_LENGTH) break;
    compact = candidate;
  }
  if (compact.length >= 24) return compact.replace(/[,:;\-–—]+$/u, "").trim();

  const fragment = source.slice(0, QUIZ_ASSET_SUBJECT_MAX_LENGTH).trimEnd();
  const boundary = fragment.lastIndexOf(" ");
  const safe = boundary >= Math.floor(QUIZ_ASSET_SUBJECT_MAX_LENGTH * 0.55) ? fragment.slice(0, boundary) : fragment;
  return safe.replace(/[,:;\-–—]+$/u, "").trim() || "Quiz subject";
}
