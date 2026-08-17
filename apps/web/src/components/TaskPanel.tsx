import { ArrowUpRight, ArrowClockwise, ListChecks } from "@phosphor-icons/react";
import type { Task } from "@studio/shared";
import { api, type RealtimeStatus } from "../api";
import { formatTaskElapsed, formatTaskType, isTaskActive } from "../lib/utils";
import { EmptyState } from "./EmptyState";
import { PageTitle } from "./AppChrome";
import { TaskTableRow } from "./TaskTableRow";
import type { Notice } from "./types";

export function TaskActivityBar({ tasks, realtimeStatus, now, onOpenTasks }: { tasks: Task[]; realtimeStatus: RealtimeStatus; now: number; onOpenTasks: () => void }) {
  if (tasks.length === 0 && realtimeStatus === "connected") return null;
  const task = tasks[0] ?? null;
  const reconnecting = realtimeStatus !== "connected";
  return <div className={`task-activity-bar ${reconnecting ? "is-reconnecting" : ""}`} role="status"><div className="task-activity-signal"><span className="live-pulse" /><span>{reconnecting ? "Reconnecting live updates" : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} active`}</span></div>{task ? <><div className="task-activity-copy"><strong>{formatTaskType(task.task_type)}</strong><span>{task.progress_message || task.status}</span></div><span className="task-activity-time">{formatTaskElapsed(task, now)}</span><div className="task-activity-track" role="progressbar" aria-label="Active task progress" aria-valuetext={task.progress_message || task.status}><span /></div></> : <div className="task-activity-copy"><strong>Restoring connection</strong><span>Results will sync automatically when the connection returns.</span></div>}<button className="text-button" onClick={onOpenTasks}>View tasks <ArrowUpRight size={14} /></button></div>;
}

export function TaskRow({ task, now }: { task: Task; now: number }) { return <div className={`activity-row ${isTaskActive(task) ? "is-processing" : ""}`}><div className={`task-status-dot ${task.status.toLowerCase()}`} /><div><strong>{formatTaskType(task.task_type)}</strong><span>{task.error || task.progress_message || task.status}</span></div><span className="task-elapsed">{formatTaskElapsed(task, now)}</span><span className="activity-status">{task.status}</span></div>; }

export function TasksView({ tasks, now, onRefresh, onNotice }: { tasks: Task[]; now: number; onRefresh: () => Promise<void>; onNotice: (notice: NonNullable<Notice>) => void }) {
  const cancel = async (task: Task) => { try { await api.cancelTask(task.task_id); onNotice({ tone: "good", message: "Task cancelled" }); await onRefresh(); } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not cancel task" }); } };
  return <section className="page-wrap"><PageTitle eyebrow="Operations" title="Tasks" action={<button className="quiet-button" onClick={() => void onRefresh()}><ArrowClockwise size={16} />Refresh</button>} />{tasks.length === 0 ? <EmptyState icon={<ListChecks size={26} />} title="No tasks yet" copy="Generated work will appear here." action="Refresh" onAction={() => void onRefresh()} /> : <div className="task-table">{tasks.map((task) => <TaskTableRow key={task.task_id} task={task} now={now} onCancel={() => void cancel(task)} />)}</div>}</section>;
}
