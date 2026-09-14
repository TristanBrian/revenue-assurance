"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getMetrics, getOmcRiskProfile, getEbillingStatus, getDepotAlerts } from "@/lib/api";
import type { Anomaly } from "@/lib/types";
import { MaterialityProvider, useMateriality } from "@/context/MaterialityContext";
import { useTheme } from "@/context/ThemeContext";
import { BRAND_CONFIG } from "@/lib/brand-config";
import {
  navItems,
  REVIEW_QUEUE_ITEM,
  navLabel,
  activeNavItemId,
  directionFromPathname,
  switchDirectionUrl,
  getAllowedDirections,
  getDefaultDirection,
  DIRECTION_LABEL,
  type WorkspaceDirection,
} from "@/lib/workspace";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function BellIcon() {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

const THEME_ICONS: Record<"light" | "dark" | "system", React.ReactNode> = {
  light: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.364 17.636l-.707.707M17.636 17.636l.707-.707M6.364 6.364l.707-.707M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  dark: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  ),
  system: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
};

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, logout } = useAuth();
  const { materiality } = useMateriality();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  // direction is a ROUTE param, not client state — derived from the URL,
  // never stored. Falls back to the user's default workspace for routes
  // outside /dashboard/[direction]/* (audit, review-queue) purely for
  // display wording (search placeholder, workspace banner) — those pages
  // don't actually filter by direction.
  const routeDirection = directionFromPathname(pathname);
  const direction: WorkspaceDirection = routeDirection ?? getDefaultDirection(user);
  const allowedDirections = getAllowedDirections(user);
  const canSwitchWorkspace = allowedDirections.length > 1;
  const activeItemId = activeNavItemId(pathname);

  const [anomalyCount, setAnomalyCount] = useState<number>(0);
  const [criticalCount, setCriticalCount] = useState<number>(0);
  const [highRiskCount, setHighRiskCount] = useState<number>(0);
  const [failedSyncCount, setFailedSyncCount] = useState<number>(0);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [depotAlerts, setDepotAlerts] = useState<{ depotId: string; criticalCount: number; items: Anomaly[] } | null>(null);
  const [depotAlertsOpen, setDepotAlertsOpen] = useState(false);
  // Drives the sidebar both below lg (fixed overlay drawer, toggled by the
  // hamburger button) and at lg+ (always docked — see the aside's own
  // classes, which force it open there regardless of this state). One
  // piece of state, no separate "mobile menu" flag.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("reconova_sidebar_collapsed") === "true");
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("reconova_sidebar_collapsed", String(next));
      return next;
    });
  }

  useEffect(() => {
    if (!user) return;

    if (user.permissions.includes("view_metrics")) {
      getMetrics(direction === "outbound" ? 0 : materiality, direction)
        .then((data) => {
          setAnomalyCount(data.metrics.anomaly_count);
          setCriticalCount(data.metrics.critical_count);
        })
        .catch(() => {});
    }

    if (direction === "inbound" && user.permissions.includes("view_omc_risk_profile")) {
      getOmcRiskProfile(materiality)
        .then((profiles) => {
          setHighRiskCount(profiles.filter((p) => p.risk_level === "High").length);
        })
        .catch(() => {});
    }

    if (direction === "inbound" && user.permissions.includes("manage_ebilling")) {
      getEbillingStatus()
        .then((status) => setFailedSyncCount(status.failed_count))
        .catch(() => {});
    }

    if (direction === "inbound" && user.permissions.includes("view_depot_alerts")) {
      getDepotAlerts()
        .then((data) => setDepotAlerts({ depotId: data.depot_id, criticalCount: data.critical_count, items: data.items }))
        .catch(() => {});
    }
  }, [user, materiality, direction]);

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const isAdmin = user?.roles.includes("system_admin") ?? false;
  const visibleItems = [
    ...(canSwitchWorkspace ? [REVIEW_QUEUE_ITEM] : []),
    ...navItems,
  ].filter((item) => {
    if (isAdmin) return false;
    if (item.anyOf && !item.anyOf.some((code) => user?.permissions.includes(code))) return false;
    if (item.directions && !item.directions.includes(direction)) return false;
    return true;
  });

  const canSeeAllAlerts = user?.permissions.includes("view_anomaly_table") ?? false;
  const canSeeDepotAlerts = user?.permissions.includes("view_depot_alerts") ?? false;
  const isRevenueAssurance = user?.roles.includes("revenue_assurance") ?? false;
  const isManager = user?.roles.includes("manager") ?? false;
  const isInukaManager = user?.roles.includes("inuka_manager") ?? false;
  const isInukaWorkspace = direction === "outbound";
  const workspaceLabel = isInukaWorkspace ? "Inuka Programme Assurance" : "Oil Revenue Assurance";
  const workspaceDescription = isInukaWorkspace
    ? "Beneficiary participation, authorisations, and stipend disbursements"
    : "Dispatch, invoice, payment, and KRA e-billing controls";
  const roleMode = isRevenueAssurance
    ? "Investigation & resolution"
    : isManager
      ? "Oversight & escalation"
      : isInukaManager
        ? "Programme review"
        : "Operations";
  const SEARCH_RELEVANT_PATHS = ["overview", "anomalies", "leakage"];
  const showSearch = !isAdmin && activeItemId != null && SEARCH_RELEVANT_PATHS.includes(activeItemId);

  function switchWorkspace(target: WorkspaceDirection) {
    router.push(switchDirectionUrl(activeItemId, target));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[35] bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-60 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 transition-[transform,width] duration-300 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${sidebarCollapsed ? "lg:w-[4.5rem] lg:p-2" : "lg:w-64"} ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className={`mb-2 flex items-center gap-2.5 px-2 py-3 ${sidebarCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            className="lg:hidden shrink-0 -ml-1 p-1.5 rounded-md text-sidebar-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {BRAND_CONFIG.logoUrl ? (
            <div className={`relative h-8 w-8 shrink-0 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
              <Image
                src={BRAND_CONFIG.logoUrl}
                alt={`${BRAND_CONFIG.companyName} logo`}
                fill
                sizes="32px"
                className="object-contain"
              />
            </div>
          ) : (
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-black text-white ${sidebarCollapsed ? "lg:hidden" : ""}`}
              style={{ backgroundColor: BRAND_CONFIG.primaryColor }}
            >
              {BRAND_CONFIG.shortName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className={`min-w-0 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
            <p className="text-base font-bold text-sidebar-foreground leading-none truncate">
              {BRAND_CONFIG.companyName}
            </p>
            <p className="text-xs text-sidebar-muted-foreground leading-none mt-1 truncate font-medium">
              {isInukaWorkspace ? "Inuka Program Assurance" : BRAND_CONFIG.systemName}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`ml-auto hidden shrink-0 rounded-md p-2 text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block ${sidebarCollapsed ? "lg:mx-auto" : ""}`}
          >
            <svg className={`h-4 w-4 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <p className={`px-2 mb-1.5 text-xs font-bold uppercase tracking-wider text-sidebar-muted-foreground ${sidebarCollapsed ? "lg:hidden" : ""}`}>
          Workspace
        </p>
        {canSwitchWorkspace && (
          <div className={`mb-3 grid grid-cols-2 gap-1 rounded-lg bg-sidebar-accent/50 p-1 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
            {(["inbound", "outbound"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => switchWorkspace(d)}
                className={`rounded-md px-2.5 py-2 text-xs font-bold transition-colors ${
                  direction === d
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                {DIRECTION_LABEL[d]}
              </button>
            ))}
          </div>
        )}
        <nav className="flex flex-col gap-1">
          {isAdmin && (
            <Link
              href="/dashboard/admin"
              title={sidebarCollapsed ? "User Administration" : undefined}
              className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""} ${pathname === "/dashboard/admin" ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"}`}
            >
              <span className={pathname === "/dashboard/admin" ? "text-sidebar-primary" : ""}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2m7-10a4 4 0 100-8 4 4 0 000 8zm10 10v-2a4 4 0 00-3-3.87m-1-12a4 4 0 010 7.75" />
                </svg>
              </span>
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>User Administration</span>
            </Link>
          )}
          {visibleItems.map((item) => {
            const href = item.route(direction);
            const active = pathname === href || (item.id === activeItemId && item.id !== "audit" && item.id !== "review-queue");
            let count = 0;
            if (item.badgeKey === "anomalies") count = anomalyCount;
            if (item.badgeKey === "high_risk") count = highRiskCount;
            if (item.badgeKey === "ebilling") count = failedSyncCount;

            return (
              <Link
                key={item.id}
                href={href}
                title={sidebarCollapsed ? navLabel(item, direction) : undefined}
                className={`group relative flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""} ${
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <span className={`flex items-center ${sidebarCollapsed ? "lg:justify-center" : "gap-3"}`}>
                  <span className={active ? "text-sidebar-primary" : ""}>{item.icon}</span>
                  <span className={sidebarCollapsed ? "lg:hidden" : ""}>{navLabel(item, direction)}</span>
                </span>
                {count > 0 && (
                  <span className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-xs font-bold text-sidebar-primary-foreground ${sidebarCollapsed ? "lg:absolute lg:right-1 lg:top-0.5" : ""}`}>
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <div className={`border-t border-sidebar-border pt-3 flex items-center gap-2.5 px-1 ${sidebarCollapsed ? "lg:flex-col" : ""}`}>
            <div className="w-8 h-8 shrink-0 rounded-full bg-sidebar-primary/20 text-sidebar-primary flex items-center justify-center text-xs font-bold">
              {user?.email?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className={`min-w-0 flex-1 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
              {!authLoading && user && (
                <>
                  <p className="truncate text-xs font-bold text-sidebar-foreground">{user.email}</p>
                  <p className="text-xs capitalize text-sidebar-muted-foreground truncate font-medium">
                    {user.roles.join(", ").replace(/_/g, " ")}
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className="shrink-0 p-1.5 rounded-md text-sidebar-muted-foreground hover:text-sidebar-primary hover:bg-sidebar-accent transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 border-b border-border bg-background/80 backdrop-blur-md shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden shrink-0 -ml-1.5 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {showSearch ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground max-w-md w-full">
                <div className="flex items-center gap-2 w-full rounded-md border border-border bg-muted/60 px-3 py-2 text-sm">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M19 11a8 8 0 11-16 0 8 8 0 0116 0z" />
                  </svg>
                  <span className="truncate text-xs sm:text-sm">{isInukaWorkspace ? "Search beneficiaries, officers, payouts…" : "Search anomalies, OMCs, invoices…"}</span>
                </div>
              </div>
            ) : (
              <div />
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {canSeeAllAlerts && (
              <Link
                href={`/dashboard/${direction}/anomalies`}
                title={isInukaWorkspace ? "Critical pillar exposure" : "Critical anomalies"}
                className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <BellIcon />
                {criticalCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] font-bold text-white">
                    {criticalCount > 99 ? "99+" : criticalCount}
                  </span>
                )}
              </Link>
            )}

            {!canSeeAllAlerts && canSeeDepotAlerts && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDepotAlertsOpen((o) => !o)}
                  onBlur={() => setTimeout(() => setDepotAlertsOpen(false), 150)}
                  title={depotAlerts ? `Critical alerts — ${depotAlerts.depotId}` : "Critical alerts"}
                  className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <BellIcon />
                  {depotAlerts && depotAlerts.criticalCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] font-bold text-white">
                      {depotAlerts.criticalCount > 99 ? "99+" : depotAlerts.criticalCount}
                    </span>
                  )}
                </button>
                {depotAlertsOpen && (
                  <div className="absolute right-0 mt-1 w-80 rounded-md border border-border bg-popover shadow-lg py-2 z-40">
                    <div className="px-3 pb-2 border-b border-border">
                      <p className="text-sm font-bold text-foreground">
                        {depotAlerts ? depotAlerts.depotId : "Your depot"} — critical alerts
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Scoped to your assigned depot only</p>
                    </div>
                    {!depotAlerts || depotAlerts.items.length === 0 ? (
                      <p className="px-3 py-4 text-xs sm:text-sm text-muted-foreground italic">No alerts for your depot right now.</p>
                    ) : (
                      <div className="max-h-72 overflow-y-auto divide-y divide-border">
                        {depotAlerts.items.slice(0, 8).map((a) => (
                          <div key={a.dispatch_id} className="px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs sm:text-sm font-semibold text-foreground truncate">{a.customer}</span>
                              <span className="text-xs sm:text-sm font-mono font-bold text-status-critical shrink-0">
                                {formatKes(a.leakage_kes)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {a.break_type} · {a.dispatch_id}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setThemeMenuOpen((o) => !o)}
                onBlur={() => setTimeout(() => setThemeMenuOpen(false), 150)}
                title="Theme"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {THEME_ICONS[theme]}
              </button>
              {themeMenuOpen && (
                <div className="absolute right-0 mt-1 w-36 rounded-md border border-border bg-popover shadow-lg py-1 z-40">
                  {(["light", "dark", "system"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setTheme(mode);
                        setThemeMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs sm:text-sm capitalize transition-colors ${
                        theme === mode
                          ? "text-foreground font-semibold bg-accent"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {THEME_ICONS[mode]}
                      {mode}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {routeDirection && (
          <div className={`border-b px-4 sm:px-6 py-3 ${isInukaWorkspace ? "border-status-info/20 bg-status-info-bg/50" : "border-primary/15 bg-primary/5"}`}>
            <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-extrabold ${isInukaWorkspace ? "bg-status-info-bg text-status-info" : "bg-primary/10 text-primary"}`}>
                  {isInukaWorkspace ? "IN" : "OIL"}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <p className="truncate text-sm sm:text-base font-bold text-foreground">{workspaceLabel}</p>
                    <span className="rounded-full bg-background/80 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-muted-foreground border border-border/50">
                      {roleMode}
                    </span>
                  </div>
                  <p className="truncate text-xs sm:text-sm font-medium text-muted-foreground">{workspaceDescription}</p>
                </div>
              </div>
              {canSwitchWorkspace && (
                <p className="text-xs sm:text-sm font-medium text-muted-foreground sm:text-right">
                  Switch workspace to change the dataset and controls shown.
                </p>
              )}
            </div>
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-auto bg-background p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <MaterialityProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </MaterialityProvider>
  );
}
