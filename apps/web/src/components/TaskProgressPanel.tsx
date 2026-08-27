import { useEffect, useRef, useState } from "react";
import { formatTaskElapsed, isTaskActive } from "../lib/utils";
import { Sparkle, Stop } from "@phosphor-icons/react";
import type { Task } from "@studio/shared";

const THINKING_STEPS_BY_STAGE: Record<string, string[]> = {
  research: [
    "Analyzing historical context & semantic topic depth",
    "Extracting high-engagement narrative hooks & facts",
    "Verifying pedagogical reference sources & truth consistency",
    "Synthesizing structured topic breakdown",
  ],
  treatment: [
    "Structuring 3-act narrative progression & tension curves",
    "Balancing question difficulty & cognitive engagement",
    "Calibrating viewer pacing & suspense checkpoints",
    "Generating creative treatment blueprint",
  ],
  script: [
    "Drafting conversational narration cadence & dialogue flow",
    "Refining punchy hooks, calibrated words & comedic timing",
    "Optimizing retention milestones across all sequences",
    "Validating speech rhythm & sentence clarity",
  ],
  visualBible: [
    "Constructing character & environment continuity anchors",
    "Locking visual DNA style tokens & prompt matrices",
    "Calibrating cinematic aspect ratios, lighting & palette",
    "Validating visual consistency gates across all bundles",
  ],
  scenes: [
    "Decomposing script into parallel shot compositions",
    "Computing camera angles, depth of field & kinetic zooms",
    "Harmonizing continuity bundle tags with scene visuals",
    "Synthesizing multi-sequence shot manifests",
  ],
  narration: [
    "Synthesizing neural voice audio with emotional inflection",
    "Calibrating phoneme durations & natural conversational pauses",
    "Balancing speech velocity against scene duration cuts",
    "Mastering audio waveforms & loudness normalization",
  ],
  video: [
    "Assembling HyperFrames render graph & multi-track timeline",
    "Composing dynamic motion overlays & countdown FX",
    "Synchronizing audio narration cues with visual transitions",
    "Compiling GPU hardware-accelerated master 1080p stream",
  ],
  general: [
    "Evaluating contextual dependencies & neural inputs",
    "Executing multi-agent generation pipeline",
    "Running automated production gate verifications",
    "Optimizing assembly artifacts & asset caches",
  ],
};

function resolveThinkingCategory(task: Task): string {
  const msg = (task.progress_message || "").toLowerCase();
  const type = task.task_type;

  if (type === "GENERATE_RESEARCH" || msg.includes("research")) return "research";
  if (type === "GENERATE_TREATMENT" || msg.includes("treatment")) return "treatment";
  if (type === "GENERATE_SCRIPT" || msg.includes("script") || msg.includes("writing")) return "script";
  if (type === "GENERATE_VISUAL_BIBLE" || msg.includes("visual") || msg.includes("bible")) return "visualBible";
  if (type === "GENERATE_SCENES" || type === "GENERATE_SEQUENCE_SCENES" || msg.includes("shot") || msg.includes("scene") || msg.includes("sequence")) return "scenes";
  if (type === "GENERATE_NARRATION" || type === "GENERATE_AUDIO" || msg.includes("audio") || msg.includes("narration") || msg.includes("voice")) return "narration";
  if (type === "GENERATE_VIDEO" || msg.includes("video") || msg.includes("render")) return "video";

  if (typeof task.progress_percent === "number") {
    const p = task.progress_percent;
    if (p < 8) return "research";
    if (p < 16) return "treatment";
    if (p < 25) return "script";
    if (p < 35) return "visualBible";
    if (p < 55) return "scenes";
    if (p < 75) return "narration";
    if (p < 95) return "video";
  }

  return "general";
}

function useThinkingStatus(task: Task, defaultActiveLabel: string, isActive: boolean): string {
  const [stepIndex, setStepIndex] = useState(0);
  const category = resolveThinkingCategory(task);
  const pool = THINKING_STEPS_BY_STAGE[category] ?? THINKING_STEPS_BY_STAGE.general;

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev + 1) % pool.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [isActive, pool]);

  if (!isActive) return defaultActiveLabel;

  const currentThought = pool[stepIndex % pool.length];

  if (task.progress_message && task.progress_message.includes(" · ")) {
    const stagePrefix = task.progress_message.split(" · ")[0].trim();
    return `${stagePrefix} · ${currentThought}…`;
  }

  return `${currentThought}…`;
}

function useContinuousProgress(task: Task, rawPercent: number | null): number | null {
  const active = isTaskActive(task);
  const completed = task.status === "COMPLETED";
  const failed = task.status === "FAILED";
  const cancelled = task.status === "CANCELLED";

  if (rawPercent === null && !active && !completed) {
    return null;
  }

  const initial = completed ? 100 : rawPercent ?? 0;
  const [displayPercent, setDisplayPercent] = useState<number>(initial);
  const backendTargetRef = useRef<number>(initial);

  // Synchronize with backend updates
  useEffect(() => {
    if (completed) {
      backendTargetRef.current = 100;
    } else if (typeof rawPercent === "number") {
      backendTargetRef.current = Math.max(backendTargetRef.current, rawPercent);
      setDisplayPercent((prev) => Math.max(prev, rawPercent));
    }
  }, [rawPercent, completed]);

  useEffect(() => {
    if (failed || cancelled) return;

    if (completed) {
      const timer = setInterval(() => {
        setDisplayPercent((prev) => {
          if (prev >= 100) {
            clearInterval(timer);
            return 100;
          }
          const step = Math.max(0.5, (100 - prev) * 0.25);
          return Math.min(100, prev + step);
        });
      }, 40);
      return () => clearInterval(timer);
    }

    if (!active) return;

    // Active continuous smooth trickle
    const interval = setInterval(() => {
      setDisplayPercent((prev) => {
        const anchor = backendTargetRef.current;
        // Ceiling for the current step (allows continuous tick up to +18% above backend anchor or 96% max)
        const ceiling = Math.min(96, Math.max(anchor + 18, prev + 2));

        if (prev < anchor) {
          // Rapid catch-up to backend anchor
          const diff = anchor - prev;
          const jump = Math.max(0.4, diff * 0.18);
          return Math.min(anchor, prev + jump);
        }

        if (prev < ceiling) {
          // Asymptotic deceleration trickle: smooth and constant
          const remaining = ceiling - prev;
          const delta = Math.max(0.08, remaining * 0.035);
          return Math.min(ceiling, prev + delta);
        }

        if (prev < 96) {
          // Micro crawl while waiting for a long backend step
          return prev + 0.04;
        }

        return prev;
      });
    }, 200);

    return () => clearInterval(interval);
  }, [active, completed, failed, cancelled]);

  return displayPercent;
}

export function TaskProgressPanel({
  task,
  title,
  activeLabel,
  completionLabel,
  now,
  compact = false,
  progressLabel = `${title} progress`,
  onCancel,
}: {
  task: Task;
  title: string;
  activeLabel: string;
  completionLabel: string;
  now: number;
  compact?: boolean;
  progressLabel?: string;
  onCancel?: (task: Task) => void;
}) {
  const active = isTaskActive(task);
  const completed = task.status === "COMPLETED";
  const failed = task.status === "FAILED";
  const cancelled = task.status === "CANCELLED";
  const thinkingLabel = useThinkingStatus(task, activeLabel, active);

  const label = completed
    ? completionLabel.replace(new RegExp(`^${title}\\s*`, "i"), "") || "Ready"
    : failed
    ? "Failed"
    : cancelled
    ? "Cancelled"
    : task.status === "WAITING_APPROVAL"
    ? "Waiting for approval"
    : thinkingLabel;

  const progressMessage = task.error || task.progress_message || task.status;
  const rawPercent = completed ? 100 : typeof task.progress_percent === "number" ? task.progress_percent : null;
  const percent = useContinuousProgress(task, rawPercent);

  return (
    <div className={`task-progress-panel ${task.status.toLowerCase()} ${compact ? "is-compact" : ""}`} role="status">
      <div className="task-progress-head">
        <div className="task-progress-title">
          <span className="eyebrow">{title}</span>
          <strong className={active ? "task-progress-thinking" : ""}>
            {active ? (
              <span className="task-thinking-pill">
                <Sparkle size={13} className="task-thinking-icon" weight="fill" />
                <span className="task-thinking-msg" key={label}>
                  {label}
                </span>
              </span>
            ) : (
              label
            )}
          </strong>
        </div>
        <div className="task-progress-meta">
          {percent !== null ? (
            <span className="task-progress-percent-badge">
              {Math.round(percent)}%
            </span>
          ) : null}
          <span className="task-progress-time">
            {formatTaskElapsed(task, now)}
          </span>
          {active && onCancel ? (
            <button
              type="button"
              className="danger-button compact stop-icon-btn"
              onClick={() => onCancel(task)}
              title="Stop task"
              aria-label={`Stop ${title}`}
            >
              <Stop size={12} weight="fill" />
              <span>Stop</span>
            </button>
          ) : null}
        </div>
      </div>
      <div
        className={`task-progress-track ${percent === null ? "is-indeterminate" : ""}`}
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={completed ? "Complete" : failed ? "Failed" : cancelled ? "Cancelled" : progressMessage}
      >
        <span
          className="task-progress-fill"
          style={percent === null ? undefined : { transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})` }}
        />
      </div>
      {!completed && (failed || cancelled || Boolean(task.error)) && progressMessage ? (
        <p className="task-progress-copy">{progressMessage}</p>
      ) : null}
    </div>
  );
}

export function TopicProgress({ task, now, onCancel }: { task: Task; now: number; onCancel?: (task: Task) => void }) {
  return (
    <TaskProgressPanel
      task={task}
      title="Topic generation"
      activeLabel="Generating 5 topics"
      completionLabel="5 topics ready"
      progressLabel="Topic generation progress"
      now={now}
      onCancel={onCancel}
    />
  );
}

