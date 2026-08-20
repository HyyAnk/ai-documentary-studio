import type { AssetConsistencyGroup, QuizAssetRequirement } from "@studio/shared";
import { candyArcadeStyleBible } from "../visual/candyArcade.js";

export type CompiledAssetPrompt = {
  prompt: string;
  cacheVersion: string;
  critical: boolean;
};

export function compileQuizAssetPrompt(request: QuizAssetRequirement, consistencyGroup?: AssetConsistencyGroup): CompiledAssetPrompt {
  const rules = purposeRules(request.purpose);
  const transparency = request.transparent_background ? "Transparent background only; do not add a scene backdrop." : "Simple low-detail background with plenty of clean breathing room around the subject.";
  const soloHeroContract = !consistencyGroup && (request.purpose === "hero_question_image" || request.purpose === "question_illustration") ? [
    "Solo hero art contract: polished 3D clay-like illustration with dimensional rounded forms and one clear focal subject.",
    "Lighting: soft frontal studio light with a gentle upper-left highlight, contact shadow, and subtle rim light for depth.",
    "Edge treatment: soft rounded edges with a clean, screen-friendly silhouette and restrained depth cues.",
    "Detail level: medium, simplified child-friendly detail with no distracting background objects.",
    "Face policy: none. Do not add eyes, mouth, smile, human facial features, or anthropomorphic expressions unless they are naturally part of the subject.",
  ] : [];
  const groupContract = consistencyGroup ? [
    `Consistency group: ${consistencyGroup.group_id}.`,
    `Every option in this set must share this exact art direction: ${consistencyGroup.style_family}; ${consistencyGroup.rendering_medium}; ${consistencyGroup.lighting}; ${consistencyGroup.framing}; ${consistencyGroup.background_treatment}; ${consistencyGroup.subject_scale}; ${consistencyGroup.contrast}; ${consistencyGroup.saturation}; ${consistencyGroup.edge_treatment}; ${consistencyGroup.detail_level}; face policy ${consistencyGroup.face_policy}.`,
    "Change only the requested subject. Do not make this option more realistic, more saturated, cleaner, larger, or more dramatic than the other options.",
    consistencyGroup.face_policy === "none" ? "No eyes, mouth, smile, human face, or anthropomorphic expression on any option." : consistencyGroup.face_policy === "all" ? "Use the same friendly face treatment on every option in this group." : "Use facial features only when naturally present in the subject; do not add cartoon faces.",
  ] : [];
  const prompt = [
    "Create one image asset for a children's educational quiz video.",
    `Subject: ${request.subject}.`,
    `Purpose: ${request.purpose.replaceAll("_", " ")}.`,
    `Visual Style Bible: ${candyArcadeStyleBible.bright ? "bright" : "calm"}, friendly, high saturation, medium-high contrast, clean lighting, large identifiable subject, simple composition, safe and positive for children.`,
    ...soloHeroContract,
    ...groupContract,
    rules,
    transparency,
    `Output framing: ${request.aspect_ratio}.`,
    "No words, letters, captions, labels, logos, watermark, collage, or split screen.",
  ].join("\n");
  return { prompt, cacheVersion: candyArcadeStyleBible.id + "-asset-prompt-v4-render-contract", critical: request.required };
}

function purposeRules(purpose: QuizAssetRequirement["purpose"]): string {
  if (purpose === "hero_question_image" || purpose === "question_illustration") return "Landscape hero image. Keep one clear focal subject, with room around it for the quiz card and no distracting details.";
  if (purpose === "answer_option") return "One centered, instantly recognizable subject. Keep lighting, scale, framing, and background complexity consistent with the other answer options so the style does not reveal the answer.";
  if (purpose === "answer_reveal") return "Create a celebratory but controlled reveal image with one clear subject and room for a green answer frame.";
  return "Clean simple composition suitable as a supporting quiz visual.";
}
