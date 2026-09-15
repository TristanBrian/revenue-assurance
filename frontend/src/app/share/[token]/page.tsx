"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { GantryYardControl } from "@/components/GantryYardControl";
import AuditVerifyPanel from "@/components/AuditVerifyPanel";
import DepotMap from "@/components/DepotMap";
import { OilBarrelIcon, ShieldIcon, SatelliteIcon, TruckIcon } from "@/components/depot/DepotIcons";
import { AuditProvider } from "@/context/AuditContext";

type VerifyStatus = "loading" | "valid" | "expired" | "error";

export default function SharePage() {
  const params = useParams();
  const token = params?.token as string;
  const [status, setStatus] = useState<VerifyStatus>("loading");
  const [activeTab, setActiveTab] = useState<"gantry" | "map" | "audit">("gantry");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    fetch(`${baseUrl}/api/share/verify?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.ok) {
          setStatus("valid");
        } else {
          const data = await res.json().catch(() => ({}));
          // Handle envelope response
          const detail = data?.detail || data?.data?.detail || "";
          if (detail.toLowerCase().includes("expired")) {
            setStatus("expired");
          } else {
            setStatus("expired");
          }
        }
      })
      .catch(() => {
        setStatus("error");
      });
  }, [token]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#12100e] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-3 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-sm font-mono text-slate-400">Verifying executive share link…</p>
        </div>
      </div>
    );
  }

  if (status === "expired" || status === "error") {
    return (
      <div className="min-h-screen bg-[#12100e] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#1f1b19] border border-[#33302c] rounded-2xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
            <ShieldIcon className="text-rose-400" size={28} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-100 font-['Outfit',sans-serif]">
              {status === "expired" ? "Link Expired" : "Invalid Link"}
            </h1>
            <p className="text-sm text-slate-400 mt-2">
              {status === "expired"
                ? "This executive share link has expired. Please request a new link from a Reconova administrator."
                : "This link is invalid or has been revoked."}
            </p>
          </div>
          <div className="pt-2">
            <a
              href="/login"
              className="inline-block px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 text-sm font-black transition-all hover:from-amber-400 hover:to-amber-500"
            >
              Sign In to Reconova
            </a>
          </div>
          <p className="text-[10px] text-slate-500 font-mono">
            Reconova Revenue Assurance Platform • Kenya Pipeline Company
          </p>
        </div>
      </div>
    );
  }

  // Valid token — render read-only depot view
  return (
    <AuditProvider>
      <div className="min-h-screen bg-[#12100e] p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-[1700px] mx-auto flex flex-col gap-5">
          {/* ── Read-Only Executive Header ───────────────────── */}
          <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1f1b19] via-[#2a2220] to-[#1c1715] border border-[#33302c] p-6 shadow-xl">
            <div className="absolute -top-20 -right-20 w-72 h-72 bg-amber-500/8 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
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
                    Executive Read-Only View • Shared via secure link
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
                <ShieldIcon className="text-cyan-400" size={14} />
                <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase">Read-Only</span>
              </div>
            </div>
          </header>

          {/* ── Mobile Tab Navigation ────────────────────────── */}
          <div className="flex lg:hidden items-center bg-[#1f1b19] border border-[#33302c] rounded-xl p-1 gap-1">
            {([
              { id: "gantry" as const, label: "Gantry Control", icon: <TruckIcon size={14} className="text-current" /> },
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

          {/* ── Primary Content Grid ─────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`lg:col-span-2 ${activeTab !== "gantry" ? "hidden lg:block" : ""}`}>
              <GantryYardControl />
            </div>
            <div className={`lg:col-span-1 ${activeTab !== "map" ? "hidden lg:block" : ""}`}>
              <div className="rounded-2xl bg-[#1c1715] border border-[#33302c] overflow-hidden shadow-xl h-full min-h-[420px]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#33302c] bg-[#1f1b19]">
                  <div className="flex items-center gap-2">
                    <SatelliteIcon className="text-amber-400" size={16} />
                    <span className="text-xs font-black text-slate-200 uppercase tracking-wider font-mono">
                      KPC Pipeline Corridor
                    </span>
                  </div>
                </div>
                <div className="h-[380px] lg:h-[calc(100%-48px)]">
                  <DepotMap />
                </div>
              </div>
            </div>
          </div>

          {/* ── Audit Verification ────────────────────────────── */}
          <div className={`${activeTab !== "audit" ? "hidden lg:block" : ""}`}>
            <AuditVerifyPanel />
          </div>

          {/* ── Footer ───────────────────────────────────────── */}
          <footer className="text-center py-4">
            <p className="text-[10px] text-slate-500 font-mono">
              Reconova Revenue Assurance Platform • Kenya Pipeline Company • Immutable Cryptographic Audit Trail
            </p>
          </footer>
        </div>
      </div>
    </AuditProvider>
  );
}
