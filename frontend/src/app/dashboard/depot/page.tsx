"use client";

import { useState, useCallback } from "react";
import { GantryYardControl } from "@/components/GantryYardControl";
import AuditVerifyPanel from "@/components/AuditVerifyPanel";
import DepotMap from "@/components/DepotMap";
import RequirePermission from "@/components/RequirePermission";
import { TruckIcon, OilBarrelIcon, ShieldIcon, SatelliteIcon, ShareLinkIcon } from "@/components/depot/DepotIcons";
import { authFetch, API_URL } from "@/lib/api";

function DepotCommandCenter({ readOnly = false }: { readOnly?: boolean }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"gantry" | "map" | "audit">("gantry");

  const handleShare = useCallback(async () => {
    setShareLoading(true);
    try {
      const res = await authFetch(new URL("/api/share/generate?audit_id=depot-live&expires=3600", API_URL));
      const data = await res.json();
      // Handle envelope response
      const payload = data?.data ?? data;
      const fullUrl = `${window.location.origin}${payload.share_url}`;
      setShareUrl(fullUrl);
      await navigator.clipboard.writeText(fullUrl);
      setShareToast("Link copied to clipboard!");
      setTimeout(() => setShareToast(null), 3000);
    } catch {
      setShareToast("Failed to generate link");
      setTimeout(() => setShareToast(null), 3000);
    } finally {
      setShareLoading(false);
    }
  }, []);

  return (
    <div className="w-full max-w-[1700px] mx-auto flex flex-col gap-5">
      {/* ── Executive Hero Header ────────────────────────────── */}
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1f1b19] via-[#2a2220] to-[#1c1715] border border-[#33302c] p-6 shadow-xl">
        {/* Ambient glows */}
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-amber-500/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-orange-500/6 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30">
                <OilBarrelIcon className="text-amber-400" size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-100 font-['Outfit',sans-serif] tracking-tight">
                  3D Depot Command Center
                </h1>
                <p className="text-xs text-slate-400 mt-0.5 font-medium flex items-center gap-2">
                  <SatelliteIcon className="text-emerald-400" size={14} />
                  Real-time volumetric telemetry • Blockchain audit anchoring • KRA iCMS sync
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status Pills */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-[#171310] border border-[#33302c]">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase">Systems Online</span>
              </div>
              <span className="text-[#33302c]">|</span>
              <div className="flex items-center gap-1.5">
                <ShieldIcon className="text-cyan-400" size={12} />
                <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase">Chain Verified</span>
              </div>
            </div>

            {/* Share Button */}
            {!readOnly && (
              <button
                onClick={handleShare}
                disabled={shareLoading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/40 text-amber-300 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                <ShareLinkIcon size={14} />
                {shareLoading ? "Generating…" : "Share Executive View"}
              </button>
            )}

            {readOnly && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
                <ShieldIcon className="text-cyan-400" size={14} />
                <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase">Read-Only Executive View</span>
              </div>
            )}
          </div>
        </div>

        {/* Share Toast */}
        {shareToast && (
          <div className="absolute top-4 right-4 z-50 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold animate-fadeIn">
            {shareToast}
          </div>
        )}

        {/* Share URL display */}
        {shareUrl && !readOnly && (
          <div className="relative z-10 mt-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#171310] border border-[#33302c]">
            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase shrink-0">Link:</span>
            <span className="text-xs font-mono text-amber-300 truncate flex-1">{shareUrl}</span>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl);
                setShareToast("Copied!");
                setTimeout(() => setShareToast(null), 2000);
              }}
              className="text-[10px] font-bold text-amber-400 hover:text-amber-300 cursor-pointer shrink-0"
            >
              Copy
            </button>
          </div>
        )}
      </header>

      {/* ── Mobile Tab Navigation ────────────────────────────── */}
      <div className="flex lg:hidden items-center bg-[#1f1b19] border border-[#33302c] rounded-xl p-1 gap-1">
        {([
          { id: "gantry" as const, label: "Gantry Control", icon: <TruckIcon size={14} /> },
          { id: "map" as const, label: "Pipeline Map", icon: <SatelliteIcon size={14} /> },
          { id: "audit" as const, label: "Audit Trail", icon: <ShieldIcon size={14} /> },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === tab.id
                ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Primary Content Grid ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Gantry Control — 2/3 width on desktop */}
        <div className={`lg:col-span-2 ${activeTab !== "gantry" ? "hidden lg:block" : ""}`}>
          <GantryYardControl />
        </div>

        {/* Depot Pipeline Map — 1/3 width on desktop */}
        <div className={`lg:col-span-1 ${activeTab !== "map" ? "hidden lg:block" : ""}`}>
          <div className="rounded-2xl bg-[#1c1715] border border-[#33302c] overflow-hidden shadow-xl h-full min-h-[420px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#33302c] bg-[#1f1b19]">
              <div className="flex items-center gap-2">
                <SatelliteIcon className="text-amber-400" size={16} />
                <span className="text-xs font-black text-slate-200 uppercase tracking-wider font-mono">
                  KPC Pipeline Corridor
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            </div>
            <div className="h-[380px] lg:h-[calc(100%-48px)]">
              <DepotMap />
            </div>
          </div>
        </div>
      </div>

      {/* ── Audit Verification — Full Width ──────────────────── */}
      <div className={`${activeTab !== "audit" ? "hidden lg:block" : ""}`}>
        <AuditVerifyPanel />
      </div>
    </div>
  );
}

export default function DepotPage() {
  return (
    <RequirePermission code="view_metrics">
      <DepotCommandCenter />
    </RequirePermission>
  );
}
