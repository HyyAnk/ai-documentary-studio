import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Broadcast, CaretDown, Check, CheckCircle, CircleNotch, FileText, Gear, House, Image, ListChecks, MoonStars, SpeakerHigh, Sparkle, Sun, TerminalWindow, VideoCamera, Wallet, WarningCircle, X } from "@phosphor-icons/react";
import type { Channel, CodexSettingsResponse } from "@studio/shared";
import type { GitInfo, Notice, Page, Theme } from "./types";

export function Sidebar({
  page,
  setPage,
  activeTaskCount,
  balanceInfo,
  loadingBalance = false,
  balanceError = null,
  onRefreshBalance,
  onOpenSettings,
}: {
  page: Page;
  setPage: (page: Page) => void;
  activeTaskCount: number;
  balanceInfo?: { balance_vnd: number; rpm?: number } | null;
  loadingBalance?: boolean;
  balanceError?: string | null;
  onRefreshBalance?: () => void;
  onOpenSettings?: () => void;
}) {
  const items: Array<{ page: Page; label: string; icon: typeof House }> = [
    { page: "dashboard", label: "Dashboard", icon: House },
    { page: "channels", label: "Channels", icon: Broadcast },
    { page: "tasks", label: "Tasks", icon: ListChecks },
  ];
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark" title="AI Quiz Studio">
          <Sparkle size={18} weight="fill" />
        </div>
        <div>
          <span className="brand-name">Quiz Studio</span>
          <span className="brand-subtitle">AI Video Engine</span>
        </div>
      </div>
      <div className="sidebar-rule" />
      <nav className="primary-nav" aria-label="Primary navigation">
        {items.map(({ page: itemPage, label, icon: Icon }) => (
          <button
            key={itemPage}
            className={`nav-item ${page === itemPage ? "is-active" : ""}`}
            onClick={() => setPage(itemPage)}
          >
            <Icon size={18} weight={page === itemPage ? "fill" : "regular"} />
            <span>{label}</span>
            {itemPage === "tasks" && activeTaskCount > 0 ? (
              <span className="nav-count">{activeTaskCount}</span>
            ) : null}
          </button>
        ))}
        <button
          className={`nav-item mobile-settings-nav ${page === "settings" ? "is-active" : ""}`}
          aria-label="Settings"
          onClick={() => setPage("settings")}
        >
          <Gear size={18} />
          <span>Settings</span>
        </button>
      </nav>
      <div className="sidebar-bottom">
        <div
          className="sidebar-balance-widget"
          title="gpti2.store Image API balance (Tự động cập nhật mỗi 30s)"
          style={{ cursor: !balanceInfo && onOpenSettings ? "pointer" : "default" }}
          onClick={() => {
            if (!balanceInfo && onOpenSettings) onOpenSettings();
          }}
        >
          <div className="sidebar-balance-header">
            <div className="sidebar-balance-title">
              <Wallet size={14} weight="duotone" />
              <span>API Balance</span>
            </div>
            <button
              type="button"
              className="sidebar-balance-refresh-btn"
              title="Cập nhật số dư API (Tự động mỗi 30s)"
              aria-label="Cập nhật số dư API"
              disabled={loadingBalance}
              onClick={(e) => {
                e.stopPropagation();
                onRefreshBalance?.();
              }}
            >
              <ArrowClockwise size={12} className={loadingBalance ? "spin" : ""} />
            </button>
          </div>
          <div className="sidebar-balance-amount">
            {balanceInfo !== null && balanceInfo !== undefined ? (
              <>
                <strong>{balanceInfo.balance_vnd.toLocaleString("vi-VN")}</strong>
                <span className="sidebar-balance-unit">đ</span>
              </>
            ) : balanceError ? (
              <span className="sidebar-balance-error" title={balanceError}>Chưa có Key</span>
            ) : (
              <span className="sidebar-balance-loading">Đang tải…</span>
            )}
          </div>
          {balanceInfo?.rpm ? (
            <div className="sidebar-balance-rpm">
              <span>RPM: {balanceInfo.rpm}</span>
            </div>
          ) : null}
        </div>

        <button
          className={`nav-item ${page === "settings" ? "is-active" : ""}`}
          onClick={() => setPage("settings")}
        >
          <Gear size={18} weight={page === "settings" ? "fill" : "regular"} />
          <span>Settings</span>
        </button>
        <div className="local-badge">
          <span className="status-dot" />
          <span>Local workspace</span>
        </div>
      </div>
    </aside>
  );
}

export function Topbar({
  channel,
  channels = [],
  onSelectChannel,
  activeEngine,
  engineStatus,
  git,
  currentModel,
  models,
  loadingModels = false,
  modelsError = null,
  currentImageModel = "gpt-image-2",
  hasImageApiKey = false,
  theme,
  onEngineToggle,
  onThemeToggle,
  onModelChange,
  onImageModelChange,
  onOpenImageSettings,
  onReconnect,
  onShutdown,
}: {
  channel: Channel | null;
  channels?: Channel[];
  onSelectChannel?: (channelId: string) => void;
  activeEngine: "codex" | "antigravity";
  engineStatus: string;
  git: GitInfo;
  currentModel: string;
  models: Array<{ id: string; label: string }>;
  loadingModels?: boolean;
  modelsError?: string | null;
  currentImageModel?: string;
  hasImageApiKey?: boolean;
  theme: Theme;
  onEngineToggle: (engine: "codex" | "antigravity") => Promise<void> | void;
  onThemeToggle: () => void;
  onModelChange: (model: string) => Promise<void>;
  onImageModelChange: (model: string) => Promise<void>;
  onOpenImageSettings?: () => void;
  onReconnect: () => void;
  onShutdown: () => void;
}) {
  const reconnectable = engineStatus === "disconnected" || engineStatus === "unavailable";
  const label = engineStatus === "connected" ? "Ready" : engineStatus === "connecting" ? "Connecting" : engineStatus === "disconnected" ? "Disconnected" : "Unavailable";
  const engineDefaultLabel = activeEngine === "antigravity" ? "Antigravity default (gemini-2.5-pro)" : "Codex default";

  return (
    <header className="topbar">
      <div className="context-trail">
        <span className="context-kicker">Workspace</span>
        {channels && channels.length > 0 ? (
          <div className="topbar-channel-selector">
            <select
              aria-label="Quick Switch Channel"
              value={channel?.channel_id ?? ""}
              onChange={(e) => {
                if (e.target.value) onSelectChannel?.(e.target.value);
              }}
            >
              <option value="" disabled={Boolean(channel)}>
                {channel ? channel.display_name : "Select Channel…"}
              </option>
              {channels.map((ch) => (
                <option key={ch.channel_id} value={ch.channel_id}>
                  {ch.engine === "quiz" ? "🎯 " : "🎬 "}
                  {ch.display_name}
                </option>
              ))}
            </select>
            <CaretDown size={12} className="selector-caret" />
          </div>
        ) : (
          <span className="context-title">{channel?.display_name ?? "Overview"}</span>
        )}
      </div>
      <div className="topbar-meta">
        <div className="engine-toggle-group" role="group" aria-label="Dual-Engine Selection">
          <button
            type="button"
            className={`engine-toggle-btn ${activeEngine === "codex" ? "is-active" : ""}`}
            onClick={() => void onEngineToggle("codex")}
            title="OpenAI Codex JSON-RPC Engine"
          >
            <TerminalWindow size={14} weight={activeEngine === "codex" ? "bold" : "regular"} />
            <span>Codex</span>
          </button>
          <button
            type="button"
            className={`engine-toggle-btn ${activeEngine === "antigravity" ? "is-active" : ""}`}
            onClick={() => void onEngineToggle("antigravity")}
            title="Google Antigravity Engine"
          >
            <Sparkle size={14} weight={activeEngine === "antigravity" ? "bold" : "regular"} />
            <span>Antigravity</span>
          </button>
        </div>

        {!hasImageApiKey ? (
          <button
            type="button"
            className="topbar-key-missing-btn"
            onClick={onOpenImageSettings}
            title="gpti2.store API Key is not configured. Click to open Settings."
          >
            <WarningCircle size={14} weight="fill" className="key-warning-icon" />
            <span>Missing Image Key</span>
          </button>
        ) : (
          <label className="model-select image-model-select" title="Image Generation Model (gpti2.store)">
            <Image size={13} style={{ marginRight: 2 }} />
            <span>Image</span>
            <CaretDown size={13} />
            <select
              aria-label="Image generation model"
              value={currentImageModel || "gpt-image-2"}
              onChange={(event) => void onImageModelChange(event.target.value)}
            >
              <option value="gpt-image-2">gpt-image-2 (50 VND)</option>
              <option value="nano-banana-2">nano-banana-2 (100 VND - 2K)</option>
            </select>
          </label>
        )}

        <label className="model-select">
          <span>Model</span>
          <CaretDown size={13} />
          {loadingModels ? (
            <select aria-label="Active engine model" disabled>
              <option>Loading models…</option>
            </select>
          ) : (
            <select
              aria-label="Active engine model"
              value={currentModel}
              onChange={(event) => void onModelChange(event.target.value)}
            >
              <option value="">{engineDefaultLabel}</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          )}
        </label>

        {modelsError ? (
          <span className="model-error-tooltip" title={modelsError}>
            <WarningCircle size={15} />
          </span>
        ) : null}

        <span className={`codex-pill ${engineStatus === "connected" ? "is-connected" : ""}`}>
          <span className="status-dot" />
          {label}
        </span>
        {reconnectable ? (
          <button className="link-button" onClick={onReconnect}>
            Reconnect
          </button>
        ) : null}
        <button
          className="icon-button theme-toggle"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={onThemeToggle}
        >
          {theme === "dark" ? <Sun size={16} /> : <MoonStars size={16} />}
        </button>
      </div>
    </header>
  );
}

export function PageTitle({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: React.ReactNode }) { return <div className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{copy ? <p className="page-copy">{copy}</p> : null}</div>{action ? <div>{action}</div> : null}</div>; }
export function StatusLine({ label, value }: { label: string; value: string }) { return <div className="status-line"><span>{label}</span><strong>{value}</strong></div>; }
export function StatusBadge({ status }: { status: string }) { return <span className={`status-badge ${status.toLowerCase()}`}>{status.toLowerCase()}</span>; }

export type ProductionStageCategory = "research" | "script" | "visual" | "timeline" | "assembly" | "final";

export type StageMetadata = {
  label: string;
  category: ProductionStageCategory;
  isReady: boolean;
};

export function getStageMetadata(stage: string): StageMetadata {
  switch (stage.toUpperCase()) {
    case "IDEA":
    case "SELECTED":
      return { label: "Idea Selected", category: "research", isReady: false };
    case "RESEARCH":
      return { label: "Researching", category: "research", isReady: false };
    case "RESEARCH_READY":
      return { label: "Research Ready", category: "research", isReady: true };
    case "TREATMENT":
      return { label: "Drafting Story", category: "research", isReady: false };
    case "TREATMENT_READY":
      return { label: "Treatment Ready", category: "research", isReady: true };
    case "SCRIPT":
      return { label: "Writing Script", category: "script", isReady: false };
    case "SCRIPT_READY":
      return { label: "Script Ready", category: "script", isReady: true };
    case "VISUAL_BIBLE":
      return { label: "Styling Visuals", category: "visual", isReady: false };
    case "VISUAL_BIBLE_READY":
      return { label: "Visual Ready", category: "visual", isReady: true };
    case "SCENE_BREAKDOWN":
      return { label: "Breaking Shots", category: "timeline", isReady: false };
    case "SCENE_READY":
      return { label: "Shots Ready", category: "timeline", isReady: true };
    case "NARRATION_READY":
      return { label: "Audio Ready", category: "assembly", isReady: true };
    case "READY_FOR_GENERATION":
      return { label: "Ready to Render", category: "assembly", isReady: true };
    case "VIDEO_RENDERING":
      return { label: "Rendering Video", category: "assembly", isReady: false };
    case "VIDEO_READY":
      return { label: "Video Ready", category: "final", isReady: true };
    default:
      return { label: stage.replaceAll("_", " ").toLowerCase(), category: "research", isReady: false };
  }
}

export function StageBadge({ stage, size = "md" }: { stage: string; size?: "sm" | "md" }) {
  const meta = getStageMetadata(stage);
  return (
    <span
      className={`stage-badge stage-cat-${meta.category} stage-size-${size} ${meta.isReady ? "is-ready" : "is-progress"}`}
    >
      <span className="stage-dot" />
      <span>{meta.label}</span>
    </span>
  );
}

export function EpisodeAssetPills({
  episode,
  tasks = [],
  compact = false,
}: {
  episode: {
    script_path?: string | null;
    visual_bible_path?: string | null;
    narration_asset_path?: string | null;
    narration_duration_seconds?: number | null;
    video_asset_path?: string | null;
    stage?: string;
  };
  tasks?: Array<{ task_type: string; status: string }>;
  compact?: boolean;
}) {
  const isTaskActiveLocal = (t: { status: string }) => t.status === "QUEUED" || t.status === "RUNNING";

  // Script status
  const scriptActive = tasks.some((t) => t.task_type === "GENERATE_SCRIPT" && isTaskActiveLocal(t));
  const scriptReady = Boolean(episode.script_path);

  // Visual status
  const visualActive = tasks.some((t) => t.task_type === "GENERATE_VISUAL_BIBLE" && isTaskActiveLocal(t));
  const visualReady = Boolean(episode.visual_bible_path);

  // Narration status
  const audioActive = tasks.some(
    (t) => (t.task_type === "GENERATE_NARRATION" || t.task_type === "GENERATE_AUDIO") && isTaskActiveLocal(t)
  );
  const audioReady = Boolean(episode.narration_asset_path);
  const audioSec = episode.narration_duration_seconds ? `${Math.round(episode.narration_duration_seconds)}s` : null;

  // Video status
  const videoActive = tasks.some((t) => t.task_type === "GENERATE_VIDEO" && isTaskActiveLocal(t));
  const videoReady = Boolean(episode.video_asset_path || episode.stage === "VIDEO_READY");

  return (
    <div className={`episode-asset-pills ${compact ? "is-compact" : ""}`} aria-label="Media asset status">
      {/* Script */}
      <span
        className={`asset-pill ${scriptReady ? "is-ready" : scriptActive ? "is-running" : "is-empty"}`}
        title={
          scriptReady
            ? "Narration Script: Ready"
            : scriptActive
            ? "Narration Script: Generating…"
            : "Narration Script: Not created"
        }
      >
        {scriptActive ? <CircleNotch size={11} className="spin" /> : <FileText size={11} />}
        <span>Script</span>
        {scriptReady ? <Check size={10} weight="bold" /> : null}
      </span>

      {/* Visual */}
      <span
        className={`asset-pill ${visualReady ? "is-ready" : visualActive ? "is-running" : "is-empty"}`}
        title={
          visualReady
            ? "Visual Identity: Ready"
            : visualActive
            ? "Visual Identity: Generating…"
            : "Visual Identity: Not created"
        }
      >
        {visualActive ? <CircleNotch size={11} className="spin" /> : <Image size={11} />}
        <span>Visual</span>
        {visualReady ? <Check size={10} weight="bold" /> : null}
      </span>

      {/* Audio */}
      <span
        className={`asset-pill ${audioReady ? "is-ready" : audioActive ? "is-running" : "is-empty"}`}
        title={
          audioReady
            ? `Narration Audio: Ready (${audioSec ?? "Complete"})`
            : audioActive
            ? "Narration Audio: Synthesizing…"
            : "Narration Audio: Not generated"
        }
      >
        {audioActive ? <CircleNotch size={11} className="spin" /> : <SpeakerHigh size={11} />}
        <span>Audio</span>
        {audioReady ? <Check size={10} weight="bold" /> : null}
      </span>

      {/* Video */}
      <span
        className={`asset-pill ${videoReady ? "is-final-ready" : videoActive ? "is-running" : "is-empty"}`}
        title={
          videoReady
            ? "Master Video: Rendered & Ready"
            : videoActive
            ? "Master Video: Rendering…"
            : "Master Video: Not rendered"
        }
      >
        {videoActive ? <CircleNotch size={11} className="spin" /> : <VideoCamera size={11} />}
        <span>Video</span>
        {videoReady ? <Check size={10} weight="bold" /> : null}
      </span>
    </div>
  );
}
export function NoticeBanner({ notice, onClose }: { notice: NonNullable<Notice>; onClose: () => void }) {
  const duration = notice.duration ?? 4200;
  const [isPaused, setIsPaused] = useState(false);
  const remainingRef = useRef(duration);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    remainingRef.current = duration;
    startTimeRef.current = Date.now();

    timerRef.current = setTimeout(() => {
      onClose();
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [notice, onClose, duration]);

  const handleMouseEnter = () => {
    setIsPaused(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    }
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
    startTimeRef.current = Date.now();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onClose();
    }, remainingRef.current);
  };

  const title = notice.title ?? (notice.tone === "bad" ? "Error" : undefined);

  return (
    <div
      className={`notice-banner ${notice.tone} ${isPaused ? "is-paused" : ""}`}
      role={notice.tone === "bad" ? "alert" : "status"}
      aria-live={notice.tone === "bad" ? "assertive" : "polite"}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="notice-icon-badge">
        {notice.tone === "good" ? (
          <CheckCircle size={18} weight="fill" />
        ) : notice.tone === "bad" ? (
          <WarningCircle size={18} weight="fill" />
        ) : (
          <Sparkle size={18} weight="fill" />
        )}
      </div>
      <div className="notice-content">
        {title ? <span className="notice-title">{title}</span> : null}
        <span className="notice-message">{notice.message}</span>
      </div>
      <button className="notice-close-btn" aria-label="Close notification" onClick={onClose}>
        <X size={14} weight="bold" />
      </button>
      <div className="notice-progress">
        <div
          key={notice.message}
          className="notice-progress-fill"
          style={{
            animationDuration: `${duration}ms`,
            animationPlayState: isPaused ? "paused" : "running",
          }}
        />
      </div>
    </div>
  );
}
