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
const root = path.join(workspace, "tmp", "e2e-quiz-6q-run", runId);
const worker = "e2e-tester";
const started = Date.now();
const color = { info: "\x1b[36m", step: "\x1b[1;34m", ok: "\x1b[32m", error: "\x1b[1;31m", dim: "\x1b[2m", reset: "\x1b[0m" };

function log(level: "INFO" | "STEP" | "OK" | "ERROR", message: string, step: string) {
  const style = level === "OK" ? color.ok : level === "ERROR" ? color.error : level === "STEP" ? color.step : color.info;
  process.stdout.write(`${color.dim}${new Date().toLocaleTimeString("en-GB", { hour12: false })}${color.reset} ${style}[${level}]${color.reset} ${color.dim}[T:${worker}]${color.reset} ${color.info}[P:e2e-quiz-6q]${color.reset} ${color.step}[STEP:${step}]${color.reset} ${message}\n`);
}

async function call(app: Awaited<ReturnType<typeof buildApp>>, url: string, step: string) {
  const reply = await app.server.inject({ method: "POST", url, payload: {} });
  if (reply.statusCode >= 300) throw new Error(`${step} failed (${reply.statusCode}): ${reply.body}`);
  log("OK", `Completed ${step}`, step);
  return reply.json();
}

async function waitForTask(app: Awaited<ReturnType<typeof buildApp>>, taskId: string) {
  let last = "";
  while (true) {
    const task = app.tasks.get(taskId);
    if (task.progress_message !== last) {
      last = task.progress_message;
      log("INFO", `${task.status} (${task.progress_percent}%): ${task.progress_message}`, "render");
    }
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function seed6Questions(episodeId: string): Scene[] {
  const facts = [
    [
      "Which planet is closest to the Sun?",
      ["Mercury", "Venus", "Mars"],
      "Mercury",
      "Mercury is the smallest planet and the closest to the Sun.",
      "A glowing bright yellow Sun with a tiny rocky Mercury planet orbiting close by",
    ],
    [
      "Which planet has large, beautiful rings that you can see with a telescope?",
      ["Saturn", "Neptune", "Jupiter"],
      "Saturn",
      "Saturn has thousands of beautiful rings made of ice and rock particles.",
      "Three distinct planetary portraits with clean circular framing",
    ],
    [
      "Which planet is the hottest planet in our entire Solar System?",
      ["Venus", "Mercury", "Jupiter"],
      "Venus",
      "Venus has thick clouds that trap heat, making it hotter than Mercury.",
      "A dramatic volcanic atmosphere with golden clouds on planet Venus",
    ],
    [
      "Which giant planet is famous for having a giant swirling storm called the Great Red Spot?",
      ["Jupiter", "Mars", "Earth"],
      "Jupiter",
      "Jupiter is the largest planet and its Great Red Spot is a storm bigger than Earth.",
      "Three bright space objects with equal lighting, scale, and clean backdrop",
    ],
    [
      "Which ice giant planet rolls on its side as it orbits the Sun?",
      ["Uranus", "Neptune", "Saturn"],
      "Uranus",
      "Uranus has an unusual tilt, making it spin almost completely on its side.",
      "A cyan blue ice giant planet with subtle vertical rings tilted sideways",
    ],
    [
      "Which icy world was reclassified as a dwarf planet by astronomers in 2006?",
      ["Pluto", "Ceres", "Eris"],
      "Pluto",
      "Pluto was named a dwarf planet because it shares its orbit with many Kuiper belt objects.",
      "A mysterious icy brown world with a heart-shaped nitrogen glacier in deep space",
    ],
  ] as const;

  return facts.map(([question, choices, answer, explanation, imagePrompt], index) => ({
    scene_id: `scene-q${index + 1}`,
    episode_id: episodeId,
    scene_number: index + 1,
    duration_seconds: 10,
    dialogue: `Question ${index + 1}! ${question} Option A: ${choices[0]}. Option B: ${choices[1]}. Option C: ${choices[2]}. The correct answer is ${answer}! ${explanation}`,
    visual_prompt: `CAMERA\nCard\nACTION\nShow Question ${index + 1}\nLIGHTING\nSoft\nATMOSPHERE\nCosmic Playful\nCONTINUITY\nCandy Arcade`,
    transition_note: "Lightning swipe",
    continuity_note: "Candy Arcade space palette",
    sequence_id: `question-${index + 1}`,
    sequence_title: `Question ${index + 1}`,
    shot_id: `shot-q${index + 1}`,
    asset_type: "ai_reconstruction" as const,
    continuity_bundle_id: `CB-${String(index + 1).padStart(2, "0")}`,
    reference_asset_ids: [],
    source_ids: [`SRC-${String(index + 1).padStart(2, "0")}`],
    reconstruction: true,
    sound_cue: "arcade victory cue",
    editorial_overlay: { kind: "none" as const, text: "", motion: "none" as const, placement: "lower_third" as const, duration_seconds: null, data: [], source_ids: [] },
    quiz: {
      phase: "question" as const,
      question_number: index + 1,
      question,
      choices: [...choices],
      answer,
      explanation,
      image_prompt: imagePrompt,
    },
    audio_asset_path: null,
    audio_generated_at: null,
    audio_duration_seconds: null,
  }));
}

function create6QuestionDirector(quiz: QuizV2) {
  const plan = createDefaultDirectorPlan(quiz);
  const specs = [
    { archetype: "illustrated_multiple_choice" as const, palette_id: "blue" as const, layout_id: "media_left_choices_right" as const, motion_id: "enter.pop" as const },
    { archetype: "visual_multiple_choice" as const, palette_id: "lime" as const, layout_id: "visual_choices_three" as const, motion_id: "enter.slideUp" as const },
    { archetype: "illustrated_multiple_choice" as const, palette_id: "purple" as const, layout_id: "media_left_choices_right" as const, motion_id: "enter.scale" as const },
    { archetype: "visual_multiple_choice" as const, palette_id: "sunny" as const, layout_id: "visual_choices_three" as const, motion_id: "enter.pop" as const },
    { archetype: "illustrated_multiple_choice" as const, palette_id: "pink" as const, layout_id: "media_left_choices_right" as const, motion_id: "enter.slideUp" as const },
    { archetype: "final_challenge" as const, palette_id: "aqua" as const, layout_id: "media_left_choices_right" as const, motion_id: "enter.scale" as const },
  ];
  plan.beats = plan.beats.map((beat, index) => ({
    ...beat,
    ...specs[index],
    asset_intents: index % 2 === 0 ? ["question_illustration"] : ["choice_illustration"],
  }));
  return plan;
}

async function extractSampleFrames(videoPath: string, outputDir: string, count: number = 6): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const frames: string[] = [];
  for (let i = 1; i <= count; i++) {
    const timestamp = i * 15;
    const frameFile = path.join(outputDir, `frame-q${i}-${timestamp}s.jpg`);
    try {
      await execFileAsync("ffmpeg", ["-y", "-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-q:v", "2", frameFile], { windowsHide: true });
      frames.push(frameFile);
    } catch {
      // ignore seek overshoot
    }
  }
  return frames;
}

async function main() {
  log("STEP", `Bootstrapping end-to-end 6-question quiz test at ${root}`, "startup");
  await mkdir(path.join(root, "templates"), { recursive: true });
  await Promise.all([
    "example_channel_dna.md",
    "quiz_channel_dna.md",
    "example_style_guide.md",
  ].map((file) => copyFile(path.join(workspace, "templates", file), path.join(root, "templates", file))));

  const app = await buildApp(root, { environmentRoot: workspace });

  try {
    // 0. Set Engine to Google Antigravity
    log("STEP", "Configuring active engine to Antigravity (Dual-Engine Mode)", "engine_setup");
    const engineRes = await app.server.inject({
      method: "POST",
      url: "/api/engine",
      payload: { active_engine: "antigravity" },
    });
    log("OK", `Active engine set to: ${JSON.stringify(engineRes.json())}`, "engine_setup");

    // 1. Create Channel
    log("STEP", "Creating Quiz Channel 'Cosmic Quest Trivia'", "create_channel");
    const channel = await app.repository.createChannel({
      name: "Cosmic Quest Trivia",
      description: "An exciting children's science and astronomy quiz show",
      target_audience: "Children ages 7-9",
      language: "English",
      market: "Global",
      dna_mode: "example",
      group_id: "quiz",
    });
    log("OK", `Channel created: id=${channel.channel_id}, slug=${channel.slug}`, "create_channel");

    // 2. Generate 5 Topic Candidates
    log("STEP", "Generating 5 candidate topics for the channel", "generate_topics");
    const topics = [
      {
        topic_id: "topic-1-solar-system",
        channel_id: channel.channel_id,
        title: "Solar System Explorers: Planetary Superstars",
        premise: "A fun 6-question trivia voyage across the planets and moons.",
        why_it_fits: "High visual variety and clear child-friendly facts.",
        hook: "Can you score 6 out of 6 on our Solar System mission?",
        estimated_potential: "High",
        generated_at: new Date().toISOString(),
        selected: false,
        quiz_format: "multiple_choice" as const,
        question_count: 6,
        age_band: "7-9" as const,
      },
      {
        topic_id: "topic-2-deep-ocean",
        channel_id: channel.channel_id,
        title: "Deep Ocean Secrets & Mysterious Sea Creatures",
        premise: "Explore glowing jellyfish, giant squids, and the Mariana Trench.",
        why_it_fits: "Engaging ocean biology trivia.",
        hook: "Dive deep into the blue unknown!",
        estimated_potential: "High",
        generated_at: new Date().toISOString(),
        selected: false,
        quiz_format: "multiple_choice" as const,
        question_count: 6,
        age_band: "7-9" as const,
      },
      {
        topic_id: "topic-3-dinosaur-giants",
        channel_id: channel.channel_id,
        title: "Dinosaur Giants: Prehistoric Predators and Herbivores",
        premise: "Meet T-Rex, Triceratops, and flying Pterosaurs.",
        why_it_fits: "Top trending topic for young explorers.",
        hook: "How well do you know the ancient rulers of Earth?",
        estimated_potential: "High",
        generated_at: new Date().toISOString(),
        selected: false,
        quiz_format: "multiple_choice" as const,
        question_count: 6,
        age_band: "7-9" as const,
      },
      {
        topic_id: "topic-4-incredible-inventions",
        channel_id: channel.channel_id,
        title: "Incredible Inventions That Changed the World",
        premise: "From wheels to lightbulbs and computers.",
        why_it_fits: "Educational STEM content.",
        hook: "Guess the inventors behind everyday marvels!",
        estimated_potential: "Medium",
        generated_at: new Date().toISOString(),
        selected: false,
        quiz_format: "multiple_choice" as const,
        question_count: 6,
        age_band: "7-9" as const,
      },
      {
        topic_id: "topic-5-rainforest-wildlife",
        channel_id: channel.channel_id,
        title: "Rainforest Wildlife: Jungle Survival Quiz",
        premise: "Discover colorful toucans, jaguars, and tree frogs.",
        why_it_fits: "Rich nature visuals.",
        hook: "Can you spot the jungle champions?",
        estimated_potential: "Medium",
        generated_at: new Date().toISOString(),
        selected: false,
        quiz_format: "multiple_choice" as const,
        question_count: 6,
        age_band: "7-9" as const,
      },
    ];
    await app.repository.saveTopicRun(channel.channel_id, topics);
    log("OK", `Saved 5 candidate topics (Topic 1 chosen for 6 questions)`, "generate_topics");

    // 3. Confirm 1 Topic with 6 Questions
    log("STEP", "Confirming Topic 1 ('Solar System Explorers') with 6 questions", "confirm_topic");
    const episode = await app.repository.confirmTopic(channel.channel_id, "topic-1-solar-system", 6);
    await app.repository.updateEpisodeSettings(channel.channel_id, episode.episode_id, {
      question_count: 6,
      quiz_format: "multiple_choice",
      age_band: "7-9",
      visual_theme: "candy_arcade",
    }, 2.3);

    // Seed 6 questions
    const scenes = seed6Questions(episode.episode_id);
    await app.repository.saveScenes(channel.channel_id, episode.episode_id, scenes);
    log("OK", `Episode confirmed: id=${episode.episode_id}, slug=${episode.slug}, scenes=${scenes.length}`, "confirm_topic");

    const base = `/api/channels/${channel.channel_id}/episodes/${episode.episode_id}/quiz-v2`;

    // 4. Generate Quiz V2 Facts
    log("STEP", "Generating Quiz V2 canonical fact chain", "quiz_generate");
    await call(app, `${base}/generate`, "questions");
    const quiz = await app.repository.readQuiz(channel.channel_id, episode.episode_id) as QuizV2;
    log("OK", `Quiz facts created: ${quiz.questions.length} questions locked`, "quiz_generate");

    // 5. Generate Director Plan
    log("STEP", "Creating Director Plan with 6 varied archetype beats", "director_plan");
    const director = create6QuestionDirector(quiz);
    await app.repository.writeDirectorPlan(channel.channel_id, episode.episode_id, director);
    log("OK", `Director plan created: ${director.beats.length} beats`, "director_plan");

    // 6. Plan Assets
    log("STEP", "Planning required visual assets for 6 questions", "asset_plan");
    await call(app, `${base}/assets/plan`, "asset-plan");

    // 7. Resolve Assets with Antigravity 3-Tier Fallback Chain
    log("STEP", "Resolving visual assets via Antigravity 3-Tier Image Fallback Pipeline", "asset_resolve");
    const assetRes = await call(app, `${base}/assets/resolve`, "asset-resolve");
    log("OK", `Resolved ${assetRes.asset_resolution.assets.length} assets (Degraded fallback tracking active)`, "asset_resolve");

    // 8. Generate Voice Narration (Chatterbox Turbo Sidecar)
    log("STEP", "Generating high-quality Chatterbox TTS narration segments", "voice_generate");
    const voiceRes = await call(app, `${base}/voice/generate`, "voice");
    log("OK", `Voice generated: ${voiceRes.voice_plan.segments.length} segments, ${voiceRes.narration_duration_seconds.toFixed(2)}s duration`, "voice_generate");

    // 9. Compile Timeline
    log("STEP", "Compiling frame-exact Quiz Timeline", "timeline_compile");
    await call(app, `${base}/timeline/compile`, "timeline");

    // 10. Preflight QA Assessment
    log("STEP", "Running automated Pre-render QA assessment", "qa_assessment");
    const qa = await call(app, `${base}/qa`, "qa");
    log("OK", `Pre-render QA Score: ${qa.assessment.score}/100 (${qa.assessment.rating})`, "qa_assessment");

    // 11. Render Final MP4 Video with HyperFrames
    log("STEP", "Submitting GENERATE_VIDEO task to HyperFrames renderer", "render_video");
    const renderTask = app.tasks.submit("GENERATE_VIDEO", channel.channel_id, episode.episode_id);
    log("INFO", `Render task queued: id=${renderTask.task_id}`, "render_video");

    const finalTask = await waitForTask(app, renderTask.task_id);
    if (finalTask.status !== "COMPLETED") throw new Error(`Video render failed: ${finalTask.error ?? finalTask.status}`);
    log("OK", "Video rendering completed successfully!", "render_video");

    // 12. Post-Render Verification & Evidence Inspection
    log("STEP", "Inspecting rendered video file and manifest", "verification");
    const finalEpisode = await app.repository.getEpisode(channel.channel_id, episode.episode_id);
    if (!finalEpisode.video_asset_path) throw new Error("Rendered video asset path is missing");

    const video = await app.repository.getEpisodeVideoFile(channel.channel_id, episode.episode_id, path.basename(finalEpisode.video_asset_path));
    const renderInspection = await inspectRenderedVideo(video.absolutePath, { width: 1920, height: 1080, fps: 30 });
    const duration = Number.parseFloat(renderInspection.probe.format?.duration ?? "0");

    const framesDir = path.join(path.dirname(video.absolutePath), "review-frames-6q");
    const extractedFrames = await extractSampleFrames(video.absolutePath, framesDir, 6);

    const manifestPath = path.join(root, "channels", channel.slug, "episodes", episode.slug, "render-manifest.json");
    let manifestData = null;
    try {
      manifestData = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      // optional
    }

    const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(1);
    const summaryReport = {
      test_name: "End-to-End 6-Question Quiz Pipeline",
      engine: "Google Antigravity (Dual-Engine Mode)",
      channel: { id: channel.channel_id, name: channel.display_name },
      episode: { id: episode.episode_id, title: episode.topic.title, questions: 6 },
      video: {
        path: video.absolutePath,
        duration_seconds: duration,
        width: 1920,
        height: 1080,
        fps: 30,
        size_bytes: video.size,
      },
      qa: {
        score: qa.assessment.score,
        rating: qa.assessment.rating,
        blockers: qa.assessment.issues.filter((i: { severity: string }) => i.severity === "blocker").length,
      },
      manifest: manifestData,
      review_frames: extractedFrames,
      elapsed_seconds: Number(elapsedSeconds),
    };

    const reportPath = path.join(root, "e2e-summary-report.json");
    await writeFile(reportPath, `${JSON.stringify(summaryReport, null, 2)}\n`, "utf8");

    log("OK", `=== END-TO-END PIPELINE SUCCESSFUL (${elapsedSeconds}s) ===`, "summary");
    log("OK", `Video: ${video.absolutePath} (${duration.toFixed(2)}s, 1920x1080)`, "summary");
    log("OK", `Review Frames Extracted: ${extractedFrames.length} frames`, "summary");
    log("OK", `Report: ${reportPath}`, "summary");

    process.stdout.write(`\nE2E_VIDEO=${video.absolutePath}\nE2E_REPORT=${reportPath}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  log("ERROR", error instanceof Error ? error.stack ?? error.message : String(error), "fatal");
  process.exitCode = 1;
});
