import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Channel, Episode } from "@studio/shared";
import { buildApp } from "../apps/server/src/app.ts";

const execFileAsync = promisify(execFile);
const workspace = path.resolve(import.meta.dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const resumeRoot = process.env.QUIZ_V2_RESUME_ROOT?.trim();
const validationRoot = resumeRoot ? path.resolve(resumeRoot) : path.join(workspace, "tmp", "quiz-v2-live-validation", runId);
const profile = "quiz-v2-live";
const worker = "validation-1";
const color = { info: "\x1b[36m", step: "\x1b[1;34m", ok: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[1;31m", dim: "\x1b[2m", reset: "\x1b[0m" };
let completed = 0;
let failed = 0;
const started = Date.now();

function log(level: "INFO" | "STEP" | "OK" | "WARN" | "ERROR", message: string, step: string) {
  const style = level === "OK" ? color.ok : level === "WARN" ? color.warn : level === "ERROR" ? color.error : level === "STEP" ? color.step : color.info;
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  process.stdout.write(`${color.dim}${time}${color.reset} ${style}[${level}]${color.reset} ${color.dim}[T:${worker}]${color.reset} ${color.info}[P:${profile}]${color.reset} ${color.step}[STEP:${step}]${color.reset} ${message}\n`);
}

async function call(app: Awaited<ReturnType<typeof buildApp>>, url: string, step: string) {
  const reply = await app.server.inject({ method: "POST", url, payload: {} });
  if (reply.statusCode >= 300) throw new Error(`${step} failed (${reply.statusCode}): ${reply.body}`);
  completed += 1;
  log("OK", "Completed", step);
  return reply.json();
}

async function main() {
  log("INFO", `${resumeRoot ? "Resuming" : "Starting"} isolated 10-question run at ${validationRoot}`, "startup");
  log("INFO", "Mode=Fastify injection, audio=Chatterbox, renderer=HyperFrames, concurrency=1, OS input=none", "startup");
  if (!resumeRoot) {
    await mkdir(path.join(validationRoot, "templates"), { recursive: true });
    await Promise.all(["example_channel_dna.md", "quiz_channel_dna.md", "example_style_guide.md"].map((filename) => copyFile(path.join(workspace, "templates", filename), path.join(validationRoot, "templates", filename))));
  }
  const app = await buildApp(validationRoot, { environmentRoot: workspace });
  try {
    let channel: Channel;
    let episode: Episode;
    if (resumeRoot) {
      channel = (await app.repository.listChannels()).find((item) => item.engine === "quiz") ?? (() => { throw new Error("No Quiz validation channel found to resume"); })();
      episode = (await app.repository.listEpisodes(channel.channel_id))[0] ?? (() => { throw new Error("No Quiz validation episode found to resume"); })();
      log("OK", "Reusing existing facts and assets, then regenerating paced voice WAVs", "resume");
    } else {
      channel = await app.repository.createChannel({ name: "Little Lab Quiz Validation", description: "A child-safe science and nature quiz validation run", target_audience: "Children ages 7-9", language: "English", market: "Global", dna_mode: "example", group_id: "quiz" });
    const topics = Array.from({ length: 5 }, (_, index) => ({
      topic_id: `validation-topic-${index + 1}`,
      channel_id: channel.channel_id,
      title: index === 0 ? "Wonder Quest: Space, Nature & Everyday Science" : `Backup quiz ${index + 1}`,
      premise: "A bright, fact-checked quiz for curious children.",
      why_it_fits: "Short questions with clear explanations.",
      hook: "Can you solve all ten?",
      estimated_potential: "High",
      generated_at: new Date().toISOString(),
      selected: false,
      quiz_format: "multiple_choice" as const,
      question_count: 10,
      age_band: "7-9" as const,
    }));
    await app.repository.saveTopicRun(channel.channel_id, topics);
      episode = await app.repository.confirmTopic(channel.channel_id, topics[0].topic_id);
      await app.repository.updateEpisodeSettings(channel.channel_id, episode.episode_id, { question_count: 10, quiz_format: "multiple_choice", age_band: "7-9", visual_theme: "space_lab" }, 2.3);
      await app.repository.saveScenes(channel.channel_id, episode.episode_id, seedScenes(episode.episode_id));
      completed += 3;
      log("OK", "Channel, episode, and 10 fact-locked source scenes are ready", "seed");
    }

    const base = `/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/quiz-v2`;
    if (!resumeRoot) {
      await call(app, `${base}/generate`, "questions");
    }
    await call(app, `${base}/director/generate`, "director");
    await call(app, `${base}/assets/plan`, "assets");
    await call(app, `${base}/assets/resolve`, "asset-resolution");
    const voice = await call(app, `${base}/voice/generate`, "voice");
    log("INFO", `Measured ${voice.voice_plan.segments.length} segments and assembled ${voice.narration_duration_seconds.toFixed(3)}s master narration`, "voice");
    await call(app, `${base}/timeline/compile`, "timeline");
    const qa = await call(app, `${base}/qa`, "qa");
    if (qa.assessment.issues.some((issue: { severity: string }) => issue.severity === "blocker")) throw new Error(`QA returned blockers: ${JSON.stringify(qa.assessment.issues)}`);
    log("OK", `Pre-render QA score=${qa.assessment.score}, rating=${qa.assessment.rating}`, "qa");

    const task = app.tasks.submit("GENERATE_VIDEO", channel.channel_id, episode.episode_id);
    log("STEP", `Render task ${task.task_id} queued`, "render");
    const finalTask = await waitForTask(app, task.task_id);
    if (finalTask.status !== "COMPLETED") throw new Error(`Render task failed: ${finalTask.error ?? finalTask.status}`);
    completed += 1;
    log("OK", "HyperFrames render completed", "render");

    const finalEpisode = await app.repository.getEpisode(channel.channel_id, episode.episode_id);
    if (!finalEpisode.video_asset_path) throw new Error("Rendered video path is missing");
    const video = await app.repository.getEpisodeVideoFile(channel.channel_id, episode.episode_id, path.basename(finalEpisode.video_asset_path));
    const probe = await probeVideo(video.absolutePath);
    const samples = await sampleFrames(video.absolutePath, finalEpisode.video_duration_seconds ?? 0);
    const report = { validation_root: validationRoot, channel_id: channel.channel_id, episode_id: episode.episode_id, video_path: video.absolutePath, qa: qa.assessment, probe, samples, task: finalTask, created_at: new Date().toISOString() };
    await writeFile(path.join(validationRoot, "validation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    log("OK", `Saved report and ${samples.length} frame samples`, "evidence");
    log("OK", `Final summary total=${completed + failed} success=${completed} failed=${failed} skipped=0 retries=0 elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`, "summary");
    process.stdout.write(`VALIDATION_ROOT=${validationRoot}\nVIDEO_PATH=${video.absolutePath}\n`);
  } finally {
    await app.close();
  }
}

function seedScenes(episodeId: string) {
  const facts = [
    ["Which planet is often called the Red Planet?", ["Venus", "Mars", "Neptune"], "Mars", "Mars looks reddish because its soil contains iron-rich minerals.", "A friendly red Mars with tiny craters and a soft storybook glow"],
    ["Which animal is the fastest on land for a short sprint?", ["Elephant", "Tortoise", "Cheetah"], "Cheetah", "A cheetah can run very fast for a short distance when it hunts.", "A child-friendly cheetah sprinting across a simple sunny savanna"],
    ["Which bird cannot fly but is an excellent swimmer?", ["Penguin", "Eagle", "Parrot"], "Penguin", "Penguins use their wings like flippers to move through water.", "A cheerful penguin gliding underwater with bubbles and blue light"],
    ["What is the largest ocean on Earth?", ["Atlantic Ocean", "Pacific Ocean", "Arctic Ocean"], "Pacific Ocean", "The Pacific Ocean covers more area than any other ocean.", "A bright blue Pacific Ocean globe with friendly waves and islands"],
    ["How many legs does a honey bee have?", ["Four", "Eight", "Six"], "Six", "A honey bee is an insect, and insects have six legs.", "A friendly honey bee hovering beside a tiny flower in a clean garden"],
    ["Which shape has three sides?", ["Triangle", "Circle", "Square"], "Triangle", "A triangle is a flat shape with three straight sides.", "A colorful triangle with three clear sides beside simple geometric shapes"],
    ["What do green plants use to make food from sunlight?", ["Rocks", "Leaves", "Clouds"], "Leaves", "Leaves use sunlight, water, and air to help a plant make food.", "Bright green leaves reaching toward warm sunbeams with water drops"],
    ["Which sense helps you notice the smell of popcorn?", ["Hearing", "Touch", "Smell"], "Smell", "Your nose sends information about smells to your brain.", "A child-safe popcorn bowl with gentle scent swirls near a smiling nose icon"],
    ["What is a baby frog called?", ["Cub", "Tadpole", "Chick"], "Tadpole", "A tadpole lives in water and later grows legs as it becomes a frog.", "A cute tadpole swimming in a pond with lily pads and soft ripples"],
    ["Which tool tells us the temperature?", ["Ruler", "Thermometer", "Compass"], "Thermometer", "A thermometer measures how hot or cold something is.", "A colorful thermometer with clear warm and cool markers"],
  ] as const;
  return facts.map(([question, choices, answer, explanation, imagePrompt], index) => ({
    scene_id: `validation-scene-${index + 1}`,
    episode_id: episodeId,
    scene_number: index + 1,
    duration_seconds: 8,
    dialogue: `${question} ${choices.join(", ")}. ${explanation}`,
    visual_prompt: "Child-friendly learning card with calm motion and high-contrast text.",
    transition_note: "Soft slide",
    continuity_note: "Space lab palette",
    sequence_id: `question-${index + 1}`,
    sequence_title: `Question ${index + 1}`,
    shot_id: `shot-${index + 1}`,
    asset_type: "ai_reconstruction" as const,
    continuity_bundle_id: `CB-${String(index + 1).padStart(2, "0")}`,
    reference_asset_ids: [],
    source_ids: [`FACT-${String(index + 1).padStart(2, "0")}`],
    reconstruction: true,
    sound_cue: "gentle quiz cue",
    editorial_overlay: { kind: "none" as const, text: "", motion: "none" as const, placement: "lower_third" as const, duration_seconds: null, data: [], source_ids: [] },
    quiz: { phase: "question" as const, question_number: index + 1, question, choices: [...choices], answer, explanation, image_prompt: imagePrompt },
    audio_asset_path: null,
    audio_generated_at: null,
    audio_duration_seconds: null,
  }));
}

async function waitForTask(app: Awaited<ReturnType<typeof buildApp>>, taskId: string) {
  let lastMessage = "";
  while (true) {
    const task = app.tasks.get(taskId);
    if (task.progress_message !== lastMessage) {
      lastMessage = task.progress_message;
      log("INFO", `${task.status}: ${task.progress_message}`, "render");
    }
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function probeVideo(videoPath: string) {
  const result = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath], { windowsHide: true });
  return JSON.parse(result.stdout) as unknown;
}

async function sampleFrames(videoPath: string, duration: number) {
  const directory = path.join(path.dirname(videoPath), "validation-frames");
  await mkdir(directory, { recursive: true });
  const points = [...new Set([1, Math.max(1, duration * 0.28), Math.max(1, duration * 0.58), Math.max(1, duration - 2)].map((value) => Number(value.toFixed(2))))];
  const samples: string[] = [];
  for (const [index, second] of points.entries()) {
    const output = path.join(directory, `frame-${String(index + 1).padStart(2, "0")}-${second.toFixed(2).replace(".", "-")}s.jpg`);
    await execFileAsync("ffmpeg", ["-y", "-ss", String(second), "-i", videoPath, "-frames:v", "1", "-q:v", "2", output], { windowsHide: true });
    samples.push(output);
  }
  return samples;
}

main().catch((error) => {
  failed += 1;
  log("ERROR", error instanceof Error ? error.stack ?? error.message : String(error), "fatal");
  log("ERROR", `Final summary total=${completed + failed} success=${completed} failed=${failed} skipped=0 retries=0 elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`, "summary");
  process.exitCode = 1;
});
