import React from 'react';
import { StatCard } from './StatCard';

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
        title="Total Revenue Protected"
        value={`KES ${(totalRevenueProtected / 1000000).toFixed(2)}M`}
        trend={{ value: 12.5, isPositive: true }}
        icon="shield-check"
      />
      <StatCard
        title="Volume Variance Index"
        value={`${volumeVarianceIndex.toFixed(2)}%`}
        trend={{ value: 0.1, isPositive: false }}
        icon="chart-bar"
      />
      <StatCard
        title="Auto Demurrage Recovered"
        value={`KES ${(demurrageRecovered / 1000).toFixed(1)}K`}
        trend={{ value: 8.4, isPositive: true }}
        icon="clock"
      />
      <StatCard
        title="Active Gate-Holds"
        value={activeGateHolds}
        trend={{ value: 2, isPositive: false }}
        icon="lock-closed"
        highlight={activeGateHolds > 0}
      />
    </div>
  );
}
