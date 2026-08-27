import { useState } from "react";
import {
  ArrowUpRight,
  Broadcast,
  ChartBar,
  CheckCircle,
  Cpu,
  CurrencyDollar,
  FilmSlate,
  FolderOpen,
  Image as ImageIcon,
  Lightning,
  Plus,
  SpeakerHigh,
  Trash,
  TrendUp,
  VideoCamera,
  Wallet,
} from "@phosphor-icons/react";
import type { AppConfig, Channel, StorageInfo, Task } from "@studio/shared";
import type { GitInfo, Page } from "./types";
import { PageTitle } from "./AppChrome";
import { EmptyState } from "./EmptyState";

export type ChannelGroupId = "quiz";

export function ChannelCard({
  channel,
  index,
  onOpen,
  onDelete,
}: {
  channel: Channel;
  index: number;
  onOpen: () => void;
  onDelete: (channel: Channel) => void;
}) {
  return (
    <article className="channel-card quiz-channel-card">
      <div className="card-top">
        <span className="channel-kind">Quiz Engine</span>
        <span className={`status-badge ${channel.status.toLowerCase()}`}>
          {channel.status.toLowerCase()}
        </span>
        <button
          type="button"
          className="icon-button danger channel-card-delete"
          title={`Delete ${channel.display_name}`}
          aria-label="Delete channel"
          onClick={() => onDelete(channel)}
        >
          <Trash size={16} />
        </button>
      </div>
      <button
        className="channel-card-open"
        aria-label={`${String(index).padStart(2, "0")} ${channel.display_name}`}
        onClick={onOpen}
      >
        <h3>{channel.display_name}</h3>
        {channel.description ? <p>{channel.description}</p> : null}
        <div className="card-bottom">
          <span>
            {channel.episode_count}{" "}
            {channel.episode_count === 1 ? "video" : "videos"}
          </span>
          <ArrowUpRight size={17} />
        </div>
      </button>
    </article>
  );
}

function Metric({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  note: string;
  icon?: typeof Broadcast;
}) {
  return (
    <div className="metric">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="metric-label">{label}</span>
        {Icon ? <Icon size={18} style={{ color: "var(--accent-deep)", opacity: 0.85 }} /> : null}
      </div>
      <strong>{value}</strong>
      <span className="metric-note">{note}</span>
    </div>
  );
}

function CostSavingsSection({
  voiceMetrics,
}: {
  voiceMetrics?: {
    rendered_characters: number;
    rendered_duration_seconds: number;
    rendered_segments_count: number;
    rendered_episodes_count: number;
  } | null;
}) {
  const elevenLabsRatePer1k = 0.10; // $0.10 per 1,000 characters
  const usdToVnd = 25500;

  const renderedChars = voiceMetrics?.rendered_characters || 0;
  const renderedSeconds = voiceMetrics?.rendered_duration_seconds || 0;

  const savedUsd = (renderedChars / 1000) * elevenLabsRatePer1k;
  const savedVnd = savedUsd * usdToVnd;

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header">
        <div className="dashboard-section-title">
          <CurrencyDollar size={18} weight="duotone" style={{ color: "var(--green)" }} />
          <h2>Voice Cost Savings (vs ElevenLabs $0.10 / 1K chars)</h2>
        </div>
      </div>

      <div className="savings-card">
        <div className="savings-metrics-row">
          <div className="savings-submetric">
            <span className="submetric-label">Estimated Savings</span>
            <strong className="submetric-val" style={{ color: "var(--green)" }}>
              ${savedUsd.toFixed(2)} USD{" "}
              <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 500 }}>
                ({Math.round(savedVnd).toLocaleString("vi-VN")} ₫)
              </span>
            </strong>
          </div>
          <div className="savings-submetric">
            <span className="submetric-label">Rendered Characters</span>
            <strong className="submetric-val">
              {renderedChars.toLocaleString("vi-VN")} chars
            </strong>
          </div>
          <div className="savings-submetric">
            <span className="submetric-label">Audio Produced</span>
            <strong className="submetric-val">
              {renderedSeconds > 0 ? `${(renderedSeconds / 60).toFixed(1)} mins` : "0 mins"}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardView({
  channels,
  tasks,
  activeTasks,
  now: _now,
  appConfig: _appConfig,
  activeEngine: _activeEngine = "codex",
  currentModel: _currentModel = "",
  currentImageModel: _currentImageModel = "gpt-image-2",
  imageBalance = null,
  voiceMetrics = null,
  storage: _storage = null,
  git: _git = { branch: null, dirty: false, changed_files: 0 },
  engineStatus: _engineStatus = "ready",
  onNavigate: _onNavigate,
}: {
  channels: Channel[];
  tasks: Task[];
  activeTasks: Task[];
  now?: number;
  appConfig?: AppConfig | null;
  activeEngine?: "codex" | "antigravity";
  currentModel?: string;
  currentImageModel?: string;
  imageBalance?: { balance_vnd: number; rpm?: number } | null;
  voiceMetrics?: {
    rendered_characters: number;
    rendered_duration_seconds: number;
    rendered_segments_count: number;
    rendered_episodes_count: number;
  } | null;
  storage?: StorageInfo | null;
  git?: GitInfo;
  engineStatus?: string;
  onNavigate?: (page: Page, params?: Record<string, string>) => void;
}) {
  // Channel & Episode metrics
  const activeChannelsCount = channels.filter((c) => c.status === "ACTIVE").length;
  const draftChannelsCount = channels.filter((c) => c.status === "DRAFT").length;
  const totalEpisodes = channels.reduce((total, channel) => total + (channel.episode_count || 0), 0);

  // Pipeline & Task execution telemetry
  const runningCount = tasks.filter((task) => task.status === "RUNNING").length;
  const queuedCount = tasks.filter((task) => task.status === "QUEUED").length;
  const completedCount = tasks.filter((task) => task.status === "COMPLETED").length;
  const failedCount = tasks.filter((task) => task.status === "FAILED").length;
  const terminalCount = completedCount + failedCount;
  const successRate = terminalCount > 0 ? ((completedCount / terminalCount) * 100).toFixed(1) : "100";

  // Balance formatting
  const formattedBalance = imageBalance
    ? `${imageBalance.balance_vnd.toLocaleString("vi-VN")} ₫`
    : "N/A";
  const balanceRateNote = imageBalance?.rpm ? `${imageBalance.rpm} RPM rate limit` : "Image API quota";


  // Category breakdown
  const categoryStats = [
    {
      domain: "Visual Art & Assets",
      filter: (t: Task) => t.task_type === "GENERATE_BUNDLE_IMAGE",
      icon: ImageIcon,
    },
    {
      domain: "Voice & Speech (TTS)",
      filter: (t: Task) => t.task_type === "GENERATE_AUDIO" || t.task_type === "GENERATE_NARRATION",
      icon: SpeakerHigh,
    },
    {
      domain: "Script & Intelligence",
      filter: (t: Task) =>
        [
          "SUGGEST_TOPICS",
          "GENERATE_RESEARCH",
          "GENERATE_TREATMENT",
          "GENERATE_SCRIPT",
          "GENERATE_VISUAL_BIBLE",
          "GENERATE_SCENES",
          "GENERATE_SEQUENCE_SCENES",
          "GENERATE_PIPELINE",
          "GENERATE_DNA",
          "REGENERATE_DIALOGUE",
          "REGENERATE_PROMPT",
          "REGENERATE_BOTH",
        ].includes(t.task_type),
      icon: Cpu,
    },
    {
      domain: "Video Composition",
      filter: (t: Task) => t.task_type === "GENERATE_VIDEO",
      icon: VideoCamera,
    },
  ].map((cat) => {
    const catTasks = tasks.filter(cat.filter);
    const catCompleted = catTasks.filter((t) => t.status === "COMPLETED").length;
    const catFailed = catTasks.filter((t) => t.status === "FAILED").length;
    const catRunning = catTasks.filter((t) => t.status === "RUNNING").length;
    const catTerminal = catCompleted + catFailed;
    const catRate = catTerminal > 0 ? ((catCompleted / catTerminal) * 100).toFixed(0) : "100";
    return {
      ...cat,
      total: catTasks.length,
      completed: catCompleted,
      failed: catFailed,
      running: catRunning,
      successRate: catRate,
    };
  });

  return (
    <section className="page-wrap">
      <div className="hero-row">
        <div>
          <p className="eyebrow">Studio Workspace</p>
          <h1>
            Studio <em>Dashboard</em>
          </h1>
          <p className="hero-copy">
            System metrics, real-time pipeline telemetry, and economic ROI analysis.
          </p>
        </div>
      </div>

      {/* Top Level Metric KPIs */}
      <div className="metric-grid">
        <Metric
          label="Channels"
          value={channels.length}
          note={`${activeChannelsCount} active · ${draftChannelsCount} draft`}
          icon={Broadcast}
        />
        <Metric
          label="Episodes"
          value={totalEpisodes}
          note={`Across ${channels.length} projects`}
          icon={FilmSlate}
        />
        <Metric
          label="Success Rate"
          value={`${successRate}%`}
          note={`${completedCount} completed · ${failedCount} failed`}
          icon={CheckCircle}
        />
        <Metric
          label="Active Tasks"
          value={activeTasks.length}
          note={`${runningCount} running · ${queuedCount} queued`}
          icon={Lightning}
        />
        <Metric
          label="Image Balance"
          value={formattedBalance}
          note={balanceRateNote}
          icon={Wallet}
        />
      </div>

      <div className="dashboard-grid">
        {/* Cost Savings & ROI Section */}
        <CostSavingsSection voiceMetrics={voiceMetrics} />

        {/* Pipeline Progress & Telemetry */}
        <div className="dashboard-section">
          {/* Operational Domain Breakdown Table */}
          <div className="dashboard-table-card">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Production Domain</th>
                  <th>Total Runs</th>
                  <th>Running</th>
                  <th>Completed</th>
                  <th>Failed</th>
                  <th>Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {categoryStats.map((item) => {
                  const Icon = item.icon;
                  return (
                    <tr key={item.domain}>
                      <td>
                        <div className="table-domain-cell">
                          <Icon size={16} style={{ color: "var(--accent-deep)" }} />
                          <span>{item.domain}</span>
                        </div>
                      </td>
                      <td className="table-num-cell">{item.total}</td>
                      <td className="table-num-cell" style={{ color: item.running ? "var(--accent)" : "inherit" }}>
                        {item.running}
                      </td>
                      <td className="table-num-cell" style={{ color: "var(--green)" }}>
                        {item.completed}
                      </td>
                      <td className="table-num-cell" style={{ color: item.failed ? "var(--notice-error)" : "inherit" }}>
                        {item.failed}
                      </td>
                      <td>
                        <div className="progress-pill-wrap">
                          <div className="progress-mini-bar">
                            <div
                              className="progress-mini-fill"
                              style={{ width: `${item.successRate}%` }}
                            />
                          </div>
                          <span className="table-num-cell" style={{ fontSize: "11px" }}>
                            {item.successRate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ChannelsListView({
  channels,
  onCreate,
  openChannel,
  onDelete,
}: {
  channels: Channel[];
  activeGroup?: ChannelGroupId;
  onActiveGroupChange?: (groupId: ChannelGroupId) => void;
  onCreate: (groupId?: ChannelGroupId) => void;
  openChannel: (id: string) => void;
  onDelete: (channel: Channel) => void;
}) {
  const quizChannels = channels;

  return (
    <section className="page-wrap">
      <PageTitle eyebrow="Quiz Studio" title="Channels" />
      <div
        id="quiz-channels-panel"
        className="channel-group-panel"
        role="region"
        aria-label="Quiz Channels"
      >
        <div className="channel-group-card" aria-labelledby="quiz-channels-title">
          <div className="channel-group-icon">
            <FolderOpen size={24} weight="duotone" />
          </div>
          <div className="channel-group-heading">
            <strong id="quiz-channels-title">Quiz Channels</strong>
            <span>
              {quizChannels.length} {quizChannels.length === 1 ? "channel" : "channels"}
            </span>
          </div>
          <div className="group-format-list">
            <span>Knowledge</span>
            <span>Image guess</span>
            <span>Multiple choice</span>
            <span>True/False</span>
            <span>Odd one out</span>
          </div>
          <button className="quiet-button group-create-button" onClick={() => onCreate("quiz")}>
            <Plus size={15} />
            <span>New Quiz Channel</span>
          </button>
        </div>
        {quizChannels.length === 0 ? (
          <EmptyState
            compact
            icon={<Broadcast size={26} />}
            title="No Quiz channels"
            copy="Create the first channel inside this group to begin producing quiz episodes."
            action="New Quiz Channel"
            onAction={() => onCreate("quiz")}
          />
        ) : (
          <div className="channel-grid channel-grid-wide">
            {quizChannels.map((channel, index) => (
              <ChannelCard
                key={channel.channel_id}
                index={index + 1}
                channel={channel}
                onOpen={() => openChannel(channel.channel_id)}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
