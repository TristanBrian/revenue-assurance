"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BRAND_CONFIG } from "@/lib/brand-config";
import { useAuth } from "@/lib/auth-context";
import { getAnomalies, getEbillingStatus, getOmcRiskProfile } from "@/lib/api";
import {
  activeNavItemId,
  canAccessModule,
  directionFromPathname,
  getAllowedDirections,
  navItems,
  navLabel,
  REVIEW_QUEUE_ITEM,
  switchDirectionUrl,
  type WorkspaceDirection,
} from "@/lib/workspace";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const [anomalyCount, setAnomalyCount] = useState(0);
  const [highRiskCount, setHighRiskCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);

  const direction = directionFromPathname(pathname) ?? "inbound";
  const isInukaWorkspace = direction === "outbound";
  const allowedDirections = getAllowedDirections(user);
  const canSwitchWorkspace = allowedDirections.length > 1;

  const isAdmin = user?.roles.includes("system_admin") ?? false;
  const isRevenueAssurance = user?.roles.includes("revenue_assurance") ?? false;
  const isManager = user?.roles.includes("manager") ?? false;
  const isInukaManager = user?.roles.includes("inuka_manager") ?? false;

  useEffect(() => {
    const saved = localStorage.getItem("kpc_sidebar_collapsed");
    if (saved !== null) setSidebarCollapsed(saved === "true");
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.getItem("kpc_sidebar_collapsed");
      localStorage.setItem("kpc_sidebar_collapsed", String(next));
      return next;
    });
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    if (user.permissions.includes("view_anomaly_table")) {
      getAnomalies(0, 1, 1, {}, direction)
        .then((res) => { if (!cancelled) setAnomalyCount(res.pagination.total); })
        .catch(() => {});
    }

    if (user.permissions.includes("view_omc_risk_profile") && direction === "inbound") {
      getOmcRiskProfile(0, direction)
        .then((profiles) => {
          if (!cancelled) setHighRiskCount(profiles.filter((p) => p.risk_level === "High").length);
        })
        .catch(() => {});
    }

    if (user.permissions.includes("manage_ebilling") && direction === "inbound") {
      getEbillingStatus()
        .then((status) => { if (!cancelled) setFailedSyncCount(status.failed_count); })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [user, direction, pathname]);

  const visibleItems = navItems.filter((item) => canAccessModule(user, item, direction));
  const activeItemId = activeNavItemId(pathname);

  const workspaceLabel = isInukaWorkspace ? "Inuka Programme Assurance" : "Oil Revenue Assurance";
  const roleMode = isRevenueAssurance
    ? "Investigation & resolution"
    : isManager
      ? "Oversight & escalation"
      : isInukaManager
        ? "Programme review"
        : "Operations";

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

        {canSwitchWorkspace && (
          <div className={`mb-3 flex items-center p-0.5 rounded-lg bg-sidebar-accent/30 border border-sidebar-border/40 gap-0.5 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
            {(["inbound", "outbound"] as const).map((d) => (
              <button
                key={d}
                aria-pressed={direction === d}
                type="button"
                onClick={() => switchWorkspace(d)}
                className={`flex-1 py-1.5 px-2 rounded-md text-[11px] font-extrabold transition-all cursor-pointer ${
                  direction === d
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-muted-foreground/70 hover:text-sidebar-foreground"
                }`}
              >
                {d === "inbound" ? "🛢️ Oil Revenue" : "Inuka (Outbound)"}
              </button>
            ))}
          </div>
        )}

        <nav aria-label="Workspace modules" className="flex flex-col gap-1 overflow-y-auto min-h-0 pb-4">
          {isAdmin && (
            <Link
              href="/dashboard/admin"
              title={sidebarCollapsed ? "User Administration" : undefined}
              className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""} ${pathname === "/dashboard/admin" ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"}`}
            >
              <span className={pathname === "/dashboard/admin" ? "text-sidebar-primary" : ""}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2m7-10a4 4 0 100-8 4 4 0 000 8zm10 10v-2a4 4 0 010 7.75" />
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
                aria-current={active ? "page" : undefined}
                href={href}
                title={sidebarCollapsed ? navLabel(item, direction) : undefined}
                className={`group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""} ${active ? "bg-sidebar-accent text-sidebar-foreground font-bold" : "text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"}`}
              >
                <span className={active ? "text-sidebar-primary" : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground"}>
                  {item.icon}
                </span>
                <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : ""}`}>
                  {navLabel(item, direction)}
                </span>

                {count > 0 && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-black ${item.badgeKey === "ebilling" ? "bg-amber-500/20 text-amber-500" : "bg-sidebar-primary/20 text-sidebar-primary"} ${sidebarCollapsed ? "lg:hidden" : ""}`}>
                    {count}
                  </span>
                )}
              </Link>
            );
          })}

          {canAccessModule(user, REVIEW_QUEUE_ITEM, direction) && (
            <Link
              href={REVIEW_QUEUE_ITEM.route(direction)}
              title={sidebarCollapsed ? REVIEW_QUEUE_ITEM.label as string : undefined}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${sidebarCollapsed ? "lg:justify-center lg:px-2" : ""} ${pathname === "/dashboard/review-queue" ? "bg-sidebar-accent text-sidebar-foreground font-bold" : "text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"}`}
            >
              <span className={pathname === "/dashboard/review-queue" ? "text-sidebar-primary" : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground"}>
                {REVIEW_QUEUE_ITEM.icon}
              </span>
              <span className={`truncate ${sidebarCollapsed ? "lg:hidden" : ""}`}>
                {REVIEW_QUEUE_ITEM.label as string}
              </span>
            </Link>
          )}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div className="flex flex-col">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{workspaceLabel}</span>
              <span className="text-sm font-semibold text-foreground hidden sm:block">{roleMode} mode</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-full border border-border bg-muted p-0.5 gap-0.5 text-xs font-semibold shadow-sm">
              {([["light", "☀️"], ["dark", "🌙"], ["system", "🖥"]] as const).map(([mode, icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    localStorage.setItem("kpc_theme_mode", mode);
                    const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
                    if (dark) document.documentElement.classList.add("dark");
                    else document.documentElement.classList.remove("dark");
                  }}
                  className="px-2.5 py-1 rounded-full hover:bg-background/80 transition-colors text-foreground cursor-pointer"
                  title={`Switch to ${mode} mode`}
                >
                  {icon}
                </button>
              ))}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((o) => !o)}
                className="flex items-center gap-2 rounded-full border border-border p-1 hover:bg-muted transition-colors cursor-pointer"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">
                  {user?.full_name ? user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : "U"}
                </div>
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-xl z-50 animate-fadeIn">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-bold text-foreground truncate">{user?.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => { logout(); router.push("/login"); }}
                    className="w-full mt-1 text-left px-3 py-2 text-xs font-bold text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                  >
                    Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
