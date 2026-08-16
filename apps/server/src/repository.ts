import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ChannelSchema,
  EpisodeSchema,
  SceneSchema,
  TopicCandidateSchema,
  type Channel,
  type CreateChannelInput,
  type Episode,
  type Scene,
  type TopicCandidate,
  makeId,
  nowIso,
} from "@studio/shared";
import { access, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

type TopicRun = { generated_at: string; candidates: TopicCandidate[] };

const allowedEpisodeFiles = new Set([
  "brief.md",
  "research.md",
  "sources.md",
  "outline.md",
  "script.md",
  "scene_plan.md",
  "dialogue_script.md",
  "video_prompts.md",
]);

export class RepositoryError extends Error {
  constructor(message: string, public readonly code = "REPOSITORY_ERROR") {
    super(message);
    this.name = "RepositoryError";
  }
}

export type RepositoryRoots = {
  channels: string;
  templates: string;
  shared: string;
  runtime: string;
};

export class RepositoryService {
  readonly roots: RepositoryRoots;

  constructor(readonly rootDirectory: string) {
    this.roots = {
      channels: path.join(rootDirectory, "channels"),
      templates: path.join(rootDirectory, "templates"),
      shared: path.join(rootDirectory, "shared"),
      runtime: path.join(rootDirectory, ".documentary-studio"),
    };
  }

  async ensureBootstrap(): Promise<void> {
    await Promise.all([
      mkdir(this.roots.channels, { recursive: true }),
      mkdir(path.join(this.roots.runtime, "tasks"), { recursive: true }),
      mkdir(path.join(this.roots.runtime, "codex"), { recursive: true }),
      mkdir(path.join(this.roots.runtime, "logs"), { recursive: true }),
    ]);
  }

  async listChannels(includeArchived = true): Promise<Channel[]> {
    await this.ensureBootstrap();
    const entries = await readdir(this.roots.channels, { withFileTypes: true });
    const channels: Channel[] = [];
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        const channel = await this.readChannelBySlug(entry.name);
        if (includeArchived || channel.status !== "ARCHIVED") channels.push(channel);
      } catch {
        // An incomplete directory should not hide every other channel from the UI.
      }
    }
    return channels.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  async getChannel(channelId: string): Promise<Channel> {
    const channels = await this.listChannels(true);
    const channel = channels.find((item) => item.channel_id === channelId);
    if (!channel) throw new RepositoryError("Channel not found", "CHANNEL_NOT_FOUND");
    return channel;
  }

  async getChannelBySlug(slug: string): Promise<Channel> {
    return this.readChannelBySlug(this.assertSlug(slug));
  }

  async createChannel(input: CreateChannelInput): Promise<Channel> {
    await this.ensureBootstrap();
    const slug = await this.uniqueSlug(input.name, this.roots.channels);
    const channelId = makeId("ch");
    const timestamp = nowIso();
    const directory = this.resolvePath("channels", slug);
    await mkdir(path.join(directory, "topics"), { recursive: true });
    await mkdir(path.join(directory, "episodes"), { recursive: true });
    await mkdir(path.join(directory, "assets"), { recursive: true });
    await writeFile(path.join(directory, "topic_database.json"), "[]\n", "utf8");

    const dna = await this.getTemplate("example_channel_dna.md");
    const styleGuide = await this.getTemplate("example_style_guide.md");
    const dnaContent = input.dna_mode === "upload" && input.dna_content?.trim()
      ? input.dna_content
      : dna.replace("- Channel name: ", `- Channel name: ${input.name}`)
        .replace("- Primary audience: ", `- Primary audience: ${input.target_audience}`)
        .replace("- Market: ", `- Market: ${input.market}`)
        .replace("- Language: ", `- Language: ${input.language}`)
        .replace("Describe the channel's documentary territory in one clear paragraph.", input.description || "Describe the channel's documentary territory in one clear paragraph.");
    await writeFile(path.join(directory, "channel_dna.md"), `${dnaContent.trim()}\n`, "utf8");
    await writeFile(path.join(directory, "style_guide.md"), `${styleGuide.trim()}\n`, "utf8");

    const channel = ChannelSchema.parse({
      channel_id: channelId,
      slug,
      display_name: input.name,
      description: input.description,
      target_audience: input.target_audience,
      language: input.language,
      market: input.market,
      channel_dna_path: `channels/${slug}/channel_dna.md`,
      style_guide_path: `channels/${slug}/style_guide.md`,
      status: "DRAFT",
      created_at: timestamp,
      updated_at: timestamp,
      episode_count: 0,
    });
    await this.writeJsonAtomic(path.join(directory, "channel.json"), channel);
    return channel;
  }

  async updateChannel(channelId: string, patch: Partial<Pick<Channel, "display_name" | "description" | "target_audience" | "language" | "market" | "status" | "updated_at">>): Promise<Channel> {
    const current = await this.getChannel(channelId);
    const next = ChannelSchema.parse({ ...current, ...patch, updated_at: nowIso() });
    await this.writeJsonAtomic(this.resolvePath("channels", current.slug, "channel.json"), next);
    return next;
  }

  async deleteChannel(channelId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new RepositoryError("Delete confirmation is required", "CONFIRMATION_REQUIRED");
    const channel = await this.getChannel(channelId);
    const directory = this.resolvePath("channels", channel.slug);
    await this.removeTree(directory);
  }

  async getChannelDna(channelId: string): Promise<{ content: string; path: string; modified_at: string }> {
    const channel = await this.getChannel(channelId);
    const absolutePath = this.resolvePath("channels", channel.slug, "channel_dna.md");
    const [content, metadata] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);
    return { content, path: channel.channel_dna_path, modified_at: metadata.mtime.toISOString() };
  }

  async saveChannelDna(channelId: string, content: string): Promise<{ path: string; modified_at: string }> {
    const channel = await this.getChannel(channelId);
    if (!content.trim()) throw new RepositoryError("Channel DNA cannot be empty", "INVALID_DNA");
    const absolutePath = this.resolvePath("channels", channel.slug, "channel_dna.md");
    await this.writeTextAtomic(absolutePath, content.endsWith("\n") ? content : `${content}\n`);
    await this.updateChannel(channelId, { status: channel.status === "DRAFT" ? "ACTIVE" : channel.status });
    const metadata = await stat(absolutePath);
    return { path: channel.channel_dna_path, modified_at: metadata.mtime.toISOString() };
  }

  async listEpisodes(channelId: string): Promise<Episode[]> {
    const channel = await this.getChannel(channelId);
    const directory = this.resolvePath("channels", channel.slug, "episodes");
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const episodes: Episode[] = [];
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", entry.name);
        await this.assertRealPathInside(path.join(this.resolvePath("channels", channel.slug), "episodes"), episodeDirectory);
        const episode = EpisodeSchema.parse(JSON.parse(await readFile(path.join(episodeDirectory, "episode.json"), "utf8")));
        episodes.push(episode);
      } catch {
        // Ignore incomplete episode directories and keep the rest visible.
      }
    }
    return episodes.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getEpisode(channelId: string, episodeId: string): Promise<Episode> {
    const episodes = await this.listEpisodes(channelId);
    const episode = episodes.find((item) => item.episode_id === episodeId);
    if (!episode) throw new RepositoryError("Episode not found", "EPISODE_NOT_FOUND");
    return episode;
  }

  async getEpisodeFile(channelId: string, episodeId: string, filename: string): Promise<{ content: string; path: string; modified_at: string }> {
    if (!allowedEpisodeFiles.has(filename)) throw new RepositoryError("Unsupported episode file", "FILE_NOT_ALLOWED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, filename);
    try {
      const [content, metadata] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);
      return { content, path: `channels/${channel.slug}/episodes/${episode.slug}/${filename}`, modified_at: metadata.mtime.toISOString() };
    } catch {
      return { content: "", path: `channels/${channel.slug}/episodes/${episode.slug}/${filename}`, modified_at: "" };
    }
  }

  async saveEpisodeFile(channelId: string, episodeId: string, filename: string, content: string): Promise<{ path: string; modified_at: string }> {
    if (!allowedEpisodeFiles.has(filename)) throw new RepositoryError("Unsupported episode file", "FILE_NOT_ALLOWED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, filename);
    await this.writeTextAtomic(absolutePath, content.endsWith("\n") ? content : `${content}\n`);
    const updated = EpisodeSchema.parse({ ...episode, updated_at: nowIso() });
    await this.writeJsonAtomic(path.join(path.dirname(absolutePath), "episode.json"), updated);
    const metadata = await stat(absolutePath);
    return { path: `channels/${channel.slug}/episodes/${episode.slug}/${filename}`, modified_at: metadata.mtime.toISOString() };
  }

  async listTopics(channelId: string): Promise<TopicCandidate[]> {
    const channel = await this.getChannel(channelId);
    const directory = this.resolvePath("channels", channel.slug, "topics");
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const all: TopicCandidate[] = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      try {
        const run = JSON.parse(await readFile(path.join(directory, entry.name), "utf8")) as TopicRun;
        all.push(...run.candidates.map((candidate) => TopicCandidateSchema.parse(candidate)));
      } catch {
        // Preserve forward compatibility with partially written topic runs.
      }
    }
    return all.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  }

  async saveTopicRun(channelId: string, candidates: TopicCandidate[]): Promise<void> {
    const channel = await this.getChannel(channelId);
    if (candidates.length !== 5) throw new RepositoryError("A topic suggestion run must contain exactly 5 candidates", "INVALID_TOPIC_RUN");
    const directory = this.resolvePath("channels", channel.slug, "topics");
    await mkdir(directory, { recursive: true });
    const run: TopicRun = { generated_at: nowIso(), candidates: candidates.map((candidate) => TopicCandidateSchema.parse(candidate)) };
    await this.writeJsonAtomic(path.join(directory, `suggestion-${Date.now()}-${makeId("run")}.json`), run);
  }

  async confirmTopic(channelId: string, topicId: string): Promise<Episode> {
    const channel = await this.getChannel(channelId);
    const candidate = (await this.listTopics(channelId)).find((topic) => topic.topic_id === topicId);
    if (!candidate) throw new RepositoryError("Topic candidate not found", "TOPIC_NOT_FOUND");
    await this.markTopicSelected(channelId, topicId);
    const episodeSlug = await this.uniqueSlug(candidate.title, this.resolvePath("channels", channel.slug, "episodes"));
    const episodeId = makeId("ep");
    const timestamp = nowIso();
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episodeSlug);
    await mkdir(path.join(episodeDirectory, "assets"), { recursive: true });
    const episode = EpisodeSchema.parse({
      episode_id: episodeId,
      channel_id: channelId,
      slug: episodeSlug,
      topic: { title: candidate.title, premise: candidate.premise, hook: candidate.hook },
      stage: "SELECTED",
      script_path: `channels/${channel.slug}/episodes/${episodeSlug}/script.md`,
      scene_plan_path: `channels/${channel.slug}/episodes/${episodeSlug}/scene_plan.md`,
      dialogue_script_path: `channels/${channel.slug}/episodes/${episodeSlug}/dialogue_script.md`,
      video_prompts_path: `channels/${channel.slug}/episodes/${episodeSlug}/video_prompts.md`,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await this.writeJsonAtomic(path.join(episodeDirectory, "episode.json"), episode);
    await this.writeTextAtomic(path.join(episodeDirectory, "brief.md"), `# ${candidate.title}\n\n## Premise\n\n${candidate.premise}\n\n## Hook\n\n${candidate.hook}\n`);
    await Promise.all([
      this.writeTextAtomic(path.join(episodeDirectory, "script.md"), "# Script\n\nScript generation has not started.\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "scene_plan.md"), "# Scene Plan\n\nScene breakdown has not started.\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "dialogue_script.md"), "# Dialogue Script\n\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "video_prompts.md"), "# Video Prompts\n\n"),
    ]);
    await this.writeJsonAtomic(path.join(this.resolvePath("channels", channel.slug), "topic_database.json"),
      (await this.listTopics(channelId)).map(({ title, premise }) => ({ title, premise })));
    await this.updateChannel(channelId, { updated_at: timestamp });
    return episode;
  }

  async readScenes(channelId: string, episodeId: string): Promise<Scene[]> {
    const file = await this.getEpisodeFile(channelId, episodeId, "scene_plan.md");
    return parseScenes(file.content, episodeId);
  }

  async saveScenes(channelId: string, episodeId: string, scenes: Scene[]): Promise<void> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const normalized = scenes.map((scene, index) => SceneSchema.parse({ ...scene, scene_number: index + 1, episode_id: episodeId }));
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    await this.writeTextAtomic(path.join(episodeDirectory, "scene_plan.md"), serializeScenes(normalized));
    await this.writeTextAtomic(path.join(episodeDirectory, "dialogue_script.md"), serializeDialogue(normalized));
    await this.writeTextAtomic(path.join(episodeDirectory, "video_prompts.md"), serializePrompts(normalized));
    await this.writeJsonAtomic(path.join(episodeDirectory, "episode.json"), EpisodeSchema.parse({ ...episode, stage: "SCENE_READY", updated_at: nowIso() }));
  }

  async updateEpisodeStage(channelId: string, episodeId: string, stage: Episode["stage"]): Promise<Episode> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const next = EpisodeSchema.parse({ ...episode, stage, updated_at: nowIso() });
    await this.writeJsonAtomic(this.resolvePath("channels", channel.slug, "episodes", episode.slug, "episode.json"), next);
    return next;
  }

  async backupEpisodeFile(channelId: string, episodeId: string, filename: string): Promise<string | null> {
    if (!allowedEpisodeFiles.has(filename)) throw new RepositoryError("Unsupported episode file", "FILE_NOT_ALLOWED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const source = this.resolvePath("channels", channel.slug, "episodes", episode.slug, filename);
    try {
      await access(source);
    } catch {
      return null;
    }
    const backup = `${source}.${new Date().toISOString().replaceAll(/[:.]/g, "-")}.bak`;
    await writeFile(backup, await readFile(source));
    return backup;
  }

  async getGitInfo(): Promise<{ branch: string | null; dirty: boolean; changed_files: number }> {
    try {
      const { stdout: branch } = await execFileAsync("git", ["branch", "--show-current"], { cwd: this.rootDirectory });
      const { stdout: status } = await execFileAsync("git", ["status", "--short"], { cwd: this.rootDirectory });
      return { branch: branch.trim() || null, dirty: Boolean(status.trim()), changed_files: status.trim() ? status.trim().split(/\r?\n/).length : 0 };
    } catch {
      return { branch: null, dirty: false, changed_files: 0 };
    }
  }

  resolvePath(root: keyof RepositoryRoots, ...segments: string[]): string {
    const rootPath = this.roots[root];
    for (const segment of segments) {
      if (!segment || segment.includes("\0") || path.isAbsolute(segment) || segment.includes("/") || segment.includes("\\") || /^[A-Za-z]:/.test(segment)) {
        throw new RepositoryError("Unsafe filesystem path", "UNSAFE_PATH");
      }
    }
    const resolved = path.resolve(rootPath, ...segments);
    if (!this.isInside(rootPath, resolved)) throw new RepositoryError("Resolved path escaped its root", "UNSAFE_PATH");
    return resolved;
  }

  slugify(input: string): string {
    const normalized = input.trim().replaceAll("đ", "d").replaceAll("Đ", "D").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
    if (!slug) throw new RepositoryError("Name cannot produce a safe slug", "EMPTY_SLUG");
    return slug;
  }

  private async readChannelBySlug(slug: string): Promise<Channel> {
    const directory = this.resolvePath("channels", this.assertSlug(slug));
    await this.assertRealPathInside(this.roots.channels, directory);
    const metadataPath = path.join(directory, "channel.json");
    const raw = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
    const metadata = ChannelSchema.parse(raw);
    const episodes = await this.safeEpisodeCount(directory);
    return ChannelSchema.parse({ ...metadata, episode_count: episodes });
  }

  private async safeEpisodeCount(channelDirectory: string): Promise<number> {
    try {
      const entries = await readdir(path.join(channelDirectory, "episodes"), { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  private async getTemplate(filename: string): Promise<string> {
    try {
      return await readFile(this.resolvePath("templates", filename), "utf8");
    } catch {
      throw new RepositoryError(`Required template is missing: ${filename}`, "TEMPLATE_MISSING");
    }
  }

  private async markTopicSelected(channelId: string, topicId: string): Promise<void> {
    const channel = await this.getChannel(channelId);
    const directory = this.resolvePath("channels", channel.slug, "topics");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      const filePath = path.join(directory, entry.name);
      try {
        const run = JSON.parse(await readFile(filePath, "utf8")) as TopicRun;
        let changed = false;
        run.candidates = run.candidates.map((topic) => {
          if (topic.topic_id !== topicId) return topic;
          changed = true;
          return { ...topic, selected: true };
        });
        if (changed) await this.writeJsonAtomic(filePath, run);
      } catch {
        // Ignore malformed historical runs.
      }
    }
  }

  private assertSlug(value: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 60) throw new RepositoryError("Invalid slug", "INVALID_SLUG");
    return value;
  }

  private async uniqueSlug(input: string, parentDirectory: string): Promise<string> {
    const base = this.slugify(input);
    let candidate = base;
    let suffix = 2;
    while (await this.exists(path.join(parentDirectory, candidate))) candidate = `${base}-${suffix++}`;
    return candidate;
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  private isInside(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  private async assertRealPathInside(rootPath: string, targetPath: string): Promise<void> {
    const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)]);
    if (!this.isInside(realRoot, realTarget)) throw new RepositoryError("Filesystem path escaped its root", "UNSAFE_PATH");
  }

  private async writeJsonAtomic(target: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    await this.writeTextAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
  }

  private async writeTextAtomic(target: string, content: string): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  }

  private async removeTree(target: string): Promise<void> {
    await rm(target, { recursive: true, force: true });
  }
}

export function parseScenes(markdown: string, episodeId: string): Scene[] {
  const blocks = markdown.split(/^# Scene\s+\d+\s*$/gim).slice(1);
  return blocks.map((block, index) => {
    const duration = Number(block.match(/\*\*Duration:\*\*\s*([\d.]+)/i)?.[1] ?? 6);
    const dialogue = block.match(/## Dialogue\s*\n([\s\S]*?)(?=\n## Video Prompt|$)/i)?.[1]?.trim() ?? "";
    const prompt = block.match(/## Video Prompt\s*\n([\s\S]*?)(?=\n## Notes|$)/i)?.[1]?.trim() ?? "";
    const notes = block.match(/## Notes\s*\n([\s\S]*)/i)?.[1] ?? "";
    const transition = notes.match(/- Transition:\s*(.*)/i)?.[1]?.trim() ?? "";
    const continuity = notes.match(/- Continuity:\s*(.*)/i)?.[1]?.trim() ?? "";
    return SceneSchema.parse({
      scene_id: `${episodeId}_scene_${index + 1}`,
      episode_id: episodeId,
      scene_number: index + 1,
      duration_seconds: duration,
      dialogue,
      visual_prompt: prompt,
      transition_note: transition,
      continuity_note: continuity,
    });
  });
}

export function serializeScenes(scenes: Scene[]): string {
  return scenes.map((scene) => `# Scene ${scene.scene_number}\n\n**Duration:** ${scene.duration_seconds} seconds\n\n## Dialogue\n\n${scene.dialogue.trim()}\n\n## Video Prompt\n\n${scene.visual_prompt.trim()}\n\n## Notes\n\n- Transition: ${scene.transition_note.trim()}\n- Continuity: ${scene.continuity_note.trim()}\n`).join("\n");
}

export function serializeDialogue(scenes: Scene[]): string {
  return `# Dialogue Script\n\n${scenes.map((scene) => `## Scene ${scene.scene_number}\n\n${scene.dialogue.trim()}`).join("\n\n")}\n`;
}

export function serializePrompts(scenes: Scene[]): string {
  return `# Video Prompts\n\n${scenes.map((scene) => `## Scene ${scene.scene_number}\n\n${scene.visual_prompt.trim()}`).join("\n\n")}\n`;
}
