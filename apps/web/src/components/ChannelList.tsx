import { ArrowUpRight, Broadcast, CheckCircle, CheckSquareOffset, FilmSlate, FolderOpen, Lightning, Plus, Trash } from "@phosphor-icons/react";
import type { Channel, Task } from "@studio/shared";
import { formatTaskElapsed, formatTaskStatus, formatTaskType, isTaskActive } from "../lib/utils";
import { EmptyState } from "./EmptyState";
import { PageTitle } from "./AppChrome";

export type ChannelGroupId = "quiz";

export function ChannelCard({ channel, index, onOpen, onDelete }: { channel: Channel; index: number; onOpen: () => void; onDelete: (channel: Channel) => void }) {
  return (
    <article className="channel-card quiz-channel-card">
      <div className="card-top">
        <span className="channel-kind">Quiz Engine</span>
        <span className={`status-badge ${channel.status.toLowerCase()}`}>{channel.status.toLowerCase()}</span>
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
        {channel.description ? <p>{channel.description}</p> : <p style={{ opacity: 0.5 }}>No description provided.</p>}
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
  value: number;
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

function TaskRow({ task, now }: { task: Task; now: number }) {
  return (
    <div className={`activity-row ${isTaskActive(task) ? "is-processing" : ""}`}>
      <div className={`task-status-dot ${task.status.toLowerCase()}`} />
      <div>
        <strong>{formatTaskType(task.task_type)}</strong>
        <span>{task.error || task.progress_message || formatTaskStatus(task.status)}</span>
      </div>
      <span className="task-elapsed">{formatTaskElapsed(task, now)}</span>
    </div>
  );
}

export function DashboardView({
  channels,
  tasks,
  activeTasks,
  now,
  onCreate,
  openChannel,
  onDelete,
  openTaskList,
  openChannelsList,
}: {
  channels: Channel[];
  tasks: Task[];
  activeTasks: Task[];
  now: number;
  onCreate: (groupId?: ChannelGroupId) => void;
  openChannel: (id: string) => void;
  onDelete: (channel: Channel) => void;
  openTaskList: () => void;
  openChannelsList: () => void;
}) {
  const reviewCount = tasks.filter((task) => task.status === "WAITING_APPROVAL").length;
  const completedCount = tasks.filter((task) => task.status === "COMPLETED").length;
  const recentChannels = [...channels].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);

  return (
    <section className="page-wrap">
      <div className="hero-row">
        <div>
          <p className="eyebrow">Studio Workspace</p>
          <h1>
            Studio <em>Dashboard</em>
          </h1>
          <p className="hero-copy">
            Produce, monitor, and scale AI-driven children's quiz video channels with high-fidelity automation.
          </p>
        </div>
        <div className="hero-actions-group" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button className="primary-button hero-action" onClick={() => onCreate("quiz")}>
            <Plus size={16} weight="bold" />
            <span>New Quiz Channel</span>
          </button>
        </div>
      </div>

      <div className="metric-grid">
        <Metric label="Channels" value={channels.length} note="Active projects" icon={Broadcast} />
        <Metric
          label="Episodes"
          value={channels.reduce((total, channel) => total + channel.episode_count, 0)}
          note="In library"
          icon={FilmSlate}
        />
        <Metric label="Running" value={activeTasks.length} note="Active background" icon={Lightning} />
        <Metric
          label="Review"
          value={reviewCount}
          note={reviewCount ? "Action required" : `${completedCount} completed`}
          icon={CheckSquareOffset}
        />
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Channels</h2>
        </div>
        <button className="text-button" onClick={openChannelsList}>
          <span>View all</span>
          <ArrowUpRight size={15} />
        </button>
      </div>
      {channels.length === 0 ? (
        <EmptyState
          icon={<Broadcast size={26} />}
          title="No channels"
          copy="Create a channel to begin producing automated documentary and quiz content."
          action="Create channel"
          onAction={onCreate}
        />
      ) : (
        <div className="channel-grid">
          {recentChannels.map((channel, index) => (
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

      <div className="section-heading activity-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Recent activity</h2>
        </div>
        <button className="text-button" onClick={openTaskList}>
          <span>View all</span>
          <ArrowUpRight size={15} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="activity-empty">
          <CheckCircle size={19} />
          <span>No background tasks recorded yet.</span>
        </div>
      ) : (
        <div className="activity-list">
          {tasks.slice(0, 5).map((task) => (
            <TaskRow key={task.task_id} task={task} now={now} />
          ))}
        </div>
      )}
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
