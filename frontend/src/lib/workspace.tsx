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
 * Replaces the old client-state DirectionContext's locking rules
 * (view_outgoing_data / inuka_manager — see backend/scripts/seed_roles.py's
 * ROLE_PERMISSIONS comment for the backend-side rationale) with the same
 * rules expressed as route-reachability instead of a hidden toggle value.
 * Also drops the old context's third "all" (merged) state entirely — this
 * app now only ever shows one real workspace at a time, per direction.
 *
 * .tsx (not .ts): nav item icons are inline SVG JSX, same convention the
 * old dashboard/layout.tsx used for its own NAV_ITEMS.
 */
import type { ReactNode } from "react";
import type { AuthUser } from "./types";

export type WorkspaceDirection = "inbound" | "outbound";

export const DIRECTION_LABEL: Record<WorkspaceDirection, string> = {
  inbound: "Oil Revenue",
  outbound: "Inuka Programs",
};

/** Which direction(s) this user is allowed to view. Mirrors the locking
 * rules the old DirectionContext enforced:
 * - No `view_outgoing_data` permission (e.g. Depot Supervisor) -> inbound only.
 * - `inuka_manager` role -> outbound only.
 * - Everyone else with `view_outgoing_data` -> both. */
export function getAllowedDirections(user: AuthUser | null): WorkspaceDirection[] {
  if (!user) return ["inbound"];
  if (user.roles.includes("inuka_manager")) return ["outbound"];
  if (!user.permissions.includes("view_outgoing_data")) return ["inbound"];
  return ["inbound", "outbound"];
}

export function getDefaultDirection(user: AuthUser | null): WorkspaceDirection {
  const allowed = getAllowedDirections(user);
  // inuka_manager's only allowed value is "outbound"; everyone else
  // defaults to "inbound" even when both are available — same default
  // the old context used ("all" leaned inbound-first in practice, since
  // every inbound page was the pre-existing default landing page).
  return allowed.includes("inbound") ? "inbound" : allowed[0];
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
  /** Permission code(s) — item hidden unless the user has at least one.
   * Omitted entirely means "always visible" (e.g. Overview). */
  anyOf?: string[];
  /** Restricts which direction(s) show this item at all. Omitted means
   * both. */
  directions?: WorkspaceDirection[];
  badgeKey?: "anomalies" | "high_risk" | "ebilling";
}

const ICONS = {
  overview: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
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
    id: "leakage",
    label: "Leakage Explorer",
    anyOf: ["view_heatmap"],
    // Confirmed live both directions — /heatmap?direction=outbound really
    // does return Beneficiary x Pillar density (see
    // backend/app/routes/reconciliation/heatmap.py) — shared, not
    // inbound-only.
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
    id: "extra",
    label: { inbound: "E-Billing", outbound: "Beneficiaries" },
    anyOf: ["manage_ebilling", "view_anomaly_table"],
    badgeKey: "ebilling",
    route: (d) => `/dashboard/${d}/extra`,
    icon: ICONS.extra,
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
    route: () => `/dashboard/audit`,
    icon: ICONS.audit,
  },
];

export const REVIEW_QUEUE_ITEM: NavItem = {
  id: "review-queue",
  label: "My Review Queue",
  anyOf: ["view_anomaly_table"],
  directions: ["inbound"], // matches today's page — outbound has its own case queue under Anomalies
  route: () => `/dashboard/review-queue`,
  icon: ICONS.reviewQueue,
};

export function navLabel(item: NavItem, direction: WorkspaceDirection): string {
  return typeof item.label === "string" ? item.label : item.label[direction];
}

/** Given the currently-active nav item id and a target direction, builds
 * the URL to switch to — the workspace switcher's "preserve the current
 * page id where possible" requirement. Falls back to that direction's
 * overview if the current item doesn't exist/apply on the other side. */
export function switchDirectionUrl(currentItemId: string | null, target: WorkspaceDirection): string {
  const item = navItems.find((i) => i.id === currentItemId);
  if (!item || item.id === "audit" || (item.directions && !item.directions.includes(target))) {
    return `/dashboard/${target}/overview`;
  }
  return item.route(target);
}

/** Resolves the active nav item id from a pathname like
 * "/dashboard/outbound/anomalies" or "/dashboard/outbound/anomalies/PIL-1"
 * (still "anomalies" — the [groupId] sub-route belongs to the same nav
 * entry) or "/dashboard/audit". */
export function activeNavItemId(pathname: string): string | null {
  if (pathname === "/dashboard/audit") return "audit";
  if (pathname.startsWith("/dashboard/review-queue")) return "review-queue";
  const match = pathname.match(/^\/dashboard\/(inbound|outbound)\/([^/]+)/);
  if (!match) return null;
  const segment = match[2];
  return navItems.find((i) => i.id === segment)?.id ?? null;
}

export function directionFromPathname(pathname: string): WorkspaceDirection | null {
  const match = pathname.match(/^\/dashboard\/(inbound|outbound)(\/|$)/);
  return (match?.[1] as WorkspaceDirection | undefined) ?? null;
}
