import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Channel, Episode, QuizTimeline, QuizV2, Scene } from "@studio/shared";
import { buildApp } from "../apps/server/src/app.ts";
import { createDefaultDirectorPlan } from "../apps/server/src/quiz/director/parseDirectorPlan.ts";
import { inspectRenderedVideo } from "../apps/server/src/quiz/qa/postRenderQa.ts";

const execFileAsync = promisify(execFile);
const workspace = path.resolve(import.meta.dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const reuseRoot = process.env.CANDY_GOLDEN_REUSE_ROOT?.trim();
const root = reuseRoot ? path.resolve(reuseRoot) : path.join(workspace, "tmp", "candy-arcade-golden-demo", runId);
const worker = "golden-demo-1";
const started = Date.now();
const color = { info: "\x1b[36m", step: "\x1b[1;34m", ok: "\x1b[32m", error: "\x1b[1;31m", dim: "\x1b[2m", reset: "\x1b[0m" };

function log(level: "INFO" | "STEP" | "OK" | "ERROR", message: string, step: string) {
  const style = level === "OK" ? color.ok : level === "ERROR" ? color.error : level === "STEP" ? color.step : color.info;
  process.stdout.write(`${color.dim}${new Date().toLocaleTimeString("en-GB", { hour12: false })}${color.reset} ${style}[${level}]${color.reset} ${color.dim}[T:${worker}]${color.reset} ${color.info}[P:candy-arcade-demo]${color.reset} ${color.step}[STEP:${step}]${color.reset} ${message}\n`);
}

async function call(app: Awaited<ReturnType<typeof buildApp>>, url: string, step: string) {
  const reply = await app.server.inject({ method: "POST", url, payload: {} });
  if (reply.statusCode >= 300) throw new Error(`${step} failed (${reply.statusCode}): ${reply.body}`);
  log("OK", "Completed", step);
  return reply.json();
}

async function main() {
  log("INFO", `${reuseRoot ? "Re-rendering" : "Creating"} deterministic demo at ${root}`, "startup");
  log("INFO", "Mode=Fastify injection, renderer=HyperFrames, assets=ShopAIKey provider with template fallback, OS input=none", "startup");
  if (!reuseRoot) {
    await mkdir(path.join(root, "templates", "sfx"), { recursive: true });
    await mkdir(path.join(root, "templates", "fonts"), { recursive: true });
    await Promise.all(["example_channel_dna.md", "quiz_channel_dna.md", "example_style_guide.md"].map((file) => copyFile(path.join(workspace, "templates", file), path.join(root, "templates", file))));
    const sfxFiles = ["ui_pop.wav", "bubble_splash.wav", "lightning_brush.wav", "countdown_tick.wav", "countdown_final.wav", "correct_ding.wav", "correct_triumph.wav", "streak.wav"];
    await Promise.all(sfxFiles.map((file) => copyFile(path.join(workspace, "templates", "sfx", file), path.join(root, "templates", "sfx", file))));
    try {
      await copyFile(path.join(workspace, "templates", "fonts", "SVN-Hello Headline.otf"), path.join(root, "templates", "fonts", "SVN-Hello Headline.otf"));
    } catch {}
  }
  const app = await buildApp(root, { environmentRoot: workspace });
  await app.server.inject({ method: "POST", url: "/api/engine", payload: { active_engine: "antigravity" } });
  try {
    let channel: Channel;
    let episode: Episode;
    if (reuseRoot) {
      channel = (await app.repository.listChannels()).find((candidate) => candidate.slug === "candy-arcade-golden-demo") ?? (() => { throw new Error("Reusable Golden Demo channel is missing"); })();
      episode = (await app.repository.listEpisodes(channel.channel_id))[0] ?? (() => { throw new Error("Reusable Golden Demo episode is missing"); })();
    } else {
      channel = await app.repository.createChannel({ name: "Candy Arcade Golden Demo", description: "A visual regression demo for a children's game-show quiz", target_audience: "Children ages 7-9", language: "English", market: "Global", dna_mode: "example", group_id: "quiz" });
      await app.repository.saveTopicRun(channel.channel_id, Array.from({ length: 5 }, (_, index) => ({ topic_id: index === 0 ? "candy-arcade-demo" : `candy-arcade-backup-${index + 1}`, channel_id: channel.channel_id, title: index === 0 ? "Candy Arcade Challenge" : `Candy Arcade Backup ${index + 1}`, premise: "Five bright questions with varied layouts.", why_it_fits: "Exercises the Candy Arcade template.", hook: "Can you earn all five stars?", estimated_potential: "High", generated_at: new Date().toISOString(), selected: false, quiz_format: "multiple_choice" as const, question_count: 5, age_band: "7-9" as const })));
      episode = await app.repository.confirmTopic(channel.channel_id, "candy-arcade-demo", 5);
      await app.repository.updateEpisodeSettings(channel.channel_id, episode.episode_id, { question_count: 5, quiz_format: "multiple_choice", age_band: "7-9", visual_theme: "candy_arcade" }, 2.3);
      await app.repository.saveScenes(channel.channel_id, episode.episode_id, seedScenes(episode.episode_id));
    }
    const base = `/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/quiz-v2`;
    if (!reuseRoot) await call(app, `${base}/generate`, "questions");
    let quiz = await app.repository.readQuiz(channel.channel_id, episode.episode_id) as QuizV2;
    if (reuseRoot) {
      quiz = compactGoldenDemoCopy(quiz);
      await app.repository.writeQuiz(channel.channel_id, episode.episode_id, quiz);
    }
    if (!reuseRoot) {
      const director = createGoldenDirector(quiz);
      await app.repository.writeDirectorPlan(channel.channel_id, episode.episode_id, director);
      await call(app, `${base}/assets/plan`, "asset-plan");
      await call(app, `${base}/assets/resolve`, "asset-resolve");
    }
    await call(app, `${base}/voice/generate`, "voice");
    await call(app, `${base}/timeline/compile`, "timeline");
    const qa = await call(app, `${base}/qa`, "qa");
    if (qa.assessment.issues.some((issue: { severity: string }) => issue.severity === "blocker")) throw new Error(`Golden demo preflight blockers: ${JSON.stringify(qa.assessment.issues)}`);
    log("OK", `Pre-render QA=${qa.assessment.score}/100 (${qa.assessment.rating})`, "qa");
    const task = app.tasks.submit("GENERATE_VIDEO", channel.channel_id, episode.episode_id);
    log("STEP", `Render task ${task.task_id} queued`, "render");
    const finalTask = await waitForTask(app, task.task_id);
    if (finalTask.status !== "COMPLETED") throw new Error(finalTask.error ?? finalTask.status);
    const finalEpisode = await app.repository.getEpisode(channel.channel_id, episode.episode_id);
    if (!finalEpisode.video_asset_path) throw new Error("Golden demo video path is missing");
    const video = await app.repository.getEpisodeVideoFile(channel.channel_id, episode.episode_id, path.basename(finalEpisode.video_asset_path));
    const renderInspection = await inspectRenderedVideo(video.absolutePath, { width: 1920, height: 1080, fps: 30 });
    const duration = Number.parseFloat(renderInspection.probe.format?.duration ?? "");
    if (renderInspection.issues.some((issue) => issue.severity === "blocker")) throw new Error(`Golden demo render blockers: ${JSON.stringify(renderInspection.issues)}`);
    if (!Number.isFinite(duration) || duration > 110) throw new Error(`Golden demo duration gate failed: ${Number.isFinite(duration) ? duration.toFixed(3) : "unreadable"}s (maximum 110s)`);
    const timeline = await app.repository.readQuizTimeline(channel.channel_id, episode.episode_id);
    if (!timeline) throw new Error("Golden demo timeline is missing");
    const frames = await extractFrames(video.absolutePath, timeline, quiz);
    const diagnostics = JSON.parse(await readFile(path.join(root, ".documentary-studio", "quiz-voice", episode.episode_id, "narration-diagnostics.json"), "utf8").catch(() => "null")) as unknown;
    const report = { template: "candy_arcade", root, channel_id: channel.channel_id, episode_id: episode.episode_id, video_path: video.absolutePath, duration_seconds: duration, duration_rating: duration <= 110 ? "preferred" : "warning", timing: timingBreakdown(timeline, quiz), audio_diagnostics: diagnostics, qa: qa.assessment, render_issues: renderInspection.issues, frames, task: finalTask, created_at: new Date().toISOString() };
    await writeFile(path.join(root, "golden-demo-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    log("OK", `Rendered ${duration.toFixed(2)}s demo and extracted ${frames.length} review frames`, "evidence");
    log("OK", `Final summary success=7 failed=0 elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`, "summary");
    process.stdout.write(`GOLDEN_DEMO=${video.absolutePath}\nGOLDEN_REPORT=${path.join(root, "golden-demo-report.json")}\n`);
  } finally { await app.close(); }
}

function createGoldenDirector(quiz: QuizV2) {
  const plan = createDefaultDirectorPlan(quiz);
  const specifications = [
    { archetype: "illustrated_multiple_choice" as const, palette_id: "blue" as const, layout_id: "media_left_choices_right" as const, motion_id: "enter.pop" as const },
    { archetype: "visual_multiple_choice" as const, palette_id: "lime" as const, layout_id: "visual_choices_three" as const, motion_id: "enter.slideUp" as const },
    { archetype: "illustrated_multiple_choice" as const, palette_id: "purple" as const, layout_id: "media_left_choices_right" as const, motion_id: "enter.scale" as const },
    { archetype: "visual_multiple_choice" as const, palette_id: "sunny" as const, layout_id: "visual_choices_three" as const, motion_id: "enter.pop" as const },
    { archetype: "final_challenge" as const, palette_id: "pink" as const, layout_id: "media_left_choices_right" as const, motion_id: "enter.scale" as const },
  ];
  plan.beats = plan.beats.map((beat, index) => ({ ...beat, ...specifications[index], asset_intents: index === 0 || index === 2 ? ["question_illustration"] : index === 1 || index === 3 ? ["choice_illustration"] : [] }));
  return plan;
}

function seedScenes(episodeId: string): Scene[] {
  const facts = [
    ["Which ocean is the largest on Earth?", ["Atlantic Ocean", "Pacific Ocean", "Arctic Ocean"], "Pacific Ocean", "The Pacific Ocean covers more area than any other ocean.", "A bright friendly globe and ocean waves"],
    ["Which animal can sprint the fastest for a short distance?", ["Cheetah", "Elephant", "Turtle"], "Cheetah", "A cheetah can sprint very quickly for a short distance.", "Three clear animal portraits with matching framing"],
    ["Which gas do plants take in from the air to help make food?", ["Oxygen", "Helium", "Carbon dioxide"], "Carbon dioxide", "Plants use carbon dioxide, water, and sunlight to make food.", "A simple leafy science diagram with sunbeams and water drops, no labels"],
    ["Which object is a planet in our Solar System?", ["Moon", "Earth", "Comet"], "Earth", "Earth is a planet that travels around the Sun.", "Three bright space objects with equal lighting and scale"],
    ["Which shape has exactly three sides?", ["Circle", "Square", "Triangle"], "Triangle", "A triangle has three straight sides and three corners.", "A celebratory set of colorful geometric shapes"],
  ] as const;
  return facts.map(([question, choices, answer, explanation, imagePrompt], index) => ({
    scene_id: `candy-scene-${index + 1}`, episode_id: episodeId, scene_number: index + 1, duration_seconds: 10, dialogue: `${question} ${choices.join(", ")}. ${explanation}`, visual_prompt: "Candy Arcade quiz scene", transition_note: "Lightning brush", continuity_note: "Candy Arcade", sequence_id: `question-${index + 1}`, sequence_title: `Question ${index + 1}`, shot_id: `shot-${index + 1}`, asset_type: "ai_reconstruction" as const, continuity_bundle_id: `CB-${String(index + 1).padStart(2, "0")}`, reference_asset_ids: [], source_ids: [`DEMO-${String(index + 1).padStart(2, "0")}`], reconstruction: true, sound_cue: "gentle arcade cue", editorial_overlay: { kind: "none" as const, text: "", motion: "none" as const, placement: "lower_third" as const, duration_seconds: null, data: [], source_ids: [] }, quiz: { phase: "question" as const, question_number: index + 1, question, choices: [...choices], answer, explanation, image_prompt: imagePrompt }, audio_asset_path: null, audio_generated_at: null, audio_duration_seconds: null,
  }));
}

function compactGoldenDemoCopy(quiz: QuizV2): QuizV2 {
  const explanations: Record<string, string> = {
    "question-01": "The Pacific Ocean is the biggest ocean.",
    "question-03": "Plants use carbon dioxide to make their food.",
  };
  return { ...quiz, questions: quiz.questions.map((question) => ({ ...question, explanation: explanations[question.id] ?? question.explanation })) };
}

async function waitForTask(app: Awaited<ReturnType<typeof buildApp>>, taskId: string) {
  let last = "";
  while (true) {
    const task = app.tasks.get(taskId);
    if (task.progress_message !== last) { last = task.progress_message; log("INFO", `${task.status}: ${task.progress_message}`, "render"); }
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function extractFrames(video: string, timeline: QuizTimeline, quiz: QuizV2) {
  const event = (questionId: string, type: string) => timeline.events.find((item) => item.question_id === questionId && item.type === type);
  const q1 = quiz.questions[0]; const q2 = quiz.questions[1]; const q4 = quiz.questions[3]; const q5 = quiz.questions[4];
  const outro = timeline.events.find((item) => item.type === "narration.segment" && item.segment_id === "outro");
  const q1Think = event(q1.id, "countdown.start");
  const q1Transition = event(q1.id, "transition.start");
  const points = [
    ["intro", 1.5],
    ["q1-entrance", (event(q1.id, "question.enter")?.at_seconds ?? 1) + .55],
    ["q1-thinking-midpoint", (q1Think?.at_seconds ?? 2) + (q1Think?.duration_seconds ?? 5) / 2],
    ["q1-reveal", (event(q1.id, "answer.reveal")?.at_seconds ?? 3) + .35],
    ["default-transition-midpoint", (q1Transition?.at_seconds ?? 4) + (q1Transition?.duration_seconds ?? .8) / 2],
    ["q2-visual-choices", (event(q2.id, "choices.enter")?.at_seconds ?? 5) + .7],
    ["q4-visual-reveal", (event(q4.id, "answer.reveal")?.at_seconds ?? 6) + .35],
    ["q5-final-challenge", (event(q5.id, "answer.reveal")?.at_seconds ?? 7) + .35],
    ["outro", (outro?.at_seconds ?? timeline.duration_seconds - 2) + .8],
  ];
  const strips = [
    ["entrance-strip", event(q1.id, "question.enter")?.at_seconds ?? 1, [.08, .34, .72]],
    ["reveal-strip", event(q1.id, "answer.reveal")?.at_seconds ?? 3, [.06, .28, .58]],
    ["transition-strip", q1Transition?.at_seconds ?? 4, [.08, .36, .68]],
  ];
  const dir = path.join(path.dirname(video), "golden-review-frames");
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const [name, point] of points) {
    const output = path.join(dir, `${name}-${point.toFixed(2).replace(".", "-")}s.jpg`);
    await execFileAsync("ffmpeg", ["-y", "-ss", String(point), "-i", video, "-frames:v", "1", "-q:v", "2", output], { windowsHide: true });
    files.push(output);
  }
  for (const [name, start, offsets] of strips) {
    for (const [index, offset] of offsets.entries()) {
      const point = start + offset;
      const output = path.join(dir, `${name}-${index + 1}-${point.toFixed(2).replace(".", "-")}s.jpg`);
      await execFileAsync("ffmpeg", ["-y", "-ss", String(point), "-i", video, "-frames:v", "1", "-q:v", "2", output], { windowsHide: true });
      files.push(output);
    }
  }
  return files;
}

function timingBreakdown(timeline: QuizTimeline, quiz: QuizV2) {
  const byQuestion = quiz.questions.map((question, index) => {
    const events = timeline.events.filter((event) => event.question_id === question.id);
    const find = (type: string) => events.find((event) => event.type === type);
    const narration = (suffix: string) => events.find((event) => event.segment_id === `${question.id}:${suffix}`)?.duration_seconds ?? 0;
    const start = find("question.enter")?.at_seconds ?? 0;
    const end = quiz.questions[index + 1] ? timeline.events.find((event) => event.type === "question.enter" && event.question_id === quiz.questions[index + 1]?.id)?.at_seconds ?? timeline.duration_seconds : timeline.events.find((event) => event.segment_id === "outro")?.at_seconds ?? timeline.duration_seconds;
    return { question_id: question.id, duration_seconds: Number((end - start).toFixed(3)), question_narration_seconds: narration("question"), choice_narration_seconds: narration("choice"), thinking_seconds: find("countdown.start")?.duration_seconds ?? 0, reveal_seconds: narration("reveal"), explanation_seconds: narration("explanation"), transition_seconds: find("transition.start")?.duration_seconds ?? 0 };
  });
  const mean = (key: keyof typeof byQuestion[number]) => Number((byQuestion.reduce((sum, item) => sum + (typeof item[key] === "number" ? item[key] as number : 0), 0) / Math.max(1, byQuestion.length)).toFixed(3));
  return { total_episode_seconds: timeline.duration_seconds, intro_seconds: quiz.questions[0] ? timeline.events.find((event) => event.type === "question.enter" && event.question_id === quiz.questions[0]?.id)?.at_seconds ?? 0 : 0, outro_seconds: timeline.events.find((event) => event.segment_id === "outro")?.duration_seconds ?? 0, average_question_seconds: mean("duration_seconds"), average_question_narration_seconds: mean("question_narration_seconds"), average_choice_narration_seconds: mean("choice_narration_seconds"), average_thinking_seconds: mean("thinking_seconds"), average_reveal_seconds: mean("reveal_seconds"), average_explanation_seconds: mean("explanation_seconds"), average_transition_seconds: mean("transition_seconds"), questions: byQuestion };
}

main().catch((error) => { log("ERROR", error instanceof Error ? error.stack ?? error.message : String(error), "fatal"); process.exitCode = 1; });
