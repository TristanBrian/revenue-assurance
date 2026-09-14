"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type StatTone = "neutral" | "critical" | "high" | "medium" | "low" | "info";

const TONE_ICON_BG: Record<StatTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: "bg-status-critical-bg text-status-critical",
  high: "bg-status-high-bg text-status-high",
  medium: "bg-status-medium-bg text-status-medium",
  low: "bg-status-low-bg text-status-low",
  info: "bg-status-info-bg text-status-info",
};

const TONE_NOTE_TEXT: Record<StatTone, string> = {
  neutral: "text-muted-foreground",
  critical: "text-status-critical",
  high: "text-status-high",
  medium: "text-status-medium",
  low: "text-status-low",
  info: "text-status-info",
};

const TONE_NOTE_PILL: Record<StatTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: "bg-status-critical-bg text-status-critical",
  high: "bg-status-high-bg text-status-high",
  medium: "bg-status-medium-bg text-status-medium",
  low: "bg-status-low-bg text-status-low",
  info: "bg-status-info-bg text-status-info",
};

const TONE_BAR_FILL: Record<StatTone, string> = {
  neutral: "bg-foreground",
  critical: "bg-status-critical",
  high: "bg-status-high",
  medium: "bg-status-medium",
  low: "bg-status-low",
  info: "bg-status-info",
};

interface StatCardProps {
  label: string;
  value: string;
  note?: string;
  /** Renders the note as a small tinted pill instead of plain text (e.g. "+6.2% vs prior"). */
  notePill?: boolean;
  /** 0-100 — renders a progress bar under the value instead of the note. */
  progress?: number;
  icon?: ReactNode;
  tone?: StatTone;
  /** Navigates to another page (e.g. dashboard KPI -> Anomalies page). */
  href?: string;
  /** Filters in place (e.g. an Anomalies-page stat card toggling its own
   * status filter) — mutually exclusive with href; href wins if both given. */
  onClick?: () => void;
  active?: boolean;
}

/**
 * KPI tile: a plain sentence-case label, a big number, and either a note
 * line (plain text or a tinted pill) or a progress bar — never both. No
 * icon badge unless one is explicitly passed in (kept for pages that still
 * use it; the softer reference look this now matches has none).
 * Clickable two ways: href navigates elsewhere ("take me to the filtered
 * list"), onClick filters the current page in place ("this IS the filter
 * control"). active adds a ring so the current selection is obvious.
 */
export default function StatCard({
  label,
  value,
  note,
  notePill,
  progress,
  icon,
  tone = "neutral",
  href,
  onClick,
  active,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-muted-foreground">{label}</span>
        {icon && (
          <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON_BG[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mt-2">{value}</span>

      {typeof progress === "number" ? (
        <div className="mt-2.5 h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${TONE_BAR_FILL[tone]}`}
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
          />
        </div>
      ) : note ? (
        notePill ? (
          <span className={`mt-2 w-fit rounded-full px-2.5 py-1 text-xs sm:text-sm font-semibold ${TONE_NOTE_PILL[tone]}`}>
            {note}
          </span>
        ) : (
          <span className={`text-xs sm:text-sm font-medium mt-1.5 ${TONE_NOTE_TEXT[tone]}`}>{note}</span>
        )
      ) : null}
    </>
  );

  const className = `bg-card border rounded-xl p-4 flex flex-col justify-between min-h-[108px] shadow-sm transition-all text-left w-full ${
    active ? "border-ring ring-2 ring-ring/40" : "border-border"
  }`;

  if (href) {
    return (
      <Link href={href} className={`${className} hover:border-ring hover:shadow-md cursor-pointer`}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} hover:border-ring hover:shadow-md cursor-pointer`}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
