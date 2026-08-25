import { useState, useMemo } from "react";
import { ArrowUpRight, ArrowClockwise, ListChecks, FilmSlate, CheckCircle, CircleNotch, X, Play, Clock, Sparkle, WarningCircle, Rows, Stack, VideoCamera } from "@phosphor-icons/react";
import type { Channel, Task } from "@studio/shared";
import { api, type RealtimeStatus } from "../api";
import { formatTaskElapsed, formatTaskType, formatTaskStatus, isTaskActive, formatDate } from "../lib/utils";
import { EmptyState } from "./EmptyState";
import { PageTitle } from "./AppChrome";
import { TaskTableRow } from "./TaskTableRow";
import type { Notice } from "./types";

export type EpisodeBuildSummary = {
  channelId: string;
  channelName: string;
  episodeId: string;
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

const PIPELINE_STAGES = [
  { id: "research", label: "Research", percent: 3 },
  { id: "treatment", label: "Treatment", percent: 6 },
  { id: "script", label: "Script", percent: 12 },
  { id: "visual", label: "Visual Bible", percent: 18 },
  { id: "shots", label: "Shots", percent: 25 },
  { id: "media", label: "Voice & Ảnh", percent: 55 },
  { id: "video", label: "Render Video", percent: 100 },
];

function calculateEpisodeProgress(task: Task | null, fallbackStatus: Task["status"]): number {
  if (!task) {
    return fallbackStatus === "COMPLETED" ? 100 : 0;
  }
  if (task.status === "COMPLETED") return 100;
  if (task.progress_percent !== null && task.progress_percent !== undefined && task.progress_percent > 0) {
    return task.progress_percent;
  }
  if (task.status === "QUEUED") return 0;
  switch (task.task_type) {
    case "GENERATE_RESEARCH": return 3;
    case "GENERATE_TREATMENT": return 6;
    case "GENERATE_SCRIPT": return 12;
    case "GENERATE_VISUAL_BIBLE": return 18;
    case "GENERATE_SEQUENCE_SCENES":
    case "GENERATE_SCENES": return 25;
    case "GENERATE_BUNDLE_IMAGE": return 32;
    case "GENERATE_NARRATION":
    case "GENERATE_AUDIO": return 48;
    case "GENERATE_VIDEO": return 70;
    case "GENERATE_PIPELINE": return 5;
    default: return 10;
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

  const progress = task ? calculateEpisodeProgress(task, task.status) : 0;

  return (
    <div className={`task-activity-bar ${reconnecting ? "is-reconnecting" : ""}`} role="status">
      <div className="task-activity-signal">
        <span className="live-pulse" />
        <span>{reconnecting ? "Reconnecting live updates" : `${tasks.length} ${tasks.length === 1 ? "tác vụ" : "tác vụ"} đang chạy`}</span>
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
          <strong>Đang kết nối lại</strong>
          <span>Dữ liệu sẽ tự động đồng bộ khi kết nối hoàn tất.</span>
        </div>
      )}
      <button className="text-button" onClick={handleAction}>
        {task?.episode_id ? "Theo dõi Production Rail" : "Xem tác vụ"} <ArrowUpRight size={14} />
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

function EpisodeProgressCard({
  summary,
  now,
  onOpenEpisode,
  onCancel,
  onRetry,
}: {
  summary: EpisodeBuildSummary;
  now: number;
  onOpenEpisode?: (channelId: string, episodeId: string) => void;
  onCancel: (task: Task) => void;
  onRetry: (task: Task) => void;
}) {
  const isRunning = summary.status === "RUNNING";
  const isQueued = summary.status === "QUEUED";
  const isFailed = summary.status === "FAILED";
  const isCompleted = summary.status === "COMPLETED";

  const targetTask = summary.activeTask || summary.latestTask;

  return (
    <article className={`episode-progress-card ${isRunning ? "is-running" : ""} ${isQueued ? "is-queued" : ""} ${isFailed ? "is-failed" : ""}`}>
      <div className="ep-card-header">
        <div className="ep-card-title-group">
          <div className="ep-card-icon">
            {isRunning ? (
              <CircleNotch size={18} className="spin accent-icon" />
            ) : isQueued ? (
              <Clock size={18} className="yellow-icon" />
            ) : isCompleted ? (
              <CheckCircle size={18} weight="fill" className="green-icon" />
            ) : isFailed ? (
              <WarningCircle size={18} weight="fill" className="coral-icon" />
            ) : (
              <FilmSlate size={18} />
            )}
          </div>
          <div>
            <div className="ep-card-channel-label">{summary.channelName}</div>
            <h3 className="ep-card-title">Episode · {summary.episodeId.slice(-6).toUpperCase()}</h3>
          </div>
        </div>

        <div className="ep-card-status-badges">
          {summary.queuePosition !== null && isQueued ? (
            <span className="queue-position-pill">#{summary.queuePosition + 1} Hàng chờ</span>
          ) : null}
          <span className={`ep-status-pill ${summary.status.toLowerCase()}`}>
            {isRunning ? "Đang xử lý" : isQueued ? "Đang chờ slot" : isCompleted ? "Hoàn thành" : isFailed ? "Thất bại" : formatTaskStatus(summary.status)}
          </span>
        </div>
      </div>

      {/* Progress Bar & Percentage */}
      <div className="ep-progress-bar-wrap">
        <div className="ep-progress-info">
          <span className="ep-progress-stage-text">
            {summary.progressMessage || (isRunning ? "Đang tiến hành sản xuất..." : isQueued ? "Đang xếp hàng chờ đến lượt build..." : isCompleted ? "Video đã sẵn sàng" : "Đã dừng")}
          </span>
          <strong className="ep-progress-percentage">{summary.progressPercent}%</strong>
        </div>
        <div className="ep-progress-track" role="progressbar" aria-valuenow={summary.progressPercent} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={`ep-progress-fill ${isCompleted ? "is-done" : isFailed ? "is-error" : isRunning ? "is-active" : ""}`}
            style={{ width: `${Math.max(4, summary.progressPercent)}%` }}
          />
        </div>
      </div>

      {/* Visual Pipeline Stages */}
      <div className="ep-pipeline-stages">
        {PIPELINE_STAGES.map((stage, idx) => {
          const isDone = summary.progressPercent >= stage.percent || isCompleted;
          const prevPercent = idx === 0 ? 0 : PIPELINE_STAGES[idx - 1]!.percent;
          const isCurrent = isRunning && summary.progressPercent >= prevPercent && summary.progressPercent < stage.percent;
          return (
            <div key={stage.id} className={`pipeline-stage-step ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`} title={`${stage.label} (~${stage.percent}%)`}>
              <span className="stage-dot" />
              <span className="stage-label">{stage.label}</span>
            </div>
          );
        })}
      </div>

      {/* Card Footer */}
      <div className="ep-card-footer">
        <div className="ep-card-meta">
          <span className="ep-card-time-label">Thời gian:</span>
          <strong>{formatTaskElapsed(targetTask, now)}</strong>
          {targetTask.completed_at ? (
            <span className="ep-card-date">({formatDate(targetTask.completed_at)})</span>
          ) : null}
        </div>

        <div className="ep-card-actions">
          {isTaskActive(targetTask) ? (
            <button
              type="button"
              className="quiet-button danger compact"
              title="Hủy tiến trình Episode này"
              onClick={() => onCancel(targetTask)}
            >
              <X size={14} />
              <span>Hủy</span>
            </button>
          ) : isFailed ? (
            <button
              type="button"
              className="quiet-button compact"
              title="Thử lại tiến trình"
              onClick={() => onRetry(targetTask)}
            >
              <ArrowClockwise size={14} />
              <span>Thử lại</span>
            </button>
          ) : null}

          {onOpenEpisode ? (
            <button
              type="button"
              className="primary-button compact ep-rail-btn"
              title="Mở Episode để theo dõi chi tiết trên Production Rail"
              onClick={() => onOpenEpisode(summary.channelId, summary.episodeId)}
            >
              <span>Production Rail</span>
              <ArrowUpRight size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

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
  const [viewMode, setViewMode] = useState<"episodes" | "raw">("episodes");
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.channel_id, c.display_name])), [channels]);

  const episodeSummaries = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.episode_id) {
        const existing = map.get(task.episode_id) || [];
        existing.push(task);
        map.set(task.episode_id, existing);
      }
    }

    const summaries: EpisodeBuildSummary[] = [];
    for (const [episodeId, epTasks] of map.entries()) {
      const sorted = [...epTasks].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const activeTask = sorted.find(isTaskActive) ?? null;
      const latestTask = sorted[0]!;
      const status = activeTask ? activeTask.status : latestTask.status;
      const channelId = latestTask.channel_id;
      const channelName = channelMap.get(channelId) || "Channel";
      const progressPercent = calculateEpisodeProgress(activeTask, status);
      const progressMessage = activeTask?.progress_message || latestTask.progress_message || (status === "COMPLETED" ? "Đã dựng xong Video" : "");

      summaries.push({
        channelId,
        channelName,
        episodeId,
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

    // Sort: RUNNING first, then QUEUED, then WAITING_APPROVAL, then by created_at descending
    return summaries.sort((a, b) => {
      const rank = (s: Task["status"]) => (s === "RUNNING" ? 0 : s === "QUEUED" ? 1 : s === "WAITING_APPROVAL" ? 2 : 3);
      const rankDiff = rank(a.status) - rank(b.status);
      if (rankDiff !== 0) return rankDiff;
      return b.startedAt.localeCompare(a.startedAt);
    });
  }, [tasks, channelMap]);

  const activeBuildsCount = episodeSummaries.filter((s) => s.status === "RUNNING").length;
  const queuedBuildsCount = episodeSummaries.filter((s) => s.status === "QUEUED").length;
  const completedBuildsCount = episodeSummaries.filter((s) => s.status === "COMPLETED").length;

  const cancel = async (task: Task) => {
    try {
      await api.cancelTask(task.task_id);
      onNotice({ tone: "good", message: "Đã hủy tác vụ" });
      await onRefresh();
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Không thể hủy tác vụ" });
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
      onNotice({ tone: "good", message: `${formatTaskType(task.task_type)} đã được thêm vào hàng chờ` });
      await onRefresh();
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Không thể thử lại tác vụ" });
    }
  };

  return (
    <section className="page-wrap">
      <PageTitle
        eyebrow="Tiến trình sản xuất (Operations)"
        title="Tiến trình Episode & Video Builds"
        action={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div className="view-mode-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "episodes"}
                className={`view-mode-tab ${viewMode === "episodes" ? "is-active" : ""}`}
                onClick={() => setViewMode("episodes")}
              >
                <FilmSlate size={15} />
                <span>Tiến trình Episode</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "raw"}
                className={`view-mode-tab ${viewMode === "raw" ? "is-active" : ""}`}
                onClick={() => setViewMode("raw")}
              >
                <ListChecks size={15} />
                <span>Chi tiết kỹ thuật</span>
              </button>
            </div>
            <button className="quiet-button" onClick={() => void onRefresh()}>
              <ArrowClockwise size={16} />
              <span>Làm mới</span>
            </button>
          </div>
        }
      />

      {/* Metrics Summary Strip */}
      <div className="operations-metrics-strip">
        <div className="op-metric-card">
          <span className="op-metric-label">Đang Build</span>
          <strong className="op-metric-value accent-text">{activeBuildsCount}</strong>
          <span className="op-metric-hint">Episode đang chạy song song</span>
        </div>
        <div className="op-metric-card">
          <span className="op-metric-label">Trong hàng chờ</span>
          <strong className="op-metric-value yellow-text">{queuedBuildsCount}</strong>
          <span className="op-metric-hint">Đang đợi slot build</span>
        </div>
        <div className="op-metric-card">
          <span className="op-metric-label">Hoàn tất gần đây</span>
          <strong className="op-metric-value green-text">{completedBuildsCount}</strong>
          <span className="op-metric-hint">Tập đã dựng xong video</span>
        </div>
      </div>

      {viewMode === "episodes" ? (
        episodeSummaries.length === 0 ? (
          <EmptyState
            icon={<FilmSlate size={32} />}
            title="Chưa có Episode nào được build"
            copy="Khi bạn bấm tạo Video hoặc chạy Pipeline, tiến trình tổng thể của từng Episode sẽ xuất hiện tại đây."
            action="Làm mới"
            onAction={() => void onRefresh()}
          />
        ) : (
          <div className="episode-progress-grid">
            {episodeSummaries.map((summary) => (
              <EpisodeProgressCard
                key={summary.episodeId}
                summary={summary}
                now={now}
                onOpenEpisode={onOpenEpisode}
                onCancel={cancel}
                onRetry={retry}
              />
            ))}
          </div>
        )
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={26} />}
          title="Không có tác vụ nào"
          copy="Các tác vụ kỹ thuật chạy ngầm sẽ được liệt kê tại đây."
          action="Làm mới"
          onAction={() => void onRefresh()}
        />
      ) : (
        <div className="task-table">
          {tasks.map((task) => (
            <TaskTableRow
              key={task.task_id}
              task={task}
              now={now}
              onCancel={() => void cancel(task)}
              onRetry={() => void retry(task)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

