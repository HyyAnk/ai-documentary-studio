import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { VoicePlanSchema, type AppConfig, type QuizTimeline, type VoiceSegment, type VoiceSegmentRole, type VoicePlan } from "@studio/shared";
import type { RepositoryService } from "../../repository.js";
import { synthesizeWav } from "../../providers/chatterbox.js";
import { audioDiagnosticsForTimeline, type VoiceAudioDiagnostics } from "./audioDiagnostics.js";
import { countQuizVoiceWords, quizVoicePacingLimit } from "./voicePolicy.js";

const execFileAsync = promisify(execFile);
export const QUIZ_VOICE_PACING_VERSION = "paced-v12-age-targeted-performance";

export type MeasuredQuizVoice = {
  voicePlan: VoicePlan;
  segmentPaths: Map<string, string>;
};

export const MIN_QUIZ_VOICE_SLOWDOWN_TEMPO = 0.85;

export type QuizVoicePacingClamp = {
  segment_id: string;
  role: VoiceSegmentRole;
  actual: number;
  pacingLimit: number;
  appliedTempo: number;
};

export function quizVoicePaceCorrectionTempo(actual: number, pacingLimit: number): number {
  if (!Number.isFinite(actual) || actual <= pacingLimit) return 1;
  return Math.max(MIN_QUIZ_VOICE_SLOWDOWN_TEMPO, pacingLimit / actual);
}

export async function synthesizeQuizVoiceSegments(input: {
  repository: RepositoryService;
  config: AppConfig["audio_generation"];
  channelId: string;
  episodeId: string;
  voicePlan: VoicePlan;
  targetWordsPerSecond: number;
  onProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void;
  onPacingClamp?: (details: QuizVoicePacingClamp) => Promise<void> | void;
}): Promise<MeasuredQuizVoice> {
  const channel = await input.repository.getChannel(input.channelId);
  const voice = channel.voice_reference_path ? input.repository.resolveContextPath(channel.voice_reference_path) : "default";
  const cache = new Map<string, { duration: number; absolutePath: string }>();
  const segmentPaths = new Map<string, string>();
  const segments: VoicePlan["segments"] = [];
  const pacingDirectory = input.repository.resolvePath("runtime", "quiz-voice", input.episodeId);
  await mkdir(pacingDirectory, { recursive: true });
  const pacingLimit = quizVoicePacingLimit(input.targetWordsPerSecond);
  for (const [index, segment] of input.voicePlan.segments.entries()) {
    const tempo = quizVoiceTempo(segment.role);
    const fingerprint = quizVoiceFingerprint(segment, tempo, voice, input.config, input.targetWordsPerSecond);
    const key = fingerprint;
      const pacingVersion = `${segment.role === "outro" ? "paced-v12-outro" : "paced-v12"}-${fingerprint.slice(0, 20)}`;
    let rendered = cache.get(key);
    let reused = Boolean(rendered);
    if (!rendered) {
      const existing = await input.repository.getQuizVoiceSegmentAudioFile(input.channelId, input.episodeId, index + 1, pacingVersion).catch(() => null);
      if (existing) {
        try {
          const audio = new Uint8Array(await readFile(existing.absolutePath));
          const duration = wavDurationSeconds(audio);
          if (duration > 0.05 && segmentPace(segment, duration) <= pacingLimit) {
            rendered = { duration, absolutePath: existing.absolutePath };
            reused = true;
          }
        } catch {
          // A corrupt cache entry is regenerated below.
        }
      }
      if (!rendered) {
        const sourceAudio = await renderPerformanceSegment(input.config, segment, voice, pacingDirectory, index + 1);
        const audio = await enforceQuizVoicePace(sourceAudio, segment, pacingLimit, pacingDirectory, index + 1, input.onPacingClamp);
        const duration = wavDurationSeconds(audio);
        const assetPath = await input.repository.writeQuizVoiceSegmentAudio(input.channelId, input.episodeId, index + 1, audio, pacingVersion);
        rendered = { duration, absolutePath: input.repository.resolveContextPath(assetPath) };
      }
      cache.set(key, rendered);
    }
    segmentPaths.set(segment.segment_id, rendered.absolutePath);
    segments.push({ ...segment, duration_seconds: rendered.duration });
    await input.onProgress?.({ completed: index + 1, total: input.voicePlan.segments.length, reused });
  }
  return { voicePlan: VoicePlanSchema.parse({ ...input.voicePlan, segments }), segmentPaths };
}

export function quizVoiceTempo(role: VoicePlan["segments"][number]["role"]): number {
  if (role === "question" || role === "choice") return 1.1;
  if (role === "reveal") return 1.08;
  if (role === "explanation" || role === "fun_fact") return 1;
  if (role === "thinking_prompt") return 1.04;
  if (role === "intro" || role === "midpoint" || role === "outro") return 1.06;
  return 1;
}

export function quizVoiceFingerprint(segment: VoiceSegment, tempo: number, voice: string, config: AppConfig["audio_generation"], targetWordsPerSecond = 0): string {
  const performance = voicePerformanceConfig(config, segment.role);
  return createHash("sha256").update(JSON.stringify({
    version: QUIZ_VOICE_PACING_VERSION,
    segment_id: segment.segment_id,
    role: segment.role,
    question_id: segment.question_id,
    text: segment.text.trim().replace(/\s+/g, " "),
    phrases: segment.phrases,
    tempo,
    targetWordsPerSecond,
    voice,
    provider: config.provider,
    service_url: config.service_url,
    exaggeration: performance.exaggeration,
    cfg_weight: performance.cfg_weight,
  })).digest("hex");
}

/** Only controls supported by the local Chatterbox adapter are used here. */
export function voicePerformanceConfig(config: AppConfig["audio_generation"], role: VoiceSegmentRole): AppConfig["audio_generation"] {
  const settings: Record<VoiceSegmentRole, { exaggeration: number; cfg_weight: number }> = {
    intro: { exaggeration: .58, cfg_weight: .48 },
    question: { exaggeration: .54, cfg_weight: .5 },
    choice: { exaggeration: .48, cfg_weight: .52 },
    thinking_prompt: { exaggeration: .62, cfg_weight: .44 },
    countdown: { exaggeration: .5, cfg_weight: .5 },
    reveal: { exaggeration: .66, cfg_weight: .38 },
    explanation: { exaggeration: .42, cfg_weight: .56 },
    fun_fact: { exaggeration: .4, cfg_weight: .58 },
    midpoint: { exaggeration: .55, cfg_weight: .48 },
    outro: { exaggeration: .56, cfg_weight: .48 },
  };
  return { ...config, ...settings[role] };
}

async function renderPerformanceSegment(config: AppConfig["audio_generation"], segment: VoiceSegment, voice: string, directory: string, segmentNumber: number): Promise<Uint8Array> {
  const phrases = segment.phrases.length ? segment.phrases : [{ text: segment.text, delivery: "normal" as const, pause_after: "none" as const }];
  const phrasePaths: string[] = [];
  try {
    for (const [phraseIndex, phrase] of phrases.entries()) {
      const raw = await synthesizeWav(voicePerformanceConfig(config, segment.role), phrase.text, voice);
      const paced = await paceQuizVoiceAudio(raw, quizVoiceTempo(segment.role), directory, segmentNumber * 100 + phraseIndex + 1, segment.role === "reveal" ? 1.5 : 0);
      const phrasePath = path.join(directory, `segment-${String(segmentNumber).padStart(3, "0")}-phrase-${phraseIndex + 1}.wav`);
      await writeFile(phrasePath, paced);
      phrasePaths.push(phrasePath);
    }
    if (phrasePaths.length === 1) return new Uint8Array(await readFile(phrasePaths[0]!));
    return await concatenatePerformancePhrases(phrasePaths, phrases, directory, segmentNumber);
  } finally {
    await Promise.all(phrasePaths.map((file) => rm(file, { force: true })));
  }
}

async function concatenatePerformancePhrases(paths: string[], phrases: VoiceSegment["phrases"], directory: string, segmentNumber: number): Promise<Uint8Array> {
  const outputPath = path.join(directory, `segment-${String(segmentNumber).padStart(3, "0")}-joined.wav`);
  const args: string[] = ["-y"];
  const filters: string[] = [];
  const chain: string[] = [];
  let inputIndex = 0;
  for (const [index, phrasePath] of paths.entries()) {
    args.push("-i", phrasePath);
    const label = `phrase${index}`;
    filters.push(`[${inputIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo[${label}]`);
    chain.push(`[${label}]`);
    inputIndex += 1;
    const pauseClass = phrases[index]?.pause_after ?? "none";
    if (index < paths.length - 1 && pauseClass !== "none") {
      const seconds = pauseSeconds(pauseClass, segmentNumber, index);
      const gapLabel = `gap${index}`;
      filters.push(`anullsrc=r=48000:cl=stereo:d=${seconds.toFixed(3)}[${gapLabel}]`);
      chain.push(`[${gapLabel}]`);
    }
  }
  filters.push(`${chain.join("")}concat=n=${chain.length}:v=0:a=1,asetpts=N/SR/TB[out]`);
  try {
    await execFileAsync("ffmpeg", [...args, "-filter_complex", filters.join(";"), "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outputPath], { timeout: 2 * 60_000, windowsHide: true });
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(outputPath, { force: true });
  }
}

function pauseSeconds(pauseClass: "micro" | "phrase" | "anticipation" | "none", segmentNumber: number, phraseIndex: number): number {
  if (pauseClass === "none") return 0;
  const variation = ((segmentNumber + phraseIndex) % 3) * .018;
  if (pauseClass === "micro") return .09 + variation;
  if (pauseClass === "phrase") return .15 + variation;
  return .2 + variation;
}

async function paceQuizVoiceAudio(audio: Uint8Array, tempo: number, directory: string, segmentNumber: number, gainDb = 0): Promise<Uint8Array> {
  if (tempo === 1 && gainDb === 0) return audio;
  const base = `segment-${String(segmentNumber).padStart(3, "0")}`;
  const inputPath = path.join(directory, `${base}-source.wav`);
  const outputPath = path.join(directory, `${base}-paced.wav`);
  try {
    await writeFile(inputPath, audio);
    const filters = atempoFilters(tempo);
    if (gainDb !== 0) filters.push(`volume=${Math.pow(10, gainDb / 20).toFixed(4)}`);
    await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-filter:a", filters.join(","), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outputPath], { timeout: 2 * 60_000, windowsHide: true });
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await Promise.all([rm(inputPath, { force: true }), rm(outputPath, { force: true })]);
  }
}

function segmentPace(segment: VoiceSegment, duration: number): number {
  if (segment.role === "countdown") return 0;
  return countQuizVoiceWords(segment.text) / Math.max(0.1, duration);
}

async function enforceQuizVoicePace(audio: Uint8Array, segment: VoiceSegment, pacingLimit: number, directory: string, segmentNumber: number, onPacingClamp?: (details: QuizVoicePacingClamp) => Promise<void> | void): Promise<Uint8Array> {
  const actual = segmentPace(segment, wavDurationSeconds(audio));
  if (actual <= pacingLimit) return audio;
  const requestedTempo = pacingLimit / actual;
  const tempo = quizVoicePaceCorrectionTempo(actual, pacingLimit);
  if (requestedTempo < MIN_QUIZ_VOICE_SLOWDOWN_TEMPO) {
    await onPacingClamp?.({
      segment_id: segment.segment_id,
      role: segment.role,
      actual: Number(actual.toFixed(3)),
      pacingLimit: Number(pacingLimit.toFixed(3)),
      appliedTempo: Number(tempo.toFixed(3)),
    });
  }
  return paceQuizVoiceAudio(audio, tempo, directory, segmentNumber * 1000 + 7);
}

function atempoFilters(tempo: number): string[] {
  if (!Number.isFinite(tempo) || tempo <= 0) throw new Error("Quiz voice tempo must be positive");
  const filters: string[] = [];
  let remaining = tempo;
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  if (Math.abs(remaining - 1) > 0.0001) filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters;
}

export async function assembleQuizNarration(input: {
  repository: RepositoryService;
  channelId: string;
  episodeId: string;
  voicePlan: VoicePlan;
  timeline: QuizTimeline;
  segmentPaths: Map<string, string>;
}): Promise<{ assetPath: string; durationSeconds: number; diagnostics: VoiceAudioDiagnostics }> {
  const narrationEvents = input.timeline.events.filter((event) => event.type === "narration.segment" && event.segment_id).sort((left, right) => left.at_seconds - right.at_seconds);
  if (narrationEvents.length === 0) throw new Error("Quiz timeline has no narration segments");
  const workingDirectory = input.repository.resolvePath("runtime", "quiz-voice", input.episodeId);
  await mkdir(workingDirectory, { recursive: true });
  const outputPath = path.join(workingDirectory, "narration.wav");
  const args: string[] = ["-y"];
  const filters: string[] = [];
  for (const [index, event] of narrationEvents.entries()) {
    const source = input.segmentPaths.get(event.segment_id!);
    if (!source) throw new Error("Quiz narration source is missing for " + event.segment_id);
    args.push("-i", source);
    const delay = Math.max(0, Math.round(event.at_seconds * 1000));
    filters.push(`[${index}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${delay}|${delay},asetpts=PTS-STARTPTS[a${index}]`);
  }
  const mixInputs = ["[bed]", ...narrationEvents.map((_, index) => `[a${index}]`)].join("");
  const duration = Number(input.timeline.duration_seconds.toFixed(3));
  filters.push(`anullsrc=r=48000:cl=stereo:d=${duration}[bed]`);
  filters.push(`${mixInputs}amix=inputs=${narrationEvents.length + 1}:duration=longest:dropout_transition=0,atrim=duration=${duration},asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=7[mix]`);
  try {
    await execFileAsync("ffmpeg", [...args, "-filter_complex", filters.join(";"), "-map", "[mix]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outputPath], { timeout: 10 * 60_000, windowsHide: true });
    const audio = new Uint8Array(await readFile(outputPath));
    const assetPath = await input.repository.writeQuizNarrationAudio(input.channelId, input.episodeId, audio);
    const durationSeconds = wavDurationSeconds(audio);
    const diagnostics = audioDiagnosticsForTimeline(audio, input.timeline);
    await writeFile(path.join(workingDirectory, "narration-diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
    await input.repository.saveNarrationMetadata(input.channelId, input.episodeId, assetPath, durationSeconds, input.voicePlan.segments.length, wordCount(input.voicePlan.segments.map((segment) => segment.text).join(" ")));
    return { assetPath, durationSeconds, diagnostics };
  } finally {
    await rm(outputPath, { force: true });
  }
}

export function wavDurationSeconds(buffer: Uint8Array): number {
  if (buffer.length < 44) throw new Error("Quiz voice output is an incomplete WAV file");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (new TextDecoder().decode(buffer.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(buffer.slice(8, 12)) !== "WAVE") throw new Error("Quiz voice output is not a WAV file");
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = new TextDecoder().decode(buffer.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && size >= 16 && offset + 24 <= buffer.length) byteRate = view.getUint32(offset + 16, true);
    if (id === "data") { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) throw new Error("Quiz voice output has no duration metadata");
  return Number((dataSize / byteRate).toFixed(3));
}

function wordCount(value: string): number {
  return countQuizVoiceWords(value);
}
