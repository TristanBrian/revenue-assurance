"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface NavItem {
  href: string;
  label: string;
  /** Shown if the user has ANY of these permissions; omitted = always shown. */
  anyOf?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/anomalies", label: "Anomalies", anyOf: ["view_anomalies"] },
  {
    href: "/dashboard/risk",
    label: "Risk & Fraud",
    anyOf: ["view_heatmap", "view_risk_profile", "view_fraud_graph"],
  },
  { href: "/dashboard/upload", label: "Upload CSVs", anyOf: ["upload_csv"] },
  { href: "/dashboard/ebilling", label: "E-Billing", anyOf: ["manage_ebilling"] },
  { href: "/dashboard/reports", label: "Reports", anyOf: ["export_reports"] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.anyOf || item.anyOf.some((code) => user?.permissions.includes(code)),
  );

  return (
    <div className="flex min-h-full flex-1 bg-zinc-50 dark:bg-black">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-6 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          KPC Revenue Assurance
        </h1>
        <nav className="flex flex-1 flex-col gap-1">
          {visibleItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-2 text-sm ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {!loading && user && (
            <>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
              <p className="text-xs capitalize text-zinc-400 dark:text-zinc-500">
                {user.roles.join(", ").replace(/_/g, " ")}
              </p>
            </>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
