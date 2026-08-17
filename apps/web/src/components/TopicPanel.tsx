import { ArrowUpRight, Lightbulb, Play, CircleNotch } from "@phosphor-icons/react";
import type { Channel, TopicCandidate } from "@studio/shared";
import { EmptyState } from "./EmptyState";
import { PageTitle } from "./AppChrome";
import { initials } from "../lib/utils";
import type { Notice } from "./types";

export function TopicsView({ channels, openChannel, onNotice }: { channels: Channel[]; openChannel: (id: string) => void; onNotice: (notice: NonNullable<Notice>) => void }) { return <section className="page-wrap"><PageTitle eyebrow="Ideas" title="Topics" />{channels.length === 0 ? <EmptyState icon={<Lightbulb size={26} />} title="No channel context yet" copy="Create a channel first." action="Browse channels" onAction={() => onNotice({ tone: "neutral", message: "Create a channel first" })} /> : <div className="topic-channel-list">{channels.map((channel) => <button className="topic-channel-row" key={channel.channel_id} onClick={() => openChannel(channel.channel_id)}><div className="channel-avatar">{initials(channel.display_name)}</div><div><strong>{channel.display_name}</strong><span>Open topics</span></div><ArrowUpRight size={17} /></button>)}</div>}</section>; }

export function TopicCard({ topic, onConfirm, busy }: { topic: TopicCandidate; onConfirm: () => void; busy: boolean }) { return <article className="topic-card"><div className="topic-number">Topic candidate</div><h3>{topic.title}</h3><p className="topic-premise">{topic.premise}</p><div className="topic-detail"><span>Why it fits</span><p>{topic.why_it_fits}</p></div><div className="topic-detail"><span>Hook</span><p>{topic.hook}</p></div><div className="topic-footer"><span>{topic.estimated_potential}</span><button className="text-button" disabled={busy} onClick={onConfirm}>{busy ? <CircleNotch className="spin" size={15} /> : <Play size={14} />}Use this topic</button></div></article>; }
