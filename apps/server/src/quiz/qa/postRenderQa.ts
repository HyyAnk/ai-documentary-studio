import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { QuizIssue } from "@studio/shared";

const execFileAsync = promisify(execFile);

export type RenderProbe = {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }>;
};

export async function inspectRenderedVideo(filePath: string, expected: { width: number; height: number; fps: number }): Promise<{ probe: RenderProbe; issues: QuizIssue[] }> {
  const issues: QuizIssue[] = [];
  try {
    await access(filePath);
    const metadata = await stat(filePath);
    if (metadata.size === 0) issues.push(issue("render_file_empty", "Rendered MP4 is empty.", "Render again and inspect HyperFrames output.", "blocker"));
  } catch {
    issues.push(issue("render_file_missing", "Rendered MP4 does not exist.", "Complete the HyperFrames render before continuing.", "blocker"));
    return { probe: {}, issues };
  }
  let probe: RenderProbe = {};
  try {
    const result = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], { timeout: 60_000, windowsHide: true });
    probe = JSON.parse(result.stdout) as RenderProbe;
  } catch {
    issues.push(issue("render_ffprobe_failed", "FFprobe could not read the rendered MP4.", "Install or repair FFmpeg/FFprobe, then rerun render verification.", "blocker"));
    return { probe, issues };
  }
  issues.push(...validateRenderProbe(probe, expected));
  return { probe, issues };
}

export function validateRenderProbe(probe: RenderProbe, expected: { width: number; height: number; fps: number }): QuizIssue[] {
  const issues: QuizIssue[] = [];
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number.parseFloat(probe.format?.duration ?? "");
  if (!video) issues.push(issue("render_video_stream_missing", "Rendered file has no video stream.", "Check the HyperFrames composition and rerun the strict render.", "blocker"));
  if (!audio) issues.push(issue("render_audio_stream_missing", "Rendered file has no audio stream.", "Ensure Chatterbox narration is mounted before rendering.", "blocker"));
  if (!Number.isFinite(duration) || duration <= 0) issues.push(issue("render_duration_unreadable", "Rendered file has no readable duration.", "Rerun FFprobe after a successful render.", "blocker"));
  if (video && (video.width !== expected.width || video.height !== expected.height)) issues.push(issue("render_resolution_mismatch", "Rendered resolution does not match the configured output.", "Update the composition or render configuration and rerun.", "blocker"));
  const fps = parseFrameRate(video?.r_frame_rate);
  if (video && (!Number.isFinite(fps) || Math.abs(fps - expected.fps) > 0.1)) issues.push(issue("render_fps_mismatch", "Rendered frame rate does not match the configured output.", "Rerun the render with the configured FPS.", "warning"));
  const audioDuration = Number.parseFloat(audio?.duration ?? "");
  if (Number.isFinite(duration) && Number.isFinite(audioDuration) && Math.abs(duration - audioDuration) > 0.5) issues.push(issue("render_audio_video_duration_mismatch", "Audio and video durations differ by more than 0.5 seconds.", "Rebuild the composition from the measured narration duration.", "blocker"));
  return issues;
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return Number.NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator / denominator : Number(value);
}

function issue(code: string, message: string, nextAction: string, severity: "blocker" | "warning"): QuizIssue {
  return { code, severity, message, next_action: nextAction, question_ids: [], stage: "render" };
}
