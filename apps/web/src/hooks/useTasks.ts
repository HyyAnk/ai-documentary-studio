import { useCallback, useEffect, useState } from "react";
import type { Task, TaskEvent } from "@studio/shared";
import { api, subscribeEvents, type RealtimeStatus } from "../api";
import { isTaskActive, isTaskTerminal } from "../lib/utils";

export function useTasks(onTerminal?: (task: Task) => void) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [codexStatus, setCodexStatus] = useState("disconnected");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [now, setNow] = useState(() => Date.now());
  const upsertTask = useCallback((task: Task) => setTasks((current) => [task, ...current.filter((item) => item.task_id !== task.task_id)].sort((a, b) => b.created_at.localeCompare(a.created_at))), []);
  const refresh = useCallback(async () => { const response = await api.tasks(); setTasks(response.tasks); setCodexStatus(response.codex_status); return response; }, []);
  useEffect(() => {
    void refresh();
    return subscribeEvents((event: TaskEvent) => { if (event.status) setCodexStatus(event.status); if (event.task) upsertTask(event.task); if (event.type === "task.updated" && event.task && isTaskTerminal(event.task)) { onTerminal?.(event.task); void refresh(); } }, (status) => { setRealtimeStatus(status); if (status === "connected") void refresh(); });
  }, [onTerminal, refresh, upsertTask]);
  const activeTasks = tasks.filter(isTaskActive);
  useEffect(() => { if (activeTasks.length === 0) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [activeTasks.length]);
  return { tasks, activeTasks, now, codexStatus, realtimeStatus, setTasks, setCodexStatus, upsertTask, refresh };
}
