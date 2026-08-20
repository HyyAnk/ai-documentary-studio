import {
  ProductionAssessmentSchema,
  SceneSchema,
  type Episode,
  type ProductionAssessment,
  type Scene,
} from "@studio/shared";

const WORD_PATTERN = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;
const AUDIO_CUE_PATTERN = /<!--\s*AUDIO[_ -]?CUE\s*:\s*(chuckle|laugh)\s*-->/gi;
const PARALINGUISTIC_TAG_PATTERN = /\[(?:chuckle|laugh)\]/gi;
export const HUMOR_POLICY_MARKER = "<!-- HUMOR_POLICY: v1 -->";

export function hasHumorPolicyMarker(markdown: string): boolean {
  return /<!--\s*HUMOR[_ -]?POLICY\s*:\s*v1\s*-->/i.test(markdown);
}

// A duration target is more useful than the historical word-count default once a
// real narrator pace is known. Keep the gate permissive enough for natural
// documentary phrasing while still catching scripts that would materially miss
// the requested runtime.
export const SCRIPT_WORD_TOLERANCE = 0.2;

export function calibratedScriptTargetWords(episode: Pick<Episode, "target_duration_minutes" | "measured_narration_words_per_second">, fallbackWordsPerSecond: number): number {
  const pace = episode.measured_narration_words_per_second ?? fallbackWordsPerSecond;
  return Math.max(1, Math.round(episode.target_duration_minutes * 60 * Math.max(0.1, pace)));
}

export function scriptWordBounds(targetWords: number): { lower: number; upper: number } {
  return {
    lower: Math.floor(targetWords * (1 - SCRIPT_WORD_TOLERANCE)),
    upper: Math.ceil(targetWords * (1 + SCRIPT_WORD_TOLERANCE)),
  };
}

export function extractNarration(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s*\[(?:Visual|SFX|Music|On screen|Archive|Reconstruction)[^\]]*\]\s*$/gim, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*\*\*(?:Narrator|Voiceover|VO):\*\*\s*$/gim, " ")
    .replace(/^\s*[-*]\s+/gm, " ")
    .replace(/[*_`>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns narration with supported audio cues restored as Chatterbox tags.
 * The normal narration extractor intentionally removes the HTML comments so
 * scripts, shot plans, and word counts stay clean.
 */
export function extractNarrationForAudio(markdown: string): string {
  return extractNarration(markdown.replace(AUDIO_CUE_PATTERN, (_match, cue: string) => ` [${cue.toLowerCase()}] `));
}

export function extractNarrationSections(markdown: string, includeAudioCues = false): Array<{ title: string; text: string }> {
  const sections = markdown.split(/^(?=##\s+)/gm).map((value) => value.trim()).filter(Boolean);
  const parsed = sections.map((section, index) => {
    const title = section.match(/^##\s+(.+)$/m)?.[1]?.trim() ?? `Section ${index + 1}`;
    return { title, text: includeAudioCues ? extractNarrationForAudio(section) : extractNarration(section) };
  }).filter((section) => section.text.length > 0);
  return parsed.length ? parsed : [{ title: "Narration", text: includeAudioCues ? extractNarrationForAudio(markdown) : extractNarration(markdown) }];
}

export function extractNarrationChunks(markdown: string, maxWords = 70, includeAudioCues = false): Array<{ title: string; text: string }> {
  return extractNarrationSections(markdown, includeAudioCues).flatMap((section) => {
    const chunks = splitAtNarrativeBoundaries(section.text, maxWords);
    if (chunks.length > 1 && countWords(chunks[chunks.length - 1]) < 25 && countWords(chunks[chunks.length - 2]) + countWords(chunks[chunks.length - 1]) <= maxWords + 15) {
      chunks.splice(chunks.length - 2, 2, `${chunks[chunks.length - 2]} ${chunks[chunks.length - 1]}`.trim());
    }
    return chunks.map((text, index) => ({
      title: chunks.length === 1 ? section.title : `${section.title} ${index + 1}/${chunks.length}`,
      text,
    }));
  });
}

export function countWords(value: string): number {
  return value.replace(/<!--[\s\S]*?-->/g, " ").replace(PARALINGUISTIC_TAG_PATTERN, " ").match(WORD_PATTERN)?.length ?? 0;
}

export function splitAtNarrativeBoundaries(dialogue: string, maxWords: number): string[] {
  const value = dialogue.trim();
  if (!value || countWords(value) <= maxWords) return value ? [value] : [];
  const units = value.match(/[^.!?;:]+(?:[.!?;:]|$)/g)?.map((unit) => unit.trim()).filter(Boolean) ?? [value];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const unit of units) {
    if (countWords(unit) > maxWords) {
      flush();
      chunks.push(...splitLongUnit(unit, maxWords));
      continue;
    }
    const candidate = `${current} ${unit}`.trim();
    if (current && countWords(candidate) > maxWords) flush();
    current = `${current} ${unit}`.trim();
  }
  flush();
  return chunks;
}

function splitLongUnit(unit: string, maxWords: number): string[] {
  const clauses = unit.split(/(?<=[,—–])\s+/).map((value) => value.trim()).filter(Boolean);
  if (clauses.length > 1 && clauses.every((clause) => countWords(clause) <= maxWords)) {
    const chunks: string[] = [];
    let current = "";
    for (const clause of clauses) {
      const candidate = `${current} ${clause}`.trim();
      if (current && countWords(candidate) > maxWords) {
        chunks.push(current);
        current = clause;
      } else current = candidate;
    }
    if (current) chunks.push(current);
    return chunks;
  }
  const words = unit.match(WORD_PATTERN) ?? [];
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) chunks.push(words.slice(index, index + maxWords).join(" "));
  return chunks;
}

export function assessProduction(input: {
  episode: Episode;
  research: string;
  treatment: string;
  visualBible: string;
  script: string;
  scenes: Scene[];
  fallbackWordsPerSecond: number;
}): ProductionAssessment {
  const { episode, research, treatment, visualBible, script, scenes: inputScenes } = input;
  const scenes = inputScenes.map((scene) => SceneSchema.parse(scene));
  const narration = extractNarration(script);
  const narrationWords = countWords(narration);
  const pace = episode.measured_narration_words_per_second ?? input.fallbackWordsPerSecond;
  const estimatedNarrationSeconds = narrationWords / Math.max(0.1, pace);
  const targetDurationSeconds = episode.target_duration_minutes * 60;
  const researchSourceCount = new Set(research.match(/https?:\/\/[^\s)>\]]+/g) ?? []).size;
  const factualAnchorCount = countFactualAnchors(narration, script);
  const sequenceCount = new Set(scenes.map((scene) => scene.sequence_id).filter(Boolean)).size;
  const uniquePromptRatio = ratio(new Set(scenes.map((scene) => normalize(scene.visual_prompt))).size, scenes.length);
  const structuredPromptRatio = ratio(scenes.filter((scene) => ["CAMERA", "ACTION", "LIGHTING", "ATMOSPHERE", "CONTINUITY"].every((label) => scene.visual_prompt.toUpperCase().includes(label))).length, scenes.length);
  const continuityCoverageRatio = ratio(scenes.filter((scene) => scene.continuity_bundle_id.trim() && scene.continuity_note.trim()).length, scenes.length);
  const sourceCoverageRatio = ratio(scenes.filter((scene) => scene.asset_type === "transition" || scene.source_ids.length > 0).length, scenes.length);
  const narrationCoverageRatio = wordCoverage(narration, scenes.map((scene) => scene.dialogue).join(" "));
  const overlayCoverageRatio = ratio(scenes.filter((scene) => scene.editorial_overlay.kind !== "none").length, scenes.length);
  const issues: ProductionAssessment["issues"] = [];
  let score = 100;
  const add = (code: string, severity: "blocker" | "warning" | "info", message: string, nextAction: string, penalty: number, sceneNumbers: number[] = []) => {
    issues.push({ code, severity, message, next_action: nextAction, scene_numbers: sceneNumbers });
    score -= penalty;
  };

  if (researchSourceCount < 5) add("research_sources", "blocker", `Research has ${researchSourceCount} linked sources; production requires at least 5.`, "Regenerate or edit research with primary and authoritative source URLs.", 18);
  const treatmentSequenceCount = Math.max(new Set(treatment.match(/\bSequence\s+\d+\b/gi) ?? []).size, (treatment.match(/\bTime budget\b/gi) ?? []).length);
  if (!treatment.trim() || treatmentSequenceCount < 5) add("treatment_structure", "blocker", "The treatment does not define at least five timed sequences.", "Generate a treatment before writing the script.", 12);
  if (!visualBible.trim() || !/continuity bundle/i.test(visualBible)) add("visual_bible", "blocker", "The visual bible has no continuity bundles.", "Generate the visual bible and define reusable identity locks.", 12);
  if (script.trim() && !hasHumorPolicyMarker(script)) add("humor_policy", "warning", "This script predates the current humor policy and has not been reviewed for restrained humor or audio cues.", "Regenerate the script once to apply the current documentary humor layer.", 2);
  const calibratedTargetWords = calibratedScriptTargetWords(episode, input.fallbackWordsPerSecond);
  const bounds = scriptWordBounds(calibratedTargetWords);
  if (narrationWords < bounds.lower || narrationWords > bounds.upper) add("script_length", "blocker", `Narration is ${narrationWords} words against a calibrated ${calibratedTargetWords}-word target (${episode.target_duration_minutes} minutes at ${pace.toFixed(2)} words/sec).`, `Regenerate or edit the script to stay within ${Math.round(SCRIPT_WORD_TOLERANCE * 100)}% of the calibrated word target.`, 15);
  if (factualAnchorCount < 6) add("factual_density", "blocker", `The script contains only ${factualAnchorCount} measurable factual anchors.`, "Add dated events, named programs, figures, decisions, and claim IDs from research.", 15);
  if (scenes.length === 0) add("scene_plan", "blocker", "No production shots exist.", "Generate the shot breakdown after the visual bible is ready.", 25);
  if (scenes.length > 0 && sequenceCount < 5) add("sequence_count", "warning", `The breakdown uses ${sequenceCount} sequence${sequenceCount === 1 ? "" : "s"}.`, "Organize the documentary into at least five purposeful sequences.", 8);
  if (scenes.length > 0 && uniquePromptRatio < 0.9) add("duplicate_prompts", "blocker", `${Math.round((1 - uniquePromptRatio) * 100)}% of prompts are exact duplicates.`, "Regenerate repeated shots with distinct visible action and framing.", 14, duplicatePromptScenes(scenes));
  if (scenes.length > 0 && structuredPromptRatio < 0.95) add("prompt_structure", "warning", `${Math.round(structuredPromptRatio * 100)}% of prompts contain the required production sections.`, "Complete CAMERA, ACTION, LIGHTING, ATMOSPHERE, and CONTINUITY for every generated shot.", 8);
  if (scenes.length > 0 && continuityCoverageRatio < 0.95) add("continuity_coverage", "blocker", `${Math.round(continuityCoverageRatio * 100)}% of shots are connected to a continuity bundle.`, "Assign every shot to a visual-bible continuity bundle.", 12);
  if (scenes.length > 0 && sourceCoverageRatio < 0.75) add("source_coverage", "warning", `${Math.round(sourceCoverageRatio * 100)}% of shots carry source IDs.`, "Link shots to research claims or evidence sources, including reconstructions.", 8);
  if (scenes.length > 0 && narrationCoverageRatio < 0.975) add("narration_coverage", "blocker", `${(narrationCoverageRatio * 100).toFixed(1)}% of script words are represented in the shot timeline.`, "Regenerate the affected sequence without paraphrasing or omitting narration.", 15);
  const types = new Set(scenes.map((scene) => scene.asset_type));
  if (scenes.length && types.size < 3) add("visual_mix", "warning", `The plan uses only ${types.size} visual asset type${types.size === 1 ? "" : "s"}.`, "Mix evidence, diagrams, maps, contemporary footage, and reconstruction where appropriate.", 6);
  if (scenes.length && (overlayCoverageRatio < 0.2 || overlayCoverageRatio > 0.35)) add("overlay_coverage", "warning", `Editorial overlays cover ${Math.round(overlayCoverageRatio * 100)}% of shots; the target range is 25–30%.`, "Use restrained captions, timelines, charts, or map callouts on only the explanatory shots.", 4);
  const invalidChartOverlays = scenes.filter((scene) => ["bar_chart", "line_chart"].includes(scene.editorial_overlay.kind) && scene.editorial_overlay.data.length < 2).map((scene) => scene.scene_number);
  if (invalidChartOverlays.length) add("overlay_data", "warning", `${invalidChartOverlays.length} chart overlay${invalidChartOverlays.length === 1 ? "" : "s"} lack at least two sourced data points.`, "Replace the chart with a caption or provide two or more research-backed data points.", Math.min(4, invalidChartOverlays.length), invalidChartOverlays);
  if (!episode.narration_asset_path) add("narration_audio", "info", "Production narration has not been generated.", "Generate sequence narration to calibrate the real timeline.", 3);
  if (episode.narration_duration_seconds) {
    const durationDeltaRatio = Math.abs(episode.narration_duration_seconds - targetDurationSeconds) / targetDurationSeconds;
    if (durationDeltaRatio > 0.12) add("narration_duration", "blocker", `Master narration is ${formatDuration(episode.narration_duration_seconds)} against a ${formatDuration(targetDurationSeconds)} target.`, "Use the measured narrator pace to update the word budget, then regenerate downstream artifacts.", 15);
  }
  const shortScenes = scenes.filter((scene) => scene.duration_seconds < 2.5 && scene.asset_type !== "transition").map((scene) => scene.scene_number);
  if (shortScenes.length) add("short_shots", "warning", `${shortScenes.length} shots are shorter than 2.5 seconds.`, "Combine or lengthen shots unless the rapid cut is intentional.", Math.min(6, shortScenes.length), shortScenes);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const hasBlocker = issues.some((issue) => issue.severity === "blocker");
  const rating = !hasBlocker && score >= 85 ? "production_ready" : score >= 60 ? "needs_work" : "not_ready";
  return ProductionAssessmentSchema.parse({
    score,
    rating,
    assessed_at: new Date().toISOString(),
    metrics: {
      target_duration_seconds: targetDurationSeconds,
      estimated_narration_seconds: Number(estimatedNarrationSeconds.toFixed(1)),
      narration_word_count: narrationWords,
      target_word_count: episode.target_word_count,
      calibrated_word_target_count: calibratedTargetWords,
      scene_count: scenes.length,
      sequence_count: sequenceCount,
      unique_prompt_ratio: uniquePromptRatio,
      structured_prompt_ratio: structuredPromptRatio,
      continuity_coverage_ratio: continuityCoverageRatio,
      source_coverage_ratio: sourceCoverageRatio,
      narration_coverage_ratio: narrationCoverageRatio,
      overlay_coverage_ratio: overlayCoverageRatio,
      factual_anchor_count: factualAnchorCount,
      research_source_count: researchSourceCount,
    },
    issues,
  });
}

function countFactualAnchors(value: string, markdown = value): number {
  const years = value.match(/\b(?:18|19|20)\d{2}\b/g) ?? [];
  const figures = value.match(/\b\d+(?:\.\d+)?(?:\s?(?:%|percent|million|billion|kilomet(?:er|re)s?|miles?|vehicles?|dollars?))\b/gi) ?? [];
  const claimIds = markdown.match(/\bC\d{2,}\b/g) ?? [];
  return new Set([...years, ...figures, ...claimIds]).size;
}

function duplicatePromptScenes(scenes: Scene[]): number[] {
  const groups = new Map<string, number[]>();
  for (const scene of scenes) {
    const key = normalize(scene.visual_prompt);
    groups.set(key, [...(groups.get(key) ?? []), scene.scene_number]);
  }
  return [...groups.values()].filter((numbers) => numbers.length > 1).flat();
}

function wordCoverage(expected: string, actual: string): number {
  const expectedWords = expected.toLowerCase().match(WORD_PATTERN) ?? [];
  const actualCounts = new Map<string, number>();
  for (const word of actual.toLowerCase().match(WORD_PATTERN) ?? []) actualCounts.set(word, (actualCounts.get(word) ?? 0) + 1);
  let matched = 0;
  for (const word of expectedWords) {
    const available = actualCounts.get(word) ?? 0;
    if (available > 0) {
      matched += 1;
      actualCounts.set(word, available - 1);
    }
  }
  return ratio(matched, expectedWords.length);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
