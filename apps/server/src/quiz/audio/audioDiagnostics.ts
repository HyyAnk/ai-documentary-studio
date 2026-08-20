import type { QuizTimeline } from "@studio/shared";

export type LowAudioRun = {
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  expected: boolean;
};

export type VoiceAudioDiagnostics = {
  sample_rate: number;
  channels: number;
  duration_seconds: number;
  peak: number;
  clipping_samples: number;
  low_audio_ratio: number;
  speech_occupancy: number;
  low_audio_runs: LowAudioRun[];
  unexpected_low_audio_runs: LowAudioRun[];
  max_unexpected_silence_seconds: number;
  unexpected_long_silence_count: number;
  reveal_energy_to_explanation_energy_ratio: number | null;
  narration_segment_energy: Array<{ segment_id: string; energy: number }>;
};

export function analyzeWavAudio(buffer: Uint8Array, expectedRanges: Array<{ start: number; end: number }> = []): VoiceAudioDiagnostics {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = readWavFormat(buffer);
  if (bitsPerSample !== 16) throw new Error(`Audio diagnostics only supports 16-bit PCM WAV, received ${bitsPerSample}-bit`);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const bytesPerSample = bitsPerSample / 8;
  const frameSize = channels * bytesPerSample;
  const frameCount = Math.floor(dataSize / frameSize);
  const windowFrames = Math.max(1, Math.floor(sampleRate * .05));
  const lowThreshold = .012;
  const windows: Array<{ start: number; end: number; level: number; peak: number; clipped: number }> = [];
  let peak = 0;
  let clippingSamples = 0;
  for (let frameStart = 0; frameStart < frameCount; frameStart += windowFrames) {
    const frameEnd = Math.min(frameCount, frameStart + windowFrames);
    let total = 0;
    let count = 0;
    let windowPeak = 0;
    let windowClipped = 0;
    for (let frame = frameStart; frame < frameEnd; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const offset = dataOffset + frame * frameSize + channel * bytesPerSample;
        const value = view.getInt16(offset, true) / 32768;
        const absolute = Math.abs(value);
        total += absolute;
        count += 1;
        windowPeak = Math.max(windowPeak, absolute);
        peak = Math.max(peak, absolute);
        if (absolute >= .999) { windowClipped += 1; clippingSamples += 1; }
      }
    }
    windows.push({ start: frameStart / sampleRate, end: frameEnd / sampleRate, level: total / Math.max(1, count), peak: windowPeak, clipped: windowClipped });
  }
  const lowWindows = windows.filter((window) => window.level < lowThreshold);
  const lowAudioRuns = mergeWindows(lowWindows, expectedRanges);
  const unexpected = lowAudioRuns.filter((run) => !run.expected);
  const duration = frameCount / sampleRate;
  const lowDuration = lowAudioRuns.reduce((sum, run) => sum + run.duration_seconds, 0);
  return {
    sample_rate: sampleRate,
    channels,
    duration_seconds: Number(duration.toFixed(3)),
    peak: Number(peak.toFixed(4)),
    clipping_samples: clippingSamples,
    low_audio_ratio: Number((lowDuration / Math.max(.001, duration)).toFixed(4)),
    speech_occupancy: Number((1 - lowDuration / Math.max(.001, duration)).toFixed(4)),
    low_audio_runs: lowAudioRuns,
    unexpected_low_audio_runs: unexpected,
    max_unexpected_silence_seconds: Number(Math.max(0, ...unexpected.map((run) => run.duration_seconds)).toFixed(3)),
    unexpected_long_silence_count: unexpected.filter((run) => run.duration_seconds > 1).length,
    reveal_energy_to_explanation_energy_ratio: null,
    narration_segment_energy: [],
  };
}

export function audioDiagnosticsForTimeline(buffer: Uint8Array, timeline: QuizTimeline): VoiceAudioDiagnostics {
  const expectedRanges = timeline.events
    .filter((event) => event.type === "countdown.start" || event.type === "transition.start")
    .map((event) => ({ start: event.at_seconds, end: event.at_seconds + event.duration_seconds }));
  const diagnostics = analyzeWavAudio(buffer, expectedRanges);
  const narration = timeline.events.filter((event) => event.type === "narration.segment" && event.segment_id);
  diagnostics.narration_segment_energy = narration.map((event) => ({ segment_id: event.segment_id!, energy: measureRangeEnergy(buffer, event.at_seconds, event.at_seconds + event.duration_seconds) }));
  const reveal = diagnostics.narration_segment_energy.filter((item) => /:reveal$/.test(item.segment_id)).map((item) => item.energy);
  const explanation = diagnostics.narration_segment_energy.filter((item) => /:(explanation|fact)$/.test(item.segment_id)).map((item) => item.energy);
  if (reveal.length && explanation.length) diagnostics.reveal_energy_to_explanation_energy_ratio = Number((average(reveal) / Math.max(.0001, average(explanation))).toFixed(3));
  return diagnostics;
}

function measureRangeEnergy(buffer: Uint8Array, startSeconds: number, endSeconds: number): number {
  const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = readWavFormat(buffer);
  if (bitsPerSample !== 16) return 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const frameSize = channels * 2;
  const first = Math.max(0, Math.floor(startSeconds * sampleRate));
  const last = Math.min(Math.floor(dataSize / frameSize), Math.ceil(endSeconds * sampleRate));
  let sum = 0;
  let count = 0;
  for (let frame = first; frame < last; frame += 1) for (let channel = 0; channel < channels; channel += 1) { sum += Math.abs(view.getInt16(dataOffset + frame * frameSize + channel * 2, true) / 32768); count += 1; }
  return Number((sum / Math.max(1, count)).toFixed(4));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function mergeWindows(windows: Array<{ start: number; end: number }>, expectedRanges: Array<{ start: number; end: number }>): LowAudioRun[] {
  const runs: LowAudioRun[] = [];
  for (const window of windows) {
    const last = runs.at(-1);
    if (last && window.start <= last.end_seconds + .051) last.end_seconds = window.end;
    else runs.push({ start_seconds: window.start, end_seconds: window.end, duration_seconds: 0, expected: false });
  }
  for (const run of runs) {
    run.duration_seconds = Number((run.end_seconds - run.start_seconds).toFixed(3));
    run.expected = expectedRanges.some((range) => {
      const overlap = Math.max(0, Math.min(run.end_seconds, range.end) - Math.max(run.start_seconds, range.start));
      return overlap >= run.duration_seconds * .5;
    });
    run.start_seconds = Number(run.start_seconds.toFixed(3));
    run.end_seconds = Number(run.end_seconds.toFixed(3));
  }
  return runs;
}

function readWavFormat(buffer: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number } {
  if (buffer.length < 44 || new TextDecoder().decode(buffer.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(buffer.slice(8, 12)) !== "WAVE") throw new Error("Audio diagnostics received an invalid WAV file");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = new TextDecoder().decode(buffer.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && size >= 16) {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    }
    if (id === "data") { dataOffset = offset + 8; dataSize = Math.min(size, buffer.length - dataOffset); break; }
    offset += 8 + size + (size % 2);
  }
  if (!sampleRate || !channels || !dataOffset || !dataSize) throw new Error("Audio diagnostics could not find complete WAV format/data chunks");
  return { sampleRate, channels, bitsPerSample, dataOffset, dataSize };
}
