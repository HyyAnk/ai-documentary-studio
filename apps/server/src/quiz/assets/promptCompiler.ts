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
    renderingMedium: "high-end 3D animated movie render with rich tangible surface textures, tactile depth, and large expressive sparkling eyes on characters and animals",
    lighting: "soft cinematic studio lighting with gentle key light, warm rim light, and natural soft contact shadow",
    edgeTreatment: "crisp foreground silhouette with beautiful soft depth of field",
    detailLevel: "masterpiece animated feature film standard with vibrant child-friendly appeal, expressive facial details, and high fidelity",
    heroBackground: "a stunning cinematic 3D environment with rich natural atmosphere, soft atmospheric glow, subtle volumetric depth, and tasteful environmental storytelling that complements the subject",
    optionBackground: "a soft luminous studio card backdrop with subtle ambient tint, warm soft rim lighting, and elegant depth that highlights the subject",
    continuityPromptBrief: "3D modern digital animated movie character render style, soft cinematic studio lighting with key and rim lights, rich detailed textures, large expressive sparkling eyes, vibrant warm cheerful colors, lush atmospheric environment with depth, the main subject is sharply focused and stands out prominently",
  },
  flat_vector: {
    id: "flat_vector",
    name: "2D Flat Vector",
    styleFamily: "modern 2D flat vector educational cartoon",
    renderingMedium: "clean 2D vector graphic illustration with bold clean outlines, crisp shapes, expressive friendly eyes on living creatures, and saturated flat pastel colors",
    lighting: "clean bright ambient studio lighting with minimal flat shading and vibrant accents",
    edgeTreatment: "bold smooth geometric outlines and crystal clear silhouette",
    detailLevel: "clean modern vector art designed for instant visual clarity, charming facial expressions, and high aesthetic appeal",
    heroBackground: "a vibrant modern vector landscape with rich geometric layers, harmonious color gradients, and playful decorative nature elements",
    optionBackground: "a clean solid-tinted card background with subtle minimalist decorative accents and playful geometric shapes",
    continuityPromptBrief: "modern 2D flat vector cartoon style, bold clean geometric outlines, bright flat pastel colors, expressive friendly eyes, playful minimalist design, vibrant layered vector backdrop, isolated centered subject",
  },
  kawaii_chibi: {
    id: "kawaii_chibi",
    name: "Chibi Kawaii Anime",
    styleFamily: "Japanese Kawaii Chibi anime sticker storybook",
    renderingMedium: "charming Kawaii Chibi 2D anime illustration with giant glistening eyes, blushing cheeks, and soft delicate lines",
    lighting: "bright joyful lighting with gentle glowing highlights and soft sparkles",
    edgeTreatment: "soft rounded manga outlines with sweet aesthetic",
    detailLevel: "adorable simplified chibi proportions with high emotional charm, sparkling eyes, and candy-like color harmony",
    heroBackground: "a whimsical pastel dreamscape with floating soft sparkles, charming clouds, gentle glowing stars, and sweet storybook scenery",
    optionBackground: "a soft pale pastel card backdrop with gentle dreamy accents, subtle sparkles, and sweet pastel warmth",
    continuityPromptBrief: "Japanese Kawaii Chibi anime style, giant glistening cute eyes, soft pastel tones, charming manga illustration, gentle pastel dreamscape backdrop with soft sparkles, isolated centered subject",
  },
  voxel_lowpoly: {
    id: "voxel_lowpoly",
    name: "3D Voxel / Low-Poly",
    styleFamily: "colorful 3D voxel blocky gaming companion",
    renderingMedium: "vibrant 3D voxel pixel blocky art with clean geometric facets, cute expressive pixel eyes on living subjects, and isometric depth",
    lighting: "crisp isometric studio lighting with clean block shadows and warm ambient occlusion",
    edgeTreatment: "distinct cubic voxel edges with clean silhouette",
    detailLevel: "playful stylized 3D cube pixels instantly appealing to kids with rich blocky detail and clearly marked character faces",
    heroBackground: "a beautifully crafted 3D voxel blocky environment with isometric landscape, lush cubic vegetation, gentle ambient occlusion, and vibrant voxel terrain",
    optionBackground: "a stylish low-poly grid card backdrop with soft isometric lighting and gentle block reflections",
    continuityPromptBrief: "3D colorful voxel blocky art style, vibrant cute cube pixels, expressive character features, clean isometric low-poly lighting, playful gaming aesthetic, lush voxel landscape backdrop with soft ambient lighting, isolated centered subject",
  },
  plastic_toy: {
    id: "plastic_toy",
    name: "3D Glossy Vinyl Toy",
    styleFamily: "3D glossy vinyl designer collectible toy",
    renderingMedium: "smooth glossy vinyl plastic toy figurine with specular shine, tactile toy proportions, cute painted glossy eyes with expressive pupils, and premium acrylic feel",
    lighting: "bright studio key light with crisp specular highlights and gentle studio reflections",
    edgeTreatment: "smooth rounded plastic edges with subtle glossy rim light",
    detailLevel: "polished designer toy collectible aesthetic with clean form, delightful painted eye decals, and glossy Pop Mart finish",
    heroBackground: "a premium designer toy diorama stage with glossy contemporary surfaces, soft studio gradient backdrop, subtle specular reflections, and vibrant toy accessories",
    optionBackground: "a polished studio pedestal card backdrop with soft reflections, subtle acrylic gradient, and vibrant toy shine",
    continuityPromptBrief: "smooth glossy vinyl designer toy figurine, shiny colorful plastic material, cute painted glossy eyes with pupils, rounded Pop Mart chibi collectible aesthetic, sleek contemporary studio tabletop with soft gentle reflections and subtle gradient lighting, isolated centered subject",
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
    "Face policy: natural_only. Living creatures, characters, dinosaurs, and animals must have complete, expressive natural eyes with clear pupils and anatomically correct facial features. Inanimate objects, planets, and landscapes must remain authentic without adding anthropomorphic cartoon faces.",
  ] : [];

  const groupContract = consistencyGroup ? [
    `Consistency group: ${consistencyGroup.group_id}.`,
    `Every option in this set must share this exact art direction: ${consistencyGroup.style_family}; ${consistencyGroup.rendering_medium}; ${consistencyGroup.lighting}; ${consistencyGroup.framing}; ${consistencyGroup.background_treatment}; ${consistencyGroup.subject_scale}; ${consistencyGroup.contrast}; ${consistencyGroup.saturation}; ${consistencyGroup.edge_treatment}; ${consistencyGroup.detail_level}; face policy ${consistencyGroup.face_policy}.`,
    "Change only the requested subject. Do not make this option more realistic, more saturated, cleaner, larger, or more dramatic than the other options.",
    consistencyGroup.face_policy === "none"
      ? "Do not add anthropomorphic facial features to non-living objects."
      : consistencyGroup.face_policy === "all"
        ? "Use the same friendly face treatment with clear expressive eyes on every option in this group."
        : "Use facial features only when naturally present in the subject; living creatures, dinosaurs, and animals must have complete clear eyes with pupils, while inanimate objects have no cartoon faces.",
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
    cacheVersion: `${contract.id}-v3-expressive-faces`,
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
