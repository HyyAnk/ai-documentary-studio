import type { AssetConsistencyGroup, QuizAssetRequirement, QuizImageStyle } from "@studio/shared";

export type CompiledAssetPrompt = {
  prompt: string;
  cacheVersion: string;
  critical: boolean;
};

export type QuizStyleContract = {
  id: QuizImageStyle;
  name: string;
  styleFamily: string;
  renderingMedium: string;
  lighting: string;
  edgeTreatment: string;
  detailLevel: string;
  heroBackground: string;
  optionBackground: string;
  continuityPromptBrief: string;
};

export const QUIZ_STYLE_CONTRACTS: Record<QuizImageStyle, QuizStyleContract> = {
  pixar_3d: {
    id: "pixar_3d",
    name: "3D Pixar Animation",
    styleFamily: "3D modern digital animation storybook companion",
    renderingMedium: "high-end 3D animated movie render with rich tangible surface textures and large expressive sparkling eyes",
    lighting: "soft cinematic studio lighting with gentle key light, subtle rim light, and natural soft contact shadow",
    edgeTreatment: "crisp foreground silhouette with soft natural depth",
    detailLevel: "high-quality animated feature film standard with vibrant child-friendly appeal",
    heroBackground: "a gentle soft-focus pastel environment with subtle depth and generous breathing room, keeping the main subject the sharp center of focus",
    optionBackground: "a soft luminous studio card backdrop with subtle ambient tint, keeping the subject crisp and instantly recognizable",
    continuityPromptBrief: "3D modern digital animated movie character render style, soft cinematic studio lighting, fluffy detailed textures, large expressive sparkling eyes, vibrant warm cheerful colors, gentle soft-focus pastel environment with clean breathing room, the main subject is sharply focused and stands out prominently",
  },
  flat_vector: {
    id: "flat_vector",
    name: "2D Flat Vector",
    styleFamily: "modern 2D flat vector educational cartoon",
    renderingMedium: "clean 2D vector graphic illustration with bold clean outlines and saturated flat pastel colors",
    lighting: "clean bright ambient studio lighting with minimal flat shading",
    edgeTreatment: "bold smooth geometric outlines and clear silhouette",
    detailLevel: "clean minimalist shapes designed for instant visual clarity",
    heroBackground: "a minimalist geometric or nature backdrop with low contrast and subtle decorative elements, keeping the primary subject the absolute focal point",
    optionBackground: "a clean solid-tinted card background with subtle minimalist decorative accents, keeping the subject bold and clear",
    continuityPromptBrief: "modern 2D flat vector cartoon style, bold clean geometric outlines, bright flat pastel colors, playful minimalist design, soft minimalist geometric or nature backdrop with low contrast, isolated centered subject",
  },
  kawaii_chibi: {
    id: "kawaii_chibi",
    name: "Chibi Kawaii Anime",
    styleFamily: "Japanese Kawaii Chibi anime sticker storybook",
    renderingMedium: "charming Kawaii Chibi 2D anime illustration with giant glistening eyes and soft delicate lines",
    lighting: "bright joyful lighting with gentle glowing highlights",
    edgeTreatment: "soft rounded manga outlines with sweet aesthetic",
    detailLevel: "adorable simplified chibi proportions with high emotional charm",
    heroBackground: "a gentle pastel dreamscape backdrop with soft sparkles and muted ambient elements that complement without distracting from the main subject",
    optionBackground: "a soft pale pastel card backdrop with gentle dreamy accents, keeping the cute character in high focus",
    continuityPromptBrief: "Japanese Kawaii Chibi anime style, giant glistening cute eyes, soft pastel tones, charming manga illustration, gentle pastel dreamscape backdrop with soft sparkles, isolated centered subject",
  },
  voxel_lowpoly: {
    id: "voxel_lowpoly",
    name: "3D Voxel / Low-Poly",
    styleFamily: "colorful 3D voxel blocky gaming companion",
    renderingMedium: "vibrant 3D voxel pixel blocky art with clean geometric facets and isometric depth",
    lighting: "crisp isometric studio lighting with clean block shadows",
    edgeTreatment: "distinct cubic voxel edges with clean silhouette",
    detailLevel: "playful stylized 3D cube pixels instantly appealing to kids",
    heroBackground: "a minimalist voxel grid landscape with soft ambient lighting and simple blocky terrain, keeping the main character in clear sharp contrast at the center",
    optionBackground: "a subtle low-poly grid card backdrop with soft ambient lighting, keeping the voxel character crisp and centered",
    continuityPromptBrief: "3D colorful voxel blocky art style, vibrant cute cube pixels, clean isometric low-poly lighting, playful gaming aesthetic, minimalist voxel grid landscape with soft ambient lighting, isolated centered subject",
  },
  plastic_toy: {
    id: "plastic_toy",
    name: "3D Glossy Vinyl Toy",
    styleFamily: "3D glossy vinyl designer collectible toy",
    renderingMedium: "smooth glossy vinyl plastic toy figurine with specular shine and tactile toy proportions",
    lighting: "bright studio key light with crisp specular highlights and gentle studio reflections",
    edgeTreatment: "smooth rounded plastic edges with subtle glossy rim light",
    detailLevel: "polished designer toy collectible aesthetic with clean form",
    heroBackground: "a sleek contemporary studio tabletop with soft gentle reflections and subtle gradient lighting, keeping the toy subject crisp and eye-catching",
    optionBackground: "a polished studio pedestal card backdrop with soft reflections, keeping the glossy toy centered and vibrant",
    continuityPromptBrief: "smooth glossy vinyl designer toy figurine, shiny colorful plastic material, rounded Pop Mart chibi collectible aesthetic, sleek contemporary studio tabletop with soft gentle reflections and subtle gradient lighting, isolated centered subject",
  },
};

export function compileQuizAssetPrompt(
  request: QuizAssetRequirement,
  consistencyGroup?: AssetConsistencyGroup,
  visualStyle: QuizImageStyle = "pixar_3d",
): CompiledAssetPrompt {
  const contract = QUIZ_STYLE_CONTRACTS[visualStyle] || QUIZ_STYLE_CONTRACTS.pixar_3d;
  const rules = purposeRules(request.purpose);

  const backgroundGuidance = request.purpose === "hero_question_image" || request.purpose === "question_illustration"
    ? `Background: ${contract.heroBackground}.`
    : `Background: ${contract.optionBackground}.`;

  const soloHeroContract = !consistencyGroup && (request.purpose === "hero_question_image" || request.purpose === "question_illustration") ? [
    `Solo hero art contract: ${contract.renderingMedium} with ${contract.edgeTreatment} and one clear focal subject.`,
    `Lighting: ${contract.lighting}.`,
    `Detail level: ${contract.detailLevel}.`,
    "Face policy: natural_only. Do not add eyes, mouth, smile, human facial features, or anthropomorphic expressions unless they are naturally part of the subject.",
  ] : [];

  const groupContract = consistencyGroup ? [
    `Consistency group: ${consistencyGroup.group_id}.`,
    `Every option in this set must share this exact art direction: ${consistencyGroup.style_family}; ${consistencyGroup.rendering_medium}; ${consistencyGroup.lighting}; ${consistencyGroup.framing}; ${consistencyGroup.background_treatment}; ${consistencyGroup.subject_scale}; ${consistencyGroup.contrast}; ${consistencyGroup.saturation}; ${consistencyGroup.edge_treatment}; ${consistencyGroup.detail_level}; face policy ${consistencyGroup.face_policy}.`,
    "Change only the requested subject. Do not make this option more realistic, more saturated, cleaner, larger, or more dramatic than the other options.",
    consistencyGroup.face_policy === "none" ? "No eyes, mouth, smile, human face, or anthropomorphic expression on any option." : consistencyGroup.face_policy === "all" ? "Use the same friendly face treatment on every option in this group." : "Use facial features only when naturally present in the subject; do not add cartoon faces.",
  ] : [];

  const framing = framingRules(request.aspect_ratio, request.purpose);
  const prompt = [
    "Create one image asset for a children's educational quiz video.",
    `Subject: ${request.subject}.`,
    `Purpose: ${request.purpose.replaceAll("_", " ")}.`,
    `Visual Style: ${contract.name}, bright, friendly, high saturation, clean lighting, large identifiable subject, simple composition, safe and positive for children.`,
    ...soloHeroContract,
    ...groupContract,
    rules,
    framing,
    backgroundGuidance,
    `Output framing: ${request.aspect_ratio}.`,
    "No words, letters, captions, labels, logos, watermark, collage, or split screen.",
  ].join("\n");

  return {
    prompt,
    cacheVersion: `${contract.id}-v2-aspect-aware`,
    critical: request.required,
  };
}

function framingRules(aspectRatio: QuizAssetRequirement["aspect_ratio"], _purpose: QuizAssetRequirement["purpose"]): string {
  if (aspectRatio === "1:1") {
    return "Composition: 1:1 square canvas. Center the subject perfectly with balanced breathing room on all sides so it fits cleanly inside an answer card box.";
  }
  if (aspectRatio === "9:16") {
    return "Composition: 9:16 vertical portrait framing. Position the primary subject centrally with generous vertical headroom and no horizontal cutoffs.";
  }
  if (aspectRatio === "16:9") {
    return "Composition: 16:9 widescreen landscape framing. Broad horizontal perspective suited for video background, header, or hero illustration.";
  }
  if (aspectRatio === "4:3") {
    return "Composition: 4:3 standard horizontal canvas with well-proportioned margins.";
  }
  if (aspectRatio === "3:4") {
    return "Composition: 3:4 portrait card canvas. Keep the subject vertically structured with clean top/bottom margins.";
  }
  return `Composition: ${aspectRatio} aspect ratio canvas with balanced margins.`;
}

function purposeRules(purpose: QuizAssetRequirement["purpose"]): string {
  if (purpose === "hero_question_image" || purpose === "question_illustration") return "Hero question image. Keep one clear focal subject, with room around it for the quiz card and no distracting details.";
  if (purpose === "answer_option") return "One centered, instantly recognizable subject. Keep lighting, scale, framing, and background complexity consistent with the other answer options so the style does not reveal the answer.";
  if (purpose === "answer_reveal") return "Create a celebratory but controlled reveal image with one clear subject and room for a green answer frame.";
  return "Clean simple composition suitable as a supporting quiz visual.";
}
