"use client";

import { useEffect, useState } from "react";
import { ApiError, getOmcRiskProfile } from "@/lib/api";
import type { OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";
import { useMateriality } from "@/context/MaterialityContext";
import { useDirection } from "@/context/DirectionContext";
import OmcRiskProfile from "@/components/OmcRiskProfile";
import RequirePermission from "@/components/RequirePermission";

export default function OmcRiskPage() {
  const { materiality } = useMateriality();
  const { direction } = useDirection();
  const [profiles, setProfiles] = useState<OmcRiskProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    getOmcRiskProfile(materiality, direction)
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
  }, [materiality, direction]);

  return (
    <RequirePermission code="view_omc_risk_profile">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">OMC Risk Profile</h1>
          <p className="text-sm text-muted-foreground">Customer risk rating and leakage aggregation</p>
        </header>

        {error && (
          <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">
            {error}
          </div>
        )}

        {loading && !error && (
          <div className="flex items-center justify-center p-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-ring/30 border-t-ring"></div>
          </div>
        )}

        {!loading && !error && <OmcRiskProfile profiles={profiles} />}
      </div>
    </RequirePermission>
  );
}
