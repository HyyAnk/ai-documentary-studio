import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ChannelSchema,
  DirectorPlanSchema,
  EpisodeSchema,
  QuizAssessmentSchema,
  QuizAssetPlanSchema,
  QuizAssetResolutionSchema,
  QuizTimelineSchema,
  QuizV2Schema,
  SceneSchema,
  TopicCandidateSchema,
  TopicConfirmInputSchema,
  QUIZ_SECONDS_PER_QUESTION,
  VoicePlanSchema,
  VoiceProfileSchema,
  type Channel,
  type CreateChannelInput,
  type DirectorPlan,
  type Episode,
  type EpisodeSettingsInput,
  type QuizAssessment,
  type QuizAssetPlan,
  type QuizAssetResolution,
  type QuizTimeline,
  type QuizV2,
  type Scene,
  type TopicCandidate,
  type VoicePlan,
  type VoiceProfile,
  makeId,
  nowIso,
} from "@studio/shared";
import { access, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripEditorialOverlayInstructions } from "./visualPrompt.js";
import { invalidateQuizArtifacts as quizInvalidationStages } from "./quiz/pipeline/invalidation.js";

const execFileAsync = promisify(execFile);

const DEFAULT_NARRATION_WORDS_PER_SECOND = 2.3;

function estimateQuizTargetDurationMinutes(questionCount: number): number {
  return Math.max(3, Math.round((questionCount * QUIZ_SECONDS_PER_QUESTION) / 60));
}

function estimateQuizTargetWordCount(targetDurationMinutes: number, wordsPerSecond: number): number {
  return Math.round(targetDurationMinutes * 60 * Math.max(0.1, wordsPerSecond) * 0.95);
}

type TopicRun = { generated_at: string; candidates: TopicCandidate[] };

export type BundleImageAsset = {
  bundle_id: string;
  bundle_number: number;
  variant: number;
  filename: string;
  path: string;
  absolutePath: string;
  size: number;
  modified_at: string;
};

const allowedEpisodeFiles = new Set([
  "brief.md",
  "research.md",
  "sources.md",
  "treatment.md",
  "outline.md",
  "script.md",
  "visual_bible.md",
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

    const dna = await this.getTemplate(input.group_id === "quiz" ? "quiz_channel_dna.md" : "example_channel_dna.md");
    const styleGuide = await this.getTemplate("example_style_guide.md");
    const dnaContent = input.dna_mode === "upload" && input.dna_content?.trim()
      ? input.dna_content
      : dna.replace("- Channel name: ", `- Channel name: ${input.name}`)
        .replace("- Primary audience: ", `- Primary audience: ${input.target_audience}`)
        .replace("- Market: ", `- Market: ${input.market}`)
        .replace("- Language: ", `- Language: ${input.language}`)
      .replace("Describe the channel's documentary territory in one clear paragraph.", input.description || "A playful, fact-checked quiz channel that turns broad knowledge into short moments of discovery.")
      .replace("Describe the quiz channel territory in one clear paragraph.", input.description || "A playful, fact-checked quiz channel that turns broad knowledge into short moments of discovery.");
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
      group_id: input.group_id === "quiz" ? "quiz" : "documentary",
      engine: input.group_id === "quiz" ? "quiz" : "documentary",
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

  async deleteEpisode(channelId: string, episodeId: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new RepositoryError("Delete confirmation is required", "CONFIRMATION_REQUIRED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const episodesRoot = this.resolvePath("channels", channel.slug, "episodes");
    const directory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    await this.assertRealPathInside(episodesRoot, directory);
    await this.removeTree(directory);
    await this.updateChannel(channelId, { updated_at: nowIso() });
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
    const updated = EpisodeSchema.parse({
      ...episode,
      ...(filename === "script.md" ? {
        narration_asset_path: null,
        narration_generated_at: null,
        narration_duration_seconds: null,
        narration_segment_count: 0,
        measured_narration_words_per_second: null,
      } : {}),
      updated_at: nowIso(),
    });
    await this.writeJsonAtomic(path.join(path.dirname(absolutePath), "episode.json"), updated);
    if (["research.md", "treatment.md", "script.md", "visual_bible.md"].includes(filename)) await this.invalidateQuizSourceArtifacts(channelId, episodeId);
    const metadata = await stat(absolutePath);
    return { path: `channels/${channel.slug}/episodes/${episode.slug}/${filename}`, modified_at: metadata.mtime.toISOString() };
  }

  async readQuiz(channelId: string, episodeId: string): Promise<QuizV2 | null> {
    return this.readQuizArtifact(channelId, episodeId, "quiz-v2.json", QuizV2Schema);
  }

  async writeQuiz(channelId: string, episodeId: string, quiz: QuizV2): Promise<string> {
    return this.writeQuizArtifact(channelId, episodeId, "quiz-v2.json", QuizV2Schema.parse(quiz));
  }

  async readDirectorPlan(channelId: string, episodeId: string): Promise<DirectorPlan | null> {
    return this.readQuizArtifact(channelId, episodeId, "director-plan.json", DirectorPlanSchema);
  }

  async writeDirectorPlan(channelId: string, episodeId: string, plan: DirectorPlan): Promise<string> {
    return this.writeQuizArtifact(channelId, episodeId, "director-plan.json", DirectorPlanSchema.parse(plan));
  }

  async readAssetPlan(channelId: string, episodeId: string): Promise<QuizAssetPlan | null> {
    return this.readQuizArtifact(channelId, episodeId, "asset-plan.json", QuizAssetPlanSchema);
  }

  async writeAssetPlan(channelId: string, episodeId: string, plan: QuizAssetPlan): Promise<string> {
    return this.writeQuizArtifact(channelId, episodeId, "asset-plan.json", QuizAssetPlanSchema.parse(plan));
  }

  async readQuizAssetResolution(channelId: string, episodeId: string): Promise<QuizAssetResolution | null> {
    return this.readQuizArtifact(channelId, episodeId, "asset-resolution.json", QuizAssetResolutionSchema);
  }

  async writeQuizAssetResolution(channelId: string, episodeId: string, resolution: QuizAssetResolution): Promise<string> {
    return this.writeQuizArtifact(channelId, episodeId, "asset-resolution.json", QuizAssetResolutionSchema.parse(resolution));
  }

  async writeQuizImageAsset(channelId: string, episodeId: string, assetId: string, fingerprint: string, content: Uint8Array): Promise<string> {
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(assetId)) throw new RepositoryError("Quiz asset ID is invalid", "INVALID_ASSET");
    if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new RepositoryError("Quiz asset fingerprint is invalid", "INVALID_ASSET");
    if (!isPng(content)) throw new RepositoryError("Quiz image output is not a PNG file", "INVALID_IMAGE");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const directory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", "quiz-images");
    await mkdir(directory, { recursive: true });
    const filename = `${assetId}-${fingerprint.slice(0, 12)}.png`;
    const absolutePath = path.join(directory, filename);
    await this.writeBinaryAtomic(absolutePath, content);
    return `channels/${channel.slug}/episodes/${episode.slug}/assets/quiz-images/${filename}`;
  }

  async resolveQuizAssetPath(channelId: string, episodeId: string, assetPath: string): Promise<string> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const expected = `channels/${channel.slug}/episodes/${episode.slug}/assets/quiz-images/`;
    if (!assetPath.replaceAll("\\", "/").startsWith(expected)) throw new RepositoryError("Quiz asset path is outside this episode", "UNSAFE_PATH");
    const filename = path.basename(assetPath);
    if (!/^[a-z0-9][a-z0-9_-]{0,119}-[a-f0-9]{12}\.png$/i.test(filename)) throw new RepositoryError("Quiz asset filename is invalid", "UNSAFE_PATH");
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", "quiz-images", filename);
    await access(absolutePath);
    return absolutePath;
  }

  async readQuizTimeline(channelId: string, episodeId: string): Promise<QuizTimeline | null> {
    return this.readQuizArtifact(channelId, episodeId, "timeline.json", QuizTimelineSchema);
  }

  async writeQuizTimeline(channelId: string, episodeId: string, timeline: QuizTimeline): Promise<string> {
    return this.writeQuizArtifact(channelId, episodeId, "timeline.json", QuizTimelineSchema.parse(timeline));
  }

  async readQuizAssessment(channelId: string, episodeId: string): Promise<QuizAssessment | null> {
    return this.readQuizArtifact(channelId, episodeId, "qa.json", QuizAssessmentSchema);
  }

  async writeQuizAssessment(channelId: string, episodeId: string, assessment: QuizAssessment): Promise<string> {
    return this.writeQuizArtifact(channelId, episodeId, "qa.json", QuizAssessmentSchema.parse(assessment));
  }

  async readVoicePlan(channelId: string, episodeId: string): Promise<VoicePlan | null> {
    return this.readQuizArtifact(channelId, episodeId, "voice-plan.json", VoicePlanSchema);
  }

  async writeVoicePlan(channelId: string, episodeId: string, plan: VoicePlan): Promise<string> {
    return this.writeQuizArtifact(channelId, episodeId, "voice-plan.json", VoicePlanSchema.parse(plan));
  }

  async invalidateQuizArtifacts(channelId: string, episodeId: string, stages: string[]): Promise<string[]> {
    const filenames: Record<string, "quiz-v2.json" | "director-plan.json" | "asset-plan.json" | "asset-resolution.json" | "voice-plan.json" | "timeline.json" | "qa.json"> = {
      quiz: "quiz-v2.json",
      director: "director-plan.json",
      assets: "asset-plan.json",
      asset_resolution: "asset-resolution.json",
      voice: "voice-plan.json",
      timeline: "timeline.json",
      qa: "qa.json",
    };
    const removed: string[] = [];
    const shouldInvalidateRender = stages.includes("render");
    const hasQuizV2Artifact = shouldInvalidateRender ? Boolean(await this.readQuiz(channelId, episodeId)) : false;
    for (const stage of stages) {
      const filename = filenames[stage];
      if (!filename) continue;
      const target = await this.quizArtifactTarget(channelId, episodeId, filename);
      await rm(target.absolutePath, { force: true });
      removed.push(target.relativePath);
    }
    if (shouldInvalidateRender && hasQuizV2Artifact) {
      const episode = await this.getEpisode(channelId, episodeId);
      const channel = await this.getChannel(channelId);
      const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
      const videoFilename = episode.video_asset_path ? path.basename(episode.video_asset_path) : "quiz-video.mp4";
      if (/^[a-z0-9][a-z0-9._-]*\.mp4$/i.test(videoFilename)) await rm(path.join(assetsDirectory, videoFilename), { force: true });
      await rm(path.join(assetsDirectory, "render-manifest.json"), { force: true });
      const next = EpisodeSchema.parse({
        ...episode,
        stage: episode.stage === "VIDEO_READY" ? "SCENE_READY" : episode.stage,
        video_asset_path: null,
        video_generated_at: null,
        video_duration_seconds: null,
        render_manifest_path: null,
        updated_at: nowIso(),
      });
      await this.writeJsonAtomic(this.resolvePath("channels", channel.slug, "episodes", episode.slug, "episode.json"), next);
    }
    return removed;
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

  async confirmTopic(channelId: string, topicId: string, questionCount?: number): Promise<Episode> {
    const channel = await this.getChannel(channelId);
    const candidate = (await this.listTopics(channelId)).find((topic) => topic.topic_id === topicId);
    if (!candidate) throw new RepositoryError("Topic candidate not found", "TOPIC_NOT_FOUND");
    const selectedQuestionCount = TopicConfirmInputSchema.parse({ topic_id: topicId, question_count: questionCount }).question_count ?? candidate.question_count;
    const targetDurationMinutes = estimateQuizTargetDurationMinutes(selectedQuestionCount);
    const targetWordCount = estimateQuizTargetWordCount(targetDurationMinutes, DEFAULT_NARRATION_WORDS_PER_SECOND);
    await this.markTopicSelected(channelId, topicId, selectedQuestionCount);
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
      research_path: `channels/${channel.slug}/episodes/${episodeSlug}/research.md`,
      treatment_path: `channels/${channel.slug}/episodes/${episodeSlug}/treatment.md`,
      visual_bible_path: `channels/${channel.slug}/episodes/${episodeSlug}/visual_bible.md`,
      scene_plan_path: `channels/${channel.slug}/episodes/${episodeSlug}/scene_plan.md`,
      dialogue_script_path: `channels/${channel.slug}/episodes/${episodeSlug}/dialogue_script.md`,
      video_prompts_path: `channels/${channel.slug}/episodes/${episodeSlug}/video_prompts.md`,
      target_duration_minutes: targetDurationMinutes,
      target_word_count: targetWordCount,
      quiz_config: {
        question_count: selectedQuestionCount,
        quiz_format: candidate.quiz_format,
        age_band: candidate.age_band,
        answer_mode: "voice_and_reveal",
        visual_theme: candidate.quiz_format === "image_guess" ? "jungle_jamboree" : "candy_pop",
      },
      created_at: timestamp,
      updated_at: timestamp,
    });
    await this.writeJsonAtomic(path.join(episodeDirectory, "episode.json"), episode);
    await this.writeTextAtomic(path.join(episodeDirectory, "brief.md"), `# ${candidate.title}\n\n## Premise\n\n${candidate.premise}\n\n## Hook\n\n${candidate.hook}\n`);
    await Promise.all([
      this.writeTextAtomic(path.join(episodeDirectory, "research.md"), "# Research Dossier\n\nResearch has not started.\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "treatment.md"), "# Documentary Treatment\n\nTreatment has not started.\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "script.md"), "# Script\n\nScript generation has not started.\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "visual_bible.md"), "# Episode Visual Bible\n\nVisual development has not started.\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "scene_plan.md"), "# Scene Plan\n\nScene breakdown has not started.\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "dialogue_script.md"), "# Dialogue Script\n\n"),
      this.writeTextAtomic(path.join(episodeDirectory, "video_prompts.md"), "# Video Prompts\n\n"),
    ]);
    await this.writeJsonAtomic(path.join(this.resolvePath("channels", channel.slug), "topic_database.json"),
      (await this.listTopics(channelId)).map(({ title, premise }) => ({ title, premise })));
    await this.updateChannel(channelId, { updated_at: timestamp });
    return episode;
  }

  async updateEpisodeSettings(channelId: string, episodeId: string, input: EpisodeSettingsInput, wordsPerSecond: number): Promise<Episode> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const nextQuizConfig = {
      ...episode.quiz_config,
      ...(input.question_count === undefined ? {} : { question_count: input.question_count }),
      ...(input.quiz_format === undefined ? {} : { quiz_format: input.quiz_format }),
      ...(input.age_band === undefined ? {} : { age_band: input.age_band }),
      ...(input.answer_mode === undefined ? {} : { answer_mode: input.answer_mode }),
      ...(input.visual_theme === undefined ? {} : { visual_theme: input.visual_theme }),
    };
    const quizSettingsChanged = nextQuizConfig.question_count !== episode.quiz_config.question_count
      || nextQuizConfig.quiz_format !== episode.quiz_config.quiz_format
      || nextQuizConfig.age_band !== episode.quiz_config.age_band
      || nextQuizConfig.visual_theme !== episode.quiz_config.visual_theme;
    const targetDurationMinutes = input.target_duration_minutes ?? estimateQuizTargetDurationMinutes(nextQuizConfig.question_count);
    const targetWordCount = estimateQuizTargetWordCount(targetDurationMinutes, episode.measured_narration_words_per_second ?? wordsPerSecond);
    const next = EpisodeSchema.parse({
      ...episode,
      target_duration_minutes: targetDurationMinutes,
      target_word_count: targetWordCount,
      quiz_config: nextQuizConfig,
      updated_at: nowIso(),
    });
    await this.writeJsonAtomic(this.resolvePath("channels", channel.slug, "episodes", episode.slug, "episode.json"), next);
    if (quizSettingsChanged) await this.invalidateQuizSourceArtifacts(channelId, episodeId);
    return next;
  }

  async readScenes(channelId: string, episodeId: string): Promise<Scene[]> {
    const file = await this.getEpisodeFile(channelId, episodeId, "scene_plan.md");
    return parseScenes(file.content, episodeId);
  }

  async listBundleImages(channelId: string, episodeId: string): Promise<BundleImageAsset[]> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const directory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", "bundles");
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const images: BundleImageAsset[] = [];
    for (const entry of entries.filter((item) => item.isFile())) {
      const match = /^CB-(\d{2,})(-alt)?\.png$/i.exec(entry.name);
      if (!match) continue;
      const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", "bundles", entry.name);
      try {
        const metadata = await stat(absolutePath);
        images.push({
          bundle_id: `CB-${String(Number(match[1])).padStart(2, "0")}`,
          bundle_number: Number(match[1]),
          variant: match[2] ? 1 : 0,
          filename: entry.name,
          path: `channels/${channel.slug}/episodes/${episode.slug}/assets/bundles/${entry.name}`,
          absolutePath,
          size: metadata.size,
          modified_at: metadata.mtime.toISOString(),
        });
      } catch {
        // Ignore an image that disappeared during a refresh.
      }
    }
    return images.sort((a, b) => a.bundle_number - b.bundle_number || a.variant - b.variant);
  }

  async getBundleImagePath(channelId: string, episodeId: string, bundleNumber: number, variant = 0): Promise<{ bundle_id: string; filename: string; path: string; absolutePath: string }> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const filename = `CB-${String(this.assertBundleNumber(bundleNumber)).padStart(2, "0")}${variant === 1 ? "-alt" : ""}.png`;
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", "bundles", filename);
    return { bundle_id: `CB-${String(bundleNumber).padStart(2, "0")}`, filename, path: `channels/${channel.slug}/episodes/${episode.slug}/assets/bundles/${filename}`, absolutePath };
  }

  async getBundleImageFile(channelId: string, episodeId: string, filename: string): Promise<BundleImageAsset> {
    if (!/^CB-\d{2,}(?:-alt)?\.png$/i.test(filename)) throw new RepositoryError("Unsupported image asset", "FILE_NOT_ALLOWED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", "bundles", filename);
    try {
      await this.assertRealPathInside(path.dirname(absolutePath), absolutePath);
      const metadata = await stat(absolutePath);
      const bundleNumber = Number(/^CB-(\d+)/i.exec(filename)?.[1] ?? 0);
      return { bundle_id: `CB-${String(bundleNumber).padStart(2, "0")}`, bundle_number: bundleNumber, variant: /-alt\.png$/i.test(filename) ? 1 : 0, filename, path: `channels/${channel.slug}/episodes/${episode.slug}/assets/bundles/${filename}`, absolutePath, size: metadata.size, modified_at: metadata.mtime.toISOString() };
    } catch {
      throw new RepositoryError("Image asset not found", "IMAGE_NOT_FOUND");
    }
  }

  async writeBundleImage(channelId: string, episodeId: string, bundleNumber: number, content: Uint8Array, variant = 0): Promise<string> {
    if (!isPng(content)) throw new RepositoryError("Image output is not a PNG file", "INVALID_IMAGE");
    const target = await this.getBundleImagePath(channelId, episodeId, bundleNumber, variant);
    const directory = path.dirname(target.absolutePath);
    const episodeDirectory = path.dirname(directory);
    await mkdir(directory, { recursive: true });
    await this.assertRealPathInside(episodeDirectory, directory);
    await this.writeBinaryAtomic(target.absolutePath, content);
    return target.path;
  }

  async writeBundleImageFromFile(channelId: string, episodeId: string, bundleNumber: number, sourcePath: string, variant = 0): Promise<string> {
    const resolvedSource = path.resolve(sourcePath);
    const sourceRoot = [this.rootDirectory, this.storageRoot].find((root) => this.isInside(root, resolvedSource));
    if (!sourceRoot) throw new RepositoryError("Codex image path is outside the studio workspace", "UNSAFE_PATH");
    await this.assertRealPathInside(sourceRoot, resolvedSource);
    return this.writeBundleImage(channelId, episodeId, bundleNumber, await readFile(resolvedSource), variant);
  }

  async clearBundleImages(channelId: string, episodeId: string, bundleNumber: number): Promise<void> {
    const images = await this.listBundleImages(channelId, episodeId);
    const id = `CB-${String(this.assertBundleNumber(bundleNumber)).padStart(2, "0")}`;
    await Promise.all(images.filter((image) => image.bundle_id === id).map((image) => rm(image.absolutePath, { force: true })));
  }

  async attachBundleReference(channelId: string, episodeId: string, bundleId: string, assetPath: string): Promise<number> {
    const scenes = await this.readScenes(channelId, episodeId);
    const matching = scenes.filter((scene) => scene.continuity_bundle_id.toUpperCase() === bundleId.toUpperCase());
    if (matching.length === 0) return 0;
    const next = scenes.map((scene) => scene.continuity_bundle_id.toUpperCase() === bundleId.toUpperCase()
      ? SceneSchema.parse({ ...scene, reference_asset_ids: [...new Set([...scene.reference_asset_ids, assetPath])] })
      : scene);
    await this.saveScenes(channelId, episodeId, next);
    return matching.length;
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
    const scenesChanged = JSON.stringify(withFreshAudio) !== JSON.stringify(previousScenes);
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    await this.writeTextAtomic(path.join(episodeDirectory, "scene_plan.md"), serializeScenes(withFreshAudio));
    await this.writeTextAtomic(path.join(episodeDirectory, "dialogue_script.md"), serializeDialogue(withFreshAudio));
    await this.writeTextAtomic(path.join(episodeDirectory, "video_prompts.md"), serializePrompts(withFreshAudio));
    await this.writeJsonAtomic(path.join(episodeDirectory, "episode.json"), EpisodeSchema.parse({ ...episode, stage: "SCENE_READY", updated_at: nowIso() }));
    if (scenesChanged) await this.invalidateQuizSourceArtifacts(channelId, episodeId);
  }

  private async invalidateQuizSourceArtifacts(channelId: string, episodeId: string): Promise<void> {
    const channel = await this.getChannel(channelId);
    if (channel.engine !== "quiz") return;
    await this.invalidateQuizArtifacts(channelId, episodeId, quizInvalidationStages("research"));
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

  async writeNarrationAudio(channelId: string, episodeId: string, content: Uint8Array, segmentNumber?: number): Promise<string> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    await this.assertRealPathInside(episodeDirectory, assetsDirectory);
    const filename = segmentNumber ? `narration-${String(segmentNumber).padStart(2, "0")}.wav` : "narration.wav";
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", filename);
    await this.writeBinaryAtomic(absolutePath, content);
    return `channels/${channel.slug}/episodes/${episode.slug}/assets/${filename}`;
  }

  async writeQuizVoiceSegmentAudio(channelId: string, episodeId: string, segmentNumber: number, content: Uint8Array, version = ""): Promise<string> {
    if (!Number.isInteger(segmentNumber) || segmentNumber < 1 || segmentNumber > 999) throw new RepositoryError("Quiz voice segment number is invalid", "INVALID_SEGMENT");
    if (version && !/^[a-z0-9-]{1,40}$/.test(version)) throw new RepositoryError("Quiz voice segment version is invalid", "INVALID_SEGMENT");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    const voiceDirectory = path.join(assetsDirectory, "quiz-voice");
    await mkdir(voiceDirectory, { recursive: true });
    await this.assertRealPathInside(episodeDirectory, voiceDirectory);
    const filename = `segment-${String(segmentNumber).padStart(3, "0")}${version ? `-${version}` : ""}.wav`;
    const absolutePath = path.join(voiceDirectory, filename);
    await this.writeBinaryAtomic(absolutePath, content);
    return `channels/${channel.slug}/episodes/${episode.slug}/assets/quiz-voice/${filename}`;
  }

  async writeQuizNarrationAudio(channelId: string, episodeId: string, content: Uint8Array): Promise<string> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    await this.assertRealPathInside(episodeDirectory, assetsDirectory);
    const filename = `quiz-narration-${Date.now()}.wav`;
    const absolutePath = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets", filename);
    await this.writeBinaryAtomic(absolutePath, content);
    return `channels/${channel.slug}/episodes/${episode.slug}/assets/${filename}`;
  }

  async getQuizVoiceSegmentAudioFile(channelId: string, episodeId: string, segmentNumber: number, version = ""): Promise<{ absolutePath: string; path: string; size: number; modified_at: string }> {
    if (!Number.isInteger(segmentNumber) || segmentNumber < 1 || segmentNumber > 999) throw new RepositoryError("Quiz voice segment number is invalid", "INVALID_SEGMENT");
    if (version && !/^[a-z0-9-]{1,40}$/.test(version)) throw new RepositoryError("Quiz voice segment version is invalid", "INVALID_SEGMENT");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    const voiceDirectory = path.join(assetsDirectory, "quiz-voice");
    const filename = `segment-${String(segmentNumber).padStart(3, "0")}${version ? `-${version}` : ""}.wav`;
    const absolutePath = path.join(voiceDirectory, filename);
    try {
      await this.assertRealPathInside(assetsDirectory, absolutePath);
      const metadata = await stat(absolutePath);
      return { absolutePath, path: `channels/${channel.slug}/episodes/${episode.slug}/assets/quiz-voice/${filename}`, size: metadata.size, modified_at: metadata.mtime.toISOString() };
    } catch {
      throw new RepositoryError("Quiz voice segment not found", "AUDIO_NOT_FOUND");
    }
  }

  async writeVideoArtifact(channelId: string, episodeId: string, content: Uint8Array, filename = "quiz-video.mp4"): Promise<string> {
    if (!/^[a-z0-9][a-z0-9._-]*\.mp4$/i.test(filename)) throw new RepositoryError("Unsupported video file", "FILE_NOT_ALLOWED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    await this.assertRealPathInside(this.resolvePath("channels", channel.slug, "episodes", episode.slug), assetsDirectory);
    const absolutePath = path.join(assetsDirectory, filename);
    await this.writeBinaryAtomic(absolutePath, content);
    return `channels/${channel.slug}/episodes/${episode.slug}/assets/${filename}`;
  }

  async getEpisodeVideoFile(channelId: string, episodeId: string, filename = "quiz-video.mp4"): Promise<{ absolutePath: string; path: string; size: number; modified_at: string }> {
    if (!/^[a-z0-9][a-z0-9._-]*\.mp4$/i.test(filename)) throw new RepositoryError("Unsupported video file", "FILE_NOT_ALLOWED");
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    const absolutePath = path.join(assetsDirectory, filename);
    try {
      await this.assertRealPathInside(assetsDirectory, absolutePath);
      const metadata = await stat(absolutePath);
      return { absolutePath, path: `channels/${channel.slug}/episodes/${episode.slug}/assets/${filename}`, size: metadata.size, modified_at: metadata.mtime.toISOString() };
    } catch {
      throw new RepositoryError("Video asset not found", "VIDEO_NOT_FOUND");
    }
  }

  async writeRenderManifest(channelId: string, episodeId: string, content: string): Promise<string> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const assetsDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    const absolutePath = path.join(assetsDirectory, "render-manifest.json");
    await this.writeTextAtomic(absolutePath, content.endsWith("\n") ? content : `${content}\n`);
    return `channels/${channel.slug}/episodes/${episode.slug}/assets/render-manifest.json`;
  }

  async saveVideoMetadata(channelId: string, episodeId: string, assetPath: string, durationSeconds: number, renderManifestPath: string): Promise<Episode> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const next = EpisodeSchema.parse({
      ...episode,
      stage: "VIDEO_READY",
      video_asset_path: assetPath,
      video_generated_at: nowIso(),
      video_duration_seconds: durationSeconds,
      render_manifest_path: renderManifestPath,
      updated_at: nowIso(),
    });
    await this.writeJsonAtomic(this.resolvePath("channels", channel.slug, "episodes", episode.slug, "episode.json"), next);
    return next;
  }

  async getEpisodeAudioFile(channelId: string, episodeId: string, filename: string): Promise<{ absolutePath: string; path: string; size: number; modified_at: string }> {
    if (!/^(?:scene-\d{2,}|narration(?:-\d{2,})?|quiz-narration-\d+)\.wav$/i.test(filename)) throw new RepositoryError("Unsupported audio file", "FILE_NOT_ALLOWED");
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

  async saveNarrationMetadata(channelId: string, episodeId: string, assetPath: string, durationSeconds: number, segmentCount: number, narrationWordCount: number): Promise<Episode> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const measuredPace = narrationWordCount / Math.max(0.1, durationSeconds);
    const calibratedWordTarget = Math.round(episode.target_duration_minutes * 60 * measuredPace * 0.95);
    const next = EpisodeSchema.parse({
      ...episode,
      stage: episode.stage === "SCENE_READY" ? "READY_FOR_GENERATION" : "NARRATION_READY",
      narration_asset_path: assetPath,
      narration_generated_at: nowIso(),
      narration_duration_seconds: durationSeconds,
      narration_segment_count: segmentCount,
      measured_narration_words_per_second: measuredPace,
      target_word_count: calibratedWordTarget,
      updated_at: nowIso(),
    });
    await this.writeJsonAtomic(this.resolvePath("channels", channel.slug, "episodes", episode.slug, "episode.json"), next);
    return next;
  }

  async clearSequenceDrafts(episodeId: string): Promise<void> {
    await this.removeTree(this.resolvePath("runtime", "shot-drafts", episodeId));
  }

  async saveSequenceDraft(episodeId: string, sequenceNumber: number, scenes: Scene[]): Promise<void> {
    const directory = this.resolvePath("runtime", "shot-drafts", episodeId);
    await mkdir(directory, { recursive: true });
    const normalized = scenes.map((scene, index) => SceneSchema.parse({ ...scene, episode_id: episodeId, scene_number: index + 1 }));
    await this.writeJsonAtomic(path.join(directory, `sequence-${String(sequenceNumber).padStart(2, "0")}.json`), normalized);
  }

  async readSequenceDrafts(episodeId: string): Promise<Array<{ sequenceNumber: number; scenes: Scene[]; modified_at: string }>> {
    const directory = this.resolvePath("runtime", "shot-drafts", episodeId);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const drafts: Array<{ sequenceNumber: number; scenes: Scene[]; modified_at: string }> = [];
    for (const entry of entries.filter((item) => item.isFile() && /^sequence-\d+\.json$/i.test(item.name))) {
      const sequenceNumber = Number(entry.name.match(/\d+/)?.[0]);
      try {
        const filePath = path.join(directory, entry.name);
        const [payload, metadata] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
        drafts.push({ sequenceNumber, scenes: SceneSchema.array().parse(JSON.parse(payload) as unknown), modified_at: metadata.mtime.toISOString() });
      } catch {
        // An incomplete draft remains isolated and cannot corrupt the committed scene plan.
      }
    }
    return drafts.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async commitSequenceDrafts(channelId: string, episodeId: string, expectedCount: number): Promise<boolean> {
    const drafts = await this.readSequenceDrafts(episodeId);
    if (drafts.length !== expectedCount || drafts.some((draft, index) => draft.sequenceNumber !== index + 1)) return false;
    await this.saveScenes(channelId, episodeId, drafts.flatMap((draft) => draft.scenes));
    await this.clearSequenceDrafts(episodeId);
    return true;
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

  private assertBundleNumber(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 99) throw new RepositoryError("Bundle number must be between 1 and 99", "INVALID_BUNDLE");
    return value;
  }

  slugify(input: string): string {
    const normalized = input.trim().replaceAll("đ", "d").replaceAll("Đ", "D").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
    if (!slug) throw new RepositoryError("Name cannot produce a safe slug", "EMPTY_SLUG");
    return slug;
  }

  private async readQuizArtifact<T>(channelId: string, episodeId: string, filename: "quiz-v2.json" | "director-plan.json" | "asset-plan.json" | "asset-resolution.json" | "voice-plan.json" | "timeline.json" | "qa.json", schema: { parse(value: unknown): T }): Promise<T | null> {
    const target = await this.quizArtifactTarget(channelId, episodeId, filename);
    try {
      const raw = JSON.parse(await readFile(target.absolutePath, "utf8")) as unknown;
      return schema.parse(raw);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") return null;
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError("Quiz artifact " + filename + " is malformed", "QUIZ_ARTIFACT_INVALID");
    }
  }

  private async writeQuizArtifact<T>(channelId: string, episodeId: string, filename: "quiz-v2.json" | "director-plan.json" | "asset-plan.json" | "asset-resolution.json" | "voice-plan.json" | "timeline.json" | "qa.json", value: T): Promise<string> {
    const target = await this.quizArtifactTarget(channelId, episodeId, filename);
    await this.writeJsonAtomic(target.absolutePath, value);
    return target.relativePath;
  }

  private async quizArtifactTarget(channelId: string, episodeId: string, filename: "quiz-v2.json" | "director-plan.json" | "asset-plan.json" | "asset-resolution.json" | "voice-plan.json" | "timeline.json" | "qa.json"): Promise<{ absolutePath: string; relativePath: string }> {
    const episode = await this.getEpisode(channelId, episodeId);
    const channel = await this.getChannel(channelId);
    const episodeDirectory = this.resolvePath("channels", channel.slug, "episodes", episode.slug);
    await this.assertRealPathInside(this.roots.channels, episodeDirectory);
    const absolutePath = path.join(episodeDirectory, "quiz", filename);
    return { absolutePath, relativePath: ["channels", channel.slug, "episodes", episode.slug, "quiz", filename].join("/") };
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

  private async markTopicSelected(channelId: string, topicId: string, questionCount: number): Promise<void> {
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
          return { ...topic, question_count: questionCount, selected: true };
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

function isPng(content: Uint8Array): boolean {
  return content.length >= 8 && content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47 && content[4] === 0x0d && content[5] === 0x0a && content[6] === 0x1a && content[7] === 0x0a;
}

export function parseScenes(markdown: string, episodeId: string): Scene[] {
  const blocks = markdown.split(/^# Scene\s+\d+\s*$/gim).slice(1);
  return blocks.map((block, index) => {
    const duration = Number(block.match(/\*\*Duration:\*\*\s*([\d.]+)/i)?.[1] ?? 6);
    const dialogue = block.match(/## Dialogue\s*\n([\s\S]*?)(?=\n## Video Prompt|$)/i)?.[1]?.trim() ?? "";
    const prompt = block.match(/## Video Prompt\s*\n([\s\S]*?)(?=\n## Notes|$)/i)?.[1]?.trim() ?? "";
    const notes = block.match(/## Notes\s*\n([\s\S]*?)(?=\n<!--|$)/i)?.[1] ?? "";
    const transition = notes.match(/- Transition:[ \t]*(.*)/i)?.[1]?.trim() ?? "";
    const continuity = stripEditorialOverlayInstructions(notes.match(/- Continuity:[ \t]*(.*)/i)?.[1]?.trim() ?? "");
    const sequenceLine = notes.match(/- Sequence:[ \t]*(.*)/i)?.[1]?.trim() ?? "sequence-1 | Sequence 1";
    const [sequenceId, ...sequenceTitleParts] = sequenceLine.split("|").map((value) => value.trim());
    const listValue = (label: string) => (notes.match(new RegExp(`- ${label}:[ \\t]*(.*)`, "i"))?.[1] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const audioAssetPath = block.match(/<!--\s*Audio asset:\s*(.*?)\s*-->/i)?.[1]?.trim() || null;
    const audioGeneratedAt = block.match(/<!--\s*Audio generated at:\s*(.*?)\s*-->/i)?.[1]?.trim() || null;
    const audioDuration = block.match(/<!--\s*Audio duration:\s*([\d.]+)\s*-->/i)?.[1];
    const overlayData = parseOverlayData(notes.match(/- Overlay data:[ \t]*(.*)/i)?.[1] ?? "");
    const quizData = parseQuizData(notes.match(/- Quiz data:[ \t]*(.*)/i)?.[1] ?? "");
    return SceneSchema.parse({
      scene_id: `${episodeId}_scene_${index + 1}`,
      episode_id: episodeId,
      scene_number: index + 1,
      duration_seconds: duration,
      dialogue,
      visual_prompt: stripEditorialOverlayInstructions(prompt),
      transition_note: transition,
      continuity_note: continuity,
      sequence_id: sequenceId || "sequence-1",
      sequence_title: sequenceTitleParts.join(" | ") || "Sequence 1",
      shot_id: notes.match(/- Shot:[ \t]*(.*)/i)?.[1]?.trim() ?? `shot-${index + 1}`,
      asset_type: notes.match(/- Asset type:[ \t]*(.*)/i)?.[1]?.trim() || "ai_reconstruction",
      continuity_bundle_id: notes.match(/- Continuity bundle:[ \t]*(.*)/i)?.[1]?.trim() ?? "",
      reference_asset_ids: listValue("Reference assets"),
      source_ids: listValue("Source IDs"),
      reconstruction: !/^no$/i.test(notes.match(/- Reconstruction:[ \t]*(.*)/i)?.[1]?.trim() ?? "yes"),
      sound_cue: notes.match(/- Sound:[ \t]*(.*)/i)?.[1]?.trim() ?? "",
      editorial_overlay: {
        kind: notes.match(/- Overlay kind:[ \t]*(.*)/i)?.[1]?.trim() || "none",
        text: notes.match(/- Overlay text:[ \t]*(.*)/i)?.[1]?.trim() ?? "",
        motion: notes.match(/- Overlay motion:[ \t]*(.*)/i)?.[1]?.trim() || "none",
        placement: notes.match(/- Overlay placement:[ \t]*(.*)/i)?.[1]?.trim() || "lower_third",
        duration_seconds: Number(notes.match(/- Overlay duration:[ \t]*([\d.]+)/i)?.[1] ?? 0) || null,
        data: overlayData,
        source_ids: listValue("Overlay sources"),
      },
      quiz: quizData,
      audio_asset_path: audioAssetPath,
      audio_generated_at: audioGeneratedAt,
      audio_duration_seconds: audioDuration ? Number(audioDuration) : null,
    });
  });
}

export function serializeScenes(scenes: Scene[]): string {
  scenes = scenes.map((scene) => SceneSchema.parse(scene));
  return scenes.map((scene) => `${[
    `# Scene ${scene.scene_number}`,
    `**Duration:** ${scene.duration_seconds} seconds`,
    "## Dialogue",
    scene.dialogue.trim(),
    "## Video Prompt",
    stripEditorialOverlayInstructions(scene.visual_prompt.trim()),
    "## Notes",
    `- Transition: ${scene.transition_note.trim()}`,
    `- Continuity: ${stripEditorialOverlayInstructions(scene.continuity_note.trim())}`,
    `- Sequence: ${scene.sequence_id.trim()} | ${scene.sequence_title.trim()}`,
    `- Shot: ${scene.shot_id.trim() || `shot-${scene.scene_number}`}`,
    `- Asset type: ${scene.asset_type}`,
    `- Continuity bundle: ${scene.continuity_bundle_id.trim()}`,
    `- Reference assets: ${scene.reference_asset_ids.join(", ")}`,
    `- Source IDs: ${scene.source_ids.join(", ")}`,
    `- Reconstruction: ${scene.reconstruction ? "yes" : "no"}`,
    `- Sound: ${scene.sound_cue.trim()}`,
    `- Overlay kind: ${scene.editorial_overlay.kind}`,
    `- Overlay text: ${scene.editorial_overlay.text.replace(/\s+/g, " ").trim()}`,
    `- Overlay motion: ${scene.editorial_overlay.motion}`,
    `- Overlay placement: ${scene.editorial_overlay.placement}`,
    `- Overlay duration: ${scene.editorial_overlay.duration_seconds ?? ""}`,
    `- Overlay data: ${JSON.stringify(scene.editorial_overlay.data)}`,
    `- Overlay sources: ${scene.editorial_overlay.source_ids.join(", ")}`,
    `- Quiz data: ${JSON.stringify(scene.quiz)}`,
    scene.audio_asset_path ? `<!-- Audio asset: ${scene.audio_asset_path} -->\n<!-- Audio generated at: ${scene.audio_generated_at ?? ""} -->\n<!-- Audio duration: ${scene.audio_duration_seconds ?? ""} -->` : "",
  ].join("\n\n")}\n`).join("\n");
}

export function serializeDialogue(scenes: Scene[]): string {
  scenes = scenes.map((scene) => SceneSchema.parse(scene));
  return `# Narration Timeline\n\n${scenes.map((scene) => `## Shot ${scene.scene_number} — ${scene.sequence_title}\n\n**Duration:** ${scene.duration_seconds}s\n\n${scene.dialogue.trim()}`).join("\n\n")}\n`;
}

export function serializePrompts(scenes: Scene[]): string {
  scenes = scenes.map((scene) => SceneSchema.parse(scene));
  return `# Video Prompts\n\n${scenes.map((scene) => `## Shot ${scene.scene_number} — ${scene.sequence_title}\n\n- Asset type: ${scene.asset_type}\n- Continuity bundle: ${scene.continuity_bundle_id}\n- Reference assets: ${scene.reference_asset_ids.join(", ")}\n- Source IDs: ${scene.source_ids.join(", ")}\n- Editorial overlay: ${scene.editorial_overlay.kind} / ${scene.editorial_overlay.motion} / ${scene.editorial_overlay.placement}\n- Overlay text: ${scene.editorial_overlay.text.replace(/\s+/g, " ").trim()}\n- Overlay data: ${JSON.stringify(scene.editorial_overlay.data)}\n\n${stripEditorialOverlayInstructions(scene.visual_prompt.trim())}`).join("\n\n")}\n`;
}

function parseOverlayData(value: string): Array<{ label: string; value: string | number; unit: string }> {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { label?: unknown; value?: unknown; unit?: unknown } => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({ label: String(item.label ?? ""), value: typeof item.value === "number" ? item.value : String(item.value ?? ""), unit: String(item.unit ?? "") }))
      .filter((item) => item.label && item.value !== "");
  } catch {
    return [];
  }
}

function parseQuizData(value: string): Scene["quiz"] {
  if (!value.trim() || value.trim() === "null") return null;
  try { return SceneSchema.shape.quiz.parse(JSON.parse(value)); } catch { return null; }
}
