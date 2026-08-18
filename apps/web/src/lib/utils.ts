import type { Task } from "@studio/shared";

export function formatTaskType(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase()); }
export function formatTaskStatus(value: Task["status"]): string { return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase()); }
export function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
export function formatElapsed(start: string, end: number): string { const seconds = Math.max(0, Math.floor((end - new Date(start).getTime()) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
export function formatTaskElapsed(task: Task, now: number): string { return formatElapsed(task.started_at || task.created_at, task.completed_at ? new Date(task.completed_at).getTime() : now); }
export function isTaskActive(task: Task): boolean { return ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(task.status); }
export function isTaskTerminal(task: Task): boolean { return ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status); }
export function latestTask(tasks: Task[], types: Task["task_type"][], sceneNumber?: number): Task | null { return tasks.filter((task) => types.includes(task.task_type) && (sceneNumber === undefined || task.scene_number === sceneNumber)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null; }
export function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CH"; }
