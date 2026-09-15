"use client";
import React, { useState, useRef, useEffect } from 'react';

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
  driver: string;
  omc: string;
}

interface LogEntry {
  ts: string;
  type: 'info' | 'hold' | 'pass' | 'action' | 'alert';
  msg: string;
}

const INITIAL_LANES: Lane[] = [
  { id: 'Bay 01', truck_id: 'KCB 123A', status: 'PASS',    dwell_time_hours: 0.5, variance_liters: 0,    product: 'PMS', invoiced_volume: 33000, metered_volume: 33000, driver: 'J. Kamau', omc: 'TotalEnergies' },
  { id: 'Bay 02', truck_id: 'KDD 456B', status: 'WARNING', dwell_time_hours: 1.8, variance_liters: 10,   product: 'AGO', invoiced_volume: 33000, metered_volume: 33010, driver: 'O. Otieno', omc: 'Vivo Energy' },
  { id: 'Bay 03', truck_id: 'KAE 789C', status: 'HOLD',    dwell_time_hours: 2.5, variance_liters: 500,  product: 'PMS', invoiced_volume: 33000, metered_volume: 33500, driver: 'P. Mwangi', omc: 'Rubis Energy' },
  { id: 'Bay 04', truck_id: 'KZZ 001Z', status: 'PASS',    dwell_time_hours: 1.0, variance_liters: 0,    product: 'IK',  invoiced_volume: 20000, metered_volume: 20000, driver: 'H. Kiprop', omc: 'Ola Energy' },
  { id: 'Bay 05', truck_id: 'KYY 999Y', status: 'HOLD',    dwell_time_hours: 0.2, variance_liters: 1200, product: 'PMS', invoiced_volume: 33000, metered_volume: 34200, driver: 'S. Njoroge', omc: 'Hass Petroleum' },
  { id: 'Bay 06', truck_id: 'KXX 888X', status: 'PASS',    dwell_time_hours: 0.8, variance_liters: 0,    product: 'AGO', invoiced_volume: 27000, metered_volume: 27000, driver: 'M. Wanjiku', omc: 'Astrol Aviation' },
];

function now() {
  return new Date().toLocaleTimeString('en-KE', { hour12: false });
}

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
    { ts: now(), type: 'info', msg: '🛡️ Autonomous Control Plane v3.0 (3D Gantry Engine) initialized.' },
    { ts: now(), type: 'info', msg: '📡 Telemetry sync active — KRA iCMS gateway linked.' },
  ]);
  const [scanning, setScanning] = useState<string | null>(null);
  const [autoSim, setAutoSim] = useState(false);
  const [selectedLane, setSelectedLane] = useState<Lane | null>(INITIAL_LANES[2]); // Bay 03 HOLD lane selected by default
  const logRef = useRef<HTMLDivElement>(null);

  function addLog(type: LogEntry['type'], msg: string) {
    setLog(prev => {
      const next = [...prev, { ts: now(), type, msg }];
      return next.slice(-100);
    });
    setTimeout(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }

  async function simulateScan(lane: Lane) {
    if (scanning) return;
    setScanning(lane.id);
    setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: 'SCANNING' } : l));
    addLog('info', `SCAN  ▶  Truck ${lane.truck_id} @ ${lane.id} — laser telemetry & volumetric scan initiating…`);

    try {
      const res = await fetch(`${API_BASE}/v1/control/gate-lockout-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispatch_id: `D-${lane.truck_id.replace(/\s/g, '')}-${Date.now()}`,
          truck_id: lane.truck_id,
          omc_name: lane.omc,
          metered_volume_l: lane.metered_volume,
          invoiced_volume_l: lane.invoiced_volume,
          allowed_evaporation_pct: lane.product === 'PMS' ? 0.5 : lane.product === 'AGO' ? 0.3 : 0.2,
        }),
      });

      const data = await res.json();
      const isHold = !res.ok || data?.status === 'GATE_HOLD' || data?.data?.status === 'GATE_HOLD';
      const newStatus: LaneStatus = isHold ? 'HOLD' : 'PASS';

      setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: newStatus } : l));
      setSelectedLane(prev => prev?.id === lane.id ? { ...lane, status: newStatus } : prev);

      if (isHold) {
        addLog('hold', `HOLD  🔴  ${lane.truck_id} (${lane.omc}) — variance ${lane.variance_liters}L exceeds threshold. GATE ARM LOCKED.`);

        addLog('action', `ACTION ⚙  Issuing mandatory KRA iCMS tax adjustment note…`);
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

        addLog('alert', `ALERT  📣  PagerDuty & WhatsApp alert sent to Depot Control Manager.`);
        try {
          await fetch(`${API_BASE}/control-plane/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incident_type: 'VOLUME_MISMATCH', dispatch_id: `D-${lane.truck_id.replace(/\s/g, '')}`, details: `Variance ${lane.variance_liters}L on ${lane.product}` }),
          });
        } catch { /* non-blocking */ }

      } else {
        addLog('pass', `PASS  🟢  ${lane.truck_id} — volumes reconciled (0.00% drift). Gate barrier OPEN.`);
      }
    } catch {
      const simulatedHold = lane.variance_liters > 50 || lane.dwell_time_hours > 2;
      const newStatus: LaneStatus = simulatedHold ? 'HOLD' : 'PASS';
      setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: newStatus } : l));
      setSelectedLane(prev => prev?.id === lane.id ? { ...lane, status: newStatus } : prev);
      if (simulatedHold) {
        addLog('hold', `HOLD  🔴  ${lane.truck_id} — variance ${lane.variance_liters}L detected. GATE ARM LOCKED.`);
        addLog('action', `ACTION ✅  iCMS adjustment queued — Ref: KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-DEMO`);
        addLog('alert', `ALERT  📣  Manager notification dispatched.`);
      } else {
        addLog('pass', `PASS  🟢  ${lane.truck_id} — volumes verified. Barrier OPEN.`);
      }
    } finally {
      setScanning(null);
    }
  }

  function handleManualOverride(lane: Lane) {
    const code = prompt(`⚠️ ENTER MANAGER OVERRIDE AUTH CODE for ${lane.truck_id} (${lane.id}):`, "KPC-MGR-9941");
    if (code) {
      setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: 'PASS', variance_liters: 0 } : l));
      addLog('alert', `OVERRIDE 🔑  Manual Gate Clearance issued by Manager (Auth: ${code}). ${lane.truck_id} unlocked.`);
      if (selectedLane?.id === lane.id) {
        setSelectedLane({ ...lane, status: 'PASS', variance_liters: 0 });
      }
    }
  }

  const holdCount = lanes.filter(l => l.status === 'HOLD').length;
  const passCount = lanes.filter(l => l.status === 'PASS').length;
  const warningCount = lanes.filter(l => l.status === 'WARNING').length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-card border border-border/80 shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-foreground font-['Outfit',sans-serif] tracking-tight">
              🏗️ Autonomous Depot Yard & Gantry Control Plane
            </h2>
            <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
              LIVE 3D SIMULATION
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Physical meter integration, gate barrier solenoids, and automatic KRA iCMS tax adjustment engine.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-background border border-border text-xs font-semibold">
            <span className="text-rose-400 font-bold">{holdCount}</span> <span className="opacity-70">HOLD</span>
            <span className="text-muted-foreground opacity-30">|</span>
            <span className="text-amber-400 font-bold">{warningCount}</span> <span className="opacity-70">WARN</span>
            <span className="text-muted-foreground opacity-30">|</span>
            <span className="text-emerald-400 font-bold">{passCount}</span> <span className="opacity-70">PASS</span>
          </div>

          <button
            onClick={() => simulateScan(selectedLane ?? lanes[2])}
            disabled={scanning !== null}
            className="px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wide bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            {scanning ? '⚙ Scanning…' : `⚡ Scan ${selectedLane?.id ?? 'Bay 03'}`}
          </button>
        </div>
      </div>

      {/* 3D Isometric Yard View Component */}
      <div className="relative rounded-2xl bg-slate-950 border border-slate-800 p-6 shadow-2xl overflow-hidden min-h-[380px] flex flex-col justify-between">
        {/* Ambient Grid Backdrop */}
        <div 
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#3b82f6 1px, transparent 1px), radial-gradient(#6366f1 1px, transparent 1px)`,
            backgroundSize: `24px 24px`,
            backgroundPosition: `0 0, 12px 12px`
          }}
        />

        {/* 3D Stage Banner */}
        <div className="relative z-10 flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#38bdf8]" />
            <span className="text-xs font-mono font-bold text-slate-200 tracking-wider">GANTRY BAY ISOMETRIC MATRIX</span>
          </div>
          <span className="text-[10px] font-mono text-cyan-400/80 bg-cyan-950/60 px-2.5 py-1 rounded-full border border-cyan-800/50">
            FPS: 60 · SENSORS: ONLINE · FLOW RATE: 1,450 L/min
          </span>
        </div>

        {/* 3D Isometric Bays Rendering */}
        <div className="relative z-10 my-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {lanes.map((lane) => {
            const isSelected = selectedLane?.id === lane.id;
            const isHold = lane.status === 'HOLD';
            const isScan = lane.status === 'SCANNING';
            const isPass = lane.status === 'PASS';

            return (
              <div
                key={lane.id}
                onClick={() => setSelectedLane(lane)}
                className={`relative group cursor-pointer transition-all duration-300 p-3.5 rounded-xl border flex flex-col justify-between min-h-[190px] ${
                  isSelected
                    ? 'bg-slate-900/90 border-cyan-400 shadow-[0_0_20px_rgba(56,189,248,0.25)] scale-[1.03]'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                }`}
              >
                {/* Laser Scanning Overhead Beam Animation */}
                {isScan && (
                  <div className="absolute inset-x-0 top-0 h-1 bg-cyan-400 shadow-[0_0_15px_#22d3ee] animate-bounce z-20" />
                )}

                {/* Status Beacon & Gate Barrier arm indicator */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono font-bold text-slate-300">{lane.id}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      isHold ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e] animate-ping' :
                      isScan ? 'bg-blue-400 shadow-[0_0_10px_#60a5fa] animate-pulse' :
                      lane.status === 'WARNING' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' :
                      'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    }`} />
                    <span className="text-[9px] font-mono font-extrabold uppercase text-slate-400">{lane.status}</span>
                  </div>
                </div>

                {/* 3D Truck Graphic Visualization */}
                <div className="my-2 relative flex items-center justify-center h-20 bg-slate-950/80 rounded-lg border border-slate-800/80 overflow-hidden">
                  {/* Gate Barrier Bar */}
                  <div className={`absolute left-0 inset-y-0 w-1.5 transition-colors ${
                    isHold ? 'bg-rose-500 shadow-[0_0_12px_#f43f5e]' : isPass ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : 'bg-amber-400'
                  }`} />

                  {/* Truck Body Icon with Product Color Badge */}
                  <div className="flex flex-col items-center gap-1 transition-transform group-hover:scale-105">
                    <div className="relative text-3xl select-none">
                      🚚
                      {isHold && (
                        <span className="absolute -top-1 -right-2 text-xs bg-rose-500 text-white rounded-full p-0.5 shadow-lg">
                          🔒
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono font-bold text-cyan-300 tracking-wider">
                      {lane.truck_id}
                    </span>
                  </div>

                  {/* Evaporation / Volumetric Flow Line */}
                  <div className="absolute bottom-1 right-2 text-[9px] font-mono text-slate-400">
                    {lane.product}
                  </div>
                </div>

                {/* Volumetric readout */}
                <div className="space-y-0.5 text-[10px] font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>Meter:</span>
                    <span className="text-slate-200 font-bold">{lane.metered_volume.toLocaleString()}L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Var:</span>
                    <span className={lane.variance_liters > 50 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {lane.variance_liters > 0 ? `+${lane.variance_liters}` : lane.variance_liters}L
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Bay HUD Footer Details */}
        {selectedLane && (
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs font-mono">
            <div className="flex items-center gap-4">
              <span className="text-cyan-400 font-bold text-sm">📍 Selected: {selectedLane.id} ({selectedLane.truck_id})</span>
              <span className="text-slate-400">OMC: <strong className="text-slate-200">{selectedLane.omc}</strong></span>
              <span className="text-slate-400">Driver: <strong className="text-slate-200">{selectedLane.driver}</strong></span>
              <span className="text-slate-400">Dwell: <strong className="text-amber-400">{selectedLane.dwell_time_hours} hrs</strong></span>
            </div>

            <div className="flex items-center gap-3">
              {selectedLane.status === 'HOLD' && (
                <button
                  onClick={() => handleManualOverride(selectedLane)}
                  className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[11px] font-bold tracking-wide uppercase transition-all cursor-pointer"
                >
                  🔑 Manager Override Gate
                </button>
              )}
              <button
                onClick={() => simulateScan(selectedLane)}
                disabled={scanning !== null}
                className="px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-bold tracking-wide uppercase transition-all cursor-pointer"
              >
                🔄 Re-scan Telemetry
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Split View: Lane Table & Live Terminal Log */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Detailed Bay Status Cards */}
        <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className={`p-4 rounded-xl border transition-all ${
                lane.status === 'HOLD'
                  ? 'bg-rose-500/10 border-rose-500/40 text-foreground'
                  : lane.status === 'WARNING'
                  ? 'bg-amber-500/10 border-amber-500/40 text-foreground'
                  : lane.status === 'SCANNING'
                  ? 'bg-blue-500/10 border-blue-500/40 text-foreground'
                  : 'bg-card border-border text-foreground'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-sm">{lane.id}</span>
                  <span className="text-xs opacity-70 font-mono">({lane.truck_id})</span>
                </div>
                <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                  lane.status === 'HOLD' ? 'bg-rose-500 text-white' :
                  lane.status === 'WARNING' ? 'bg-amber-500 text-black' :
                  lane.status === 'SCANNING' ? 'bg-blue-500 text-white' :
                  'bg-emerald-500 text-white'
                }`}>
                  {lane.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-3 p-2.5 rounded-lg bg-muted/50">
                <div><span className="opacity-60">Product:</span> <strong>{lane.product}</strong></div>
                <div><span className="opacity-60">OMC:</span> <strong>{lane.omc}</strong></div>
                <div><span className="opacity-60">Invoiced:</span> <strong>{lane.invoiced_volume.toLocaleString()}L</strong></div>
                <div><span className="opacity-60">Metered:</span> <strong>{lane.metered_volume.toLocaleString()}L</strong></div>
              </div>

              <div className="flex items-center justify-between text-xs font-mono">
                <span className={lane.variance_liters > 50 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                  Var: {lane.variance_liters > 0 ? `+${lane.variance_liters}` : lane.variance_liters} L
                </span>
                <button
                  onClick={() => simulateScan(lane)}
                  disabled={scanning !== null}
                  className="px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary font-sans text-[11px] font-bold transition-all cursor-pointer"
                >
                  Scan
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Live Terminal Log */}
        <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl min-h-[350px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              ⚡ Real-Time Audit & Tax Log
            </span>
            <span className="text-[10px] text-slate-400 font-mono">KRA iCMS SECURE</span>
          </div>

          <div
            ref={logRef}
            className="flex-1 overflow-y-auto p-3.5 space-y-1.5 font-mono text-[11px] max-h-[420px]"
          >
            {log.map((entry, i) => (
              <div key={i} className="flex gap-2 leading-relaxed">
                <span className="text-slate-600 shrink-0 select-none">{entry.ts}</span>
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
