import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import type { QuizAssessment, Task } from "@studio/shared";
import type { QuizV2Stages, QuizV2State } from "../api";
import { isTaskActive, latestTask } from "../lib/utils";

type RailStage = "research" | "treatment" | "script" | "visualBible" | "scenes" | keyof QuizV2Stages;
type RailStatus = QuizV2Stages["research"] | "queued";
type StageProgress = { completed: number; total: number; percent: number; unit: string };

const stages: Array<{ key: RailStage; label: string }> = [
  { key: "research", label: "Research" },
  { key: "treatment", label: "Treatment" },
  { key: "script", label: "Script" },
  { key: "visualBible", label: "Visual bible" },
  { key: "scenes", label: "Scenes" },
  { key: "questions", label: "Questions" },
  { key: "director", label: "Director" },
  { key: "assets", label: "Assets" },
  { key: "voice", label: "Voice" },
  { key: "timeline", label: "Timeline" },
  { key: "qa", label: "QA" },
  { key: "render", label: "Render" },
];

type Readiness = { research: boolean; treatment: boolean; script: boolean; visualBible: boolean; scenes: boolean; video: boolean };

export function QuizV2Panel({ state, readiness, pipelineTask, tasks, questionCount = 0 }: { state: QuizV2State | null; readiness: Readiness; pipelineTask: Task | null; tasks: Task[]; questionCount?: number }) {
  if (!state) return <section className="panel quiz-v2-panel"><p className="artifact-empty">Loading Quiz Engine V2 state</p></section>;
  const currentStage = pipelineStage(pipelineTask);
  return <section className="panel quiz-v2-panel" aria-label="Quiz production stages">
    {currentStage ? <p className="quiz-v2-panel-note">{pipelineTask?.status === "FAILED" ? "Stopped at" : "Current"}: {currentStage.label}{pipelineTask?.progress_message && pipelineTask.status !== "FAILED" ? ` · ${pipelineTask.progress_message}` : ""}</p> : null}
    <ol className="quiz-v2-rail" aria-label="Quiz production stages">
      {stages.map((stage, index) => {
        const status = resolveStatus(stage.key, index, readiness, state, pipelineTask, tasks, currentStage);
        const progress = resolveProgress(stage.key, readiness, state, tasks, questionCount);
        return <li key={stage.key} className={"quiz-v2-stage is-" + status} aria-label={`${stage.label}: ${progress.completed} of ${progress.total} ${progress.unit} complete, ${progress.percent}%`}>
          <span className="quiz-v2-stage-icon">{status === "ready" ? <CheckCircle size={16} weight="fill" /> : status === "failed" ? <WarningCircle size={16} weight="fill" /> : status === "running" ? <CircleNotch className="spin" size={16} /> : <span>{index + 1}</span>}</span>
          <div><strong>{stage.label}</strong><span>{statusLabel(status)}</span><span className="quiz-v2-stage-progress">{progress.completed}/{progress.total} {progress.unit} · {progress.percent}%</span><span className="quiz-v2-stage-track" aria-hidden="true"><span style={{ width: `${progress.percent}%` }} /></span></div>
        </li>;
      })}
    </ol>
    {state.assessment ? <QuizV2Assessment assessment={state.assessment} /> : <QuizV2PendingAssessment />}
  </section>;
}

function resolveStatus(stage: RailStage, index: number, readiness: Readiness, state: QuizV2State, pipelineTask: Task | null, tasks: Task[], currentStage: { key: RailStage; label: string } | null): RailStatus {
  const base = baseStatus(stage, readiness, state);
  const failedStage = pipelineTask?.status === "FAILED" ? currentStage?.key : null;
  if (failedStage === stage) return "failed";

  const currentIndex = currentStage ? stages.findIndex((candidate) => candidate.key === currentStage.key) : -1;
  if (pipelineTask && isTaskActive(pipelineTask) && currentIndex >= 0) {
    if (index < currentIndex) return "ready";
    if (index === currentIndex) return "running";
    if (base !== "ready") return "queued";
  }

  const childTask = latestRelevantTask(stage, tasks);
  if ((childTask?.status === "FAILED" || childTask?.status === "CANCELLED") && base !== "ready") return "failed";
  if (childTask && isTaskActive(childTask)) return "running";
  if (currentStage) {
    if (pipelineTask?.status === "FAILED" && index < currentIndex) return "ready";
  }
  return base;
}

function baseStatus(stage: RailStage, readiness: Readiness, state: QuizV2State): RailStatus {
  if (stage === "research") return readiness.research ? "ready" : "not_started";
  if (stage === "treatment") return readiness.treatment ? "ready" : "not_started";
  if (stage === "script") return readiness.script ? "ready" : "not_started";
  if (stage === "visualBible") return readiness.visualBible ? "ready" : "not_started";
  if (stage === "scenes") return readiness.scenes ? "ready" : "not_started";
  if (stage === "render") return readiness.video ? "ready" : state.stages.render;
  return state.stages[stage];
}

function resolveProgress(stage: RailStage, readiness: Readiness, state: QuizV2State, tasks: Task[], questionCount: number): StageProgress {
  const questionTotal = Math.max(0, questionCount || state.quiz?.questions.length || 0);
  if (stage === "questions") return itemProgress(state.quiz?.questions.length ?? 0, questionTotal, "questions");
  if (stage === "director") return itemProgress(state.director_plan?.beats.length ?? 0, questionTotal || state.director_plan?.beats.length || 1, "beats");
  if (stage === "assets") {
    const total = state.asset_plan?.assets.length ?? 0;
    return total > 0 ? itemProgress(state.asset_resolution?.assets.length ?? 0, total, "assets") : itemProgress(state.asset_plan ? 1 : 0, 1, "task");
  }
  if (stage === "voice") {
    const segments = state.voice_plan?.segments ?? [];
    return segments.length > 0 ? itemProgress(segments.filter((segment) => segment.duration_seconds !== null).length, segments.length, "segments") : itemProgress(0, 1, "task");
  }
  if (stage === "timeline") {
    const coveredQuestions = new Set((state.timeline?.events ?? []).filter((event) => event.question_id).map((event) => event.question_id)).size;
    return questionTotal > 0 ? itemProgress(coveredQuestions, questionTotal, "questions") : itemProgress(state.timeline ? 1 : 0, 1, "task");
  }
  if (stage === "qa") return itemProgress(state.assessment ? 1 : 0, 1, "check");
  if (stage === "scenes") {
    const sequenceTasks = tasks.filter((task) => task.task_type === "GENERATE_SEQUENCE_SCENES");
    return sequenceTasks.length > 0 ? sequenceTaskProgress(sequenceTasks, questionTotal) : itemProgress(readiness.scenes ? 1 : 0, 1, "task");
  }
  const taskTypes: Partial<Record<RailStage, Task["task_type"][]>> = {
    research: ["GENERATE_RESEARCH"],
    treatment: ["GENERATE_TREATMENT"],
    script: ["GENERATE_SCRIPT"],
    visualBible: ["GENERATE_VISUAL_BIBLE"],
    render: ["GENERATE_VIDEO"],
  };
  const taskTypeList = taskTypes[stage];
  if (taskTypeList) {
    const task = latestTask(tasks, taskTypeList);
    return task ? taskProgress([task], "task") : itemProgress(stage === "research" ? Number(readiness.research) : stage === "treatment" ? Number(readiness.treatment) : stage === "script" ? Number(readiness.script) : stage === "visualBible" ? Number(readiness.visualBible) : Number(readiness.video), 1, "task");
  }
  return itemProgress(0, 1, "task");
}

function itemProgress(completed: number, total: number, unit: string): StageProgress {
  const safeTotal = Math.max(1, total);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completed));
  return { completed: safeCompleted, total: safeTotal, percent: Math.round((safeCompleted / safeTotal) * 100), unit };
}

function taskProgress(tasks: Task[], unit: string): StageProgress {
  const completed = tasks.filter((task) => task.status === "COMPLETED").length;
  const fallback = itemProgress(completed, tasks.length, unit);
  if (tasks.length === 1 && isTaskActive(tasks[0]) && typeof tasks[0].progress_percent === "number") return { ...fallback, percent: tasks[0].progress_percent };
  return fallback;
}

function sequenceTaskProgress(tasks: Task[], expectedTotal: number): StageProgress {
  const latestBySequence = new Map<number, Task>();
  for (const task of [...tasks].sort((left, right) => right.created_at.localeCompare(left.created_at))) {
    if (task.scene_number !== null && !latestBySequence.has(task.scene_number)) latestBySequence.set(task.scene_number, task);
  }
  const total = Math.max(expectedTotal, latestBySequence.size);
  const completed = [...latestBySequence.values()].filter((task) => task.status === "COMPLETED").length;
  return itemProgress(completed, total, "tasks");
}

function latestRelevantTask(stage: RailStage, tasks: Task[]): Task | null {
  const types: Partial<Record<RailStage, Task["task_type"][]>> = {
    research: ["GENERATE_RESEARCH"],
    treatment: ["GENERATE_TREATMENT"],
    script: ["GENERATE_SCRIPT"],
    visualBible: ["GENERATE_VISUAL_BIBLE"],
    scenes: ["GENERATE_SCENES", "GENERATE_SEQUENCE_SCENES"],
    render: ["GENERATE_VIDEO"],
  };
  const stageTypes = types[stage];
  if (!stageTypes) return null;
  const matching = tasks.filter((task) => stageTypes.includes(task.task_type));
  if (stage === "scenes") return matching.sort((a, b) => b.created_at.localeCompare(a.created_at)).find((task) => isTaskActive(task) || task.status === "FAILED" || task.status === "CANCELLED") ?? null;
  return latestTask(tasks, stageTypes);
}

function pipelineStage(task: Task | null): { key: RailStage; label: string } | null {
  if (!task || (!isTaskActive(task) && task.status !== "FAILED")) return null;
  const text = `${task.error ?? ""} ${task.progress_message ?? ""}`.toLowerCase();
  const match = text.includes("research") ? "research"
    : text.includes("treatment") ? "treatment"
      : text.includes("narration script") || text.includes("script") ? "script"
        : text.includes("visual bible") ? "visualBible"
          : text.includes("shot plan") || text.includes("sequence") ? "scenes"
            : text.includes("question facts") || text.includes("quiz · locking") ? "questions"
              : text.includes("directing") || text.includes("director") ? "director"
                : text.includes("semantic assets") || text.includes("resolving") ? "assets"
                  : text.includes("voice") || text.includes("narration") ? "voice"
                    : text.includes("timeline") ? "timeline"
                      : text.includes("qa") || text.includes("quality") ? "qa"
                        : text.includes("video") || text.includes("render") || text.includes("composition") ? "render"
                          : null;
  return match ? stages.find((stage) => stage.key === match) ?? null : null;
}

function QuizV2Assessment({ assessment }: { assessment: QuizAssessment }) {
  const blockers = assessment.issues.filter((issue) => issue.severity === "blocker");
  return <div className={"quiz-v2-assessment " + assessment.rating}><div className="quiz-v2-score"><strong>{assessment.score}</strong><span>QA score</span></div><div><strong>{assessment.rating.replaceAll("_", " ")}</strong><span>{blockers.length ? blockers.length + " blocker" + (blockers.length === 1 ? "" : "s") : "No blockers"}</span></div>{blockers.length ? <ul>{blockers.slice(0, 3).map((issue) => <li key={issue.code}><strong>{issue.message}</strong><span>{issue.next_action}</span></li>)}</ul> : null}</div>;
}

function QuizV2PendingAssessment() {
  return <div className="quiz-v2-assessment pending" aria-label="Quiz QA score not assessed"><div className="quiz-v2-score"><strong>—</strong><span>Quiz QA score</span></div><div><strong>Not assessed</strong><span>Available after Timeline and QA</span></div></div>;
}

function statusLabel(status: RailStatus): string {
  if (status === "not_started") return "Not started";
  if (status === "queued") return "Waiting";
  return status.replaceAll("_", " ");
}
