"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getMetrics, getOmcRiskProfile, getEbillingStatus } from "@/lib/api";
import {
  MaterialityProvider,
  useMateriality,
} from "@/context/MaterialityContext";
import { useTheme } from "@/context/ThemeContext";
import { BRAND_CONFIG } from "@/lib/brand-config";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badgeKey?: "anomalies" | "omc_risk" | "ebilling";
  /** Shown if the user has ANY of these permissions; omitted = always shown. */
  anyOf?: string[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/upload",
    label: "Upload CSVs",
    anyOf: ["upload_csv"],
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
  {
    href: "/dashboard/anomalies",
    label: "Anomalies",
    anyOf: ["view_anomaly_table"],
    badgeKey: "anomalies",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/heatmap",
    label: "Heatmap",
    anyOf: ["view_heatmap"],
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/omc-risk",
    label: "OMC Risk",
    anyOf: ["view_omc_risk_profile"],
    badgeKey: "omc_risk",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/fraud",
    label: "Fraud Graph",
    anyOf: ["view_fraud_graph"],
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <path strokeLinecap="round" d="M8.2 7.2L10 15M15.8 7.2L14 15M8.5 6h7" />
      </svg>
    ),
  },
  {
    href: "/dashboard/ebilling",
    label: "E-Billing",
    anyOf: ["manage_ebilling"],
    badgeKey: "ebilling",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/reports",
    label: "Reports",
    anyOf: ["export_reports"],
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 014-4h4m0 0l-3-3m3 3l-3 3M4 7h16M4 7a2 2 0 002 2h12a2 2 0 002-2M4 7a2 2 0 012-2h12a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/admin",
    label: "User Management",
    anyOf: ["manage_users"],
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
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

  const [anomalyCount, setAnomalyCount] = useState<number>(0);
  const [criticalCount, setCriticalCount] = useState<number>(0);
  const [highRiskCount, setHighRiskCount] = useState<number>(0);
  const [failedSyncCount, setFailedSyncCount] = useState<number>(0);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Each badge's source call is gated on the same permission that gates
    // its nav item — a role without it would otherwise 403 on every
    // dashboard load for a badge it can't even see, on every page.
    if (user.permissions.includes("view_metrics")) {
      getMetrics(materiality)
        .then((data) => {
          setAnomalyCount(data.metrics.anomaly_count);
          setCriticalCount(data.metrics.critical_count);
        })
        .catch(() => {});
    }

    if (user.permissions.includes("view_omc_risk_profile")) {
      getOmcRiskProfile(materiality)
        .then((profiles) => {
          setHighRiskCount(profiles.filter((p) => p.risk_level === "High").length);
        })
        .catch(() => {});
    }

    if (user.permissions.includes("manage_ebilling")) {
      getEbillingStatus()
        .then((status) => setFailedSyncCount(status.failed_count))
        .catch(() => {});
    }
  }, [user, materiality]);

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.anyOf || item.anyOf.some((code) => user?.permissions.includes(code)),
  );
  const canSeeAlerts = user?.permissions.includes("view_anomaly_table");

  return (
    <div className="flex min-h-full flex-1 bg-background text-foreground">
      {/* Sidebar — deliberately its own reddish-dark surface (bg-sidebar),
          distinct from the neutral bg-background main layout in both themes. */}
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
          {BRAND_CONFIG.logoUrl ? (
            <div className="w-8 h-8 shrink-0 relative">
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
              className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center font-black text-white text-xs"
              style={{ backgroundColor: BRAND_CONFIG.primaryColor }}
            >
              {BRAND_CONFIG.shortName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-sidebar-foreground leading-none truncate">
              {BRAND_CONFIG.companyName}
            </p>
            <p className="text-[10px] text-sidebar-muted-foreground leading-none mt-1 truncate">
              {BRAND_CONFIG.systemName}
            </p>
          </div>
        </div>

        <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground">
          Workspace
        </p>
        <nav className="flex flex-col gap-0.5">
          {visibleItems.map((item) => {
            const active = pathname === item.href;
            let count = 0;
            if (item.badgeKey === "anomalies") count = anomalyCount;
            if (item.badgeKey === "omc_risk") count = highRiskCount;
            if (item.badgeKey === "ebilling") count = failedSyncCount;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center justify-between rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className={active ? "text-sidebar-primary" : ""}>{item.icon}</span>
                  {item.label}
                </span>
                {count > 0 && (
                  <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-bold text-sidebar-primary-foreground">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-lg bg-sidebar-accent/50 px-3 py-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-sidebar-muted-foreground">
              Materiality Threshold
            </p>
            <p className="text-sm font-bold text-sidebar-foreground font-mono mt-0.5">
              {formatKes(materiality)}
            </p>
          </div>

          <div className="border-t border-sidebar-border pt-3 flex items-center gap-2.5 px-1">
            <div className="w-7 h-7 shrink-0 rounded-full bg-sidebar-primary/20 text-sidebar-primary flex items-center justify-center text-[11px] font-bold">
              {user?.email?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              {!authLoading && user && (
                <>
                  <p className="truncate text-[12px] font-semibold text-sidebar-foreground">{user.email}</p>
                  <p className="text-[10px] capitalize text-sidebar-muted-foreground truncate">
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

      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <header className="flex h-14 items-center justify-between gap-4 px-6 border-b border-border bg-background/80 backdrop-blur-md shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-2 text-sm text-muted-foreground max-w-md w-full">
            <div className="flex items-center gap-2 w-full rounded-md border border-border bg-muted/60 px-3 py-1.5 text-xs">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M19 11a8 8 0 11-16 0 8 8 0 0116 0z" />
              </svg>
              <span className="truncate">Search anomalies, OMCs, invoices…</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {canSeeAlerts && (
              <Link
                href="/dashboard/anomalies"
                title="Critical anomalies"
                className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {criticalCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-critical px-1 text-[8px] font-bold text-white">
                    {criticalCount > 99 ? "99+" : criticalCount}
                  </span>
                )}
              </Link>
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
                <div className="absolute right-0 mt-1 w-32 rounded-md border border-border bg-popover shadow-lg py-1 z-40">
                  {(["light", "dark", "system"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setTheme(mode);
                        setThemeMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs capitalize transition-colors ${
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

        <main className="flex-1 overflow-x-auto p-6 bg-background">{children}</main>
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
