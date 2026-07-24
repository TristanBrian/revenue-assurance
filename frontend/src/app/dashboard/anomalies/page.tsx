"use client";

import { useEffect, useState, useMemo } from "react";
import { ApiError, getAnomalies, updateAnomalyStatus } from "@/lib/api";
import type { Anomaly } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useMateriality } from "@/context/MaterialityContext";
import AnomalyTable from "@/components/AnomalyTable";
import RequirePermission from "@/components/RequirePermission";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function AnomaliesContent() {
  const { user } = useAuth();
  const { materiality } = useMateriality();
  const [reloadToken, setReloadToken] = useState(0);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [breakTypeFilter, setBreakTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  
  // Detail Drawer State
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    getAnomalies(materiality, 1, 100)
      .then((data) => {
        if (!cancelled) {
          setAnomalies(data.anomalies);
          // If we had a selected anomaly, update it with fresh data
          if (selectedAnomaly) {
            const fresh = data.anomalies.find(
              (x) => x.dispatch_id === selectedAnomaly.dispatch_id
            );
            if (fresh) setSelectedAnomaly(fresh);
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not reach the reconciliation API. Is the database online?",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiality, reloadToken]);

  async function handleResolve(dispatchId: string) {
    setResolving(true);
    try {
      await updateAnomalyStatus(dispatchId, "Resolved");
      // Force refresh data
      setReloadToken((t) => t + 1);
      // Close drawer or keep open but update
      setSelectedAnomaly(null);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not resolve the anomaly.");
    } finally {
      setResolving(false);
    }
  }

  // Client-side filtering of anomalies for search and dropdowns
  const filteredAnomalies = useMemo(() => {
    return anomalies.filter((a) => {
      // 1. Search Query
      const q = searchQuery.toLowerCase();
      const matchSearch =
        a.customer.toLowerCase().includes(q) ||
        a.dispatch_id.toLowerCase().includes(q) ||
        (a.invoice_id && a.invoice_id.toLowerCase().includes(q)) ||
        a.product.toLowerCase().includes(q);

      // 2. Break Type Filter
      const matchBreakType =
        breakTypeFilter === "All" || a.break_type === breakTypeFilter;

      // 3. Status Filter
      const matchStatus =
        statusFilter === "All" || a.status === statusFilter;

      return matchSearch && matchBreakType && matchStatus;
    });
  }, [anomalies, searchQuery, breakTypeFilter, statusFilter]);

  const canResolve = user?.permissions.includes("resolve_anomaly");

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto relative">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Anomalies</h1>
        <p className="text-sm text-zinc-400">
          Line-item Waybills and Invoices reconciliation leaks
        </p>
      </header>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 bg-zinc-900/40 border border-zinc-800 p-4 rounded-xl">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search by OMC, waybill ID, product, or invoice ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all"
          />
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col gap-1 w-44">
            <select
              value={breakTypeFilter}
              onChange={(e) => setBreakTypeFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none transition-all cursor-pointer"
            >
              <option value="All">All Break Types</option>
              <option value="Missing Invoice">Missing Invoice</option>
              <option value="Missing Payment">Missing Payment</option>
              <option value="Underpayment">Underpayment</option>
              <option value="Overpayment">Overpayment</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 w-36">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none transition-all cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Critical">Critical</option>
              <option value="Pending">Pending</option>
              <option value="Review Required">Review Required</option>
              <option value="Resolved">Resolved</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-400 animate-spin"></div>
        </div>
      )}

      {!loading && !error && (
        <AnomalyTable
          anomalies={filteredAnomalies}
          onSelectAnomaly={setSelectedAnomaly}
          selectedAnomalyId={selectedAnomaly?.dispatch_id}
        />
      )}

      {/* Side Slide-out Detail Drawer */}
      {selectedAnomaly && (
        <>
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setSelectedAnomaly(null)}
          ></div>

          {/* Drawer container */}
          <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-zinc-900 border-l border-zinc-800 shadow-2xl z-50 flex flex-col transition-all duration-300 transform translate-x-0">
            {/* Drawer Header */}
            <div className="p-6 border-b border-zinc-800 flex justify-between items-start bg-zinc-950/50">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">
                  Anomaly Investigation
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Waybill #{selectedAnomaly.dispatch_id}
                </h2>
              </div>
              <button
                onClick={() => setSelectedAnomaly(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800/80 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Drawer Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
              {/* Status Section */}
              <div className="flex items-center justify-between bg-zinc-950/40 p-4 rounded-xl border border-zinc-800/50">
                <div className="flex flex-col">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Current Status</span>
                  <span className={`text-xs font-bold px-2.5 py-0.5 mt-1 rounded-full text-center inline-block ${
                    selectedAnomaly.status === "Critical" ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                    selectedAnomaly.status === "Review Required" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                    selectedAnomaly.status === "Resolved" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                    "bg-zinc-800 text-zinc-300"
                  }`}>
                    {selectedAnomaly.status}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Leakage (KSh)</span>
                  <span className="text-base font-bold text-rose-400 font-mono mt-0.5">
                    {formatKes(selectedAnomaly.leakage_kes)}
                  </span>
                </div>
              </div>

              {/* Waybill / Dispatch details */}
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Waybill Gantry Records</h3>
                <div className="grid grid-cols-2 gap-4 bg-zinc-950/20 border border-zinc-800 p-4 rounded-xl text-sm">
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">Customer OMC</p>
                    <p className="text-zinc-200 mt-0.5 font-medium">{selectedAnomaly.customer}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">Product Category</p>
                    <p className="text-zinc-200 mt-0.5 font-medium">{selectedAnomaly.product}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">Dispatched Value</p>
                    <p className="text-white font-bold font-mono mt-0.5">{formatKes(selectedAnomaly.dispatched_kes)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">Dispatch Age</p>
                    <p className="text-zinc-200 mt-0.5 font-medium">{selectedAnomaly.age_days} days</p>
                  </div>
                </div>
              </div>

              {/* Invoice details */}
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Financial Invoice Match</h3>
                {selectedAnomaly.invoice_id ? (
                  <div className="grid grid-cols-2 gap-4 bg-zinc-950/20 border border-zinc-800 p-4 rounded-xl text-sm">
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">Invoice ID</p>
                      <p className="text-zinc-200 font-mono mt-0.5">{selectedAnomaly.invoice_id}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">Invoiced Value</p>
                      <p className="text-white font-bold font-mono mt-0.5">{formatKes(selectedAnomaly.invoiced_kes)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex gap-3 text-sm text-rose-400">
                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="font-bold">Missing Invoice Detected (Ghost Load)</p>
                      <p className="text-xs text-rose-400/80 mt-1">Fuel was physical dispatched from KPC gantry but no commercial invoice was registered for this OMC.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment Details */}
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">OMC Remittance Match</h3>
                {selectedAnomaly.paid_kes > 0 ? (
                  <div className="grid grid-cols-2 gap-4 bg-zinc-950/20 border border-zinc-800 p-4 rounded-xl text-sm">
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">Paid Amount</p>
                      <p className="text-white font-bold font-mono mt-0.5">{formatKes(selectedAnomaly.paid_kes)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">Reconciliation Status</p>
                      <p className="text-zinc-200 mt-0.5 font-medium">Partial Payment</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3 text-sm text-amber-400">
                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="font-bold">Missing Payment Match</p>
                      <p className="text-xs text-amber-400/80 mt-1">No payment reference matched this commercial invoice. The invoice remains unpaid.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* KRA E-Billing Synced details */}
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">KRA iCMS Status</h3>
                <div className="grid grid-cols-2 gap-4 bg-zinc-950/20 border border-zinc-800 p-4 rounded-xl text-sm">
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">E-Billing Status</p>
                    <p className="text-zinc-200 mt-0.5 capitalize">{selectedAnomaly.ebilling_status}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase">Sync Date</p>
                    <p className="text-zinc-200 mt-0.5 font-mono">{selectedAnomaly.ebilling_sync_date ?? "Pending"}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer Footer Actions */}
            {canResolve && selectedAnomaly.status !== "Resolved" && (
              <div className="p-6 border-t border-zinc-800 bg-zinc-950/50 flex flex-col">
                <button
                  onClick={() => handleResolve(selectedAnomaly.dispatch_id)}
                  disabled={resolving}
                  className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resolving ? "Resolving..." : "Mark Anomaly as Resolved"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function AnomaliesPage() {
  return (
    <RequirePermission code="view_anomaly_table">
      <AnomaliesContent />
    </RequirePermission>
  );
}
