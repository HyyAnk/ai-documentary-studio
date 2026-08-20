import { QuizAssetPlanSchema, type DirectorPlan, type QuizAssetPlan, type QuizV2 } from "@studio/shared";

export function planQuizAssets(quiz: QuizV2, director: DirectorPlan): QuizAssetPlan {
  const assets: QuizAssetPlan["assets"] = [];
  const consistencyGroups: QuizAssetPlan["consistency_groups"] = [];
  for (const beat of director.beats) {
    const question = quiz.questions.find((candidate) => candidate.id === beat.question_id);
    if (!question) continue;
    if (beat.asset_intents.includes("question_illustration") && question.visual_opportunity) {
      assets.push({
        asset_id: "asset-" + question.id + "-hero",
        question_id: question.id,
        subject: question.visual_opportunity,
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
        style_family: "Candy Arcade bright storybook companions",
        rendering_medium: "polished 3D clay-like illustration",
        lighting: "soft frontal studio light with gentle upper-left highlight",
        framing: "one centered subject, eye-level, full silhouette visible",
        background_treatment: "the same clean pale studio backdrop with no scenery",
        subject_scale: "subject fills roughly 68 percent of the square frame",
        contrast: "medium-high and matched across every option",
        saturation: "bright but matched across every option",
        edge_treatment: "soft rounded edges with a thin consistent rim light",
        detail_level: "medium, simplified child-friendly detail with one clear silhouette",
        face_policy: "none",
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
        required: question.format === "image_guess",
        semantic_key: question.id + ":choice:" + choice.id,
        consistency_group_id: groupId,
      }));
    }
  }
  return QuizAssetPlanSchema.parse({ schema_version: 2, episode_id: quiz.episode_id, assets, consistency_groups: consistencyGroups });
}
