"use client";

import { useEffect, useState } from "react";
import { ApiError, reconcile } from "@/lib/api";
import type { OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";
import Heatmap from "@/components/Heatmap";
import OmcRiskProfile from "@/components/OmcRiskProfile";
import FraudGraph from "@/components/FraudGraph";
import RequirePermission from "@/components/RequirePermission";

function RiskProfileSection() {
  const [profiles, setProfiles] = useState<OmcRiskProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    reconcile(0)
      .then((data) => {
        if (!cancelled) setProfiles(data.omc_risk_profile);
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
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {error}
      </div>
    );
  }
  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading OMC risk profile…</p>;
  }
  return <OmcRiskProfile profiles={profiles} />;
}

export default function RiskPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Risk &amp; Fraud</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Strategic leakage analysis and fraud investigation tools
        </p>
      </header>

      <RequirePermission code="view_heatmap">
        <Heatmap />
      </RequirePermission>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      <RequirePermission code="view_risk_profile">
        <RiskProfileSection />
      </RequirePermission>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      <RequirePermission code="view_fraud_graph">
        <FraudGraph />
      </RequirePermission>
    </div>
  );
}
