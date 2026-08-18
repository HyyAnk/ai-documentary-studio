import { formatTaskElapsed } from "../lib/utils";
import type { Task } from "@studio/shared";

export function TaskProgressPanel({ task, title, activeLabel, completionLabel, now, compact = false, progressLabel = `${title} progress` }: { task: Task; title: string; activeLabel: string; completionLabel: string; now: number; compact?: boolean; progressLabel?: string }) {
  const completed = task.status === "COMPLETED";
  const failed = task.status === "FAILED";
  const cancelled = task.status === "CANCELLED";
  const label = completed ? completionLabel.replace(new RegExp(`^${title}\\s*`, "i"), "") || "Ready" : failed ? "Failed" : cancelled ? "Cancelled" : task.status === "WAITING_APPROVAL" ? "Waiting for approval" : activeLabel;
  const progressMessage = task.error || task.progress_message || task.status;
  const percent = completed ? 100 : typeof task.progress_percent === "number" ? task.progress_percent : null;
  return <div className={`task-progress-panel ${task.status.toLowerCase()} ${compact ? "is-compact" : ""}`} role="status"><div className="task-progress-head"><div className="task-progress-title"><span className="eyebrow">{title}</span><strong>{label}</strong></div><span className="task-progress-time">{percent !== null ? `${Math.round(percent)}% · ` : ""}{formatTaskElapsed(task, now)}</span></div><div className={`task-progress-track ${percent === null ? "is-indeterminate" : ""}`} role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={completed ? "Complete" : failed ? "Failed" : cancelled ? "Cancelled" : progressMessage}><span className="task-progress-fill" style={percent === null ? undefined : { transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})` }} /></div>{!completed && (failed || cancelled || Boolean(task.error)) && progressMessage ? <p className="task-progress-copy">{progressMessage}</p> : null}</div>;
}

export function TopicProgress({ task, now }: { task: Task; now: number }) { return <TaskProgressPanel task={task} title="Topic generation" activeLabel="Generating 5 topics" completionLabel="5 topics ready" progressLabel="Topic generation progress" now={now} />; }
