/**
 * Direction-driven app shell — shared workspace/nav config.
 *
 * `direction` is a ROUTE param (/dashboard/[direction]/...), never client
 * state — see src/app/dashboard/[direction]/layout.tsx for where it's
 * read and guarded. This file is the one place both that guard and the
 * sidebar's workspace switcher (src/app/dashboard/layout.tsx) derive
 * "which direction(s) can this user reach" from, so they can never
 * disagree with each other.
 *
 * .tsx (not .ts): nav item icons are inline SVG JSX.
 */
import type { ReactNode } from "react";
import type { AuthUser } from "./types";

export type WorkspaceDirection = "inbound" | "outbound";

export const DIRECTION_LABEL: Record<WorkspaceDirection, string> = {
  inbound: "Oil Revenue",
  outbound: "Inuka Programs",
};

export function getAllowedDirections(user: AuthUser | null): WorkspaceDirection[] {
  if (!user || user.roles.includes("system_admin")) return [];
  if (user.roles.includes("depot_supervisor")) return ["inbound"];
  if (user.roles.includes("inuka_manager")) return ["outbound"];
  if (!user.permissions.includes("view_outgoing_data")) return ["inbound"];
  return ["inbound", "outbound"];
}

export function getDefaultDirection(user: AuthUser | null): WorkspaceDirection {
  const allowed = getAllowedDirections(user);
  return allowed.includes("inbound") ? "inbound" : (allowed[0] ?? "inbound");
}

export function isDirectionAllowed(user: AuthUser | null, direction: string): direction is WorkspaceDirection {
  return getAllowedDirections(user).includes(direction as WorkspaceDirection);
}

// ---------------------------------------------------------------------------
// Side nav
// ---------------------------------------------------------------------------

export interface NavItem {
  id: string;
  label: string | { inbound: string; outbound: string };
  route: (direction: WorkspaceDirection) => string;
  icon: ReactNode;
  anyOf?: string[];
  directions?: WorkspaceDirection[];
  badgeKey?: "anomalies" | "high_risk" | "ebilling";
}

const ICONS = {
  overview: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
    </svg>
  ),
  alerts: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  anomalies: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  leakage: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  risk: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path strokeLinecap="round" d="M8.2 7.2L10 15M15.8 7.2L14 15M8.5 6h7" />
    </svg>
  ),
  extra: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  reports: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 014-4h4m0 0l-3-3m3 3l-3 3M4 7h16M4 7a2 2 0 002 2h12a2 2 0 002-2M4 7a2 2 0 012-2h12a2 2 0 012 2" />
    </svg>
  ),
  audit: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  reviewQueue: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5h10M9 12h10M9 19h10M4 5h.01M4 12h.01M4 19h.01" />
    </svg>
  ),
};

export const navItems: NavItem[] = [
  {
    id: "overview",
    label: { inbound: "Dashboard", outbound: "Assurance Overview" },
    route: (d) => `/dashboard/${d}/overview`,
    icon: ICONS.overview,
    anyOf: ["view_metrics"],
  },
  {
    id: "anomalies",
    label: "Anomalies",
    anyOf: ["view_anomaly_table"],
    badgeKey: "anomalies",
    route: (d) => `/dashboard/${d}/anomalies`,
    icon: ICONS.anomalies,
  },
  {
    id: "alerts",
    label: "Alerts",
    anyOf: ["view_anomaly_table"],
    route: (d) => `/dashboard/${d}/alerts`,
    icon: ICONS.alerts,
  },
  {
    id: "leakage",
    label: { inbound: "Leakage Explorer", outbound: "Payout Exposure" },
    anyOf: ["view_heatmap"],
    route: (d) => `/dashboard/${d}/leakage`,
    icon: ICONS.leakage,
  },
  {
    id: "risk",
    label: "Risk Intelligence",
    anyOf: ["view_fraud_graph"],
    badgeKey: "high_risk",
    route: (d) => `/dashboard/${d}/risk`,
    icon: ICONS.risk,
  },
  {
    id: "consents",
    label: "Consent & Privacy",
    anyOf: ["view_anomaly_table"],
    directions: ["outbound"],
    route: (d) => `/dashboard/${d}/consents`,
    icon: ICONS.audit,
  },
  {
    id: "operations", label: "Depot Operations", anyOf: ["view_metrics"],
    directions: ["inbound"], route: (d) => `/dashboard/${d}/operations`, icon: ICONS.overview,
  },
  {
    id: "billing", label: "KRA iCMS E-Billing", anyOf: ["manage_ebilling"],
    directions: ["inbound"], badgeKey: "ebilling",
    route: (d) => `/dashboard/${d}/billing`, icon: ICONS.extra,
  },
  {
    id: "upload", label: "Data Import", anyOf: ["upload_csv"],
    directions: ["inbound"], route: (d) => `/dashboard/${d}/upload`, icon: ICONS.reports,
  },
  {
    id: "beneficiaries", label: "Beneficiaries", anyOf: ["view_anomaly_table"],
    directions: ["outbound"], route: (d) => `/dashboard/${d}/beneficiaries`, icon: ICONS.extra,
  },
  {
    id: "programs", label: "Programs & Pillars", anyOf: ["view_metrics"],
    directions: ["outbound"], route: (d) => `/dashboard/${d}/programs`, icon: ICONS.leakage,
  },
  {
    id: "officers", label: "Field Officers", anyOf: ["view_metrics"],
    directions: ["outbound"], route: (d) => `/dashboard/${d}/officers`, icon: ICONS.risk,
  },
  {
    id: "reports",
    label: "Reports",
    anyOf: ["export_reports"],
    route: (d) => `/dashboard/${d}/reports`,
    icon: ICONS.reports,
  },
  {
    id: "audit",
    label: "Audit Trail",
    anyOf: ["view_audit"],
    directions: ["inbound"],
    route: () => `/dashboard/audit`,
    icon: ICONS.audit,
  },
];

export const REVIEW_QUEUE_ITEM: NavItem = {
  id: "review-queue",
  label: "My Review Queue",
  anyOf: ["view_anomaly_table"],
  directions: ["inbound"],
  route: (d) => `/dashboard/${d}/review-queue`,
  icon: ICONS.reviewQueue,
};

export function navLabel(item: NavItem, direction: WorkspaceDirection): string {
  return typeof item.label === "string" ? item.label : item.label[direction];
}

export function switchDirectionUrl(currentItemId: string | null, target: WorkspaceDirection): string {
  const item = navItems.find((i) => i.id === currentItemId);
  if (!item || item.id === "audit" || (item.directions && !item.directions.includes(target))) {
    return `/dashboard/${target}/overview`;
  }
  return item.route(target);
}

export function activeNavItemId(pathname: string): string | null {
  if (pathname === "/dashboard/audit") return "audit";
  if (pathname.startsWith("/dashboard/review-queue")) return "review-queue";
  const match = pathname.match(/^\/dashboard\/(inbound|outbound)\/([^/]+)/);
  if (!match) return null;
  const segment = match[2] === "extra" ? (match[1] === "inbound" ? "billing" : "beneficiaries") : match[2];
  return navItems.find((i) => i.id === segment)?.id ?? null;
}

export function directionFromPathname(pathname: string): WorkspaceDirection | null {
  const match = pathname.match(/^\/dashboard\/(inbound|outbound)(\/|$)/);
  return (match?.[1] as WorkspaceDirection | undefined) ?? null;
}

export function canAccessModule(user: AuthUser | null, item: NavItem, direction: WorkspaceDirection): boolean {
  return !!user && isDirectionAllowed(user, direction)
    && (!item.directions || item.directions.includes(direction))
    && (!item.anyOf || item.anyOf.some((code) => user.permissions.includes(code)));
}
