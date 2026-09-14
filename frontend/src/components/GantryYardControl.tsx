import React, { useState } from 'react';

type LaneStatus = 'PASS' | 'WARNING' | 'HOLD';

interface Lane {
  id: string;
  truck_id: string;
  status: LaneStatus;
  dwell_time_hours: number;
  variance_liters: number;
}

export function GantryYardControl() {
  const [lanes] = useState<Lane[]>([
    { id: 'Lane 1', truck_id: 'KCB 123A', status: 'PASS', dwell_time_hours: 0.5, variance_liters: 0 },
    { id: 'Lane 2', truck_id: 'KDD 456B', status: 'WARNING', dwell_time_hours: 1.8, variance_liters: 10 },
    { id: 'Lane 3', truck_id: 'KAE 789C', status: 'HOLD', dwell_time_hours: 2.5, variance_liters: 500 },
    { id: 'Lane 4', truck_id: 'KZZ 001Z', status: 'PASS', dwell_time_hours: 1.0, variance_liters: -5 },
    { id: 'Lane 5', truck_id: 'KYY 999Y', status: 'HOLD', dwell_time_hours: 0.2, variance_liters: 1200 },
    { id: 'Lane 6', truck_id: 'KXX 888X', status: 'PASS', dwell_time_hours: 0.8, variance_liters: 0 },
  ]);

  const getStatusColor = (status: LaneStatus) => {
    switch(status) {
      case 'PASS': return 'bg-emerald-500/20 border-emerald-500 text-emerald-400';
      case 'WARNING': return 'bg-amber-500/20 border-amber-500 text-amber-400';
      case 'HOLD': return 'bg-rose-500/20 border-rose-500 text-rose-400';
    }
  };

  const getStatusLabel = (status: LaneStatus) => {
    switch(status) {
      case 'PASS': return 'Clear / Matched';
      case 'WARNING': return 'Demurrage Warning';
      case 'HOLD': return 'Volume Mismatch / Demurrage';
    }
  };

  return (
    <div className="p-6 bg-[#0A192F]/80 backdrop-blur-md rounded-xl border border-blue-900/50 shadow-2xl">
      <h2 className="text-2xl font-bold text-white mb-6 font-['Outfit',sans-serif]">Live Gantry Yard Control</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {lanes.map((lane) => (
          <div 
            key={lane.id} 
            className={`p-5 rounded-lg border-2 backdrop-blur-sm transition-all duration-300 hover:scale-105 ${getStatusColor(lane.status)}`}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold font-['Outfit',sans-serif]">{lane.id}</h3>
              <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-black/30">
                {lane.status}
              </span>
            </div>
            
            <div className="space-y-2 font-['Inter',sans-serif] text-sm">
              <div className="flex justify-between">
                <span className="opacity-70">Truck ID:</span>
                <span className="font-mono font-semibold">{lane.truck_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Dwell Time:</span>
                <span className="font-mono font-semibold">{lane.dwell_time_hours} hrs</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Volume Variance:</span>
                <span className="font-mono font-semibold">{lane.variance_liters} L</span>
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-current/20 text-center text-xs font-medium">
              {getStatusLabel(lane.status)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
