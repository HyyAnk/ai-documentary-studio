import { isTaskActive, formatTaskElapsed } from "../lib/utils";
import type { Task } from "@studio/shared";

export function TaskProgressPanel({ task, title, activeLabel, completionLabel, now, compact = false, progressLabel = `${title} progress` }: { task: Task; title: string; activeLabel: string; completionLabel: string; now: number; compact?: boolean; progressLabel?: string }) {
  const active = isTaskActive(task);
  const completed = task.status === "COMPLETED";
  const failed = task.status === "FAILED";
  const cancelled = task.status === "CANCELLED";
  const label = completed ? completionLabel : failed ? `${title} failed` : cancelled ? `${title} cancelled` : task.status === "WAITING_APPROVAL" ? "Waiting for approval" : activeLabel;
  const progressMessage = task.error || task.progress_message || task.status;
  return <div className={`task-progress-panel ${task.status.toLowerCase()} ${compact ? "is-compact" : ""}`} role="status"><div className="task-progress-head"><div className="task-progress-title"><span className="eyebrow">{title}</span><strong>{label}</strong></div><span className="task-progress-time">{formatTaskElapsed(task, now)}</span></div><div className="task-progress-track" role="progressbar" aria-label={progressLabel} aria-valuetext={completed ? "Complete" : failed ? "Failed" : cancelled ? "Cancelled" : progressMessage}><span className="task-progress-fill" /></div><p className="task-progress-copy">{progressMessage}{active ? " - updates appear here automatically" : ""}</p></div>;
}

export function TopicProgress({ task, now }: { task: Task; now: number }) { return <TaskProgressPanel task={task} title="Topic generation" activeLabel="Generating 5 topics" completionLabel="5 topics ready" progressLabel="Topic generation progress" now={now} />; }
