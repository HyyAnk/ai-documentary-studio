import { ArrowUpRight, CircleNotch } from "@phosphor-icons/react";

export function EmptyState({ icon, title, copy, action, onAction, compact = false, disabled = false, busy = false, busyLabel }: { icon: React.ReactNode; title: string; copy: string; action: string; onAction: () => void; compact?: boolean; disabled?: boolean; busy?: boolean; busyLabel?: string }) {
  return <div className={`empty-state ${compact ? "is-compact" : ""}`}><div className="empty-icon">{busy ? <CircleNotch className="spin" size={24} /> : icon}</div><h3>{title}</h3><p>{copy}</p><button className="quiet-button" disabled={disabled || busy} onClick={onAction}>{busy ? <CircleNotch className="spin" size={15} /> : null}{busy ? busyLabel || "Working..." : action}{busy ? null : <ArrowUpRight size={15} />}</button></div>;
}

export function LoadingState() { return <section className="page-wrap"><div className="loading-state"><CircleNotch className="spin" size={22} /><span>Loading workspace</span></div></section>; }
