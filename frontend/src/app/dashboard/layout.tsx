"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getMetrics, getOmcRiskProfile, getEbillingStatus } from "@/lib/api";
import { MaterialityProvider, useMateriality } from "@/context/MaterialityContext";

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
      <svg className="w-5 h-5 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/anomalies",
    label: "Anomalies",
    anyOf: ["view_anomaly_table"],
    badgeKey: "anomalies",
    icon: (
      <svg className="w-5 h-5 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/heatmap",
    label: "Heatmap",
    anyOf: ["view_heatmap"],
    icon: (
      <svg className="w-5 h-5 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
      <svg className="w-5 h-5 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/fraud",
    label: "Fraud Graph",
    anyOf: ["view_fraud_graph"],
    icon: (
      <svg className="w-5 h-5 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/ebilling",
    label: "E-Billing",
    anyOf: ["manage_ebilling"],
    badgeKey: "ebilling",
    icon: (
      <svg className="w-5 h-5 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
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

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, logout } = useAuth();
  const { materiality } = useMateriality();
  const pathname = usePathname();
  const router = useRouter();

  // Badges state
  const [anomalyCount, setAnomalyCount] = useState<number>(0);
  const [highRiskCount, setHighRiskCount] = useState<number>(0);
  const [failedSyncCount, setFailedSyncCount] = useState<number>(0);

  useEffect(() => {
    if (!user) return;

    // 1. Fetch metrics for anomaly count badge
    getMetrics(materiality)
      .then((data) => {
        setAnomalyCount(data.metrics.anomaly_count);
      })
      .catch(() => {});

    // 2. Fetch OMC profile for High Risk OMCs badge
    getOmcRiskProfile(materiality)
      .then((profiles) => {
        const highRisk = profiles.filter((p) => p.risk_level === "High").length;
        setHighRiskCount(highRisk);
      })
      .catch(() => {});

    // 3. Fetch E-Billing status for failed sync logs count badge
    getEbillingStatus()
      .then((status) => {
        setFailedSyncCount(status.failed_count);
      })
      .catch(() => {});
  }, [user, materiality]);

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.anyOf || item.anyOf.some((code) => user?.permissions.includes(code)),
  );

  return (
    <div className="flex min-h-full flex-1 bg-zinc-950 text-zinc-100">
      {/* Sidebar navigation panel */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 p-4 transition-all duration-300">
        
        {/* Logo matching the mockup */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-black text-lg shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            $
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white uppercase leading-none">
              KPC Revenue
            </h1>
            <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block mt-0.5">
              Assurance Platform
            </span>
          </div>
        </div>

        {/* Sidebar Nav Items */}
        <nav className="flex flex-1 flex-col gap-1">
          {visibleItems.map((item) => {
            const active = pathname === item.href;
            
            // Get badge count based on key
            let count = 0;
            if (item.badgeKey === "anomalies") count = anomalyCount;
            if (item.badgeKey === "omc_risk") count = highRiskCount;
            if (item.badgeKey === "ebilling") count = failedSyncCount;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded px-3 py-2 text-xs font-semibold tracking-wide transition-all duration-150 ${
                  active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30"
                }`}
              >
                <div className="flex items-center">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                {count > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded bg-rose-600 px-1 text-[9px] font-extrabold text-white">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Materiality Threshold Summary in the bottom-left sidebar */}
        <div className="mt-4 border-t border-zinc-900 pt-4 flex flex-col gap-1">
          <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
            Materiality Threshold
          </span>
          <span className="text-lg font-bold text-emerald-400 font-mono tracking-tight">
            {formatKes(materiality)}
          </span>
          <span className="text-[10px] text-zinc-500">
            All pages filtered
          </span>
        </div>

        {/* User profile section */}
        <div className="mt-4 border-t border-zinc-900 pt-4">
          {!authLoading && user && (
            <div className="flex flex-col">
              <p className="truncate text-xs font-semibold text-zinc-300">{user.email}</p>
              <p className="text-[9px] uppercase tracking-wider font-bold text-indigo-400">
                {user.roles.join(", ").replace(/_/g, " ")}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3.5 w-full text-center py-2 text-xs font-bold text-rose-400 hover:text-rose-350 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded transition-all active:scale-[0.98]"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto p-8 bg-zinc-950 min-h-screen">
        {children}
      </main>
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
