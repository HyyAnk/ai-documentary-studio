import type { Task } from "@studio/shared";
import { formatTaskElapsed, isTaskActive } from "../lib/utils";

export function InlineTaskState({ task, now }: { task: Task; now: number }) { return <div className={`inline-task-state ${task.status.toLowerCase()}`} role="status"><span className="task-status-dot" /><strong>{task.status === "COMPLETED" ? "Updated" : task.status === "FAILED" ? "Failed" : task.status === "CANCELLED" ? "Cancelled" : task.progress_message || "Working"}</strong><span>{task.error || task.progress_message}</span><time>{formatTaskElapsed(task, now)}</time>{isTaskActive(task) ? <div className="inline-task-track"><span /></div> : null}</div>; }
