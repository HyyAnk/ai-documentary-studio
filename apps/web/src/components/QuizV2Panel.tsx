import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
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

export function QuizV2Panel({ state }: { state: QuizV2State | null }) {
  if (!state) return <section className="panel quiz-v2-panel"><div className="panel-heading"><div><p className="eyebrow">Quiz engine V2</p><h2>Production rail</h2></div></div><p className="artifact-empty">Loading Quiz Engine V2 state</p></section>;
  return <section className="panel quiz-v2-panel" aria-labelledby="quiz-v2-title">
    <div className="panel-heading"><div><p className="eyebrow">Quiz engine V2</p><h2 id="quiz-v2-title">Production rail</h2></div></div>
    <p className="quiz-v2-panel-note">Build video runs every stage automatically.</p>
    <ol className="quiz-v2-rail" aria-label="Quiz Engine V2 production stages">
      {stages.map((stage) => {
        const status = state.stages[stage.key];
        return <li key={stage.key} className={"quiz-v2-stage is-" + status}>
          <span className="quiz-v2-stage-icon">{status === "ready" ? <CheckCircle size={16} weight="fill" /> : status === "failed" ? <WarningCircle size={16} weight="fill" /> : status === "running" ? <CircleNotch className="spin" size={16} /> : <span>{stages.indexOf(stage) + 1}</span>}</span>
          <div><strong>{stage.label}</strong><span>{statusLabel(status)}</span></div>
          {stage.key === "research" ? <span className="quiz-v2-stage-note">Existing</span> : null}
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

function statusLabel(status: QuizV2Stages[QuizStage]): string {
  return status === "not_started" ? "Not started" : status.replaceAll("_", " ");
}
