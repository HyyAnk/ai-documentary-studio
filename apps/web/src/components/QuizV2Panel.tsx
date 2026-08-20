import { ArrowClockwise, CheckCircle, CircleNotch, Play, WarningCircle } from "@phosphor-icons/react";
import type { QuizAssessment } from "@studio/shared";
import type { QuizV2Stages, QuizV2State } from "../api";

type QuizStage = keyof QuizV2Stages;

const stages: Array<{ key: QuizStage; label: string }> = [
  { key: "research", label: "Research" },
  { key: "questions", label: "Questions" },
  { key: "director", label: "Director" },
  { key: "assets", label: "Assets" },
  { key: "voice", label: "Voice" },
  { key: "timeline", label: "Timeline" },
  { key: "qa", label: "QA" },
  { key: "render", label: "Render" },
];

export function QuizV2Panel({ state, busy, scenesReady, onRun }: { state: QuizV2State | null; busy: string | null; scenesReady: boolean; onRun: (stage: QuizStage) => void }) {
  if (!state) return <section className="panel quiz-v2-panel"><div className="panel-heading"><div><p className="eyebrow">Quiz engine V2</p><h2>Production rail</h2></div></div><p className="artifact-empty">Loading Quiz Engine V2 state</p></section>;
  const nextStage = stages.find((stage) => stage.key !== "research" && state.stages[stage.key] !== "ready");
  const pendingStage = busy?.startsWith("quiz-") ? busy.slice(5) : null;
  return <section className="panel quiz-v2-panel" aria-labelledby="quiz-v2-title">
      <div className="panel-heading">
      <div><p className="eyebrow">Quiz engine V2</p><h2 id="quiz-v2-title">Production rail</h2></div>
      {nextStage && nextStage.key !== "render" ? <button className="primary-button compact" disabled={Boolean(pendingStage) || !canRun(nextStage.key, state, scenesReady)} onClick={() => onRun(nextStage.key)}>{pendingStage === nextStage.key ? <CircleNotch className="spin" size={15} /> : <Play size={15} />}{pendingStage === nextStage.key ? "Working" : actionLabel(nextStage.key, state)}</button> : null}
    </div>
    <p className="quiz-v2-panel-note">Build Video runs this rail automatically. Use stage actions for targeted regeneration.</p>
    <ol className="quiz-v2-rail" aria-label="Quiz Engine V2 production stages">
      {stages.map((stage) => {
        const status = state.stages[stage.key];
        const pending = pendingStage === stage.key;
        const available = canRun(stage.key, state, scenesReady);
        return <li key={stage.key} className={"quiz-v2-stage is-" + status}>
          <span className="quiz-v2-stage-icon">{status === "ready" ? <CheckCircle size={16} weight="fill" /> : status === "failed" ? <WarningCircle size={16} weight="fill" /> : pending ? <CircleNotch className="spin" size={16} /> : <span>{stages.indexOf(stage) + 1}</span>}</span>
          <div><strong>{stage.label}</strong><span>{statusLabel(status)}</span></div>
          {stage.key === "research" ? <span className="quiz-v2-stage-note">Existing</span> : <button className="quiet-button compact" disabled={!available || Boolean(pendingStage)} onClick={() => onRun(stage.key)}>{pending ? "Working" : status === "ready" ? <><ArrowClockwise size={14} />Regenerate</> : stage.key === "render" ? <><Play size={14} />Render</> : actionLabel(stage.key, state)}</button>}
        </li>;
      })}
    </ol>
    {state.assessment ? <QuizV2Assessment assessment={state.assessment} /> : <p className="artifact-empty">Run QA after the timeline is compiled</p>}
  </section>;
}

function QuizV2Assessment({ assessment }: { assessment: QuizAssessment }) {
  const blockers = assessment.issues.filter((issue) => issue.severity === "blocker");
  return <div className={"quiz-v2-assessment " + assessment.rating}><div className="quiz-v2-score"><strong>{assessment.score}</strong><span>QA score</span></div><div><strong>{assessment.rating.replaceAll("_", " ")}</strong><span>{blockers.length ? blockers.length + " blocker" + (blockers.length === 1 ? "" : "s") : "No blockers"}</span></div>{blockers.length ? <ul>{blockers.slice(0, 3).map((issue) => <li key={issue.code}><strong>{issue.message}</strong><span>{issue.next_action}</span></li>)}</ul> : null}</div>;
}

function canRun(stage: QuizStage, state: QuizV2State, scenesReady: boolean): boolean {
  if (stage === "research") return false;
  if (stage === "questions") return scenesReady;
  if (stage === "director") return Boolean(state.quiz);
  if (stage === "assets" || stage === "voice") return Boolean(state.quiz && state.director_plan);
  if (stage === "timeline") return Boolean(state.quiz && state.director_plan && state.voice_plan);
  if (stage === "qa") return Boolean(state.quiz && state.director_plan && state.asset_plan && state.voice_plan && state.timeline);
  if (stage === "render") return Boolean(state.quiz && state.director_plan && state.asset_plan && state.voice_plan && state.timeline && state.assessment && !state.assessment.issues.some((issue) => issue.severity === "blocker"));
  return Boolean(state.quiz && state.director_plan && state.asset_plan && state.voice_plan && state.timeline);
}

function actionLabel(stage: QuizStage, state: QuizV2State): string {
  if (stage === "questions") return state.quiz ? "Regenerate questions" : "Generate questions";
  if (stage === "director") return "Generate Director";
  if (stage === "assets") return "Plan assets";
  if (stage === "voice") return "Generate voice";
  if (stage === "timeline") return "Compile timeline";
  if (stage === "qa") return "Run QA";
  return "Render";
}

function statusLabel(status: QuizV2Stages[QuizStage]): string {
  return status === "not_started" ? "Not started" : status.replaceAll("_", " ");
}
