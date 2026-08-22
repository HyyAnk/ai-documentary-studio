import { Broadcast, CaretDown, Gear, GitBranch, House, Image, ListChecks, MoonStars, Power, Sun, TerminalWindow, X, CheckCircle, Sparkle, WarningCircle } from "@phosphor-icons/react";
import type { Channel, CodexSettingsResponse } from "@studio/shared";
import type { GitInfo, Notice, Page, Theme } from "./types";

export function Sidebar({ page, setPage, activeTaskCount }: { page: Page; setPage: (page: Page) => void; activeTaskCount: number }) {
  const items: Array<{ page: Page; label: string; icon: typeof House }> = [
    { page: "dashboard", label: "Dashboard", icon: House },
    { page: "channels", label: "Channels", icon: Broadcast },
    { page: "tasks", label: "Tasks", icon: ListChecks },
  ];
  return <aside className="sidebar"><div className="brand-lockup"><div className="brand-mark">QS</div><div><span className="brand-name">Quiz</span><span className="brand-subtitle">Studio</span></div></div><div className="sidebar-rule" /><nav className="primary-nav" aria-label="Primary navigation">{items.map(({ page: itemPage, label, icon: Icon }) => <button key={itemPage} className={`nav-item ${page === itemPage ? "is-active" : ""}`} onClick={() => setPage(itemPage)}><Icon size={18} weight={page === itemPage ? "fill" : "regular"} /><span>{label}</span>{itemPage === "tasks" && activeTaskCount > 0 ? <span className="nav-count">{activeTaskCount}</span> : null}</button>)}<button className={`nav-item mobile-settings-nav ${page === "settings" ? "is-active" : ""}`} aria-label="Settings" onClick={() => setPage("settings")}><Gear size={18} /><span>Settings</span></button></nav><div className="sidebar-bottom"><button className={`nav-item ${page === "settings" ? "is-active" : ""}`} onClick={() => setPage("settings")}><Gear size={18} /><span>Settings</span></button><div className="local-badge"><span className="status-dot" />Local workspace</div></div></aside>;
}

export function Topbar({
  channel,
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
        <span className="context-title">{channel?.display_name ?? "Overview"}</span>
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
            title="Chưa cấu hình API Key gpti2.store. Bấm vào đây để tới trang Cài đặt."
          >
            <WarningCircle size={14} weight="fill" className="key-warning-icon" />
            <span>Chưa nhập Image Key</span>
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
              <option value="gpt-image-2">gpt-image-2 (50đ)</option>
              <option value="nano-banana-2">nano-banana-2 (100đ - 2K)</option>
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
        <span className="git-readout">
          <GitBranch size={14} />
          {git.branch ?? "No Git"}
          {git.dirty ? <span className="dirty-dot" title={`${git.changed_files} changed files`} /> : null}
        </span>
        <button
          className="icon-button theme-toggle"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={onThemeToggle}
        >
          {theme === "dark" ? <Sun size={16} /> : <MoonStars size={16} />}
        </button>
        <button
          className="icon-button danger shutdown-button"
          title="Stop dashboard"
          aria-label="Stop dashboard"
          onClick={onShutdown}
        >
          <Power size={16} />
        </button>
      </div>
    </header>
  );
}

export function PageTitle({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: React.ReactNode }) { return <div className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{copy ? <p className="page-copy">{copy}</p> : null}</div>{action ? <div>{action}</div> : null}</div>; }
export function StatusLine({ label, value }: { label: string; value: string }) { return <div className="status-line"><span>{label}</span><strong>{value}</strong></div>; }
export function StatusBadge({ status }: { status: string }) { return <span className={`status-badge ${status.toLowerCase()}`}>{status.toLowerCase()}</span>; }
export function StageBadge({ stage }: { stage: string }) { return <span className="stage-badge">{stage.replaceAll("_", " ").toLowerCase()}</span>; }
export function NoticeBanner({ notice, onClose }: { notice: NonNullable<Notice>; onClose: () => void }) { return <div className={`notice-banner ${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"} aria-live={notice.tone === "bad" ? "assertive" : "polite"}><span>{notice.tone === "good" ? <CheckCircle size={18} /> : notice.tone === "bad" ? <WarningCircle size={18} /> : <Sparkle size={18} />}</span><span>{notice.message}</span><button aria-label="Close notification" onClick={onClose}><X size={15} /></button></div>; }
