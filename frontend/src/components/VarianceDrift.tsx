import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';

const mockDriftData = [
  { time: '08:00', metered: 4000, invoiced: 4000 },
  { time: '09:00', metered: 3000, invoiced: 3000 },
  { time: '10:00', metered: 2000, invoiced: 2050 }, // Small drift
  { time: '11:00', metered: 2780, invoiced: 2700 },
  { time: '12:00', metered: 1890, invoiced: 1890 },
  { time: '13:00', metered: 2390, invoiced: 2000 }, // Large drift
  { time: '14:00', metered: 3490, invoiced: 3490 },
];

const mockOmcData = [
  { name: 'OMC A', discrepancyLiters: 4000, demurrageHrs: 24 },
  { name: 'OMC B', discrepancyLiters: 3000, demurrageHrs: 13 },
  { name: 'OMC C', discrepancyLiters: 2000, demurrageHrs: 98 },
  { name: 'OMC D', discrepancyLiters: 2780, demurrageHrs: 39 },
  { name: 'OMC E', discrepancyLiters: 1890, demurrageHrs: 48 },
];

export function VarianceDrift() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
      
      {/* Drift Line Chart */}
      <div className="p-6 bg-[#0A192F]/80 backdrop-blur-md rounded-xl border border-blue-900/50 shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-6 font-['Outfit',sans-serif]">
          Real-Time Volume Drift (Meter vs Invoice)
        </h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockDriftData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis dataKey="time" stroke="#94A3B8" />
              <YAxis stroke="#94A3B8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #1E293B', borderRadius: '8px' }}
                itemStyle={{ color: '#E2E8F0' }}
              />
              <Legend />
              <Line type="monotone" dataKey="metered" stroke="#10B981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
              <Line type="monotone" dataKey="invoiced" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* OMC Leaderboard Bar Chart */}
      <div className="p-6 bg-[#0A192F]/80 backdrop-blur-md rounded-xl border border-blue-900/50 shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-6 font-['Outfit',sans-serif]">
          OMC Leaderboard: Discrepancy & Demurrage
        </h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mockOmcData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis type="number" stroke="#94A3B8" />
              <YAxis dataKey="name" type="category" stroke="#94A3B8" width={80} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #1E293B', borderRadius: '8px' }}
                itemStyle={{ color: '#E2E8F0' }}
              />
              <Legend />
              <Bar dataKey="discrepancyLiters" name="Volume Discrepancy (L)" fill="#F43F5E" radius={[0, 4, 4, 0]} />
              <Bar dataKey="demurrageHrs" name="Total Demurrage (Hrs)" fill="#F59E0B" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
}
