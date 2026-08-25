import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { VoicePlanSchema, type AppConfig, type QuizTimeline, type VoicePauseClass, type VoiceSegment, type VoiceSegmentRole, type VoicePlan } from "@studio/shared";
import type { RepositoryService } from "../../repository.js";
import { synthesizeWav } from "../../providers/chatterbox.js";
import { runConcurrent } from "../../utils/concurrency.js";
import { audioDiagnosticsForTimeline, type VoiceAudioDiagnostics } from "./audioDiagnostics.js";
import { countQuizVoiceWords, quizVoicePacingLimit } from "./voicePolicy.js";

const execFileAsync = promisify(execFile);
export const QUIZ_VOICE_PACING_VERSION = "paced-v13-expressive-playful";

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
  const pacingDirectory = input.repository.resolvePath("runtime", "quiz-voice", input.episodeId);
  await mkdir(pacingDirectory, { recursive: true });
  const pacingLimit = quizVoicePacingLimit(input.targetWordsPerSecond);

  let completedCount = 0;
  const voiceConcurrency = Math.max(1, Math.min(4, input.config.max_concurrent_tasks || 2));

  const results = await runConcurrent(input.voicePlan.segments, voiceConcurrency, async (segment, index) => {
    const tempo = quizVoiceTempo(segment.role);
    const fingerprint = quizVoiceFingerprint(segment, tempo, voice, input.config, input.targetWordsPerSecond);
    const key = fingerprint;
    const pacingVersion = `${segment.role === "outro" ? "paced-v13-outro" : "paced-v13"}-${fingerprint.slice(0, 20)}`;
    let rendered = cache.get(key);
    let reused = Boolean(rendered);
    if (!rendered) {
      const existing = await input.repository.getQuizVoiceSegmentAudioFile(input.channelId, input.episodeId, index + 1, pacingVersion).catch(() => null);
      if (existing) {
        try {
          const audio = new Uint8Array(await readFile(existing.absolutePath));
          const duration = wavDurationSeconds(audio);
          if (duration > 0.05 && isStandardPcmWav(audio) && segmentPace(segment, duration) <= pacingLimit) {
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
    completedCount++;
    await input.onProgress?.({ completed: completedCount, total: input.voicePlan.segments.length, reused });
    return {
      segment: { ...segment, duration_seconds: rendered.duration },
      absolutePath: rendered.absolutePath,
    };
  });

  const segments: VoicePlan["segments"] = [];
  for (const item of results) {
    segments.push(item.segment);
    segmentPaths.set(item.segment.segment_id, item.absolutePath);
  }

  return { voicePlan: VoicePlanSchema.parse({ ...input.voicePlan, segments }), segmentPaths };
}

export function quizVoiceTempo(role: VoicePlan["segments"][number]["role"]): number {
  if (role === "question" || role === "choice") return 1.1;
  if (role === "reveal" || role === "intro") return 1.12;
  if (role === "explanation" || role === "fun_fact") return 1;
  if (role === "thinking_prompt") return 1.04;
  if (role === "midpoint" || role === "outro") return 1.06;
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
    intro: { exaggeration: .84, cfg_weight: .34 },
    question: { exaggeration: .62, cfg_weight: .48 },
    choice: { exaggeration: .56, cfg_weight: .50 },
    thinking_prompt: { exaggeration: .75, cfg_weight: .42 },
    countdown: { exaggeration: .60, cfg_weight: .48 },
    reveal: { exaggeration: .86, cfg_weight: .30 },
    explanation: { exaggeration: .58, cfg_weight: .52 },
    fun_fact: { exaggeration: .62, cfg_weight: .50 },
    midpoint: { exaggeration: .70, cfg_weight: .45 },
    outro: { exaggeration: .72, cfg_weight: .45 },
  };
  return { ...config, ...settings[role] };
}

async function renderPerformanceSegment(config: AppConfig["audio_generation"], segment: VoiceSegment, voice: string, directory: string, segmentNumber: number): Promise<Uint8Array> {
  const phrases = segment.phrases.length ? segment.phrases : [{ text: segment.text, delivery: "normal" as const, pause_after: "none" as const }];
  const phrasePaths: string[] = [];
  try {
    for (const [phraseIndex, phrase] of phrases.entries()) {
      const raw = await synthesizeWav(voicePerformanceConfig(config, segment.role), phrase.text, voice);
      const gainDb = segment.role === "reveal" ? 2.0 : segment.role === "intro" ? 1.5 : 0;
      const paced = await paceQuizVoiceAudio(raw, quizVoiceTempo(segment.role), directory, segmentNumber * 100 + phraseIndex + 1, gainDb);
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

export function createSilenceWav(durationSeconds: number): Uint8Array {
  const numSamples = Math.max(0, Math.round(durationSeconds * 48000));
  const dataSize = numSamples * 4;
  const buffer = new Uint8Array(44 + dataSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // "RIFF"
  buffer[0] = 0x52; buffer[1] = 0x49; buffer[2] = 0x46; buffer[3] = 0x46;
  view.setUint32(4, 36 + dataSize, true);
  // "WAVE"
  buffer[8] = 0x57; buffer[9] = 0x41; buffer[10] = 0x56; buffer[11] = 0x45;
  // "fmt "
  buffer[12] = 0x66; buffer[13] = 0x6d; buffer[14] = 0x74; buffer[15] = 0x20;
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // 2 channels
  view.setUint32(24, 48000, true); // 48000 Hz
  view.setUint32(28, 192000, true); // 192000 bytes/sec
  view.setUint16(32, 4, true); // block align
  view.setUint16(34, 16, true); // 16-bit
  // "data"
  buffer[36] = 0x64; buffer[37] = 0x61; buffer[38] = 0x74; buffer[39] = 0x61;
  view.setUint32(40, dataSize, true);
  return buffer;
}

async function concatenatePerformancePhrases(paths: string[], phrases: VoiceSegment["phrases"], directory: string, segmentNumber: number): Promise<Uint8Array> {
  const outputPath = path.join(directory, `segment-${String(segmentNumber).padStart(3, "0")}-joined.wav`);
  const concatManifestPath = path.join(directory, `segment-${String(segmentNumber).padStart(3, "0")}-concat.txt`);
  const temporaryFiles: string[] = [concatManifestPath];

  try {
    const manifestLines: string[] = [];
    for (const [index, phrasePath] of paths.entries()) {
      const normalizedPath = phrasePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
      manifestLines.push(`file '${normalizedPath}'`);
      const pauseClass = phrases[index]?.pause_after ?? "none";
      if (index < paths.length - 1 && pauseClass !== "none") {
        const seconds = pauseSeconds(pauseClass, segmentNumber, index);
        if (seconds > 0) {
          const pausePath = path.join(directory, `segment-${String(segmentNumber).padStart(3, "0")}-pause-${index}.wav`);
          await writeFile(pausePath, createSilenceWav(seconds));
          temporaryFiles.push(pausePath);
          const normalizedPause = pausePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
          manifestLines.push(`file '${normalizedPause}'`);
        }
      }
    }
    await writeFile(concatManifestPath, manifestLines.join("\n") + "\n", "utf8");

    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatManifestPath,
      "-af", "aformat=sample_rates=48000:channel_layouts=stereo,asetpts=N/SR/TB",
      "-ar", "48000",
      "-ac", "2",
      "-c:a", "pcm_s16le",
      outputPath,
    ], { timeout: 2 * 60_000, windowsHide: true });
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await Promise.all([
      rm(outputPath, { force: true }),
      ...temporaryFiles.map((file) => rm(file, { force: true })),
    ]);
  }
}

function pauseSeconds(pauseClass: VoicePauseClass, segmentNumber: number, phraseIndex: number): number {
  if (pauseClass === "none") return 0;
  if (pauseClass === "long") return 1.0;
  const variation = ((segmentNumber + phraseIndex) % 3) * .018;
  if (pauseClass === "micro") return .09 + variation;
  if (pauseClass === "anticipation") return .16 + variation;
  if (pauseClass === "phrase") return .15 + variation;
  return .2 + variation;
}

async function paceQuizVoiceAudio(audio: Uint8Array, tempo: number, directory: string, segmentNumber: number, gainDb = 0): Promise<Uint8Array> {
  const base = `segment-${String(segmentNumber).padStart(3, "0")}`;
  const inputPath = path.join(directory, `${base}-source.wav`);
  const outputPath = path.join(directory, `${base}-paced.wav`);
  try {
    await writeFile(inputPath, audio);
    const filters = atempoFilters(tempo);
    if (gainDb !== 0) filters.push(`volume=${Math.pow(10, gainDb / 20).toFixed(4)}`);
    const filterArgs = filters.length > 0 ? ["-filter:a", filters.join(",")] : [];
    await execFileAsync("ffmpeg", ["-y", "-i", inputPath, ...filterArgs, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", outputPath], { timeout: 2 * 60_000, windowsHide: true });
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
  const narrationEvents = input.timeline.events
    .filter((event) => event.type === "narration.segment" && event.segment_id)
    .sort((left, right) => left.at_seconds - right.at_seconds);
  if (narrationEvents.length === 0) throw new Error("Quiz timeline has no narration segments");

  const workingDirectory = input.repository.resolvePath("runtime", "quiz-voice", input.episodeId);
  await mkdir(workingDirectory, { recursive: true });
  const outputPath = path.join(workingDirectory, "narration.wav");
  const concatManifestPath = path.join(workingDirectory, "narration-concat.txt");
  const temporaryFiles: string[] = [concatManifestPath];

  try {
    const manifestLines: string[] = [];
    let currentPosition = 0;

    for (const [index, event] of narrationEvents.entries()) {
      const source = input.segmentPaths.get(event.segment_id!);
      if (!source) throw new Error("Quiz narration source is missing for " + event.segment_id);

      const targetStart = Number(event.at_seconds.toFixed(3));
      if (targetStart > currentPosition + 0.002) {
        const gap = Number((targetStart - currentPosition).toFixed(3));
        const silencePath = path.join(workingDirectory, `silence-${String(index).padStart(4, "0")}.wav`);
        await writeFile(silencePath, createSilenceWav(gap));
        temporaryFiles.push(silencePath);
        const normalizedSilence = silencePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
        manifestLines.push(`file '${normalizedSilence}'`);
        currentPosition = targetStart;
      }

      const normalizedSource = source.replace(/\\/g, "/").replace(/'/g, "'\\''");
      manifestLines.push(`file '${normalizedSource}'`);
      currentPosition += Number(event.duration_seconds.toFixed(3));
    }

    const totalDuration = Number(input.timeline.duration_seconds.toFixed(3));
    if (totalDuration > currentPosition + 0.002) {
      const trailingGap = Number((totalDuration - currentPosition).toFixed(3));
      const trailingSilencePath = path.join(workingDirectory, "silence-end.wav");
      await writeFile(trailingSilencePath, createSilenceWav(trailingGap));
      temporaryFiles.push(trailingSilencePath);
      const normalizedTrailing = trailingSilencePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
      manifestLines.push(`file '${normalizedTrailing}'`);
    }

    await writeFile(concatManifestPath, manifestLines.join("\n") + "\n", "utf8");

    const duration = totalDuration;
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatManifestPath,
      "-af", `aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${duration},asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=7`,
      "-ar", "48000",
      "-ac", "2",
      "-c:a", "pcm_s16le",
      outputPath,
    ], { timeout: 10 * 60_000, windowsHide: true });

    const audio = new Uint8Array(await readFile(outputPath));
    const assetPath = await input.repository.writeQuizNarrationAudio(input.channelId, input.episodeId, audio);
    const durationSeconds = wavDurationSeconds(audio);
    const diagnostics = audioDiagnosticsForTimeline(audio, input.timeline);
    await writeFile(path.join(workingDirectory, "narration-diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
    await input.repository.saveNarrationMetadata(input.channelId, input.episodeId, assetPath, durationSeconds, input.voicePlan.segments.length, wordCount(input.voicePlan.segments.map((segment) => segment.text).join(" ")));
    return { assetPath, durationSeconds, diagnostics };
  } finally {
    await Promise.all([
      rm(outputPath, { force: true }),
      ...temporaryFiles.map((file) => rm(file, { force: true })),
    ]);
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

export function isStandardPcmWav(buffer: Uint8Array, expectedSampleRate = 48000, expectedChannels = 2): boolean {
  if (buffer.length < 44) return false;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (new TextDecoder().decode(buffer.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(buffer.slice(8, 12)) !== "WAVE") return false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = new TextDecoder().decode(buffer.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && size >= 16 && offset + 24 <= buffer.length) {
      const audioFormat = view.getUint16(offset + 8, true); // 1 = PCM integer
      const numChannels = view.getUint16(offset + 10, true);
      const sampleRate = view.getUint32(offset + 12, true);
      const bitsPerSample = view.getUint16(offset + 22, true);
      return audioFormat === 1 && numChannels === expectedChannels && sampleRate === expectedSampleRate && bitsPerSample === 16;
    }
    offset += 8 + size + (size % 2);
  }
  return false;
}

