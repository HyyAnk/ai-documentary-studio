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

    if (taskType === "GENERATE_SCRIPT") {
      await read(stylePath, "channel style guide");
      await this.readSharedRules(["script_rules.md"], sharedFiles);
      const research = await this.repository.getEpisodeFile(channelId, episodeKey, "research.md");
      if (research.content.trim()) add({ path: research.path, reason: "research for this episode", content: research.content });
    } else if (taskType === "GENERATE_SCENES") {
      await this.readSharedRules(["visual_rules.md", "prompt_rules.md"], sharedFiles);
      const script = await this.repository.getEpisodeFile(channelId, episodeKey, "script.md");
      add({ path: script.path, reason: "confirmed episode script", content: script.content });
      add({ path: dnaPath, reason: "visual language and scene rules", content: selectSections(dna, ["Visual Language", "Scene Rules", "AI Reconstruction Rules"]) });
      add({ path: ".documentary-studio/config.json", reason: "scene duration and aspect ratio", content: JSON.stringify(await this.readConfig()) });
    } else {
      const scenes = await this.repository.readScenes(channelId, episodeKey);
      const current = scenes.find((scene) => scene.scene_number === sceneNumber);
      if (!current) throw new Error("Scene is required for regeneration");
      const neighbors = scenes.filter((scene) => Math.abs(scene.scene_number - current.scene_number) <= 1);
      add({ path: `channels/${channel.slug}/episodes/${episode.slug}/scene-${current.scene_number}.json`, reason: "current scene and immediate neighbors", content: JSON.stringify(neighbors) });
      const script = await this.repository.getEpisodeFile(channelId, episodeKey, "script.md");
      add({ path: script.path, reason: "script excerpt around scene", content: excerptForScene(script.content, current.scene_number) });
      add({ path: dnaPath, reason: "relevant continuity guidance", content: selectSections(dna, ["Visual Language", "Scene Rules", "Narrative Style"]) });
    }

    const outputContract = taskType === "GENERATE_SCRIPT"
      ? "Return only the completed Markdown script for this confirmed episode. Do not write files."
      : taskType === "GENERATE_SCENES"
        ? "Return a JSON array of scenes with duration_seconds, dialogue, visual_prompt, transition_note, and continuity_note. Keep each duration at or below the configured maximum. Do not write files."
        : "Return one JSON object for the requested scene regeneration. Include only the fields being regenerated and preserve continuity. Do not write files.";
    const prompt = this.compose(taskType, channel, episode, [...files, ...sharedFiles], { scene_number: sceneNumber ?? null, output_contract: outputContract });
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
      return JSON.parse(await (await import("node:fs/promises")).readFile(path.join(this.repository.rootDirectory, ".documentary-studio", "config.json"), "utf8"));
    } catch {
      return {};
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
      "Use only the scoped context below. Do not research, script, or create scenes for an unconfirmed topic.",
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
