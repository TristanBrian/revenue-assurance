"use client";

import { useEffect, useState } from "react";
import { ApiError, getOmcRiskProfile } from "@/lib/api";
import type { OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";
import { useMateriality } from "@/context/MaterialityContext";
import OmcRiskProfile from "@/components/OmcRiskProfile";
import RequirePermission from "@/components/RequirePermission";

export default function OmcRiskPage() {
  const { materiality } = useMateriality();
  const [profiles, setProfiles] = useState<OmcRiskProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getOmcRiskProfile(materiality)
      .then((data) => {
        if (!cancelled) setProfiles(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load OMC risk data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [materiality]);

  return (
    <RequirePermission code="view_omc_risk_profile">
      <div className="flex flex-col gap-6 max-w-5xl mx-auto">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-white">OMC Risk Profile</h1>
          <p className="text-sm text-zinc-400">Customer risk rating and leakage aggregation</p>
        </header>

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && !error && (
          <div className="flex items-center justify-center p-12">
            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin"></div>
          </div>
        )}

        {!loading && !error && <OmcRiskProfile profiles={profiles} />}
      </div>
    </RequirePermission>
  );
}
