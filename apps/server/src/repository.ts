import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ChannelSchema,
  EpisodeSchema,
  SceneSchema,
  TopicCandidateSchema,
  VoiceProfileSchema,
  type Channel,
  type CreateChannelInput,
  type Episode,
  type Scene,
  type TopicCandidate,
  type VoiceProfile,
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
  voices: string;
};

export class RepositoryService {
  roots: RepositoryRoots;

  constructor(readonly rootDirectory: string, storageRoot = rootDirectory) {
    this.roots = this.createRoots(storageRoot);
  }

  get storageRoot(): string {
    return path.dirname(this.roots.channels);
  }

  setStorageRoot(storageRoot: string): void {
    this.roots = this.createRoots(storageRoot);
  }

  resolveContextPath(relativePath: string): string {
    const normalized = relativePath.replaceAll("\\", "/");
    const [root, ...segments] = normalized.split("/");
    const roots: Record<string, string> = {
      channels: this.roots.channels,
      templates: this.roots.templates,
      shared: this.roots.shared,
      ".documentary-studio": this.roots.runtime,
    };
    const base = roots[root ?? ""];
    if (!base || segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new RepositoryError("Unsafe context path", "UNSAFE_PATH");
    }
    const resolved = path.resolve(base, ...segments);
    if (!this.isInside(base, resolved)) throw new RepositoryError("Resolved context path escaped its root", "UNSAFE_PATH");
    return resolved;
  }

  async ensureBootstrap(): Promise<void> {
    await Promise.all([
      mkdir(this.roots.channels, { recursive: true }),
      mkdir(path.join(this.roots.runtime, "tasks"), { recursive: true }),
      mkdir(path.join(this.roots.runtime, "codex"), { recursive: true }),
      mkdir(path.join(this.roots.runtime, "logs"), { recursive: true }),
      mkdir(this.roots.voices, { recursive: true }),
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

  async updateChannel(channelId: string, patch: Partial<Pick<Channel, "display_name" | "description" | "target_audience" | "language" | "market" | "status" | "updated_at" | "voice_reference_path">>): Promise<Channel> {
    const current = await this.getChannel(channelId);
    const next = ChannelSchema.parse({ ...current, ...patch, updated_at: nowIso() });
    await this.writeJsonAtomic(this.resolvePath("channels", current.slug, "channel.json"), next);
    return next;
  }

  async saveVoiceReference(channelId: string, content: Uint8Array): Promise<{ path: string; modified_at: string }> {
    const channel = await this.getChannel(channelId);
    const channelDirectory = this.resolvePath("channels", channel.slug);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    await this.assertRealPathInside(channelDirectory, assetsDirectory);
    const absolutePath = this.resolvePath("channels", channel.slug, "assets", "voice_reference.wav");
    await this.writeBinaryAtomic(absolutePath, content);
    await this.updateChannel(channelId, { voice_reference_path: `channels/${channel.slug}/assets/voice_reference.wav` });
    const metadata = await stat(absolutePath);
    return { path: `channels/${channel.slug}/assets/voice_reference.wav`, modified_at: metadata.mtime.toISOString() };
  }

  async listVoices(): Promise<VoiceProfile[]> {
    await this.ensureBootstrap();
    try {
      const raw = JSON.parse(await readFile(path.join(this.roots.voices, "voices.json"), "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((voice) => VoiceProfileSchema.parse(voice)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch {
      return [];
    }
  }

  async getVoice(voiceId: string): Promise<VoiceProfile> {
    const voice = (await this.listVoices()).find((item) => item.voice_id === voiceId);
    if (!voice) throw new RepositoryError("Voice not found", "VOICE_NOT_FOUND");
    return voice;
  }

  async createVoiceProfile(name: string, referenceContent: Uint8Array, sampleContent: Uint8Array): Promise<VoiceProfile> {
    await this.ensureBootstrap();
    const voiceId = makeId("voice");
    const directory = this.resolvePath("voices", voiceId);
    await mkdir(directory, { recursive: true });
    const referencePath = `.documentary-studio/voices/${voiceId}/reference.wav`;
    const samplePath = `.documentary-studio/voices/${voiceId}/sample.wav`;
    await this.writeBinaryAtomic(path.join(directory, "reference.wav"), referenceContent);
    await this.writeBinaryAtomic(path.join(directory, "sample.wav"), sampleContent);
    const profile = VoiceProfileSchema.parse({ voice_id: voiceId, name, reference_path: referencePath, sample_path: samplePath, created_at: nowIso() });
    await this.writeJsonAtomic(path.join(this.roots.voices, "voices.json"), [...(await this.listVoices()), profile]);
    return profile;
  }

  async updateVoiceSample(voiceId: string, content: Uint8Array): Promise<VoiceProfile> {
    const voice = await this.getVoice(voiceId);
    await this.writeBinaryAtomic(this.resolveContextPath(voice.sample_path), content);
    return voice;
  }

  async deleteVoiceProfile(voiceId: string): Promise<void> {
    const voice = await this.getVoice(voiceId);
    const inUse = (await this.listChannels(true)).filter((channel) => channel.voice_reference_path === voice.reference_path);
    if (inUse.length > 0) throw new RepositoryError(`Voice is in use by ${inUse.length} channel(s)`, "VOICE_IN_USE");
    await this.removeTree(this.resolvePath("voices", voice.voice_id));
    await this.writeJsonAtomic(path.join(this.roots.voices, "voices.json"), (await this.listVoices()).filter((item) => item.voice_id !== voiceId));
  }

  async assignVoice(channelId: string, voiceId: string | null): Promise<Channel> {
    const voice = voiceId ? await this.getVoice(voiceId) : null;
    return this.updateChannel(channelId, { voice_reference_path: voice?.reference_path ?? null });
  }

  async getVoiceSampleFile(voiceId: string): Promise<{ absolutePath: string; size: number; modified_at: string }> {
    const voice = await this.getVoice(voiceId);
    const absolutePath = this.resolveContextPath(voice.sample_path);
    try {
      await this.assertRealPathInside(this.roots.voices, absolutePath);
      const metadata = await stat(absolutePath);
      return { absolutePath, size: metadata.size, modified_at: metadata.mtime.toISOString() };
    } catch {
      throw new RepositoryError("Voice preview not found", "VOICE_SAMPLE_NOT_FOUND");
    }
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
    const previousScenes = await this.readScenes(channelId, episodeId);
    const normalized = scenes.map((scene, index) => SceneSchema.parse({ ...scene, scene_number: index + 1, episode_id: episodeId }));
    const withFreshAudio = normalized.map((scene) => {
      const previous = previousScenes.find((item) => item.scene_number === scene.scene_number);
      if (previous && previous.dialogue !== scene.dialogue) return clearSceneAudio(scene);
      return scene;
    });
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    await this.writeTextAtomic(path.join(episodeDirectory, "scene_plan.md"), serializeScenes(withFreshAudio));
    await this.writeTextAtomic(path.join(episodeDirectory, "dialogue_script.md"), serializeDialogue(withFreshAudio));
    await this.writeTextAtomic(path.join(episodeDirectory, "video_prompts.md"), serializePrompts(withFreshAudio));
    await this.writeJsonAtomic(path.join(episodeDirectory, "episode.json"), EpisodeSchema.parse({ ...episode, stage: "SCENE_READY", updated_at: nowIso() }));
  }

  async saveSceneAudio(channelId: string, episodeId: string, sceneNumber: number, audioAssetPath: string, durationSeconds: number): Promise<void> {
    const scenes = await this.readScenes(channelId, episodeId);
    const target = scenes.find((scene) => scene.scene_number === sceneNumber);
    if (!target) throw new RepositoryError("Audio target scene not found", "SCENE_NOT_FOUND");
    const next = scenes.map((scene) => scene.scene_number === sceneNumber ? SceneSchema.parse({
      ...scene,
      audio_asset_path: audioAssetPath,
      audio_generated_at: nowIso(),
      audio_duration_seconds: durationSeconds,
    }) : scene);
    await this.saveScenes(channelId, episodeId, next);
  }

  async getSceneAudioFile(channelId: string, episodeId: string, filename: string): Promise<{ absolutePath: string; path: string; size: number; modified_at: string }> {
    if (!/^scene-\d{2,}\.wav$/i.test(filename)) throw new RepositoryError("Unsupported audio file", "FILE_NOT_ALLOWED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", filename);
    try {
      await this.assertRealPathInside(assetsDirectory, absolutePath);
      const metadata = await stat(absolutePath);
      return { absolutePath, path: `channels/${channel.slug}/episodes/${episode.slug}/assets/${filename}`, size: metadata.size, modified_at: metadata.mtime.toISOString() };
    } catch {
      throw new RepositoryError("Audio asset not found", "AUDIO_NOT_FOUND");
    }
  }

  async writeSceneAudio(channelId: string, episodeId: string, sceneNumber: number, content: Uint8Array): Promise<string> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    await this.assertRealPathInside(episodeDirectory, assetsDirectory);
    const filename = `scene-${String(sceneNumber).padStart(2, "0")}.wav`;
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", filename);
    await this.writeBinaryAtomic(absolutePath, content);
    return `channels/${channel.slug}/episodes/${episode.slug}/assets/${filename}`;
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

  private createRoots(storageRoot: string): RepositoryRoots {
    const resolvedStorageRoot = path.resolve(storageRoot);
    return {
      channels: path.join(resolvedStorageRoot, "channels"),
      templates: path.join(this.rootDirectory, "templates"),
      shared: path.join(this.rootDirectory, "shared"),
      runtime: path.join(resolvedStorageRoot, ".documentary-studio"),
      voices: path.join(resolvedStorageRoot, ".documentary-studio", "voices"),
    };
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

  private async writeBinaryAtomic(target: string, content: Uint8Array): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, target);
  }

  private async removeTree(target: string): Promise<void> {
    await rm(target, { recursive: true, force: true });
  }
}

function clearSceneAudio(scene: Scene): Scene {
  return { ...scene, audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null };
}

export function parseScenes(markdown: string, episodeId: string): Scene[] {
  const blocks = markdown.split(/^# Scene\s+\d+\s*$/gim).slice(1);
  return blocks.map((block, index) => {
    const duration = Number(block.match(/\*\*Duration:\*\*\s*([\d.]+)/i)?.[1] ?? 6);
    const dialogue = block.match(/## Dialogue\s*\n([\s\S]*?)(?=\n## Video Prompt|$)/i)?.[1]?.trim() ?? "";
    const prompt = block.match(/## Video Prompt\s*\n([\s\S]*?)(?=\n## Notes|$)/i)?.[1]?.trim() ?? "";
    const notes = block.match(/## Notes\s*\n([\s\S]*?)(?=\n<!--|$)/i)?.[1] ?? "";
    const transition = notes.match(/- Transition:[ \t]*(.*)/i)?.[1]?.trim() ?? "";
    const continuity = notes.match(/- Continuity:[ \t]*(.*)/i)?.[1]?.trim() ?? "";
    const audioAssetPath = block.match(/<!--\s*Audio asset:\s*(.*?)\s*-->/i)?.[1]?.trim() || null;
    const audioGeneratedAt = block.match(/<!--\s*Audio generated at:\s*(.*?)\s*-->/i)?.[1]?.trim() || null;
    const audioDuration = block.match(/<!--\s*Audio duration:\s*([\d.]+)\s*-->/i)?.[1];
    return SceneSchema.parse({
      scene_id: `${episodeId}_scene_${index + 1}`,
      episode_id: episodeId,
      scene_number: index + 1,
      duration_seconds: duration,
      dialogue,
      visual_prompt: prompt,
      transition_note: transition,
      continuity_note: continuity,
      audio_asset_path: audioAssetPath,
      audio_generated_at: audioGeneratedAt,
      audio_duration_seconds: audioDuration ? Number(audioDuration) : null,
    });
  });
}

export function serializeScenes(scenes: Scene[]): string {
  return scenes.map((scene) => `${[
    `# Scene ${scene.scene_number}`,
    `**Duration:** ${scene.duration_seconds} seconds`,
    "## Dialogue",
    scene.dialogue.trim(),
    "## Video Prompt",
    scene.visual_prompt.trim(),
    "## Notes",
    `- Transition: ${scene.transition_note.trim()}`,
    `- Continuity: ${scene.continuity_note.trim()}`,
    scene.audio_asset_path ? `<!-- Audio asset: ${scene.audio_asset_path} -->\n<!-- Audio generated at: ${scene.audio_generated_at ?? ""} -->\n<!-- Audio duration: ${scene.audio_duration_seconds ?? ""} -->` : "",
  ].join("\n\n")}\n`).join("\n");
}

export function serializeDialogue(scenes: Scene[]): string {
  return `# Dialogue Script\n\n${scenes.map((scene) => `## Scene ${scene.scene_number}\n\n${scene.dialogue.trim()}`).join("\n\n")}\n`;
}

export function serializePrompts(scenes: Scene[]): string {
  return `# Video Prompts\n\n${scenes.map((scene) => `## Scene ${scene.scene_number}\n\n${scene.visual_prompt.trim()}`).join("\n\n")}\n`;
}
