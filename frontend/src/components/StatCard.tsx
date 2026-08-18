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

interface StatCardProps {
  label: string;
  value: string;
  note?: string;
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
 * KPI tile matching the reference dashboard: label top-left, big number,
 * a tone-tinted icon badge top-right, and a status-colored note line.
 * Clickable two ways: href navigates elsewhere ("take me to the filtered
 * list"), onClick filters the current page in place ("this IS the filter
 * control"). active adds a ring so the current selection is obvious.
 */
export default function StatCard({
  label,
  value,
  note,
  icon,
  tone = "neutral",
  href,
  onClick,
  active,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        {icon && (
          <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON_BG[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <span className="text-2xl font-bold tracking-tight text-foreground mt-2">{value}</span>
      {note && <span className={`text-[11px] font-medium mt-1.5 ${TONE_NOTE_TEXT[tone]}`}>{note}</span>}
    </>
  );

  const className = `bg-card border rounded-xl p-4 flex flex-col justify-between h-[104px] shadow-sm transition-all text-left w-full ${
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
