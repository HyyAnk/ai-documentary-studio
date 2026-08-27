import { useState, useMemo, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowClockwise,
  ListChecks,
  FilmSlate,
  CheckCircle,
  CircleNotch,
  X,
  Clock,
  WarningCircle,
  MagnifyingGlass,
  Funnel,
  SquaresFour,
  Table as TableIcon,
  Trash,
  Copy,
  Check,
  FileText,
  Info,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import type { Channel, Task } from "@studio/shared";
import { api, type RealtimeStatus } from "../api";
import {
  formatTaskElapsed,
  formatTaskType,
  formatTaskStatus,
  isTaskActive,
  formatDate,
} from "../lib/utils";
import { EmptyState } from "./EmptyState";
import { PageTitle } from "./AppChrome";
import type { Notice } from "./types";

export type StatusFilter = "all" | "running" | "queued" | "failed" | "completed";

export type ProductionItemSummary = {
  id: string;
  channelId: string;
  channelName: string;
  episodeId: string | null;
  episodeTitle: string;
  isChannelTask: boolean;
  tasks: Task[];
  activeTask: Task | null;
  latestTask: Task;
  status: Task["status"];
  progressPercent: number;
  progressMessage: string;
  queuePosition: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  accumulatedSeconds: number;
};

function calculateProgress(task: Task | null, fallbackStatus: Task["status"]): number {
  if (!task) {
    return fallbackStatus === "COMPLETED" ? 100 : 0;
  }
  if (task.status === "COMPLETED") return 100;
  if (task.progress_percent !== null && task.progress_percent !== undefined && task.progress_percent > 0) {
    return task.progress_percent;
  }
  if (task.status === "QUEUED") return 0;
  switch (task.task_type) {
    case "GENERATE_RESEARCH": return 5;
    case "GENERATE_TREATMENT": return 10;
    case "GENERATE_SCRIPT": return 20;
    case "GENERATE_VISUAL_BIBLE": return 30;
    case "GENERATE_SEQUENCE_SCENES":
    case "GENERATE_SCENES": return 40;
    case "GENERATE_BUNDLE_IMAGE": return 55;
    case "GENERATE_NARRATION":
    case "GENERATE_AUDIO": return 75;
    case "GENERATE_VIDEO": return 90;
    case "GENERATE_PIPELINE": return 10;
    case "SUGGEST_TOPICS": return 50;
    case "GENERATE_DNA": return 50;
    default: return 15;
  }
}

export function TaskActivityBar({
  tasks,
  realtimeStatus,
  now,
  onOpenTasks,
  onOpenEpisode,
}: {
  tasks: Task[];
  realtimeStatus: RealtimeStatus;
  now: number;
  onOpenTasks: () => void;
  onOpenEpisode?: (channelId: string, episodeId: string) => void;
}) {
  if (tasks.length === 0 && realtimeStatus === "connected") return null;
  const task = tasks[0] ?? null;
  const reconnecting = realtimeStatus !== "connected";

  const handleAction = () => {
    if (task && task.channel_id && task.episode_id && onOpenEpisode) {
      onOpenEpisode(task.channel_id, task.episode_id);
    } else {
      onOpenTasks();
    }
  };

  const progress = task ? calculateProgress(task, task.status) : 0;

  return (
    <div className={`task-activity-bar ${reconnecting ? "is-reconnecting" : ""}`} role="status">
      <div className="task-activity-signal">
        <span className="live-pulse" />
        <span>{reconnecting ? "Reconnecting live updates" : `${tasks.length} active ${tasks.length === 1 ? "task" : "tasks"}`}</span>
      </div>
      {task ? (
        <>
          <div className="task-activity-copy">
            <strong>{formatTaskType(task.task_type)}</strong>
            <span>{task.progress_message || formatTaskStatus(task.status)}</span>
          </div>
          <span className="task-activity-time">{formatTaskElapsed(task, now)}</span>
          <div className="task-activity-track" role="progressbar" aria-label="Active task progress" aria-valuetext={`${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
        <div className="task-activity-copy">
          <strong>Reconnecting</strong>
          <span>Data will automatically sync once connection is restored.</span>
        </div>
      )}
      <button className="text-button" onClick={handleAction}>
        {task?.episode_id ? "Production Rail" : "View Tasks"} <ArrowUpRight size={14} />
      </button>
    </div>
  );
}

export function TaskRow({ task, now }: { task: Task; now: number }) {
  return (
    <div className="activity-row">
      <div className={`task-status-dot ${task.status.toLowerCase()}`} />
      <div>
        <strong>{formatTaskType(task.task_type)}</strong>
        <span>{task.error || task.progress_message || formatTaskStatus(task.status)}</span>
      </div>
      <span className="task-elapsed">{formatTaskElapsed(task, now)}</span>
    </div>
  );
}

/* ==========================================================================
   Task Detail & Error Inspection Drawer (Slide-Over Panel)
   ========================================================================== */
function TaskDetailDrawer({
  item,
  task,
  now,
  onClose,
  onCancel,
  onRetry,
  onOpenEpisode,
}: {
  item: ProductionItemSummary | null;
  task: Task | null;
  now: number;
  onClose: () => void;
  onCancel: (task: Task) => void;
  onRetry: (task: Task) => void;
  onOpenEpisode?: (channelId: string, episodeId: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!item && !task) return null;
  const targetTask = task || item?.activeTask || item?.latestTask;
  if (!targetTask) return null;

  const isRunning = targetTask.status === "RUNNING";
  const isQueued = targetTask.status === "QUEUED";
  const isFailed = targetTask.status === "FAILED";
  const isCompleted = targetTask.status === "COMPLETED";

  const handleCopyError = () => {
    if (targetTask.error) {
      void navigator.clipboard.writeText(targetTask.error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="task-drawer-overlay" onClick={onClose}>
      <aside className="task-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="task-drawer-header">
          <div className="task-drawer-title-group">
            <span className="eyebrow">Task Details</span>
            <h2>{formatTaskType(targetTask.task_type)}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close drawer" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="task-drawer-body">
          {/* Status Banner */}
          <div className={`task-drawer-status-banner is-${targetTask.status.toLowerCase()}`}>
            <div className="task-drawer-status-left">
              {isRunning ? (
                <CircleNotch size={20} className="spin accent-icon" />
              ) : isQueued ? (
                <Clock size={20} className="yellow-icon" />
              ) : isCompleted ? (
                <CheckCircle size={20} weight="fill" className="green-icon" />
              ) : isFailed ? (
                <WarningCircle size={20} weight="fill" className="coral-icon" />
              ) : (
                <ListChecks size={20} />
              )}
              <div>
                <strong>{formatTaskStatus(targetTask.status)}</strong>
                <span>
                  {targetTask.progress_message ||
                    (isRunning
                      ? "Task currently running on engine"
                      : isQueued
                      ? `Position #${(targetTask.queue_position ?? 0) + 1} in build queue`
                      : isCompleted
                      ? "Execution finished successfully"
                      : "Execution failed")}
                </span>
              </div>
            </div>
            {targetTask.progress_percent !== null && targetTask.progress_percent !== undefined && (
              <span className="task-drawer-percent">{targetTask.progress_percent}%</span>
            )}
          </div>

          {/* Error Callout (if Failed) */}
          {targetTask.error && (
            <div className="task-drawer-section error-section">
              <div className="section-title-row">
                <span className="section-label coral-text">
                  <WarningCircle size={14} weight="fill" /> Error Details & Stack
                </span>
                <button className="text-button copy-btn" onClick={handleCopyError}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? "Copied" : "Copy Error"}</span>
                </button>
              </div>
              <div className="task-error-code-wrap">
                <pre className="task-error-code">{targetTask.error}</pre>
              </div>
            </div>
          )}

          {/* Key-Value Information Grid */}
          <div className="task-drawer-section">
            <span className="section-label">Execution Info</span>
            <div className="task-info-grid">
              <div className="task-info-item">
                <span className="info-key">Channel</span>
                <strong className="info-val">{item?.channelName || targetTask.channel_id}</strong>
              </div>
              <div className="task-info-item">
                <span className="info-key">Episode / Topic</span>
                <strong className="info-val">{item?.episodeTitle || targetTask.episode_id || "Channel Level"}</strong>
              </div>
              {targetTask.scene_number !== null && targetTask.scene_number !== undefined && (
                <div className="task-info-item">
                  <span className="info-key">Scene</span>
                  <strong className="info-val">Scene #{targetTask.scene_number}</strong>
                </div>
              )}
              <div className="task-info-item">
                <span className="info-key">Elapsed Duration</span>
                <strong className="info-val">{formatTaskElapsed(targetTask, now)}</strong>
              </div>
              <div className="task-info-item">
                <span className="info-key">Created At</span>
                <span className="info-val">{formatDate(targetTask.created_at)}</span>
              </div>
              {targetTask.started_at && (
                <div className="task-info-item">
                  <span className="info-key">Started At</span>
                  <span className="info-val">{formatDate(targetTask.started_at)}</span>
                </div>
              )}
              {targetTask.completed_at && (
                <div className="task-info-item">
                  <span className="info-key">Completed At</span>
                  <span className="info-val">{formatDate(targetTask.completed_at)}</span>
                </div>
              )}
              <div className="task-info-item">
                <span className="info-key">Task ID</span>
                <span className="info-val code-text">{targetTask.task_id}</span>
              </div>
            </div>
          </div>

          {/* Output Files (if any) */}
          {targetTask.output_files && targetTask.output_files.length > 0 && (
            <div className="task-drawer-section">
              <span className="section-label">Generated Output Files ({targetTask.output_files.length})</span>
              <ul className="task-output-list">
                {targetTask.output_files.map((file, idx) => (
                  <li key={idx} className="task-output-item">
                    <FileText size={14} className="file-icon" />
                    <span>{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Drawer Footer Actions */}
        <div className="task-drawer-footer">
          {isTaskActive(targetTask) ? (
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                onCancel(targetTask);
                onClose();
              }}
            >
              <X size={15} />
              <span>Cancel Task</span>
            </button>
          ) : isFailed ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onRetry(targetTask);
                onClose();
              }}
            >
              <ArrowClockwise size={15} />
              <span>Retry Task</span>
            </button>
          ) : null}

          {targetTask.episode_id && onOpenEpisode && (
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                onOpenEpisode(targetTask.channel_id, targetTask.episode_id!);
                onClose();
              }}
            >
              <span>Production Rail</span>
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ==========================================================================
   Streamlined Task Card (Clean, Breathable, Topic-Oriented)
   ========================================================================== */
function StreamlinedTaskCard({
  item,
  now,
  onOpenEpisode,
  onCancel,
  onRetry,
  onInspect,
}: {
  item: ProductionItemSummary;
  now: number;
  onOpenEpisode?: (channelId: string, episodeId: string) => void;
  onCancel: (task: Task) => void;
  onRetry: (task: Task) => void;
  onInspect: (item: ProductionItemSummary) => void;
}) {
  const isRunning = item.status === "RUNNING";
  const isQueued = item.status === "QUEUED";
  const isFailed = item.status === "FAILED";
  const isCompleted = item.status === "COMPLETED";

  const targetTask = item.activeTask || item.latestTask;

  return (
    <article className={`streamlined-task-card is-${item.status.toLowerCase()}`}>
      {/* Top Bar: Channel Tag & Status Pill */}
      <div className="task-card-header">
        <div className="task-card-channel-group">
          <span className="task-card-channel-pill">{item.channelName}</span>
          {item.episodeId ? (
            <span className="task-card-ep-pill">EP · {item.episodeId.slice(-4).toUpperCase()}</span>
          ) : (
            <span className="task-card-channel-level-pill">Channel Task</span>
          )}
        </div>

        <div className="task-card-status-badges">
          {item.queuePosition !== null && isQueued ? (
            <span className="queue-position-pill">Queue #{item.queuePosition + 1}</span>
          ) : null}
          <span className={`task-status-chip is-${item.status.toLowerCase()}`}>
            {isRunning ? (
              <>
                <CircleNotch size={12} className="spin" />
                <span>Running</span>
              </>
            ) : isQueued ? (
              <>
                <Clock size={12} />
                <span>Queued</span>
              </>
            ) : isCompleted ? (
              <>
                <CheckCircle size={12} weight="fill" />
                <span>Completed</span>
              </>
            ) : isFailed ? (
              <>
                <WarningCircle size={12} weight="fill" />
                <span>Failed</span>
              </>
            ) : (
              formatTaskStatus(item.status)
            )}
          </span>
        </div>
      </div>

      {/* Main Title: Episode Topic Title */}
      <div className="task-card-title-row" onClick={() => onInspect(item)} title="Click to view full details">
        <h3 className="task-card-topic-title">
          {item.episodeTitle || formatTaskType(targetTask.task_type)}
        </h3>
        <span className="task-card-type-subtext">{formatTaskType(targetTask.task_type)}</span>
      </div>

      {/* Clean Progress Bar & Message */}
      <div className="task-card-progress-section">
        <div className="task-card-progress-info">
          <span className="task-card-progress-msg">
            {item.progressMessage ||
              (isRunning
                ? "Processing in progress..."
                : isQueued
                ? "Waiting for execution slot..."
                : isCompleted
                ? "Generation completed"
                : "Execution stopped")}
          </span>
          <span className="task-card-progress-pct">{item.progressPercent}%</span>
        </div>
        <div
          className="task-card-progress-track"
          role="progressbar"
          aria-valuenow={item.progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`task-card-progress-fill is-${item.status.toLowerCase()}`}
            style={{ width: `${Math.max(isRunning ? 6 : 0, Math.min(100, item.progressPercent))}%` }}
          />
        </div>
      </div>

      {/* Error Callout Box (if Failed) */}
      {isFailed && item.error && (
        <div className="task-card-error-callout" onClick={() => onInspect(item)}>
          <WarningCircle size={15} weight="fill" className="coral-icon" />
          <p className="task-card-error-text">{item.error}</p>
          <span className="task-card-view-log-link">View Log &rarr;</span>
        </div>
      )}

      {/* Card Footer: Elapsed Time + Direct Action Buttons */}
      <div className="task-card-footer">
        <div className="task-card-meta">
          <Clock size={13} className="meta-icon" />
          <span>{formatTaskElapsed(targetTask, now)}</span>
          {targetTask.completed_at ? (
            <span className="task-card-meta-date">· {formatDate(targetTask.completed_at)}</span>
          ) : null}
        </div>

        <div className="task-card-actions">
          <button
            type="button"
            className="quiet-button compact icon-only"
            title="Inspect task details & logs"
            aria-label="View task details"
            onClick={() => onInspect(item)}
          >
            <Info size={15} />
          </button>

          {isTaskActive(targetTask) ? (
            <button
              type="button"
              className="quiet-button danger compact"
              title="Cancel execution"
              onClick={() => onCancel(targetTask)}
            >
              <X size={14} />
              <span>Cancel</span>
            </button>
          ) : isFailed ? (
            <button
              type="button"
              className="primary-button compact"
              title="Retry task"
              onClick={() => onRetry(targetTask)}
            >
              <ArrowClockwise size={14} />
              <span>Retry</span>
            </button>
          ) : null}

          {item.episodeId && onOpenEpisode ? (
            <button
              type="button"
              className="quiet-button compact ep-rail-btn"
              title="Open in Production Rail"
              onClick={() => onOpenEpisode(item.channelId, item.episodeId!)}
            >
              <span>Rail</span>
              <ArrowUpRight size={13} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* ==========================================================================
   Compact Table View Component (Dense & High Efficiency)
   ========================================================================== */
function CompactTaskTable({
  items,
  now,
  onOpenEpisode,
  onCancel,
  onRetry,
  onInspect,
}: {
  items: ProductionItemSummary[];
  now: number;
  onOpenEpisode?: (channelId: string, episodeId: string) => void;
  onCancel: (task: Task) => void;
  onRetry: (task: Task) => void;
  onInspect: (item: ProductionItemSummary) => void;
}) {
  return (
    <div className="task-compact-table-wrap">
      <table className="task-compact-table">
        <thead>
          <tr>
            <th style={{ width: "120px" }}>Status</th>
            <th>Topic / Episode</th>
            <th style={{ width: "140px" }}>Channel</th>
            <th style={{ width: "180px" }}>Task Type</th>
            <th>Progress / Details</th>
            <th style={{ width: "130px" }}>Duration</th>
            <th style={{ width: "140px", textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const targetTask = item.activeTask || item.latestTask;
            const isRunning = item.status === "RUNNING";
            const isQueued = item.status === "QUEUED";
            const isFailed = item.status === "FAILED";
            const isCompleted = item.status === "COMPLETED";

            return (
              <tr key={item.id} className={`task-table-row is-${item.status.toLowerCase()}`}>
                {/* Status Column */}
                <td>
                  <span className={`task-status-chip compact is-${item.status.toLowerCase()}`}>
                    {isRunning ? (
                      <CircleNotch size={12} className="spin" />
                    ) : isQueued ? (
                      <Clock size={12} />
                    ) : isCompleted ? (
                      <CheckCircle size={12} weight="fill" />
                    ) : isFailed ? (
                      <WarningCircle size={12} weight="fill" />
                    ) : null}
                    <span>{formatTaskStatus(item.status)}</span>
                  </span>
                </td>

                {/* Topic / Episode Column */}
                <td>
                  <div className="table-topic-cell" onClick={() => onInspect(item)}>
                    <strong className="table-topic-title">
                      {item.episodeTitle || (item.episodeId ? `EP · ${item.episodeId.slice(-4).toUpperCase()}` : "Channel Operation")}
                    </strong>
                    {item.episodeId && (
                      <span className="table-topic-ep-code">EP · {item.episodeId.slice(-4).toUpperCase()}</span>
                    )}
                  </div>
                </td>

                {/* Channel Column */}
                <td>
                  <span className="table-channel-name">{item.channelName}</span>
                </td>

                {/* Task Type Column */}
                <td>
                  <span className="table-type-label">{formatTaskType(targetTask.task_type)}</span>
                </td>

                {/* Progress / Detail Column */}
                <td>
                  <div className="table-progress-cell">
                    <div className="table-progress-bar-wrap">
                      <div className="table-progress-track">
                        <div
                          className={`table-progress-fill is-${item.status.toLowerCase()}`}
                          style={{ width: `${item.progressPercent}%` }}
                        />
                      </div>
                      <span className="table-progress-pct">{item.progressPercent}%</span>
                    </div>
                    <span className="table-progress-msg">
                      {item.error || item.progressMessage || (isCompleted ? "Finished" : "")}
                    </span>
                  </div>
                </td>

                {/* Duration Column */}
                <td>
                  <span className="table-duration-text">{formatTaskElapsed(targetTask, now)}</span>
                </td>

                {/* Actions Column */}
                <td style={{ textAlign: "right" }}>
                  <div className="table-actions-cell">
                    <button
                      type="button"
                      className="quiet-button compact icon-only"
                      title="Inspect details"
                      onClick={() => onInspect(item)}
                    >
                      <Info size={14} />
                    </button>

                    {isTaskActive(targetTask) ? (
                      <button
                        type="button"
                        className="quiet-button danger compact icon-only"
                        title="Cancel task"
                        onClick={() => onCancel(targetTask)}
                      >
                        <X size={14} />
                      </button>
                    ) : isFailed ? (
                      <button
                        type="button"
                        className="quiet-button compact icon-only"
                        title="Retry task"
                        onClick={() => onRetry(targetTask)}
                      >
                        <ArrowClockwise size={14} />
                      </button>
                    ) : null}

                    {item.episodeId && onOpenEpisode ? (
                      <button
                        type="button"
                        className="quiet-button compact icon-only"
                        title="Open Production Rail"
                        onClick={() => onOpenEpisode(item.channelId, item.episodeId!)}
                      >
                        <ArrowUpRight size={14} />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ==========================================================================
   Main Tasks View
   ========================================================================== */
export function TasksView({
  tasks,
  channels = [],
  now,
  onRefresh,
  onNotice,
  onOpenEpisode,
}: {
  tasks: Task[];
  channels?: Channel[];
  now: number;
  onRefresh: () => Promise<void>;
  onNotice: (notice: NonNullable<Notice>) => void;
  onOpenEpisode?: (channelId: string, episodeId: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"cards" | "table">(() => {
    return (window.localStorage.getItem("studio-tasks-view-mode") as "cards" | "table") || "cards";
  });
  const [selectedInspectItem, setSelectedInspectItem] = useState<ProductionItemSummary | null>(null);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set());
  const [episodeTitleMap, setEpisodeTitleMap] = useState<Map<string, string>>(new Map());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const channelMap = useMemo(() => new Map(channels.map((c) => [c.channel_id, c.display_name])), [channels]);

  // Load episode titles for channels to replace raw hash IDs with meaningful names
  useEffect(() => {
    let isCancelled = false;
    const fetchEpisodeTitles = async () => {
      const titleMap = new Map<string, string>();
      await Promise.all(
        channels.map(async (channel) => {
          try {
            const res = await api.episodes(channel.channel_id);
            if (res.episodes) {
              res.episodes.forEach((ep) => {
                if (ep.topic?.title) {
                  titleMap.set(ep.episode_id, ep.topic.title);
                }
              });
            }
          } catch {
            // Ignore background title load errors
          }
        })
      );
      if (!isCancelled) {
        setEpisodeTitleMap(titleMap);
      }
    };

    if (channels.length > 0) {
      void fetchEpisodeTitles();
    }
    return () => {
      isCancelled = true;
    };
  }, [channels]);

  const handleViewModeChange = (mode: "cards" | "table") => {
    setViewMode(mode);
    window.localStorage.setItem("studio-tasks-view-mode", mode);
  };

  // Group and structure all production items (both episode-level and channel-level)
  const productionItems = useMemo(() => {
    const epMap = new Map<string, Task[]>();
    const channelTasks: Task[] = [];

    for (const task of tasks) {
      if (dismissedTaskIds.has(task.task_id)) continue;
      if (task.episode_id) {
        const existing = epMap.get(task.episode_id) || [];
        existing.push(task);
        epMap.set(task.episode_id, existing);
      } else {
        channelTasks.push(task);
      }
    }

    const list: ProductionItemSummary[] = [];

    // Episode-grouped items
    for (const [episodeId, epTasks] of epMap.entries()) {
      const sorted = [...epTasks].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const activeTask = sorted.find(isTaskActive) ?? null;
      const latestTask = sorted[0]!;
      const status = activeTask ? activeTask.status : latestTask.status;
      const channelId = latestTask.channel_id;
      const channelName = channelMap.get(channelId) || "Channel";
      const episodeTitle = episodeTitleMap.get(episodeId) || `Episode · ${episodeId.slice(-6).toUpperCase()}`;
      const progressPercent = calculateProgress(activeTask, status);
      const progressMessage =
        activeTask?.progress_message || latestTask.progress_message || (status === "COMPLETED" ? "Video build completed" : "");

      list.push({
        id: `ep-${episodeId}`,
        channelId,
        channelName,
        episodeId,
        episodeTitle,
        isChannelTask: false,
        tasks: sorted,
        activeTask,
        latestTask,
        status,
        progressPercent,
        progressMessage,
        queuePosition: activeTask?.queue_position ?? null,
        error: activeTask?.error || latestTask.error || null,
        startedAt: activeTask?.started_at || latestTask.started_at || latestTask.created_at,
        completedAt: latestTask.completed_at,
        accumulatedSeconds: latestTask.accumulated_duration_seconds || 0,
      });
    }

    // Channel-level standalone tasks (like SUGGEST_TOPICS, GENERATE_DNA)
    for (const task of channelTasks) {
      const status = task.status;
      const channelId = task.channel_id;
      const channelName = channelMap.get(channelId) || "Channel";
      const progressPercent = calculateProgress(task, status);

      list.push({
        id: `task-${task.task_id}`,
        channelId,
        channelName,
        episodeId: null,
        episodeTitle: formatTaskType(task.task_type),
        isChannelTask: true,
        tasks: [task],
        activeTask: isTaskActive(task) ? task : null,
        latestTask: task,
        status,
        progressPercent,
        progressMessage: task.progress_message || (status === "COMPLETED" ? "Operation finished" : ""),
        queuePosition: task.queue_position,
        error: task.error,
        startedAt: task.started_at || task.created_at,
        completedAt: task.completed_at,
        accumulatedSeconds: task.accumulated_duration_seconds || 0,
      });
    }

    // Sorting: RUNNING first (0), QUEUED (1), WAITING_APPROVAL (2), FAILED (3), COMPLETED (4)
    return list.sort((a, b) => {
      const rank = (s: Task["status"]) =>
        s === "RUNNING" ? 0 : s === "QUEUED" ? 1 : s === "WAITING_APPROVAL" ? 2 : s === "FAILED" ? 3 : 4;
      const rankDiff = rank(a.status) - rank(b.status);
      if (rankDiff !== 0) return rankDiff;
      return b.startedAt.localeCompare(a.startedAt);
    });
  }, [tasks, dismissedTaskIds, channelMap, episodeTitleMap]);

  // Overall status count metrics for interactive KPI chips
  const totalCount = productionItems.length;
  const runningCount = productionItems.filter((i) => i.status === "RUNNING").length;
  const queuedCount = productionItems.filter((i) => i.status === "QUEUED").length;
  const failedCount = productionItems.filter((i) => i.status === "FAILED").length;
  const completedCount = productionItems.filter((i) => i.status === "COMPLETED").length;

  // Filtered list based on Status, Channel, and Search Query
  const filteredItems = useMemo(() => {
    return productionItems.filter((item) => {
      // Status filter
      if (statusFilter === "running" && item.status !== "RUNNING") return false;
      if (statusFilter === "queued" && item.status !== "QUEUED") return false;
      if (statusFilter === "failed" && item.status !== "FAILED") return false;
      if (statusFilter === "completed" && item.status !== "COMPLETED") return false;

      // Channel filter
      if (channelFilter !== "all" && item.channelId !== channelFilter) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchTitle = item.episodeTitle.toLowerCase().includes(query);
        const matchChannel = item.channelName.toLowerCase().includes(query);
        const matchType = formatTaskType(item.latestTask.task_type).toLowerCase().includes(query);
        const matchEpId = item.episodeId?.toLowerCase().includes(query) ?? false;
        if (!matchTitle && !matchChannel && !matchType && !matchEpId) {
          return false;
        }
      }

      return true;
    });
  }, [productionItems, statusFilter, channelFilter, searchQuery]);

  // Actions
  const cancel = async (task: Task) => {
    try {
      await api.cancelTask(task.task_id);
      onNotice({ tone: "good", message: "Task cancelled" });
      await onRefresh();
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Failed to cancel task" });
    }
  };

  const retry = async (task: Task) => {
    try {
      await api.createTask({
        task_type: task.task_type,
        channel_id: task.channel_id,
        episode_id: task.episode_id,
        scene_number: task.scene_number,
      });
      onNotice({ tone: "good", message: `${formatTaskType(task.task_type)} added to queue` });
      await onRefresh();
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Failed to retry task" });
    }
  };

  const clearCompleted = () => {
    const completedIds = new Set<string>();
    productionItems
      .filter((i) => i.status === "COMPLETED")
      .forEach((item) => {
        item.tasks.forEach((t) => completedIds.add(t.task_id));
      });

    setDismissedTaskIds((prev) => {
      const next = new Set(prev);
      completedIds.forEach((id) => next.add(id));
      return next;
    });
    onNotice({ tone: "good", message: "Cleared completed tasks from view" });
  };

  const retryAllFailed = async () => {
    const failedTasks = productionItems.filter((i) => i.status === "FAILED").map((i) => i.activeTask || i.latestTask);
    if (failedTasks.length === 0) return;

    try {
      for (const t of failedTasks) {
        await api.createTask({
          task_type: t.task_type,
          channel_id: t.channel_id,
          episode_id: t.episode_id,
          scene_number: t.scene_number,
        });
      }
      onNotice({ tone: "good", message: `Retried ${failedTasks.length} failed ${failedTasks.length === 1 ? "task" : "tasks"}` });
      await onRefresh();
    } catch (err) {
      onNotice({ tone: "bad", message: err instanceof Error ? err.message : "Failed to retry all" });
    }
  };

  const cancelAllQueued = async () => {
    const queuedTasks = tasks.filter((t) => t.status === "QUEUED");
    if (queuedTasks.length === 0) return;

    try {
      await Promise.all(queuedTasks.map((t) => api.cancelTask(t.task_id)));
      onNotice({ tone: "good", message: `Cancelled ${queuedTasks.length} queued tasks` });
      await onRefresh();
    } catch (err) {
      onNotice({ tone: "bad", message: err instanceof Error ? err.message : "Failed to cancel queue" });
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <section className="page-wrap task-manager-page">
      {/* Top Header */}
      <PageTitle
        eyebrow="Operations & Jobs"
        title="Task Manager"
        action={
          <div className="task-header-actions">
            {/* View Mode Toggle (Cards vs Table) */}
            <div className="task-view-toggle" role="tablist" aria-label="View Layout">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "cards"}
                className={`task-view-toggle-btn ${viewMode === "cards" ? "is-active" : ""}`}
                onClick={() => handleViewModeChange("cards")}
                title="Streamlined Cards View"
              >
                <SquaresFour size={15} />
                <span>Cards</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "table"}
                className={`task-view-toggle-btn ${viewMode === "table" ? "is-active" : ""}`}
                onClick={() => handleViewModeChange("table")}
                title="Compact Table View"
              >
                <TableIcon size={15} />
                <span>Table</span>
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              className="quiet-button"
              onClick={() => void handleManualRefresh()}
              disabled={isRefreshing}
            >
              <ArrowClockwise size={15} className={isRefreshing ? "spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        }
      />

      {/* Interactive KPI Filter Bar */}
      <div className="task-kpi-bar" role="tablist" aria-label="Task Status Filters">
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === "all"}
          className={`task-kpi-chip ${statusFilter === "all" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("all")}
        >
          <span className="kpi-label">All Tasks</span>
          <span className="kpi-count">{totalCount}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === "running"}
          className={`task-kpi-chip is-running ${statusFilter === "running" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("running")}
        >
          {runningCount > 0 && <span className="live-dot-pulse" />}
          <span className="kpi-label">Running</span>
          <span className="kpi-count">{runningCount}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === "queued"}
          className={`task-kpi-chip is-queued ${statusFilter === "queued" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("queued")}
        >
          <span className="kpi-label">Queued</span>
          <span className="kpi-count">{queuedCount}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === "failed"}
          className={`task-kpi-chip is-failed ${statusFilter === "failed" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("failed")}
        >
          <span className="kpi-label">Failed</span>
          <span className={`kpi-count ${failedCount > 0 ? "has-errors" : ""}`}>{failedCount}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === "completed"}
          className={`task-kpi-chip is-completed ${statusFilter === "completed" ? "is-active" : ""}`}
          onClick={() => setStatusFilter("completed")}
        >
          <span className="kpi-label">Completed</span>
          <span className="kpi-count">{completedCount}</span>
        </button>
      </div>

      {/* Toolbar: Search, Channel Selector, Batch Actions */}
      <div className="task-toolbar">
        <div className="task-toolbar-left">
          {/* Search Box */}
          <div className="task-search-box">
            <MagnifyingGlass size={14} className="search-icon" />
            <input
              type="search"
              placeholder="Search by topic, channel, task type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search tasks"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Channel Selector */}
          {channels.length > 1 && (
            <div className="task-channel-filter-wrap">
              <Funnel size={13} className="channel-filter-icon" />
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="task-channel-select"
                aria-label="Filter by channel"
              >
                <option value="all">All Channels</option>
                {channels.map((ch) => (
                  <option key={ch.channel_id} value={ch.channel_id}>
                    {ch.display_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Batch Action Buttons */}
        <div className="task-toolbar-right">
          {failedCount > 0 && (
            <button
              type="button"
              className="quiet-button compact warn-btn"
              onClick={() => void retryAllFailed()}
              title="Retry all failed tasks"
            >
              <ArrowsClockwise size={13} />
              <span>Retry Failed ({failedCount})</span>
            </button>
          )}

          {queuedCount > 0 && (
            <button
              type="button"
              className="quiet-button danger compact"
              onClick={() => void cancelAllQueued()}
              title="Cancel all queued tasks"
            >
              <X size={13} />
              <span>Cancel Queue ({queuedCount})</span>
            </button>
          )}

          {completedCount > 0 && (
            <button
              type="button"
              className="quiet-button compact"
              onClick={clearCompleted}
              title="Clear completed tasks from this view"
            >
              <Trash size={13} />
              <span>Clear Done</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={<FilmSlate size={32} />}
          title={
            searchQuery
              ? "No tasks match your search"
              : statusFilter !== "all"
              ? `No ${statusFilter} tasks`
              : "No tasks found"
          }
          copy={
            searchQuery
              ? "Try adjusting your search terms or reset the channel filter."
              : "When you generate videos, topics, or scripts, live operations will appear here."
          }
          action={searchQuery ? "Clear Search" : "Refresh"}
          onAction={searchQuery ? () => setSearchQuery("") : () => void handleManualRefresh()}
        />
      ) : viewMode === "cards" ? (
        <div className="streamlined-task-grid">
          {filteredItems.map((item) => (
            <StreamlinedTaskCard
              key={item.id}
              item={item}
              now={now}
              onOpenEpisode={onOpenEpisode}
              onCancel={cancel}
              onRetry={retry}
              onInspect={setSelectedInspectItem}
            />
          ))}
        </div>
      ) : (
        <CompactTaskTable
          items={filteredItems}
          now={now}
          onOpenEpisode={onOpenEpisode}
          onCancel={cancel}
          onRetry={retry}
          onInspect={setSelectedInspectItem}
        />
      )}

      {/* Slide-over Task Detail & Error Drawer */}
      <TaskDetailDrawer
        item={selectedInspectItem}
        task={null}
        now={now}
        onClose={() => setSelectedInspectItem(null)}
        onCancel={cancel}
        onRetry={retry}
        onOpenEpisode={onOpenEpisode}
      />
    </section>
  );
}


