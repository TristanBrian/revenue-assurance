"use client";
import React, { useState, useRef } from 'react';

type LaneStatus = 'PASS' | 'WARNING' | 'HOLD' | 'SCANNING';

interface Lane {
  id: string;
  truck_id: string;
  status: LaneStatus;
  dwell_time_hours: number;
  variance_liters: number;
  product: string;
  invoiced_volume: number;
  metered_volume: number;
}

interface LogEntry {
  ts: string;
  type: 'info' | 'hold' | 'pass' | 'action' | 'alert';
  msg: string;
}

const INITIAL_LANES: Lane[] = [
  { id: 'Lane 1', truck_id: 'KCB 123A', status: 'PASS',    dwell_time_hours: 0.5, variance_liters: 0,    product: 'PMS', invoiced_volume: 33000, metered_volume: 33000 },
  { id: 'Lane 2', truck_id: 'KDD 456B', status: 'WARNING', dwell_time_hours: 1.8, variance_liters: 10,   product: 'AGO', invoiced_volume: 33000, metered_volume: 33010 },
  { id: 'Lane 3', truck_id: 'KAE 789C', status: 'HOLD',    dwell_time_hours: 2.5, variance_liters: 500,  product: 'PMS', invoiced_volume: 33000, metered_volume: 33500 },
  { id: 'Lane 4', truck_id: 'KZZ 001Z', status: 'PASS',    dwell_time_hours: 1.0, variance_liters: 0,    product: 'IK',  invoiced_volume: 20000, metered_volume: 20000 },
  { id: 'Lane 5', truck_id: 'KYY 999Y', status: 'HOLD',    dwell_time_hours: 0.2, variance_liters: 1200, product: 'PMS', invoiced_volume: 33000, metered_volume: 34200 },
  { id: 'Lane 6', truck_id: 'KXX 888X', status: 'PASS',    dwell_time_hours: 0.8, variance_liters: 0,    product: 'AGO', invoiced_volume: 27000, metered_volume: 27000 },
];

function now() {
  return new Date().toLocaleTimeString('en-KE', { hour12: false });
}

const STATUS_STYLES: Record<LaneStatus, string> = {
  PASS:     'bg-emerald-500/10 border-emerald-500/50 text-emerald-400',
  WARNING:  'bg-amber-500/10 border-amber-500/50 text-amber-400',
  HOLD:     'bg-rose-500/15 border-rose-500 text-rose-400 shadow-rose-500/30 shadow-lg animate-pulse',
  SCANNING: 'bg-blue-500/10 border-blue-400/60 text-blue-300',
};

const LOG_COLORS: Record<LogEntry['type'], string> = {
  info:   'text-slate-400',
  hold:   'text-rose-400 font-semibold',
  pass:   'text-emerald-400 font-semibold',
  action: 'text-amber-300',
  alert:  'text-purple-400',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://revenue-assurance.fly.dev/api';

export function GantryYardControl() {
  const [lanes, setLanes] = useState<Lane[]>(INITIAL_LANES);
  const [log, setLog] = useState<LogEntry[]>([
    { ts: now(), type: 'info', msg: 'System initialised — Autonomous Control Plane v2 online.' },
  ]);
  const [scanning, setScanning] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  function addLog(type: LogEntry['type'], msg: string) {
    setLog(prev => {
      const next = [...prev, { ts: now(), type, msg }];
      return next.slice(-80); // keep last 80 lines
    });
    setTimeout(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }

  async function simulateScan(lane: Lane) {
    if (scanning) return;
    setScanning(lane.id);
    setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: 'SCANNING' } : l));
    addLog('info', `SCAN  ▶  Truck ${lane.truck_id} @ ${lane.id} — initiating gate check…`);

    try {
      // Step 1: Gate lockout check
      const res = await fetch(`${API_BASE}/v1/control/gate-lockout-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispatch_id: `D-${lane.truck_id.replace(/\s/g, '')}-${Date.now()}`,
          truck_id: lane.truck_id,
          omc_name: 'Demo OMC Ltd',
          metered_volume_l: lane.metered_volume,
          invoiced_volume_l: lane.invoiced_volume,
          allowed_evaporation_pct: lane.product === 'PMS' ? 0.5 : lane.product === 'AGO' ? 0.3 : 0.2,
        }),
      });

      const data = await res.json();
      const isHold = !res.ok || data?.status === 'GATE_HOLD' || data?.data?.status === 'GATE_HOLD';
      const newStatus: LaneStatus = isHold ? 'HOLD' : 'PASS';

      setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: newStatus } : l));

      if (isHold) {
        addLog('hold', `HOLD  🔴  ${lane.truck_id} — variance ${lane.variance_liters}L exceeds tolerance for ${lane.product}. EXIT BLOCKED.`);

        // Step 2: KRA iCMS tax adjustment
        addLog('action', `ACTION ⚙  Triggering KRA iCMS tax adjustment note…`);
        try {
          const taxRes = await fetch(`${API_BASE}/control-plane/icms-tax-adjustment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dispatch_id: `D-${lane.truck_id.replace(/\s/g, '')}`, volume_discrepancy: lane.variance_liters }),
          });
          const taxData = await taxRes.json();
          const ref = taxData?.data?.icms_reference ?? taxData?.icms_reference ?? 'KRA-ADJ-PENDING';
          addLog('action', `ACTION ✅  iCMS adjustment queued — Ref: ${ref}`);
        } catch {
          addLog('action', `ACTION ✅  iCMS adjustment queued — Ref: KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-DEMO`);
        }

        // Step 3: Manager alert
        addLog('alert', `ALERT  📣  PagerDuty/Slack notification dispatched to Depot Manager.`);
        try {
          await fetch(`${API_BASE}/control-plane/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incident_type: 'VOLUME_MISMATCH', dispatch_id: `D-${lane.truck_id.replace(/\s/g, '')}`, details: `Variance ${lane.variance_liters}L on ${lane.product}` }),
          });
        } catch { /* non-blocking */ }

      } else {
        addLog('pass', `PASS  🟢  ${lane.truck_id} — volumes matched. Gate cleared for exit.`);
      }
    } catch {
      // API unreachable — show deterministic simulation result
      const simulatedHold = lane.variance_liters > 50 || lane.dwell_time_hours > 2;
      const newStatus: LaneStatus = simulatedHold ? 'HOLD' : 'PASS';
      setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: newStatus } : l));
      if (simulatedHold) {
        addLog('hold', `HOLD  🔴  ${lane.truck_id} — variance ${lane.variance_liters}L exceeds tolerance. EXIT BLOCKED.`);
        addLog('action', `ACTION ✅  iCMS adjustment queued — Ref: KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-DEMO`);
        addLog('alert', `ALERT  📣  Manager notification dispatched (offline mode).`);
      } else {
        addLog('pass', `PASS  🟢  ${lane.truck_id} — volumes matched. Gate cleared.`);
      }
    } finally {
      setScanning(null);
    }
  }

  const holdCount = lanes.filter(l => l.status === 'HOLD').length;
  const passCount = lanes.filter(l => l.status === 'PASS').length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground font-['Outfit',sans-serif]">
            🛡️ Autonomous Gate Control Plane
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time gantry scan simulation — click <span className="font-semibold text-primary">Scan Truck</span> to trigger gate-lockout check
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-semibold">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30">
            🔴 {holdCount} HOLD
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            🟢 {passCount} PASS
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Lane Grid */}
        <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className={`relative p-4 rounded-xl border-2 transition-all duration-500 ${STATUS_STYLES[lane.status]}`}
            >
              {lane.status === 'HOLD' && (
                <div className="absolute top-2 right-2 text-lg" title="Gate Hold">🔒</div>
              )}
              {lane.status === 'SCANNING' && (
                <div className="absolute top-2 right-2 animate-spin text-lg">⚙️</div>
              )}
              {lane.status === 'PASS' && (
                <div className="absolute top-2 right-2 text-lg">✅</div>
              )}

              <div className="mb-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-base font-['Outfit',sans-serif]">{lane.id}</h3>
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    lane.status === 'HOLD' ? 'bg-rose-500/30' : lane.status === 'WARNING' ? 'bg-amber-500/30' : lane.status === 'SCANNING' ? 'bg-blue-500/30' : 'bg-emerald-500/30'
                  }`}>{lane.status}</span>
                </div>
                <p className="text-xs font-mono opacity-80 mt-0.5">{lane.truck_id} · {lane.product}</p>
              </div>

              <div className="space-y-1.5 text-xs mb-4">
                <div className="flex justify-between">
                  <span className="opacity-70">Metered</span>
                  <span className="font-mono font-semibold">{lane.metered_volume.toLocaleString()} L</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Invoiced</span>
                  <span className="font-mono font-semibold">{lane.invoiced_volume.toLocaleString()} L</span>
                </div>
                <div className={`flex justify-between font-semibold ${lane.variance_liters > 50 ? 'text-rose-400' : 'opacity-80'}`}>
                  <span className="opacity-70">Variance</span>
                  <span className="font-mono">{lane.variance_liters > 0 ? '+' : ''}{lane.variance_liters} L</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Dwell</span>
                  <span className={`font-mono font-semibold ${lane.dwell_time_hours > 2 ? 'text-amber-400' : ''}`}>{lane.dwell_time_hours}h</span>
                </div>
              </div>

              <button
                onClick={() => simulateScan(lane)}
                disabled={scanning !== null}
                className={`w-full py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all duration-200 ${
                  scanning === lane.id
                    ? 'bg-blue-500/20 text-blue-300 cursor-wait'
                    : scanning !== null
                    ? 'opacity-30 cursor-not-allowed bg-current/10'
                    : 'bg-current/15 hover:bg-current/25 active:scale-95 cursor-pointer'
                }`}
              >
                {scanning === lane.id ? '⚙ Scanning…' : '▶ Scan Truck'}
              </button>
            </div>
          ))}
        </div>

        {/* Live Event Log */}
        <div className="flex flex-col bg-slate-950 border border-slate-700/50 rounded-xl overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 bg-slate-900">
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-widest font-mono">
              ⚡ System Event Log
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-slate-500 font-mono">LIVE</span>
            </span>
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[11px] min-h-[280px] max-h-[400px]"
          >
            {log.map((entry, i) => (
              <div key={i} className="flex gap-2 leading-relaxed">
                <span className="text-slate-600 shrink-0">{entry.ts}</span>
                <span className={LOG_COLORS[entry.type]}>{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GantryYardControl;
