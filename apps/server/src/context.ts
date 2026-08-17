import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ContextManifestSchema,
  type ContextManifest,
  type Episode,
  type Scene,
  type TaskType,
} from "@studio/shared";
import { RepositoryService } from "./repository.js";
import { StudioLogger } from "./logger.js";
import { DEFAULT_CONFIG } from "./config.js";

type ContextFile = { path: string; reason: string; content: string };

export class ContextEngine {
  constructor(private readonly repository: RepositoryService, private readonly logger: StudioLogger) {}

  async build(taskType: TaskType, channelId: string, episodeId: string | null, sceneNumber?: number): Promise<ContextManifest> {
    const channel = await this.repository.getChannel(channelId);
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
      const template = await read("templates/example_channel_dna.md", "canonical DNA schema");
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
      await this.readSharedRules(["production_rules.md", "research_rules.md", "script_rules.md"], sharedFiles);
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
      const prompt = this.compose(taskType, channel, null, [...files, ...sharedFiles], { output_contract: "Return exactly 5 JSON candidates with title, premise, why_it_fits, hook, and estimated_potential. Do not research or develop them further." });
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
    const maxBeatWords = Math.max(1, Math.floor((runtimeConfig.video_generation?.max_scene_duration_seconds ?? 8) * (episode.measured_narration_words_per_second ?? runtimeConfig.video_generation?.narration_words_per_second ?? 2.3)));

    if (taskType === "GENERATE_RESEARCH") {
      await read(stylePath, "channel style guide");
      await this.readSharedRules(["production_rules.md", "research_rules.md"], sharedFiles);
    } else if (taskType === "GENERATE_TREATMENT") {
      await read(stylePath, "channel style guide");
      await artifact("research.md", "verified research dossier", true);
      await this.readSharedRules(["research_rules.md", "treatment_rules.md", "script_rules.md"], sharedFiles);
    } else if (taskType === "GENERATE_SCRIPT") {
      await read(stylePath, "channel style guide");
      await artifact("research.md", "verified research dossier", true);
      await artifact("treatment.md", "approved documentary treatment", true);
      await this.readSharedRules(["research_rules.md", "script_rules.md"], sharedFiles);
    } else if (taskType === "GENERATE_VISUAL_BIBLE") {
      await read(stylePath, "channel style guide");
      await artifact("research.md", "verified research dossier", true);
      await artifact("treatment.md", "approved documentary treatment", true);
      await artifact("script.md", "confirmed episode script", true);
      await this.readSharedRules(["visual_bible_rules.md", "visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"], sharedFiles);
    } else if (taskType === "GENERATE_SEQUENCE_SCENES") {
      const sequenceNumber = sceneNumber ?? 0;
      if (sequenceNumber < 1) throw new Error("Sequence number is required for shot generation");
      const research = await loadArtifact("research.md", true);
      const treatment = await loadArtifact("treatment.md", true);
      const script = await loadArtifact("script.md", true);
      const visualBible = await loadArtifact("visual_bible.md", true);
      add({ path: research.path, reason: "research claim and source ledger", content: research.content });
      add({ path: `${treatment.path}#sequence-${sequenceNumber}`, reason: `treatment sequence ${sequenceNumber}`, content: selectMarkdownSection(treatment.content, sequenceNumber, /^##\s+Sequence\s+\d+/i) });
      add({ path: `${script.path}#sequence-${sequenceNumber}`, reason: `script sequence ${sequenceNumber}`, content: selectMarkdownSection(script.content, sequenceNumber) });
      add({ path: `${visualBible.path}#CB-${String(sequenceNumber).padStart(2, "0")}`, reason: `continuity bundle ${sequenceNumber}`, content: selectMarkdownSection(visualBible.content, sequenceNumber, /^##\s+Continuity bundle/i) });
      await this.readSharedRules(["visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"], sharedFiles);
      add({ path: ".documentary-studio/config.json", reason: "shot duration and narration pace", content: JSON.stringify(runtimeConfig) });
    } else if (taskType === "GENERATE_SCENES") {
      await artifact("research.md", "research claim and source ledger", true);
      await artifact("treatment.md", "sequence plan and time budget", true);
      await artifact("script.md", "confirmed episode script", true);
      await artifact("visual_bible.md", "episode identity and continuity bundles", true);
      add({ path: dnaPath, reason: "visual language and reconstruction rules", content: selectSections(dna, ["Visual Style", "Visual Language", "Scene Rules", "AI Reconstruction Rules"]) });
      await this.readSharedRules(["visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"], sharedFiles);
      add({ path: ".documentary-studio/config.json", reason: "shot duration, narration pace, and aspect ratio", content: JSON.stringify(runtimeConfig) });
    } else {
      await this.readSharedRules(["visual_rules.md", "prompt_rules.md", "cinematic_prompt_reference.md"], sharedFiles);
      const scenes = await this.repository.readScenes(channelId, episodeKey);
      const current = scenes.find((scene) => scene.scene_number === sceneNumber);
      if (!current) throw new Error("Scene is required for regeneration");
      const neighbors = scenes.filter((scene) => Math.abs(scene.scene_number - current.scene_number) <= 1);
      add({ path: `channels/${channel.slug}/episodes/${episode.slug}/scene-${current.scene_number}.json`, reason: "current scene and immediate neighbors", content: JSON.stringify(neighbors) });
      const script = await this.repository.getEpisodeFile(channelId, episodeKey, "script.md");
      add({ path: script.path, reason: "script excerpt around scene", content: excerptForScene(script.content, current.scene_number) });
      add({ path: dnaPath, reason: "relevant continuity guidance", content: selectSections(dna, ["Visual Language", "Scene Rules", "Narrative Style"]) });
    }

    const outputContract = taskType === "GENERATE_RESEARCH"
      ? "Return only a completed Markdown research dossier. Include: research question, chronological evidence, verified claim ledger with stable IDs C01..., failure factors, what replaced the idea, open uncertainties, and a visual evidence inventory. Every material claim must cite a direct primary or authoritative URL. Use at least 8 independent sources and distinguish fact, inference, and uncertainty."
      : taskType === "GENERATE_TREATMENT"
        ? "Return only a completed Markdown documentary treatment. Define the thesis, audience promise, target duration and word count, then 6-10 numbered sequences. Format every sequence as a second-level heading exactly like `## Sequence 1 — Title`. Every sequence must include labeled Purpose, Time budget, Dramatic question, Claim IDs, Evidence/visual modes, Transition, and Changed understanding fields. Time budgets must sum to the target duration."
        : taskType === "GENERATE_SCRIPT"
          ? `Return only the completed Markdown narration script. Target ${episode.target_word_count} words for ${episode.target_duration_minutes} minutes; stay within ±7%. Follow the treatment sequence order. Build the argument from dated events, named programs/people/organizations, measurable facts, decisions, and consequences from research. Add an HTML comment after each section listing the claim IDs used. Do not include generic visual directions in the narration.`
          : taskType === "GENERATE_VISUAL_BIBLE"
            ? "Return only a completed Markdown Episode Visual Bible. Define fixed channel constants, episode palette, typography/graphic language, reconstruction label, recurring hero objects, evidence treatment, and asset mix. Create one continuity bundle per treatment sequence. Format every bundle as a second-level heading exactly like `## Continuity bundle CB-01 — Title`, incrementing CB-02, CB-03, and so on. Each bundle needs labeled Era, Location, Subjects, Wardrobe/objects, Palette, Lighting, Texture, Anchor-frame prompt, Reference asset slots, and Allowed shot variation fields."
            : taskType === "GENERATE_SEQUENCE_SCENES"
              ? `Return a JSON array of shot beats covering only the provided script sequence in exact order without paraphrasing or omission. Every beat must use no more than ${maxBeatWords} words and should end at a sentence or natural clause boundary. Use sequence_id \"sequence-${sceneNumber}\", the provided sequence title, and continuity_bundle_id \"CB-${String(sceneNumber ?? 0).padStart(2, "0")}\". Fields: { dialogue, sequence_id, sequence_title, shot_id, visual_prompt, asset_type: archive|document|map|diagram|ai_reconstruction|contemporary|transition, continuity_key, continuity_bundle_id, reference_asset_ids: string[], source_ids: claim/source IDs[], reconstruction: boolean, sound_cue, transition_note, continuity_note }. Every prompt must be distinct and include CAMERA/ACTION/LIGHTING/ATMOSPHERE/CONTINUITY sections. Repeat the bundle identity locks, link evidence IDs, and do not add durations, SHOT PLAN, or timecodes.`
              : taskType === "GENERATE_SCENES"
              ? `Return a JSON array of shot beats covering the script narration in exact order without paraphrasing or omission. Each beat must use no more than ${maxBeatWords} words and should end at a sentence or natural clause boundary. Fields: { dialogue, sequence_id, sequence_title, shot_id, visual_prompt, asset_type: archive|document|map|diagram|ai_reconstruction|contemporary|transition, continuity_key, continuity_bundle_id, reference_asset_ids: string[], source_ids: claim/source IDs[], reconstruction: boolean, sound_cue, transition_note, continuity_note }. The visual_prompt must be a distinct single shot with CAMERA/ACTION/LIGHTING/ATMOSPHERE/CONTINUITY sections and must repeat the relevant visual-bible identity locks. Archive/document/map shots must name visible evidence; AI reconstructions must be physically specific. Do not repeat a prompt. Do not add durations, SHOT PLAN, or timecodes.`
              : "Return one JSON object for the requested scene regeneration. Include only the fields being regenerated and preserve sequence, sources, references, and continuity bundle. The visual_prompt must use CAMERA/ACTION/LIGHTING/ATMOSPHERE/CONTINUITY sections. Do not write files.";
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
      "You are working inside AI Documentary Studio.",
      `Task type: ${taskType}`,
      `Channel: ${channel.display_name}`,
      `Channel description: ${channel.description}`,
      `Audience: ${channel.target_audience}; language: ${channel.language}; market: ${channel.market}`,
      episodeLine,
      taskType === "GENERATE_RESEARCH"
        ? "Use read-only web research to verify this confirmed topic. Prefer primary records, government/university archives, standards bodies, museums, and contemporary reporting. Never invent a source or inaccessible quotation."
        : "Use only the scoped context below. Treat the research claim ledger as the factual boundary and never invent facts, quotes, people, programs, figures, or sources.",
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

function selectMarkdownSection(markdown: string, sectionNumber: number, headingPattern: RegExp = /^##\s+/i): string {
  const lines = markdown.split(/\r?\n/);
  const starts = lines.map((line, index) => headingPattern.test(line) ? index : -1).filter((index) => index >= 0);
  const start = starts[sectionNumber - 1];
  if (start === undefined) throw new Error(`Sequence ${sectionNumber} was not found in an upstream artifact`);
  const next = starts[sectionNumber] ?? lines.length;
  return lines.slice(start, next).join("\n").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlaceholderArtifact(content: string): boolean {
  const value = content.trim();
  return !value || /(?:has not started|generation has not started|breakdown has not started)/i.test(value);
}
