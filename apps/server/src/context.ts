import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ContextManifestSchema,
  type ContextManifest,
  type Episode,
  type Scene,
  type TaskType,
  QUIZ_MAX_QUESTION_COUNT,
  QUIZ_MIN_QUESTION_COUNT,
} from "@studio/shared";
import { RepositoryService } from "./repository.js";
import { StudioLogger } from "./logger.js";
import { DEFAULT_CONFIG } from "./config.js";
import { calibratedScriptTargetWords, scriptWordBounds } from "./production.js";
import { continuityBundleId } from "./visualBundles.js";
import { extractArtifactSectionNumbers, parseArtifactSectionNumber, type ArtifactSectionKind } from "./artifactSections.js";
import { QUIZ_STYLE_CONTRACTS } from "./quiz/assets/promptCompiler.js";

type ContextFile = { path: string; reason: string; content: string };

export class ContextEngine {
  constructor(private readonly repository: RepositoryService, private readonly logger: StudioLogger) {}

  async build(taskType: TaskType, channelId: string, episodeId: string | null, sceneNumber?: number, imageVariant = 0): Promise<ContextManifest> {
    const channel = await this.repository.getChannel(channelId);
    const isQuiz = channel.engine === "quiz" || channel.group_id === "quiz";
    const files: ContextFile[] = [];
    const sharedFiles: ContextFile[] = [];
    const excluded = ["other channels", "full unrelated episodes", "raw task history", "secrets and credentials"];
    const add = (file: ContextFile) => files.push(file);
    const read = async (relativePath: string, reason: string): Promise<string> => {
      const absolute = this.repository.resolveContextPath(relativePath);
      try {
        const content = await (await import("node:fs/promises")).readFile(absolute, "utf8");
        add({ path: relativePath, reason, content });
        return content;
      } catch {
        return "";
      }
    };

    const dnaPath = `channels/${channel.slug}/channel_dna.md`;
    const stylePath = `channels/${channel.slug}/style_guide.md`;
    if (taskType === "GENERATE_DNA") {
      const template = await read("templates/quiz_channel_dna.md", "canonical DNA schema");
      const prompt = this.compose(taskType, channel, null, files, {
        user_description: channel.description,
        metadata: { name: channel.display_name, audience: channel.target_audience, language: channel.language, market: channel.market },
        template,
        output_contract: "Return only the completed Markdown DNA document. Do not write files or perform research.",
      });
      return this.finalize(taskType, channelId, null, files, excluded, prompt);
    }

    const dna = await read(dnaPath, "active channel DNA");
    if (taskType === "SUGGEST_TOPICS") {
      await read(stylePath, "channel style guide");
      await this.readSharedRules(["research_rules.md"], sharedFiles);
      const topics = await this.repository.listTopics(channelId);
      const episodes = await this.repository.listEpisodes(channelId);
      add({
        path: `channels/${channel.slug}/topic_database.json`,
        reason: "existing titles and premises only",
        content: JSON.stringify(topics.map(({ title, premise }) => ({ title, premise }))),
      });
      add({
        path: `channels/${channel.slug}/episodes/index.json`,
        reason: "existing episode titles only",
        content: JSON.stringify(episodes.map((episode) => episode.topic.title)),
      });
      const prompt = this.compose(taskType, channel, null, [...files, ...sharedFiles], { output_contract: isQuiz
        ? `Return exactly 5 JSON candidates with title, premise, why_it_fits, hook, estimated_potential, quiz_format (knowledge|image_guess|multiple_choice|true_false|odd_one_out), question_count (${QUIZ_MIN_QUESTION_COUNT}-${QUIZ_MAX_QUESTION_COUNT}), and age_band (4-6|7-9|10-12|family). Use five different formats where possible. Do not research or develop them further.`
        : "Return exactly 5 JSON candidates with title, premise, why_it_fits, hook, and estimated_potential. Do not research or develop them further." });
      return this.finalize(taskType, channelId, null, [...files, ...sharedFiles], excluded.concat("research/script/scene work for candidates"), prompt);
    }

    const episode = episodeId ? await this.repository.getEpisode(channelId, episodeId) : null;
    if (!episode) throw new Error(`Episode is required for ${taskType}`);
    const episodeKey = episode.episode_id;
    const briefFile = await this.repository.getEpisodeFile(channelId, episodeKey, "brief.md");
    add({ path: briefFile.path, reason: "confirmed episode brief", content: briefFile.content });

    const loadArtifact = async (filename: string, required = false) => {
      const file = await this.repository.getEpisodeFile(channelId, episodeKey, filename);
      if (required && isPlaceholderArtifact(file.content)) throw new Error(`${filename} must be ready before ${taskType}`);
      return file;
    };
    const artifact = async (filename: string, reason: string, required = false) => {
      const file = await loadArtifact(filename, required);
      if (!isPlaceholderArtifact(file.content)) add({ path: file.path, reason, content: file.content });
      return file.content;
    };
    const runtimeConfig = await this.readConfig() as { video_generation?: { max_scene_duration_seconds?: number; narration_words_per_second?: number } };
    const narrationWordsPerSecond = runtimeConfig.video_generation?.narration_words_per_second ?? 2.3;
    const calibratedTargetWords = calibratedScriptTargetWords(episode, narrationWordsPerSecond);
    const scriptBounds = scriptWordBounds(calibratedTargetWords);
    const maxBeatWords = Math.max(1, Math.floor((runtimeConfig.video_generation?.max_scene_duration_seconds ?? 8) * (episode.measured_narration_words_per_second ?? runtimeConfig.video_generation?.narration_words_per_second ?? 2.3)));
    const humorGuidance = humorGuidanceForDuration(episode.target_duration_minutes);
    const sequenceGuidance = sequenceGuidanceForDuration(episode.target_duration_minutes);
    const quizQuestionCount = episode.quiz_config.question_count;
    const quizLastClaimId = `C${String(quizQuestionCount).padStart(2, "0")}`;
    const quizSourceMinimum = Math.max(3, Math.ceil(quizQuestionCount / 2));

    if (taskType === "GENERATE_RESEARCH") {
      await read(stylePath, "channel style guide");
      await this.readSharedRules(["research_rules.md"], sharedFiles);
    } else if (taskType === "GENERATE_TREATMENT") {
      await read(stylePath, "channel style guide");
      await artifact("research.md", "verified research dossier", true);
      await this.readSharedRules(["treatment_rules.md"], sharedFiles);
    } else if (taskType === "GENERATE_SCRIPT") {
      await read(stylePath, "channel style guide");
      await artifact("research.md", "verified research dossier", true);
      await artifact("treatment.md", "approved documentary treatment", true);
      await this.readSharedRules(["script_rules.md"], sharedFiles);
    } else if (taskType === "GENERATE_VISUAL_BIBLE") {
      await read(stylePath, "channel style guide");
      await artifact("research.md", "verified research dossier", true);
      await artifact("treatment.md", "approved documentary treatment", true);
      await artifact("script.md", "confirmed episode script", true);
      await this.readSharedRules(["visual_bible_rules.md", "prompt_rules.md"], sharedFiles);
    } else if (taskType === "GENERATE_BUNDLE_IMAGE") {
      const bundleNumber = sceneNumber ?? 0;
      if (bundleNumber < 1) throw new Error("Bundle number is required for anchor image generation");
      const visualBible = await loadArtifact("visual_bible.md", true);
      const bundleId = continuityBundleId(bundleNumber);
      add({ path: `${visualBible.path}#${bundleId}`, reason: `continuity bundle ${bundleId}`, content: selectMarkdownSection(visualBible.content, bundleNumber, /^##\s+Continuity bundle/i) });
      add({ path: dnaPath, reason: "visual style and language locks", content: selectSections(dna, ["Visual Style", "Visual Language"]) });
      await this.readSharedRules(["visual_bible_rules.md"], sharedFiles);
      const target = await this.repository.getBundleImagePath(channelId, episodeKey, bundleNumber, imageVariant);
      // The Codex turn runs with the project as its working directory, while
      // channel storage may be configured elsewhere. Give the image-capable
      // provider the real destination so it cannot accidentally write to a
      // non-existent relative path under the project.
      add({ path: target.absolutePath, reason: "requested image output path", content: "" });
    } else if (taskType === "GENERATE_SEQUENCE_SCENES") {
      const sequenceNumber = sceneNumber ?? 0;
      if (sequenceNumber < 1) throw new Error("Sequence number is required for shot generation");
      const research = await loadArtifact("research.md", true);
      const treatment = await loadArtifact("treatment.md", true);
      const script = await loadArtifact("script.md", true);
      const visualBible = await loadArtifact("visual_bible.md", true);
      add({ path: `${research.path}#sequence-${sequenceNumber}`, reason: `research claim for sequence ${sequenceNumber}`, content: selectResearchForSequence(research.content, sequenceNumber, isQuiz) });
      add({ path: `${treatment.path}#sequence-${sequenceNumber}`, reason: `treatment sequence ${sequenceNumber}`, content: selectMarkdownSectionOrFallback(treatment.content, sequenceNumber, isQuiz ? /^##\s+Question\s+\d+/i : /^##\s+Sequence\s+\d+/i, isQuiz ? "question" : "sequence", "treatment") });
      add({ path: `${script.path}#sequence-${sequenceNumber}`, reason: `script sequence ${sequenceNumber}`, content: selectMarkdownSectionOrFallback(script.content, sequenceNumber, /^##\s+/i, isQuiz ? "question" : "sequence", "script") });
      add({ path: `${visualBible.path}#CB-${String(sequenceNumber).padStart(2, "0")}`, reason: `continuity bundle ${sequenceNumber}`, content: selectMarkdownSectionOrFallback(visualBible.content, sequenceNumber, /^##\s+Continuity bundle/i, "continuity_bundle", "visual bible") });
      const sequenceRules = isQuiz ? ["prompt_rules.md"] : ["visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"];
      await this.readSharedRules(sequenceRules, sharedFiles);
      add({ path: ".documentary-studio/config.json", reason: "shot duration and narration pace", content: JSON.stringify(runtimeConfig) });
    } else if (taskType === "GENERATE_SCENES") {
      await artifact("research.md", "research claim and source ledger", true);
      await artifact("treatment.md", "sequence plan and time budget", true);
      await artifact("script.md", "confirmed episode script", true);
      await artifact("visual_bible.md", "episode identity and continuity bundles", true);
      add({ path: dnaPath, reason: "visual language and reconstruction rules", content: selectSections(dna, ["Visual Style", "Visual Language", "Scene Rules", "AI Reconstruction Rules"]) });
      const sceneRules = isQuiz ? ["prompt_rules.md"] : ["visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"];
      await this.readSharedRules(sceneRules, sharedFiles);
      add({ path: ".documentary-studio/config.json", reason: "shot duration, narration pace, and aspect ratio", content: JSON.stringify(runtimeConfig) });
    } else {
      const regenRules = isQuiz ? ["prompt_rules.md"] : ["visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"];
      await this.readSharedRules(regenRules, sharedFiles);
      const scenes = await this.repository.readScenes(channelId, episodeKey);
      const current = scenes.find((scene) => scene.scene_number === sceneNumber);
      if (!current) throw new Error("Scene is required for regeneration");
      const neighbors = scenes.filter((scene) => Math.abs(scene.scene_number - current.scene_number) <= 1);
      add({ path: `channels/${channel.slug}/episodes/${episode.slug}/scene-${current.scene_number}.json`, reason: "current scene and immediate neighbors", content: JSON.stringify(neighbors) });
      const script = await this.repository.getEpisodeFile(channelId, episodeKey, "script.md");
      add({ path: script.path, reason: "script excerpt around scene", content: excerptForScene(script.content, current.scene_number) });
      add({ path: dnaPath, reason: "relevant continuity guidance", content: selectSections(dna, ["Visual Language", "Scene Rules", "Narrative Style"]) });
    }

    const treatmentForPrompt = files.find((file) => file.path.endsWith("/treatment.md"))?.content ?? "";
    const treatmentKind = isQuiz ? "question" : "sequence";
    const requiredBundleNumbers = extractArtifactSectionNumbers(treatmentForPrompt, treatmentKind);
    const requiredBundleInstruction = requiredBundleNumbers.length
      ? `Create exactly ${requiredBundleNumbers.length} continuity bundles with IDs ${requiredBundleNumbers.map((number) => `CB-${String(number).padStart(2, "0")}`).join(", ")}, one bundle for every upstream ${isQuiz ? "question" : "sequence"}.`
      : "Create one continuity bundle for every upstream sequence in order.";
    const isTrueFalse = isQuiz && episode?.quiz_config?.quiz_format === "true_false";
    const treatmentChoicesContract = isTrueFalse
      ? "Answer choices (strictly exactly 2 choices: True or False / Đúng hoặc Sai — never add a 3rd option)"
      : "Answer choices (strictly maximum 3 choices: A, B, or C only)";
    const scriptChoicesContract = isTrueFalse
      ? "choices (strictly exactly 2 choices: True or False / Đúng hoặc Sai)"
      : "choices (strictly maximum 3 options: A, B, or C only)";
    const maxChoicesLimitText = isTrueFalse ? "2" : "3";
    const sequenceBeatChoicesContract = isTrueFalse
      ? "Choices array must contain exactly 2 choices (True and False only; never add a 3rd option)."
      : "Choices array must contain at most 3 choices (A, B, C only; never exceed 3 options).";
    const sceneBeatChoicesContract = isTrueFalse
      ? "Choices must have exactly 2 options (True and False only; never exceed 2 choices)."
      : "Choices must have at most 3 options (A, B, C only; never exceed 3 choices).";

    const outputContract = isQuiz && taskType === "GENERATE_RESEARCH"
      ? `Return only a completed Markdown quiz research dossier. The episode has exactly ${quizQuestionCount} questions. Build an answer ledger with exactly ${quizQuestionCount} entries, one entry for every question in order, and assign each entry one unique claim ID exactly once from C01 through ${quizLastClaimId}. Do not stop early, merge questions, reuse a claim ID, or invent extra question numbers. Every ledger entry must include Question number, Claim ID, canonical answer, one ultra-concise child-friendly explanation (strictly 1 punchy fun fact under 10 words and under 70 characters, single clause, direct and crisp with no filler or preamble), direct authoritative URL(s), and a note about ambiguity or safety. Include at least ${quizSourceMinimum} distinct direct authoritative URLs and enough evidence for every answer. Before returning, silently check that every ID in the complete sequence C01, C02, ... ${quizLastClaimId} appears in the ledger and that each question has evidence.`
      : isQuiz && taskType === "GENERATE_TREATMENT"
        ? `Return only a completed Markdown quiz treatment. Define the episode format, age band, ${episode.quiz_config.question_count} question blocks, and visual/audio rhythm. Use one second-level heading per question exactly like \`## Question 1 — Title\`. Each block must include Purpose, Question (ultra-concise, under 10 words, direct single-clause phrasing), ${treatmentChoicesContract} or visual clue, Correct answer, Think time, Reveal beat, Explanation (strictly 1 punchy, child-friendly fun fact under 10 words and under 70 characters), Claim IDs, and Time budget. Never generate more than ${maxChoicesLimitText} answer choices. Keep the total runtime appropriate for ${episode.quiz_config.question_count} questions.`
        : isQuiz && taskType === "GENERATE_SCRIPT"
          ? `Return only one completed Markdown quiz narration script. Include exactly ${episode.quiz_config.question_count} question blocks, formatted as second-level headings \`## Question 1 — Title\` through Question ${episode.quiz_config.question_count}. Fold the welcome into Question 1 and the closing into the final question so the section count stays exact. For each block speak the question (ultra-concise, under 10 words, direct phrasing), ${scriptChoicesContract} or clue, an invitation to guess, the reveal, and one ultra-concise explanation (strictly 1 short, punchy fun fact under 10 words and under 70 characters). Never provide more than ${maxChoicesLimitText} answer choices. Use concise child-friendly language for ages ${episode.quiz_config.age_band}. Add the exact hidden marker <!-- HUMOR_POLICY: v1 --> after the title. Use HTML comments only for restrained audio cues. Do not include JSON, planning notes, or visual directions.`
          : isQuiz && taskType === "GENERATE_VISUAL_BIBLE"
            ? (() => {
                const resolvedStyle = episode.quiz_config?.resolved_visual_style ?? "pixar_3d";
                const styleContract = QUIZ_STYLE_CONTRACTS[resolvedStyle] || QUIZ_STYLE_CONTRACTS.pixar_3d;
                return `Return only a completed Markdown Quiz Visual Bible. Define a single child-friendly, vibrant, high-appeal visual direction strictly adhering to the locked art style "${styleContract.name}" (${styleContract.renderingMedium}; ${styleContract.lighting}; ${styleContract.edgeTreatment}; ${styleContract.detailLevel}). Backgrounds must be subtle and fitting (${styleContract.heroBackground}), avoiding pure flat white backgrounds while ensuring the main subject remains the sharpest and most prominent element. Include an explicit second-level section named exactly \`## Safe motion\` with labeled Allowed motion, Prohibited motion, and Reduced-motion fallback rules; the phrase "safe motion" must appear exactly in the document. Create exactly ${episode.quiz_config.question_count} continuity bundles formatted as \`## Continuity bundle CB-01 — Title\` through CB-${String(episode.quiz_config.question_count).padStart(2, "0")}. Every bundle must include an Anchor-frame prompt describing ONLY the clean hero subject illustration and environment with ${styleContract.continuityPromptBrief}. Never include question cards, answer choices, countdown timers, UI boxes, or text inside Anchor-frame prompts because the video composition engine renders all quiz UI dynamically on top of the clean artwork.`;
              })()
            : taskType === "GENERATE_RESEARCH"
      ? "Return only a completed Markdown research dossier. Include: research question, chronological evidence, verified claim ledger with stable IDs C01..., failure factors, what replaced the idea, open uncertainties, and a visual evidence inventory. Every material claim must cite a direct primary or authoritative URL. Use at least 8 independent sources and distinguish fact, inference, and uncertainty."
      : taskType === "GENERATE_TREATMENT"
        ? `Return only a completed Markdown documentary treatment. Define the thesis, audience promise, target duration and word count, then ${sequenceGuidance} numbered sequences. Format every sequence as a second-level heading exactly like \`## Sequence 1 — Title\`. Every sequence must include labeled Purpose, Time budget, Dramatic question, Claim IDs, Evidence/visual modes, Transition, and Changed understanding fields. Time budgets must sum to the target duration.`
        : taskType === "GENERATE_SCRIPT"
          ? `Return only one completed Markdown narration script for the confirmed episode. Do not return planning notes, reasoning, research, treatment, tool output, JSON, file excerpts, or an explanation. The final answer must be only the script. Target approximately ${calibratedTargetWords} spoken words for ${episode.target_duration_minutes} minutes at ${narrationWordsPerSecond.toFixed(2)} words per second; the hard acceptable range is ${scriptBounds.lower}–${scriptBounds.upper} spoken words. Aim near ${Math.round(calibratedTargetWords * 1.05)} words and never add padding to reach the number. Humor must replace generic explanation, not add new paragraphs or extend the runtime. The legacy ${episode.target_word_count}-word metadata target is only a planning hint. Add this exact hidden marker immediately after the title: <!-- HUMOR_POLICY: v1 -->. Follow the treatment sequence order. Build the argument from dated events, named programs/people/organizations, measurable facts, decisions, and consequences from research. Add a restrained humor layer: ${humorGuidance}. Never invent a quote, statistic, anecdote, or reaction for a joke; never mock victims or sensitive subjects. After a humorous spoken line, add only an HTML comment of the form <!-- AUDIO_CUE: chuckle --> or, rarely, <!-- AUDIO_CUE: laugh -->. Use at most one laugh cue per three minutes and prefer chuckle. Do not write (laughs), [laugh], or visual directions in the visible narration. Before returning, silently verify that the marker exists, humor beats are spaced across the argument, every joke is grounded in the scoped research, and the spoken word count is between ${scriptBounds.lower} and ${scriptBounds.upper}.`
          : taskType === "GENERATE_VISUAL_BIBLE"
            ? `Return only a completed Markdown Episode Visual Bible. Define fixed channel constants, episode palette, typography/graphic language, editorial overlay system, recurring hero objects, evidence treatment, and asset mix. Provenance is tracked in production metadata; do not require a visible AI or reconstruction label inside footage prompts. ${requiredBundleInstruction} Format every bundle as a second-level heading exactly like \`## Continuity bundle CB-01 — Title\`, using the exact numeric IDs from the upstream artifact. Each bundle needs labeled Era, Location, Subjects, Wardrobe/objects, Palette, Lighting, Texture, Anchor-frame prompt, Reference asset slots, and Allowed shot variation fields.`
          : taskType === "GENERATE_BUNDLE_IMAGE"
            ? (() => {
              const resolvedStyle = episode.quiz_config?.resolved_visual_style ?? "pixar_3d";
              const styleContract = QUIZ_STYLE_CONTRACTS[resolvedStyle] || QUIZ_STYLE_CONTRACTS.pixar_3d;
              return `Generate exactly one reference image for continuity bundle ${continuityBundleId(sceneNumber ?? 0)}. Follow the bundle's Anchor-frame prompt and the locked visual style (${isQuiz ? styleContract.continuityPromptBrief : "channel Visual Style/Visual Language locks"}). Depict only the described environment, subjects, era, palette, lighting, and texture. No text, captions, logos, UI, split panels, charts, watermarks, or labels. Save the final PNG exactly to the requested image output path in the task instructions. If the connected image capability returns bytes instead of writing a file, return a data:image/png;base64 payload or report the saved PNG path.`;
            })()
            : isQuiz && taskType === "GENERATE_SEQUENCE_SCENES"
              ? `Return a JSON array of quiz beats covering only the provided script question in exact order. Fields: { dialogue, sequence_id: 'sequence-${sceneNumber}', sequence_title, shot_id, visual_prompt, asset_type: 'ai_reconstruction'|'diagram'|'transition', continuity_key, continuity_bundle_id: 'CB-${String(sceneNumber ?? 0).padStart(2, '0')}', reference_asset_ids: string[], source_ids: ['C${String(sceneNumber ?? 0).padStart(2, '0')}'], reconstruction: boolean, sound_cue, transition_note, continuity_note, editorial_overlay: { kind: 'none' }, quiz: { phase: intro|question|reveal|explanation|outro, question_number: ${sceneNumber}, question, choices: string[], answer, explanation, image_prompt } }. ${sequenceBeatChoicesContract} Every beat must carry source_ids with the claim ID ['C${String(sceneNumber ?? 0).padStart(2, '0')}']. Preserve the exact question, all visible choices, canonical answer, and child-friendly explanation across every beat in this sequence (keep question ultra-concise under 10 words, and explanation strictly 1 punchy fun fact under 10 words and under 70 characters). The quiz.image_prompt is strictly MANDATORY for every question beat: provide a clear, child-friendly semantic visual subject describing the illustration for this question (e.g. 'A friendly cartoon cheetah sprinting across a sunny savanna'); never leave image_prompt empty. Copy every spoken word from the provided script section verbatim and in order into one or more dialogue fields; split only at natural boundaries and never paraphrase or omit words. Use sequence_id 'sequence-${sceneNumber}', a non-empty continuity_bundle_id exactly 'CB-${String(sceneNumber ?? 0).padStart(2, '0')}', and a non-empty continuity_note that explains the visual identity lock. The visual_prompt must contain the exact uppercase sections CAMERA, ACTION, LIGHTING, ATMOSPHERE, and CONTINUITY, with concrete content under every section. Keep text out of visual_prompt because HyperFrames renders the quiz card from the structured quiz object.`
              : taskType === "GENERATE_SEQUENCE_SCENES"
              ? `Return a JSON array of shot beats covering only the provided script sequence in exact order without paraphrasing or omission. Every beat must use no more than ${maxBeatWords} words and should end at a sentence or natural clause boundary. Use sequence_id "sequence-${sceneNumber}", the provided sequence title, and continuity_bundle_id "CB-${String(sceneNumber ?? 0).padStart(2, "0")}". Fields: { dialogue, sequence_id, sequence_title, shot_id, visual_prompt, asset_type: archive|document|map|diagram|ai_reconstruction|contemporary|transition, continuity_key, continuity_bundle_id, reference_asset_ids: string[], source_ids: ['C${String(sceneNumber ?? 0).padStart(2, "0")}'] or claim IDs from research, reconstruction: boolean, sound_cue, transition_note, continuity_note, editorial_overlay: { kind: none|caption|stat_card|timeline|bar_chart|line_chart|map_callout|comparison|quote, text, motion: none|fade_up|slide_in|draw_on|count_up|highlight, placement: lower_third|upper_left|upper_right|center|side_panel, duration_seconds, data: [{ label, value, unit }], source_ids: string[] } }. Every beat except transitions must carry source_ids. Every prompt must be distinct and include CAMERA/ACTION/LIGHTING/ATMOSPHERE/CONTINUITY sections. The visual_prompt describes only the visible footage: never put captions, labels, logos, UI, charts, source IDs, or 'AI VISUALIZATION' text inside it. Use editorial_overlay.kind 'none' for most beats; across the complete episode target 25–30% of shots with an overlay. Use overlays only when they clarify a date, number, geography, comparison, named program, or quote. Charts require at least two sourced data points; never invent data. Repeat the bundle identity locks, link evidence IDs, and do not add durations, SHOT PLAN, or timecodes.`
              : isQuiz && taskType === "GENERATE_SCENES"
              ? `Return a JSON array of quiz scene beats covering the script in exact order. Create one or more beats for the welcome, each of the ${episode.quiz_config.question_count} questions, and the closing. Every beat must include dialogue, sequence_id, sequence_title, shot_id, visual_prompt with CAMERA/ACTION/LIGHTING/ATMOSPHERE/CONTINUITY sections, asset_type, continuity_key, continuity_bundle_id, reference_asset_ids, source_ids (e.g. ['C01'] matching each question's Claim ID), reconstruction, sound_cue, transition_note, continuity_note, editorial_overlay, and quiz: { phase: intro|question|reveal|explanation|outro, question_number, question, choices: string[], answer, explanation, image_prompt }. ${sceneBeatChoicesContract} Questions must be ultra-concise (under 10 words) and explanations strictly 1 punchy fun fact (under 10 words, under 70 characters, crisp single clause). The quiz.image_prompt is strictly MANDATORY for every question beat: describe a clear, child-friendly semantic visual subject matching the question (e.g. 'A friendly cartoon cheetah sprinting across a sunny savanna'); never leave image_prompt empty. Use safe, high-contrast, child-friendly quiz visuals. Never place source IDs or production labels inside visual_prompt.`
              : taskType === "GENERATE_SCENES"
              ? `Return a JSON array of shot beats covering the script narration in exact order without paraphrasing or omission. Copy every spoken word from the provided script section verbatim and in order into one or more dialogue fields; split only at natural boundaries and never paraphrase, shorten, add, or omit words. Each beat must use no more than ${maxBeatWords} words and should end at a sentence or natural clause boundary. Fields: { dialogue, sequence_id, sequence_title, shot_id, visual_prompt, asset_type: archive|document|map|diagram|ai_reconstruction|contemporary|transition, continuity_key, continuity_bundle_id, reference_asset_ids: string[], source_ids: claim/source IDs[], reconstruction: boolean, sound_cue, transition_note, continuity_note, editorial_overlay: { kind: none|caption|stat_card|timeline|bar_chart|line_chart|map_callout|comparison|quote, text, motion: none|fade_up|slide_in|draw_on|count_up|highlight, placement: lower_third|upper_left|upper_right|center|side_panel, duration_seconds, data: [{ label, value, unit }], source_ids: string[] } }. Every beat must have non-empty source_ids (except transitions), a non-empty continuity_bundle_id, a non-empty continuity_note, and a distinct visual_prompt containing the exact uppercase sections CAMERA, ACTION, LIGHTING, ATMOSPHERE, and CONTINUITY, with concrete content under every section. The visual_prompt must describe only image, camera, action, lighting, and atmosphere. Never put captions, labels, logos, UI, charts, source IDs, or 'AI VISUALIZATION' text inside the visual_prompt. Archive/document/map shots must name visible evidence; AI reconstructions must be physically specific. Use editorial_overlay.kind 'none' for most beats and target 25–30% overlay coverage across the complete episode. Charts require sourced data points and overlays must never invent data. Do not repeat a prompt. Do not add durations, SHOT PLAN, or timecodes.`
              : "Return one JSON object for the requested scene regeneration. Include only the fields being regenerated and preserve sequence, sources, references, continuity bundle, and editorial_overlay. The visual_prompt must describe only footage and use CAMERA/ACTION/LIGHTING/ATMOSPHERE/CONTINUITY sections. Never put captions, labels, logos, UI, charts, source IDs, or AI disclosure text inside the visual_prompt. Do not write files.";
    const prompt = this.compose(taskType, channel, episode, [...files, ...sharedFiles], {
      scene_number: sceneNumber ?? null,
      target_duration_minutes: episode.target_duration_minutes,
      target_word_count: episode.target_word_count,
      output_contract: outputContract,
    });
    return this.finalize(taskType, channelId, episodeKey, [...files, ...sharedFiles], excluded.concat("other scenes outside immediate neighbors"), prompt);
  }

  private async readSharedRules(names: string[], target: ContextFile[]): Promise<void> {
    for (const name of names) {
      const relative = `shared/${name}`;
      const absolute = this.repository.resolveContextPath(relative);
      try {
        const content = await (await import("node:fs/promises")).readFile(absolute, "utf8");
        target.push({ path: relative, reason: "shared production rule", content });
      } catch {
        // A missing optional rule is not fatal; the manifest still records the other inputs.
      }
    }
  }

  private async readConfig(): Promise<unknown> {
    try {
      const raw = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(this.repository.rootDirectory, ".documentary-studio", "config.json"), "utf8")) as Record<string, unknown>;
      return { ...raw, video_generation: { ...DEFAULT_CONFIG.video_generation, ...(raw.video_generation as object | undefined) } };
    } catch {
      return { video_generation: DEFAULT_CONFIG.video_generation };
    }
  }

  private compose(taskType: TaskType, channel: { display_name: string; description: string; target_audience: string; language: string; market: string }, episode: Episode | null, files: ContextFile[], extra: Record<string, unknown>): string {
    const context = files.map((file) => `\n--- FILE: ${file.path} (${file.reason}) ---\n${file.content}`).join("\n");
    const episodeLine = episode ? `Episode: ${episode.topic.title}\nPremise: ${episode.topic.premise}\nHook: ${episode.topic.hook}` : "No episode is confirmed for this task.";
    return [
      "You are working inside AI Quiz Studio.",
      `Task type: ${taskType}`,
      `Channel: ${channel.display_name}`,
      `Channel description: ${channel.description}`,
      `Audience: ${channel.target_audience}; language: ${channel.language}; market: ${channel.market}`,
      episodeLine,
      taskType === "GENERATE_RESEARCH"
        ? "Use read-only web research to verify this confirmed topic. Prefer primary records, government/university archives, standards bodies, museums, and contemporary reporting. Never invent a source or inaccessible quotation."
        : "Use only the scoped context below. Treat the research claim ledger as the factual boundary and never invent facts, quotes, people, programs, figures, or sources. DO NOT USE ANY WORKSPACE/CODE SEARCH OR EDITING TOOLS; output the final response text or JSON directly.",
      `Task instructions: ${JSON.stringify(extra)}`,
      context,
    ].join("\n");
  }

  private async finalize(taskType: TaskType, channelId: string, episodeId: string | null, files: ContextFile[], excluded: string[], prompt: string): Promise<ContextManifest> {
    const manifest = ContextManifestSchema.parse({
      task_type: taskType,
      scope: { channel_id: channelId, episode_id: episodeId },
      included_files: files.map(({ path: filePath, reason, content }) => ({ path: filePath, reason, bytes: Buffer.byteLength(content) })),
      excluded_categories: excluded,
      approximate_bytes: Buffer.byteLength(prompt),
      prompt,
    });
    const auditDirectory = path.join(this.repository.roots.runtime, "logs");
    await mkdir(auditDirectory, { recursive: true });
    await appendFile(path.join(auditDirectory, "context-manifests.jsonl"), `${JSON.stringify({ ...manifest, created_at: new Date().toISOString() })}\n`, "utf8");
    this.logger.debug("Context manifest assembled", { step: "context", profileId: channelId });
    return manifest;
  }
}

function humorGuidanceForDuration(minutes: number): string {
  if (minutes <= 3) return "weave 1–2 dry, evidence-grounded humor beats across the story";
  if (minutes <= 5) return "weave 2–3 dry, evidence-grounded humor beats across the story";
  return "weave 2–4 dry, evidence-grounded humor beats across the story";
}

function sequenceGuidanceForDuration(minutes: number): string {
  if (minutes <= 3) return "5–6";
  if (minutes <= 5) return "6–8";
  return "7–10";
}

function selectSections(markdown: string, headings: string[]): string {
  return headings.map((heading) => {
    const match = markdown.match(new RegExp(`## ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"));
    return match ? `## ${heading}\n${match[1].trim()}` : "";
  }).filter(Boolean).join("\n\n");
}

function excerptForScene(script: string, sceneNumber: number): string {
  const lines = script.split(/\r?\n/);
  const center = Math.min(lines.length, Math.max(0, Math.floor((lines.length * sceneNumber) / Math.max(1, sceneNumber + 1))));
  return lines.slice(Math.max(0, center - 18), center + 18).join("\n");
}

function selectMarkdownSection(markdown: string, sectionNumber: number, headingPattern: RegExp = /^##\s+/i, kind?: ArtifactSectionKind): string {
  const lines = markdown.split(/\r?\n/);
  const starts = lines.map((line, index) => headingPattern.test(line) ? index : -1).filter((index) => index >= 0);
  const numberedStarts = kind
    ? starts.filter((index) => parseArtifactSectionNumber(lines[index]!.replace(/^##\s+/, ""), kind) !== null)
    : [];
  const explicitStart = kind
    ? numberedStarts.find((index) => parseArtifactSectionNumber(lines[index]!.replace(/^##\s+/, ""), kind) === sectionNumber)
    : undefined;
  const start = explicitStart ?? (kind && numberedStarts.length > 0 ? undefined : starts[sectionNumber - 1]);
  if (start === undefined) throw new Error(`Sequence ${sectionNumber} was not found in an upstream artifact`);
  const next = starts.find((candidate) => candidate > start) ?? lines.length;
  return lines.slice(start, next).join("\n").trim();
}

function selectMarkdownSectionOrFallback(markdown: string, sectionNumber: number, headingPattern: RegExp, kind: ArtifactSectionKind, artifactName: string): string {
  try {
    return selectMarkdownSection(markdown, sectionNumber, headingPattern, kind);
  } catch {
    const content = markdown.trim();
    if (!content) throw new Error(`Sequence ${sectionNumber} was not found in an upstream artifact`);
    return [
      `## ${artifactName} fallback for requested section ${sectionNumber}`,
      "The upstream artifact has no dedicated numbered section for this request. Preserve the requested sequence/question number and infer only stable identity rules from the complete artifact below.",
      content,
    ].join("\n\n");
  }
}

function selectResearchForSequence(researchMarkdown: string, sequenceNumber: number, isQuiz: boolean): string {
  const claimId = `C${String(sequenceNumber).padStart(2, "0")}`;
  const shortClaimId = `C${sequenceNumber}`;
  const lines = researchMarkdown.split(/\r?\n/);

  // 1. Find the specific claim section in the research deep-dive
  const claimHeaderIndex = lines.findIndex((line) =>
    new RegExp(`^###?\\s+(?:${claimId}|${shortClaimId}|Question\\s+${sequenceNumber}\\b)`, "i").test(line)
  );

  if (claimHeaderIndex !== -1) {
    const nextHeaderIndex = lines.findIndex((line, idx) =>
      idx > claimHeaderIndex && /^###?\s+/i.test(line)
    );
    const claimSection = lines.slice(claimHeaderIndex, nextHeaderIndex === -1 ? lines.length : nextHeaderIndex).join("\n").trim();

    // Also include the answer ledger table if present (for quick cross-reference)
    const tableStartIndex = lines.findIndex((line) => line.includes("| Question |") || line.includes("| Claim ID |"));
    let ledgerRow = "";
    if (tableStartIndex !== -1) {
      const headerLine = lines[tableStartIndex] || "";
      const separatorLine = lines[tableStartIndex + 1] || "";
      const rowLine = lines.slice(tableStartIndex + 2).find((line) =>
        line.includes(`Q${sequenceNumber}`) || line.includes(`Q0${sequenceNumber}`) || line.includes(`| ${claimId}`) || line.includes(`| ${shortClaimId}`)
      ) || "";
      if (rowLine) {
        ledgerRow = `### Answer Ledger Summary\n${headerLine}\n${separatorLine}\n${rowLine}\n\n`;
      }
    }

    return `${ledgerRow}### Scoped Research Evidence for Sequence ${sequenceNumber} (${claimId})\n\n${claimSection}`;
  }

  // Fallback to full research if sectioning pattern didn't match
  return researchMarkdown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlaceholderArtifact(content: string): boolean {
  const value = content.trim();
  return !value || /(?:has not started|generation has not started|breakdown has not started)/i.test(value);
}
