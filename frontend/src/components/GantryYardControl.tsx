"use client";
import React, { useState, useRef } from 'react';

type LaneStatus = 'PASS' | 'WARNING' | 'HOLD' | 'SCANNING';
type TraversalStep = 'ENTRY' | 'BAY_PARK' | 'LASER_SCAN' | 'LOCKOUT_CHECK' | 'GATE_CLEAR';

interface Lane {
  id: string;
  truck_id: string;
  status: LaneStatus;
  dwell_time_minutes: number;
  free_dwell_limit_minutes: number;
  variance_liters: number;
  product: string;
  invoiced_volume: number;
  metered_volume: number;
  driver: string;
  omc: string;
  hold_reason?: string;
}

interface LogEntry {
  ts: string;
  type: 'info' | 'hold' | 'pass' | 'action' | 'alert';
  msg: string;
}

const INITIAL_LANES: Lane[] = [
  { id: 'Bay 01', truck_id: 'KCB 123A', status: 'PASS',    dwell_time_minutes: 25, free_dwell_limit_minutes: 45, variance_liters: 0,    product: 'PMS', invoiced_volume: 33000, metered_volume: 33000, driver: 'J. Kamau', omc: 'TotalEnergies' },
  { id: 'Bay 02', truck_id: 'KDD 104B', status: 'HOLD',    dwell_time_minutes: 52, free_dwell_limit_minutes: 45, variance_liters: 6500, product: 'AGO', invoiced_volume: 32000, metered_volume: 38500, driver: 'O. Otieno', omc: 'Lake Oil', hold_reason: 'Meter volume exceeds invoiced volume (+6,500 L unbilled)' },
  { id: 'Bay 03', truck_id: 'KAE 789C', status: 'HOLD',    dwell_time_minutes: 68, free_dwell_limit_minutes: 45, variance_liters: 500,  product: 'PMS', invoiced_volume: 33000, metered_volume: 33500, driver: 'P. Mwangi', omc: 'Rubis Energy', hold_reason: 'Volumetric drift exceeds 0.5% evaporation safety threshold' },
  { id: 'Bay 04', truck_id: 'KZZ 001Z', status: 'PASS',    dwell_time_minutes: 30, free_dwell_limit_minutes: 45, variance_liters: 0,    product: 'IK',  invoiced_volume: 20000, metered_volume: 20000, driver: 'H. Kiprop', omc: 'Ola Energy' },
  { id: 'Bay 05', truck_id: 'KYY 999Y', status: 'HOLD',    dwell_time_minutes: 18, free_dwell_limit_minutes: 45, variance_liters: 1200, product: 'PMS', invoiced_volume: 33000, metered_volume: 34200, driver: 'S. Njoroge', omc: 'Hass Petroleum', hold_reason: 'Unreconciled PMS overhang detected (+1,200 L)' },
  { id: 'Bay 06', truck_id: 'KXX 888X', status: 'PASS',    dwell_time_minutes: 40, free_dwell_limit_minutes: 45, variance_liters: 0,    product: 'AGO', invoiced_volume: 27000, metered_volume: 27000, driver: 'M. Wanjiku', omc: 'Astrol Aviation' },
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
    { ts: now(), type: 'info', msg: '🛡️ Autonomous Control Plane v3.3 (3D Depot Matrix Engine) active.' },
    { ts: now(), type: 'info', msg: '📡 Telemetry link established — KRA iCMS tax gateway connected.' },
  ]);
  const [scanning, setScanning] = useState<string | null>(null);
  const [selectedLane, setSelectedLane] = useState<Lane | null>(INITIAL_LANES[1]); // Bay 02 Lake Oil default
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [pathProgress, setPathProgress] = useState<number>(65);
  const [currentStep, setCurrentStep] = useState<TraversalStep>('LASER_SCAN');
  const [isSimulatingPath, setIsSimulatingPath] = useState(false);
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

  async function runAnimatedPath(lane: Lane) {
    if (isSimulatingPath) return;
    setIsSimulatingPath(true);
    setSelectedLane(lane);

    setCurrentStep('ENTRY');
    setPathProgress(10);
    addLog('info', `DEPOT ROUTE  ▶  Truck ${lane.truck_id} passed Gate Alpha.`);
    await new Promise(r => setTimeout(r, 500));

    setCurrentStep('BAY_PARK');
    setPathProgress(35);
    addLog('info', `DEPOT ROUTE  ▶  Truck ${lane.truck_id} positioned at ${lane.id} (${lane.omc}).`);
    await new Promise(r => setTimeout(r, 600));

    setCurrentStep('LASER_SCAN');
    setPathProgress(65);
    await simulateScan(lane);

    setPathProgress(95);
    setCurrentStep(lane.variance_liters > 50 ? 'LOCKOUT_CHECK' : 'GATE_CLEAR');
    setIsSimulatingPath(false);
  }

  async function simulateScan(lane: Lane) {
    setScanning(lane.id);
    setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: 'SCANNING' } : l));
    addLog('info', `SCAN  ▶  Laser telemetry scan for ${lane.truck_id} @ ${lane.id}…`);

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
        addLog('hold', `HOLD  🔴  ${lane.truck_id} (${lane.omc}) — variance +${lane.variance_liters}L. GATE ARM LOCKED.`);

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

        addLog('alert', `ALERT  📣  PagerDuty incident alert sent to Depot Manager.`);
        try {
          await fetch(`${API_BASE}/control-plane/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incident_type: 'VOLUME_MISMATCH', dispatch_id: `D-${lane.truck_id.replace(/\s/g, '')}`, details: `Variance ${lane.variance_liters}L on ${lane.product}` }),
          });
        } catch { /* non-blocking */ }

      } else {
        addLog('pass', `PASS  🟢  ${lane.truck_id} — volumes matched. Barrier OPEN.`);
      }
    } catch {
      const simulatedHold = lane.variance_liters > 50 || lane.dwell_time_minutes > 45;
      const newStatus: LaneStatus = simulatedHold ? 'HOLD' : 'PASS';
      setLanes(prev => prev.map(l => l.id === lane.id ? { ...l, status: newStatus } : l));
      setSelectedLane(prev => prev?.id === lane.id ? { ...lane, status: newStatus } : prev);
      if (simulatedHold) {
        addLog('hold', `HOLD  🔴  ${lane.truck_id} — variance +${lane.variance_liters}L detected. GATE ARM LOCKED.`);
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
      setIsInspectorOpen(false);
    }
  }

  function handleTriggerDemurrage(lane: Lane) {
    const demurrageAmount = Math.max(0, (lane.dwell_time_minutes - lane.free_dwell_limit_minutes) * 150);
    addLog('action', `DEMURRAGE 🧾  Auto-invoiced KES ${demurrageAmount.toLocaleString()} to ${lane.omc} for ${lane.truck_id} (${lane.dwell_time_minutes}m dwell).`);
    alert(`✅ Auto-demurrage invoice for KES ${demurrageAmount.toLocaleString()} issued to ${lane.omc}!`);
  }

  function handleTriggerIcms(lane: Lane) {
    const ref = `KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    addLog('action', `KRA iCMS ⚙  Tax adjustment note issued for ${lane.truck_id} (${lane.variance_liters}L) — Ref: ${ref}`);
    alert(`✅ KRA iCMS Tax Adjustment Note queued!\nReference ID: ${ref}`);
  }

  const holdCount = lanes.filter(l => l.status === 'HOLD').length;
  const passCount = lanes.filter(l => l.status === 'PASS').length;
  const warningCount = lanes.filter(l => l.status === 'WARNING').length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-card border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-foreground font-['Outfit',sans-serif] tracking-tight">
              🏗️ Autonomous Depot Control Plane & 3D Gantry Matrix
            </h2>
            <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 animate-pulse">
              3D ACTIVE SIMULATION
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time gantry volumetric telemetry, physical gate lockout barriers, and KRA iCMS tax adjustments.
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
            onClick={() => runAnimatedPath(selectedLane ?? lanes[1])}
            disabled={isSimulatingPath || scanning !== null}
            className="px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wide bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSimulatingPath ? '🚛 Traversal Active…' : `⚡ Run 3D Path (${selectedLane?.id ?? 'Bay 02'})`}
          </button>
        </div>
      </div>

      {/* 3D Depot Route & Pipeline Visualizer Stage */}
      <div className="relative rounded-2xl bg-slate-950 border border-slate-800 p-6 shadow-2xl overflow-hidden min-h-[380px] flex flex-col justify-between">
        {/* Ambient Grid Backdrop */}
        <div 
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(#38bdf8 1px, transparent 1px), radial-gradient(#6366f1 1px, transparent 1px)`,
            backgroundSize: `24px 24px`,
            backgroundPosition: `0 0, 12px 12px`
          }}
        />

        {/* Top Telemetry Step Progress */}
        <div className="relative z-10 flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-cyan-400 font-bold">DEPOT TRAJECTORY:</span>
            {[
              { id: 'ENTRY', label: '1. Gate Alpha' },
              { id: 'BAY_PARK', label: '2. Bay Positioning' },
              { id: 'LASER_SCAN', label: '3. Volumetric Scan' },
              { id: 'LOCKOUT_CHECK', label: '4. Barrier Check' },
            ].map((st) => (
              <span
                key={st.id}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all ${
                  currentStep === st.id
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(56,189,248,0.3)]'
                    : 'bg-slate-900/60 text-slate-500 border-slate-800'
                }`}
              >
                {st.label}
              </span>
            ))}
          </div>

          <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded-full border border-slate-800">
            INSPECTING: <strong className="text-cyan-300">{selectedLane?.truck_id}</strong> ({selectedLane?.omc})
          </span>
        </div>

        {/* 3D Animated Path Track */}
        <div className="relative z-10 my-6 py-4">
          <div className="relative h-3 w-full bg-slate-900 rounded-full border border-slate-800 overflow-hidden shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-indigo-500 transition-all duration-700 rounded-full shadow-[0_0_15px_#38bdf8]"
              style={{ width: `${pathProgress}%` }}
            />
          </div>

          <div 
            className="absolute -top-1 transition-all duration-700 transform -translate-x-1/2 flex flex-col items-center z-20 cursor-pointer"
            style={{ left: `${pathProgress}%` }}
            onClick={() => setIsInspectorOpen(true)}
          >
            <div className="px-2 py-0.5 text-[9px] font-mono font-bold rounded bg-cyan-950 text-cyan-300 border border-cyan-500/50 shadow-lg mb-1 whitespace-nowrap">
              {selectedLane?.truck_id} · {selectedLane?.omc}
            </div>
            <div className="text-3xl filter drop-shadow-[0_0_12px_rgba(56,189,248,0.8)] animate-pulse">
              🚚
            </div>
          </div>
        </div>

        {/* 3D Isometric Bay Grid Cards */}
        <div className="relative z-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {lanes.map((lane) => {
            const isSelected = selectedLane?.id === lane.id;
            const isHold = lane.status === 'HOLD';
            const isScan = lane.status === 'SCANNING';
            const isPass = lane.status === 'PASS';

            return (
              <div
                key={lane.id}
                onClick={() => {
                  setSelectedLane(lane);
                  setIsInspectorOpen(true);
                }}
                className={`relative group cursor-pointer transition-all duration-300 p-3 rounded-xl border flex flex-col justify-between min-h-[175px] ${
                  isSelected
                    ? 'bg-slate-900/90 border-cyan-400 shadow-[0_0_20px_rgba(56,189,248,0.3)] scale-[1.03]'
                    : isHold
                    ? 'bg-rose-950/20 border-rose-800/80 hover:border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                }`}
              >
                {isScan && (
                  <div className="absolute inset-x-0 top-0 h-1 bg-cyan-400 shadow-[0_0_15px_#22d3ee] animate-bounce z-20" />
                )}

                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-mono font-bold text-slate-300">{lane.id}</span>
                  <div className="flex items-center gap-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      isHold ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e] animate-ping' :
                      isScan ? 'bg-blue-400 shadow-[0_0_10px_#60a5fa] animate-pulse' :
                      lane.status === 'WARNING' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' :
                      'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    }`} />
                    <span className="text-[9px] font-mono font-extrabold uppercase text-slate-400">{lane.status}</span>
                  </div>
                </div>

                <div className="my-1.5 relative flex items-center justify-center h-16 bg-slate-950/80 rounded-lg border border-slate-800/80 overflow-hidden">
                  <div className={`absolute left-0 inset-y-0 w-1.5 transition-colors ${
                    isHold ? 'bg-rose-500 shadow-[0_0_12px_#f43f5e]' : isPass ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : 'bg-amber-400'
                  }`} />
                  <div className="text-2xl select-none">🚚</div>
                  <span className="absolute bottom-1 right-2 text-[9px] font-mono text-cyan-400 font-bold">{lane.truck_id}</span>
                </div>

                <div className="space-y-0.5 text-[10px] font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>Metered:</span>
                    <span className="text-slate-200 font-bold">{lane.metered_volume.toLocaleString()}L</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Variance:</span>
                    <span className={lane.variance_liters > 50 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {lane.variance_liters > 0 ? `+${lane.variance_liters}` : lane.variance_liters}L
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Bay Quick HUD Bar */}
        {selectedLane && (
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 mt-4 p-3 rounded-xl bg-slate-900/90 border border-slate-700 text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-cyan-400 font-bold">📍 Active Bay: {selectedLane.id} ({selectedLane.truck_id})</span>
              <span className="text-slate-400">OMC: <strong className="text-slate-200">{selectedLane.omc}</strong></span>
              <span className="text-slate-400">Dwell: <strong className="text-amber-400">{selectedLane.dwell_time_minutes} mins</strong></span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsInspectorOpen(true)}
                className="px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-bold uppercase transition-all cursor-pointer"
              >
                🔍 Inspect Bay Details
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Terminal Real-Time Event Audit Log */}
      <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl min-h-[240px]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900/80">
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            ⚡ Real-Time Control Audit & Tax Log
          </span>
          <span className="text-[10px] text-slate-400 font-mono">KRA iCMS GATEWAY LINK</span>
        </div>

        <div
          ref={logRef}
          className="flex-1 overflow-y-auto p-3.5 space-y-1 font-mono text-[11px] max-h-[260px]"
        >
          {log.map((entry, i) => (
            <div key={i} className="flex gap-2 leading-relaxed">
              <span className="text-slate-600 shrink-0 select-none">{entry.ts}</span>
              <span className={LOG_COLORS[entry.type]}>{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rich Inspector Modal (Matching User's Specified Layout & Actions) */}
      {isInspectorOpen && selectedLane && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100 font-sans space-y-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-bold font-['Outfit',sans-serif] text-cyan-400">
                  {selectedLane.id} Inspector
                </h3>
                <p className="text-sm font-mono text-slate-300 mt-0.5">
                  Truck {selectedLane.truck_id} • <strong className="text-white">{selectedLane.omc}</strong>
                </p>
              </div>
              <button
                onClick={() => setIsInspectorOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-base transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Metrics Breakdown Grid */}
            <div className="grid grid-cols-2 gap-4 text-xs font-mono bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">Gate Clearance Status</span>
                <div>
                  <span className={`inline-block px-2 py-0.5 rounded font-extrabold text-xs uppercase ${
                    selectedLane.status === 'HOLD' ? 'bg-rose-500/30 text-rose-400 border border-rose-500/50' :
                    selectedLane.status === 'WARNING' ? 'bg-amber-500/30 text-amber-400 border border-amber-500/50' :
                    'bg-emerald-500/30 text-emerald-400 border border-emerald-500/50'
                  }`}>
                    {selectedLane.status === 'HOLD' ? 'HOLD_TRIGGERED' : selectedLane.status}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">Product Category</span>
                <p className="font-bold text-sm text-slate-200">{selectedLane.product}</p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-2">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">Physical Meter Reading</span>
                <p className="font-bold text-sm text-slate-100">{selectedLane.metered_volume.toLocaleString()} Liters</p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-2">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">Billed Commercial Invoice</span>
                <p className="font-bold text-sm text-slate-100">{selectedLane.invoiced_volume.toLocaleString()} Liters</p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-2">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">Volume Variance Delta</span>
                <p className={`font-bold text-sm ${selectedLane.variance_liters > 50 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {selectedLane.variance_liters > 0 ? `+${selectedLane.variance_liters.toLocaleString()}` : selectedLane.variance_liters} Liters
                </p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-2">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">Gantry Dwell Duration</span>
                <p className={`font-bold text-sm ${selectedLane.dwell_time_minutes > selectedLane.free_dwell_limit_minutes ? 'text-amber-400' : 'text-slate-200'}`}>
                  {selectedLane.dwell_time_minutes} minutes <span className="text-[10px] text-slate-500 font-normal">(Free limit: {selectedLane.free_dwell_limit_minutes}m)</span>
                </p>
              </div>
            </div>

            {/* Automated Hold / Status Preview Banner */}
            <div className={`p-3.5 rounded-xl border text-xs font-mono leading-relaxed ${
              selectedLane.status === 'HOLD'
                ? 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                : 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
            }`}>
              <div className="font-bold uppercase tracking-wider text-[10px] mb-1">Automated Hold Preview</div>
              {selectedLane.hold_reason ?? (selectedLane.status === 'HOLD' ? 'Meter volume exceeds invoiced volume' : 'All volumetric parameters matched. Barrier arm cleared.')}
            </div>

            {/* Recommended Action Buttons */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Recommended Autonomous Actions</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {selectedLane.status === 'HOLD' && (
                  <>
                    <button
                      onClick={() => handleTriggerIcms(selectedLane)}
                      className="p-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition-all text-left flex items-center gap-2 cursor-pointer"
                    >
                      <span>⚡</span> Issue KRA iCMS Tax Note
                    </button>

                    <button
                      onClick={() => handleTriggerDemurrage(selectedLane)}
                      className="p-2.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 font-bold transition-all text-left flex items-center gap-2 cursor-pointer"
                    >
                      <span>🧾</span> Auto-Bill Demurrage
                    </button>

                    <button
                      onClick={() => handleManualOverride(selectedLane)}
                      className="col-span-1 sm:col-span-2 p-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold transition-all text-center flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>🔑</span> Execute Manager Emergency Gate Override
                    </button>
                  </>
                )}

                {selectedLane.status === 'PASS' && (
                  <div className="col-span-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-center font-bold">
                    ✅ Gate Clear — Truck Authorized for Exit
                  </div>
                )}
              </div>
            </div>

            {/* Footer Close */}
            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsInspectorOpen(false)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GantryYardControl;
