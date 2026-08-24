import { pathToFileURL } from "node:url";
import type { DirectorPlan, QuizConfig, QuizTimeline, QuizV2, Scene } from "@studio/shared";
import { buildCandyArcadeComposition, buildCandyArcadeCompositionBundle, type CandyArcadeCompositionBundle } from "./candyArcadeComposition.js";

export function buildQuizComposition(config: { question_count: number; quiz_format: string; age_band: string; visual_theme: string }, scenes: Scene[], audioPath: string, narrationDurationSeconds?: number): string {
  const sceneDuration = Math.max(0.1, scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0));
  const totalDuration = Math.max(3, narrationDurationSeconds ?? sceneDuration);
  const durationScale = totalDuration / sceneDuration;
  const audioSrc = audioSource(audioPath);
  let cursor = 0;
  const clips = scenes.map((scene, index) => {
    const start = cursor;
    const scaledDuration = scene.duration_seconds * durationScale;
    cursor += scaledDuration;
    const isWelcome = index === 0 || /welcome|intro|opening/i.test(scene.sequence_title);
    const quiz = scene.quiz;
    const questionNumber = quiz?.question_number ?? Math.min(config.question_count, Math.max(1, index));
    const label = isWelcome ? "READY TO PLAY" : "QUESTION " + questionNumber;
    const safeDialogue = escapeHtml((quiz?.explanation || scene.dialogue).replace(/\s+/g, " ").trim().slice(0, 240));
    const safeTitle = escapeHtml(quiz?.question || scene.sequence_title || label);
    const choices = (quiz?.choices.length ? quiz.choices : ["A", "B", "C"]).slice(0, 3).map((choice, choiceIndex) => "<div class=\"answer-choice answer-" + (choiceIndex + 1) + "\"><b>" + String.fromCharCode(65 + choiceIndex) + "</b><span>" + escapeHtml(choice) + "</span></div>").join("");
    const phaseLabel = quiz?.phase === "reveal" ? "ANSWER REVEAL" : quiz?.phase === "explanation" ? "WHY IT'S TRUE" : label;
    return "<section id=\"quiz-scene-" + (index + 1) + "\" class=\"clip quiz-scene " + (isWelcome ? "welcome" : "") + "\" data-start=\"" + start.toFixed(3) + "\" data-duration=\"" + scaledDuration.toFixed(3) + "\" data-track-index=\"0\"><div class=\"scene-kicker\">" + phaseLabel + "</div><h1>" + safeTitle + "</h1><div class=\"answer-grid\">" + choices + "</div><p class=\"voice-line\">" + safeDialogue + "</p><div class=\"countdown\"><span></span><span></span><span></span></div><div class=\"sparkle sparkle-one\" data-layout-ignore aria-hidden=\"true\">✦</div><div class=\"sparkle sparkle-two\" data-layout-ignore aria-hidden=\"true\">✦</div></section>";
  }).join("\n");
  const css = "@font-face{font-family:\"SVN-Hello Headline\";src:url(\"./fonts/SVN-Hello%20Headline.otf\") format(\"opentype\"),url(\"./fonts/SVN-Hello Headline.otf\") format(\"opentype\"),local(\"SVN-Hello Headline\");font-weight:100 900;font-style:normal;font-display:swap}:root{color-scheme:dark;--ink:#18212b;--cream:#fff8e8;--yellow:#ffd65a;--coral:#ff7866;--mint:#73d6bd;--blue:#78b9ff}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--ink);font-family:Arial,sans-serif}body{color:var(--cream)}#stage{position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(circle at 18% 10%,#31445c 0,#18212b 45%,#111820 100%)}#stage:before{content:\"\";position:absolute;inset:0;opacity:.17;background-image:radial-gradient(#fff 1px,transparent 1px);background-size:34px 34px}section.clip{position:absolute;inset:0;padding:125px 160px 100px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}.scene-kicker{padding:14px 24px;border:4px solid var(--yellow);border-radius:999px;color:var(--yellow);font-size:34px;font-weight:800;letter-spacing:.14em}section.clip h1{max-width:1420px;margin:36px 0 42px;color:var(--cream);font-family:\"SVN-Hello Headline\",Arial,sans-serif;font-size:82px;line-height:1.04;letter-spacing:-.04em;text-wrap:balance}.answer-grid{display:grid;grid-template-columns:repeat(3,260px);gap:24px;margin-bottom:38px}.answer-grid div{min-width:220px;display:grid;gap:8px;padding:22px 16px;border-radius:26px;color:var(--ink);font-size:58px;font-weight:900}.answer-grid div span{font-size:22px;line-height:1.15;font-weight:700}.answer-grid div:nth-child(1){background:var(--coral)}.answer-grid div:nth-child(2){background:var(--mint)}.answer-grid div:nth-child(3){background:var(--blue)}.voice-line{max-width:1180px;margin:0;color:#dce7ef;font-size:31px;line-height:1.35}.countdown{display:flex;gap:14px;margin-top:34px}.countdown span{width:18px;height:18px;border-radius:50%;background:var(--yellow)}.sparkle{position:absolute;color:var(--yellow);font-size:88px}.sparkle-one{top:120px;left:190px}.sparkle-two{right:210px;bottom:150px;color:var(--coral)}";
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Quiz composition</title><style>" + css + "</style></head><body><main id=\"stage\" data-composition-id=\"quiz\" data-no-timeline data-start=\"0\" data-width=\"1920\" data-height=\"1080\" data-duration=\"" + totalDuration.toFixed(3) + "\" data-fps=\"30\">" + clips + "<audio id=\"quiz-narration\" class=\"clip\" data-start=\"0\" data-duration=\"" + totalDuration.toFixed(3) + "\" data-track-index=\"2\" data-volume=\"1\" src=\"" + audioSrc + "\"></audio></main><script>window.__playerReady=true;window.__renderReady=true;</script></body></html>";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}

type QuizV2CompositionInput = {
  quiz: QuizV2;
  director: DirectorPlan;
  timeline: QuizTimeline;
  theme: QuizConfig["visual_theme"];
  audioPath: string;
  narrationDurationSeconds: number;
  assets?: Record<string, string>;
};

/**
 * Builds a deterministic V2 composition directly from semantic facts and the
 * compiled timeline. The legacy scene renderer above stays intact for V1.
 */
export function buildQuizV2Composition(input: QuizV2CompositionInput): string {
  return buildCandyArcadeComposition(input);
  /* Legacy V2 markup is kept below temporarily as a migration reference while
   * Candy Arcade owns the active template implementation. */
  /* c8 ignore start */
  const duration = Math.max(3, input.narrationDurationSeconds, input.timeline.duration_seconds);
  const copy = quizCopy(input.quiz.language);
  const events = input.timeline.events;
  const byQuestion = (questionId: string, type: string) => events.filter((event) => event.question_id === questionId && event.type === type);
  const firstQuestion = input.quiz.questions[0];
  const firstStart = firstQuestion ? eventAt(byQuestion(firstQuestion.id, "question.enter"), 0) : 0;
  const clips: string[] = [introClip(firstStart, input.quiz.questions.length, copy)];

  input.quiz.questions.forEach((question, index) => {
    const beat = input.director.beats.find((candidate) => candidate.question_id === question.id);
    if (!beat) return;
    const nextQuestion = input.quiz.questions[index + 1];
    const questionStart = eventAt(byQuestion(question.id, "question.enter"), 0);
    const choicesStart = eventAt(byQuestion(question.id, "choices.enter"), questionStart + 0.35);
    const thinkingStart = eventAt(byQuestion(question.id, "countdown.start"), choicesStart + 1);
    const revealStart = eventAt(byQuestion(question.id, "answer.reveal"), thinkingStart + 5);
    const rewardStart = eventAt(byQuestion(question.id, "reward.play"), revealStart + 0.55);
    const transition = byQuestion(question.id, "transition.start")[0];
    const nextStart = nextQuestion ? eventAt(byQuestion(nextQuestion.id, "question.enter"), duration) : duration;
    const end = Math.min(duration, Math.max(nextStart, transition ? transition.at_seconds + transition.duration_seconds : rewardStart + 1));
    const countdownTicks = byQuestion(question.id, "countdown.tick").sort((a, b) => a.at_seconds - b.at_seconds);
    const choiceStates = byQuestion(question.id, "mascot.state").filter((event) => event.at_seconds >= choicesStart && event.at_seconds < thinkingStart).sort((a, b) => a.at_seconds - b.at_seconds);
    const thinkingStates = byQuestion(question.id, "mascot.state").filter((event) => event.at_seconds >= thinkingStart && event.at_seconds < (countdownTicks[0]?.at_seconds ?? revealStart)).sort((a, b) => a.at_seconds - b.at_seconds);
    const explanationStates = byQuestion(question.id, "mascot.state").filter((event) => event.at_seconds >= rewardStart && event.at_seconds < end).sort((a, b) => a.at_seconds - b.at_seconds);

    clips.push(questionClip({ start: questionStart, end: choicesStart, phase: "question", question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
    let choicesCursor = choicesStart;
    let choicesMascot: string = beat.mascot_state ?? "curious";
    for (const state of choiceStates) {
      if (state.at_seconds > choicesCursor + 0.02) clips.push(questionClip({ start: choicesCursor, end: state.at_seconds, phase: "choices", mascotState: choicesMascot, question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
      choicesCursor = state.at_seconds;
      choicesMascot = typeof state.payload.state === "string" ? state.payload.state : choicesMascot;
    }
    if (choicesCursor < thinkingStart - 0.02) clips.push(questionClip({ start: choicesCursor, end: thinkingStart, phase: "choices", mascotState: choicesMascot, question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));

    const firstTick = countdownTicks[0]?.at_seconds ?? revealStart;
    const thinkingBreaks = [...thinkingStates.map((event) => ({ at: event.at_seconds, mascotState: typeof event.payload.state === "string" ? event.payload.state : undefined })), { at: firstTick, mascotState: undefined }];
    let thinkingCursor = thinkingStart;
    let mascotState: string | undefined = "thinking";
    for (const point of thinkingBreaks) {
      if (point.at > thinkingCursor + 0.02) clips.push(questionClip({ start: thinkingCursor, end: point.at, phase: "think", mascotState, question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
      thinkingCursor = point.at;
      mascotState = point.mascotState ?? mascotState;
    }
    countdownTicks.forEach((tick, tickIndex) => {
      const tickEnd = countdownTicks[tickIndex + 1]?.at_seconds ?? revealStart;
      clips.push(questionClip({ start: tick.at_seconds, end: tickEnd, phase: "countdown", countdown: String(tick.payload.value ?? ""), question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
      thinkingCursor = tickEnd;
    });
    if (thinkingCursor < revealStart - 0.02) clips.push(questionClip({ start: thinkingCursor, end: revealStart, phase: "think", question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
    clips.push(questionClip({ start: revealStart, end: rewardStart, phase: "reveal", question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
    let explanationCursor = rewardStart;
    let explanationMascot = "celebrate";
    for (const state of explanationStates) {
      if (state.at_seconds > explanationCursor + 0.02) clips.push(questionClip({ start: explanationCursor, end: state.at_seconds, phase: "explain", mascotState: explanationMascot, question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
      explanationCursor = state.at_seconds;
      explanationMascot = typeof state.payload.state === "string" ? state.payload.state : explanationMascot;
    }
    if (explanationCursor < end - 0.02) clips.push(questionClip({ start: explanationCursor, end, phase: "explain", mascotState: explanationMascot, question, beat, count: input.quiz.questions.length, copy, theme: input.theme }));
  });

  const audioSrc = audioSource(input.audioPath);
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Quiz Engine V2 composition</title><style>" + v2Css() + "</style></head><body><main id=\"stage\" data-composition-id=\"quiz-v2\" data-no-timeline data-start=\"0\" data-width=\"1920\" data-height=\"1080\" data-duration=\"" + duration.toFixed(3) + "\" data-fps=\"30\">" + clips.filter(Boolean).join("\n") + "<audio id=\"quiz-narration\" class=\"clip\" data-start=\"0\" data-duration=\"" + duration.toFixed(3) + "\" data-track-index=\"2\" data-volume=\"1\" src=\"" + audioSrc + "\"></audio></main><script>window.__playerReady=true;window.__renderReady=true;</script></body></html>";
  /* c8 ignore stop */
}

export function buildQuizV2CompositionBundle(input: QuizV2CompositionInput): CandyArcadeCompositionBundle {
  return buildCandyArcadeCompositionBundle(input);
}

function eventAt(events: QuizTimeline["events"], fallback: number): number {
  return events[0]?.at_seconds ?? fallback;
}

function quizCopy(language: string) {
  const vietnamese = /^(vi|vietnamese|tiếng việt)/i.test(language.trim());
  return vietnamese
    ? { ready: "Sẵn sàng chơi chưa?", question: "Câu", remember: "Nhớ đáp án của bạn nhé!", think: "Bạn chọn đáp án nào?", correct: "Đáp án đúng", fact: "Bạn có biết?", final: "Thử thách cuối", why: "Vì sao đúng?" }
    : { ready: "Ready to play?", question: "Question", remember: "Keep your answer in mind!", think: "Which answer do you choose?", correct: "Correct answer", fact: "Did you know?", final: "Final challenge", why: "Why is it right?" };
}

function introClip(end: number, count: number, copy: ReturnType<typeof quizCopy>): string {
  if (end < 0.08) return "";
  const questionLabel = /^question$/i.test(copy.question) ? (count === 1 ? "question" : "questions") : copy.question.toLowerCase();
  return "<section id=\"quiz-intro\" class=\"clip quiz-v2-clip theme-candy_pop phase-intro\" data-start=\"0\" data-duration=\"" + end.toFixed(3) + "\" data-track-index=\"0\"><div class=\"bubble bubble-a\"></div><div class=\"bubble bubble-b\"></div><div class=\"intro-lockup\"><span class=\"mini-badge\">QUIZ TIME</span><h1>" + escapeHtml(copy.ready) + "</h1><p>" + count + " " + escapeHtml(questionLabel) + "</p></div><div class=\"mascot mascot-wave\"><i></i><b></b><em></em></div></section>";
}

function questionClip(input: {
  start: number;
  end: number;
  phase: "question" | "choices" | "think" | "countdown" | "reveal" | "explain";
  countdown?: string;
  question: QuizV2["questions"][number];
  beat: DirectorPlan["beats"][number];
  count: number;
  copy: ReturnType<typeof quizCopy>;
  theme: QuizConfig["visual_theme"];
  mascotState?: string;
}): string {
  const duration = input.end - input.start;
  if (duration < 0.04) return "";
  const q = input.question;
  const isFinal = input.beat.archetype === "final_challenge";
  const answer = q.choices.find((choice) => choice.id === q.correct_choice_id);
  const questionTitle = input.phase === "explain" ? input.copy.why : input.phase === "reveal" ? input.copy.correct : isFinal ? input.copy.final : input.copy.question + " " + q.number;
  const body = input.phase === "explain"
    ? "<div class=\"fact-card\"><span>" + escapeHtml(q.fun_fact ? input.copy.fact : input.copy.why) + "</span><p>" + escapeHtml(q.fun_fact || q.explanation) + "</p></div>"
    : input.phase === "reveal"
      ? "<div class=\"answer-reveal\"><span>" + escapeHtml(answer?.text ?? "") + "</span></div>"
      : input.phase === "countdown"
        ? "<div class=\"countdown-orb\"><strong>" + escapeHtml(input.countdown || "!") + "</strong><span>" + escapeHtml(input.copy.think) + "</span></div>"
        : input.phase === "think"
          ? "<div class=\"think-prompt\"><span class=\"thinking-dots\"><i></i><i></i><i></i></span><strong>" + escapeHtml(input.copy.think) + "</strong><small>" + escapeHtml(input.copy.remember) + "</small></div>"
          : "";
  const showChoices = input.phase === "choices" || input.phase === "think" || input.phase === "countdown" || input.phase === "reveal" || input.phase === "explain";
  const choices = showChoices ? choiceMarkup(q, input.phase, input.beat.archetype) : "";
  const illustration = input.beat.archetype === "illustrated_multiple_choice" || input.beat.archetype === "image_guess"
    ? topicIllustration(q.question) : "";
  const mascotState = input.phase === "explain" ? input.mascotState ?? "celebrate" : input.phase === "think" ? input.mascotState ?? "thinking" : input.phase === "countdown" ? "thinking" : input.mascotState ?? input.beat.mascot_state ?? "curious";
  const tone = (q.number - 1) % 4;
  return "<section id=\"quiz-q" + q.number + "-" + input.phase + "-" + Math.round(input.start * 1000) + "\" class=\"clip quiz-v2-clip theme-" + input.theme + " tone-" + tone + " phase-" + input.phase + " archetype-" + input.beat.archetype + (isFinal ? " is-final" : "") + "\" data-start=\"" + input.start.toFixed(3) + "\" data-duration=\"" + duration.toFixed(3) + "\" data-track-index=\"0\"><div class=\"pattern pattern-one\"></div><div class=\"pattern pattern-two\"></div><header><div class=\"counter\">" + escapeHtml(input.copy.question) + " " + q.number + " / " + input.count + "</div><div class=\"mode-pill\">" + escapeHtml(questionTitle) + "</div></header><div class=\"content-wrap\"><div class=\"question-panel\"><h1>" + escapeHtml(q.question) + "</h1>" + illustration + "</div>" + choices + body + "</div><div class=\"mascot mascot-" + escapeHtml(mascotState) + "\"><i></i><b></b><em></em></div><div class=\"progress-dots\">" + progressDots(q.number, input.count) + "</div></section>";
}

function topicIllustration(question: string): string {
  const normalized = question.toLocaleLowerCase();
  const topic = /planet|ocean/.test(normalized) ? "planet" : /bee/.test(normalized) ? "bee" : /animal|bird|frog/.test(normalized) ? "animal" : /shape|side/.test(normalized) ? "shape" : /plant|leaf/.test(normalized) ? "plant" : /smell|sense/.test(normalized) ? "sense" : /temperature|thermometer/.test(normalized) ? "temperature" : "spark";
  return "<div class=\"visual-orbit topic-" + topic + "\"><span></span><i></i><b></b></div>";
}

function choiceMarkup(question: QuizV2["questions"][number], phase: string, archetype: string): string {
  return "<div class=\"choices choices-" + question.choices.length + " " + (archetype === "true_false" ? "choices-true-false" : "") + "\">" + question.choices.map((choice, index) => {
    const state = phase === "reveal" || phase === "explain" ? (choice.id === question.correct_choice_id ? " is-correct" : " is-dim") : "";
    const letter = String.fromCharCode(65 + index);
    return "<div class=\"choice" + state + "\"><b>" + letter + "</b><span>" + escapeHtml(choice.text) + "</span><i class=\"choice-orb\"></i></div>";
  }).join("") + "</div>";
}

function progressDots(active: number, total: number): string {
  return Array.from({ length: total }, (_, index) => "<i" + (index + 1 === active ? " class=\"active\"" : index + 1 < active ? " class=\"done\"" : "") + "></i>").join("");
}

function v2Css(): string {
  return `:root{font-family:Arial,"Helvetica Neue",sans-serif;color:#263047}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#263047}#stage{position:relative;width:1920px;height:1080px;overflow:hidden}.quiz-v2-clip{--bg:#fff0dc;--surface:#fffdf7;--ink:#263047;--accent:#f36b5f;--accent2:#23a9a2;--accent3:#f4bd4c;--success:#36a56d;position:absolute;inset:0;overflow:hidden;padding:70px 110px;background:var(--bg);color:var(--ink)}.theme-space_lab{--bg:#112955;--surface:#f5fbff;--ink:#1e2d4b;--accent:#f46d62;--accent2:#58c6db;--accent3:#ffd064;--success:#4cc98b}.theme-space_lab.tone-1{--bg:#17376a;--accent:#ef765d;--accent2:#7ad3df}.theme-space_lab.tone-2{--bg:#1e2b5d;--accent:#ef675f;--accent2:#5cc6a9}.theme-space_lab.tone-3{--bg:#12314f;--accent:#e77870;--accent2:#68bae7}.theme-jungle_jamboree{--bg:#dff1b6;--surface:#fffdf2;--ink:#244435;--accent:#e6684d;--accent2:#45a777;--accent3:#f3c24f;--success:#398c5c}.theme-ocean_explorer{--bg:#cceefa;--surface:#fbfeff;--ink:#164466;--accent:#f06e5d;--accent2:#2b9fc5;--accent3:#f5c55b;--success:#35a779}.quiz-v2-clip:before{content:"";position:absolute;inset:0;opacity:.8}.pattern{position:absolute;border:18px solid color-mix(in srgb,var(--accent2) 28%,transparent);border-radius:50%;width:230px;height:230px}.pattern-one{top:-104px;right:100px}.pattern-two{bottom:-145px;left:235px;width:300px;height:300px;border-color:color-mix(in srgb,var(--accent3) 42%,transparent)}.tone-1 .pattern-one{border-style:dashed;right:160px}.tone-1 .pattern-two{left:100px}.tone-2 .pattern-one{width:310px;height:310px;top:-160px}.tone-2 .pattern-two{width:220px;height:220px;left:420px}.tone-3 .pattern-one{right:320px}.tone-3 .pattern-two{border-style:dashed;left:130px}header{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center}.counter,.mode-pill,.mini-badge{display:inline-flex;align-items:center;border-radius:999px;font-weight:900;letter-spacing:.04em}.counter{padding:15px 23px;background:var(--surface);font-size:27px;box-shadow:0 10px 0 color-mix(in srgb,var(--ink) 10%,transparent)}.mode-pill{padding:13px 22px;background:var(--ink);color:#fff;font-size:23px}.content-wrap{position:relative;z-index:2;width:1420px;margin:70px auto 0;display:flex;flex-direction:column;align-items:center}.question-panel{position:relative;width:min(1320px,100%);padding:34px 64px 28px;text-align:center;background:var(--surface);border:6px solid color-mix(in srgb,var(--ink) 14%,transparent);border-radius:46px;box-shadow:0 18px 0 color-mix(in srgb,var(--ink) 13%,transparent)}.question-panel h1{max-width:1140px;margin:0 auto;color:var(--ink);font-size:64px;line-height:1.08;letter-spacing:-.035em}.visual-orbit{position:absolute;top:50%;right:-105px;width:178px;height:178px;transform:translateY(-50%);border-radius:50%;background:var(--accent3);border:9px solid var(--surface);box-shadow:0 12px 0 color-mix(in srgb,var(--ink) 13%,transparent)}.visual-orbit span,.visual-orbit i,.visual-orbit b{position:absolute;display:block;border-radius:50%}.visual-orbit span{width:58px;height:58px;top:30px;left:36px;background:var(--accent)}.visual-orbit i{width:45px;height:45px;right:27px;bottom:34px;background:var(--accent2)}.visual-orbit b{width:24px;height:24px;top:28px;right:29px;background:var(--surface)}.topic-planet{background:#b86858}.topic-planet:after{content:"";position:absolute;inset:40px -20px;border:8px solid #f7d16d;border-radius:50%;transform:rotate(-22deg)}.topic-bee{background:#ffd364}.topic-bee span{width:79px;height:46px;top:68px;left:47px;border-radius:30px;background:repeating-linear-gradient(90deg,#35425b 0 13px,#ffd364 13px 26px)}.topic-bee i{width:42px;height:42px;top:26px;right:22px;background:#dfeef5}.topic-animal{background:#ef8b61}.topic-animal span{width:72px;height:72px;top:53px;left:53px;background:#fff5dd}.topic-animal i{width:31px;height:31px;top:30px;left:28px;background:#fff5dd}.topic-animal b{width:31px;height:31px;top:30px;right:28px;background:#fff5dd}.topic-shape{background:#5fcad0}.topic-shape span{width:0;height:0;top:33px;left:31px;border-left:58px solid transparent;border-right:58px solid transparent;border-bottom:103px solid #ffd364;background:transparent;border-radius:0}.topic-plant{background:#7fc578}.topic-plant span{width:76px;height:109px;top:33px;left:54px;border-radius:80% 10% 80% 10%;background:#e7f5af;transform:rotate(-30deg)}.topic-sense{background:#e77a70}.topic-sense span{width:62px;height:110px;top:31px;left:59px;border-radius:50px 50px 34px 34px;background:#f5d1b2}.topic-temperature{background:#70c8df}.topic-temperature span{width:31px;height:102px;top:27px;left:75px;border:9px solid #fff9dc;border-radius:25px;background:#ef765d}.topic-temperature i{width:58px;height:58px;left:62px;bottom:20px;background:#ef765d;border:9px solid #fff9dc}.choices{display:grid;gap:21px;width:1260px;margin-top:43px}.choices-2{grid-template-columns:repeat(2,1fr)}.choices-3{grid-template-columns:repeat(3,1fr)}.choices-4,.choices-5,.choices-6{grid-template-columns:repeat(2,1fr)}.choice{position:relative;min-height:135px;display:flex;align-items:center;gap:22px;padding:20px 34px 20px 22px;overflow:hidden;border:5px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:31px;background:var(--surface);box-shadow:0 13px 0 color-mix(in srgb,var(--ink) 13%,transparent);font-weight:900}.choice:nth-child(3n+1) b{background:var(--accent)}.choice:nth-child(3n+2) b{background:var(--accent2)}.choice:nth-child(3n) b{background:var(--accent3)}.choice b{width:68px;height:68px;display:grid;flex:none;place-items:center;border-radius:23px;color:#fff;font-size:35px}.choice span{position:relative;z-index:2;font-size:33px;line-height:1.12}.choice-orb{position:absolute;right:-24px;bottom:-36px;width:92px;height:92px;border-radius:50%;background:color-mix(in srgb,var(--accent3) 33%,transparent)}.choices-true-false .choice{justify-content:center;min-height:184px}.choices-true-false .choice span{font-size:47px}.choice.is-correct{border-color:var(--success);background:#f6fff5;box-shadow:0 13px 0 color-mix(in srgb,var(--success) 38%,transparent);transform:translateY(-9px)}.choice.is-correct:after{content:"✓";position:absolute;right:22px;top:17px;width:46px;height:46px;display:grid;place-items:center;border-radius:50%;background:var(--success);color:#fff;font-size:30px}.choice.is-dim{opacity:.42;filter:saturate(.5)}.think-prompt,.countdown-orb,.answer-reveal,.fact-card{margin-top:36px;text-align:center}.think-prompt{display:grid;gap:11px}.think-prompt strong{font-size:47px}.think-prompt small{font-size:27px;font-weight:700}.thinking-dots{display:flex;justify-content:center;gap:14px}.thinking-dots i{width:22px;height:22px;border-radius:50%;background:var(--accent)}.thinking-dots i:nth-child(2){background:var(--accent2)}.thinking-dots i:nth-child(3){background:var(--accent3)}.countdown-orb{width:208px;height:208px;display:grid;place-content:center;gap:3px;border:10px solid var(--accent3);border-radius:50%;background:var(--surface);box-shadow:0 14px 0 color-mix(in srgb,var(--ink) 13%,transparent)}.countdown-orb strong{font-size:104px;line-height:.9;color:var(--accent)}.countdown-orb span{font-weight:900;font-size:20px}.answer-reveal{padding:24px 48px;border-radius:28px;background:var(--success);color:#fff;box-shadow:0 13px 0 color-mix(in srgb,var(--success) 42%,transparent)}.answer-reveal span{font-size:49px;font-weight:900}.fact-card{max-width:1040px;padding:27px 44px;border:5px solid color-mix(in srgb,var(--accent2) 48%,transparent);border-radius:31px;background:var(--surface);box-shadow:0 13px 0 color-mix(in srgb,var(--ink) 11%,transparent)}.fact-card span{font-size:23px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--accent2)}.fact-card p{margin:10px 0 0;font-size:31px;line-height:1.25;font-weight:700}.mascot{position:absolute;z-index:4;right:76px;bottom:65px;width:182px;height:205px}.mascot i{position:absolute;left:38px;top:0;width:104px;height:100px;border:7px solid var(--ink);border-radius:47% 47% 46% 46%;background:#b96e43}.mascot i:before,.mascot i:after{content:"";position:absolute;top:37px;width:15px;height:18px;border-radius:50%;background:var(--ink)}.mascot i:before{left:28px}.mascot i:after{right:28px}.mascot b{position:absolute;left:16px;bottom:0;width:145px;height:120px;border:7px solid var(--ink);border-radius:62px 62px 38px 38px;background:var(--accent2)}.mascot b:after{content:"★";position:absolute;left:50px;top:26px;color:var(--accent3);font-size:38px}.mascot em{position:absolute;right:0;top:83px;width:62px;height:22px;border:7px solid var(--ink);border-left:0;border-radius:0 22px 22px 0;transform:rotate(-22deg)}.mascot-wave em{transform:rotate(-60deg);top:54px;right:-10px}.mascot-thinking{transform:rotate(-5deg)}.mascot-thinking em{transform:rotate(18deg);right:-4px;top:72px}.mascot-celebrate{transform:translateY(-17px)}.mascot-celebrate em{transform:rotate(-62deg);top:38px;right:-13px}.mascot-point{transform:translateX(-14px) rotate(5deg)}.mascot-point em{transform:rotate(-8deg);top:65px;right:-13px}.mascot-encourage{transform:translateY(-9px) rotate(3deg)}.mascot-encourage em{transform:rotate(-48deg);top:48px;right:-12px}.progress-dots{position:absolute;z-index:3;left:50%;bottom:53px;display:flex;gap:11px;transform:translateX(-50%)}.progress-dots i{width:16px;height:16px;border:3px solid color-mix(in srgb,var(--ink) 32%,transparent);border-radius:50%;background:var(--surface)}.progress-dots i.done{background:var(--accent2);border-color:var(--accent2)}.progress-dots i.active{width:34px;border-radius:99px;background:var(--accent);border-color:var(--accent)}.is-final .question-panel{border-color:var(--accent3);box-shadow:0 18px 0 color-mix(in srgb,var(--accent3) 45%,transparent)}.is-final:after{content:"✦   ✦   ✦";position:absolute;top:120px;left:50%;transform:translateX(-50%);color:var(--accent3);font-size:66px;letter-spacing:210px;white-space:nowrap}.phase-intro{display:grid;place-items:center;background:#fff0dc}.intro-lockup{position:relative;z-index:2;display:grid;justify-items:center;text-align:center}.mini-badge{padding:14px 23px;background:var(--accent2);color:#fff;font-size:25px}.intro-lockup h1{max-width:1020px;margin:29px 0 10px;font-size:94px;line-height:1.02;letter-spacing:-.05em}.intro-lockup p{margin:0;font-size:38px;font-weight:800}.bubble{position:absolute;border-radius:50%;background:var(--accent3)}.bubble-a{top:140px;left:240px;width:180px;height:180px}.bubble-b{right:250px;bottom:165px;width:120px;height:120px;background:var(--accent)}.phase-intro .mascot{right:288px;bottom:102px;transform:scale(1.3) rotate(-6deg)}.phase-question .question-panel{margin-top:75px}.phase-question .content-wrap{margin-top:150px}.phase-question .mascot{bottom:76px}.phase-question .progress-dots{bottom:62px}`;
}

function audioSource(value: string): string {
  return escapeHtml(value.startsWith("./") || value.startsWith("../") ? value : pathToFileURL(value).href);
}
