import React from 'react';
import StatCard from './StatCard';

interface ExecutiveKPIsProps {
  totalRevenueProtected: number;
  volumeVarianceIndex: number;
  demurrageRecovered: number;
  activeGateHolds: number;
}

export function ExecutiveKPIs({
  totalRevenueProtected,
  volumeVarianceIndex,
  demurrageRecovered,
  activeGateHolds,
}: ExecutiveKPIsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
        label="Total Revenue Protected"
        value={`KES ${(totalRevenueProtected / 1000000).toFixed(2)}M`}
        note="+12.5% vs prior"
        notePill={true}
        tone="high"
      />
      <StatCard
        label="Volume Variance Index"
        value={`${volumeVarianceIndex.toFixed(2)}%`}
        note="-0.1% vs prior"
        notePill={true}
        tone="critical"
      />
      <StatCard
        label="Auto Demurrage Recovered"
        value={`KES ${(demurrageRecovered / 1000).toFixed(1)}K`}
        note="+8.4% vs prior"
        notePill={true}
        tone="high"
      />
      <StatCard
        label="Active Gate-Holds"
        value={activeGateHolds.toString()}
        note="Requires attention"
        notePill={false}
        tone={activeGateHolds > 0 ? "critical" : "neutral"}
      />
    </div>
  );
}
