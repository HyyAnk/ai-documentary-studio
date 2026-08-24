import { describe, expect, it } from "vitest";
import { analyzeWavAudio } from "../src/quiz/audio/audioDiagnostics.js";
import { createSilenceWav, wavDurationSeconds } from "../src/quiz/audio/voiceSynthesis.js";

function wav(seconds: number, sampleRate = 1000): Uint8Array {
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    const active = index >= frames * .2 && index < frames * .7;
    data.writeInt16LE(active ? 9000 : 0, index * 2);
  }
  const output = Buffer.alloc(44 + data.length);
  output.write("RIFF", 0); output.writeUInt32LE(36 + data.length, 4); output.write("WAVE", 8);
  output.write("fmt ", 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22); output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write("data", 36); output.writeUInt32LE(data.length, 40); data.copy(output, 44);
  return new Uint8Array(output);
}

describe("voice audio diagnostics", () => {
  it("measures occupancy, low-audio runs, and clipping without wall-clock state", () => {
    const result = analyzeWavAudio(wav(2), [{ start: 0, end: .25 }]);
    expect(result.sample_rate).toBe(1000);
    expect(result.speech_occupancy).toBeGreaterThan(.4);
    expect(result.low_audio_runs.length).toBeGreaterThan(0);
    expect(result.unexpected_low_audio_runs.some((run) => run.duration_seconds > .5)).toBe(true);
    expect(result.clipping_samples).toBe(0);
  });

  it("creates valid silence wav buffers with exact duration", () => {
    const silence = createSilenceWav(1.5);
    expect(silence.length).toBe(44 + Math.round(1.5 * 48000 * 4));
    expect(wavDurationSeconds(silence)).toBe(1.5);
  });
});

