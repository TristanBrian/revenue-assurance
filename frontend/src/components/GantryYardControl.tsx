"use client";
import React, { useState, useRef } from 'react';
import { authFetch, API_URL } from "@/lib/api";

type LaneStatus = 'PASS' | 'WARNING' | 'HOLD' | 'SCANNING';
type TraversalStep = 'ENTRY' | 'BAY_PARK' | 'LASER_SCAN' | 'LOCKOUT_CHECK' | 'GATE_CLEAR';
type ViewMode = '3D_ISOMETRIC' | '2D_BLUEPRINT';

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
  hold_reason: string;
}

interface LogEntry {
  ts: string;
  type: 'info' | 'hold' | 'pass' | 'action' | 'alert';
  msg: string;
}

const INITIAL_LANES: Lane[] = [
  { id: 'Bay 01', truck_id: 'KCB 123A', status: 'PASS',    dwell_time_minutes: 25, free_dwell_limit_minutes: 45, variance_liters: 0,    product: 'PMS', invoiced_volume: 33000, metered_volume: 33000, driver: 'J. Kamau', omc: 'TotalEnergies', hold_reason: 'All volumetric parameters matched. Barrier arm cleared.' },
  { id: 'Bay 02', truck_id: 'KDD 104B', status: 'HOLD',    dwell_time_minutes: 52, free_dwell_limit_minutes: 45, variance_liters: 6500, product: 'AGO', invoiced_volume: 32000, metered_volume: 38500, driver: 'O. Otieno', omc: 'Lake Oil', hold_reason: 'Meter volume exceeds invoiced volume (+6,500 L unbilled)' },
  { id: 'Bay 03', truck_id: 'KAE 789C', status: 'HOLD',    dwell_time_minutes: 68, free_dwell_limit_minutes: 45, variance_liters: 500,  product: 'PMS', invoiced_volume: 33000, metered_volume: 33500, driver: 'P. Mwangi', omc: 'Rubis Energy', hold_reason: 'Volumetric drift exceeds 0.5% evaporation safety threshold' },
  { id: 'Bay 04', truck_id: 'KZZ 001Z', status: 'PASS',    dwell_time_minutes: 30, free_dwell_limit_minutes: 45, variance_liters: 0,    product: 'IK',  invoiced_volume: 20000, metered_volume: 20000, driver: 'H. Kiprop', omc: 'Ola Energy', hold_reason: 'All volumetric parameters matched. Barrier arm cleared.' },
  { id: 'Bay 05', truck_id: 'KYY 999Y', status: 'HOLD',    dwell_time_minutes: 18, free_dwell_limit_minutes: 45, variance_liters: 1200, product: 'PMS', invoiced_volume: 33000, metered_volume: 34200, driver: 'S. Njoroge', omc: 'Hass Petroleum', hold_reason: 'Unreconciled PMS overhang detected (+1,200 L)' },
  { id: 'Bay 06', truck_id: 'KXX 888X', status: 'PASS',    dwell_time_minutes: 40, free_dwell_limit_minutes: 45, variance_liters: 0,    product: 'AGO', invoiced_volume: 27000, metered_volume: 27000, driver: 'M. Wanjiku', omc: 'Astrol Aviation', hold_reason: 'All volumetric parameters matched. Barrier arm cleared.' },
];

function now() {
  return new Date().toLocaleTimeString('en-KE', { hour12: false });
}

const LOG_COLORS: Record<LogEntry['type'], string> = {
  info:   'text-cyan-300',
  hold:   'text-rose-400 font-bold',
  pass:   'text-emerald-400 font-bold',
  action: 'text-amber-300 font-semibold',
  alert:  'text-purple-300 font-semibold',
};

export function GantryYardControl() {
  const [lanes, setLanes] = useState<Lane[]>(INITIAL_LANES);
  const [log, setLog] = useState<LogEntry[]>([
    { ts: now(), type: 'info', msg: '🛡️ Autonomous Control Plane v3.4 (3D Isometric Matrix Engine) operational.' },
    { ts: now(), type: 'info', msg: '📡 Telemetry link online — KRA iCMS realtime tax gateway synced.' },
  ]);
  const [scanning, setScanning] = useState<string | null>(null);
  const [selectedLane, setSelectedLane] = useState<Lane | null>(INITIAL_LANES[1]); // Bay 02 default
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [pathProgress, setPathProgress] = useState<number>(65);
  const [currentStep, setCurrentStep] = useState<TraversalStep>('LASER_SCAN');
  const [isSimulatingPath, setIsSimulatingPath] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('3D_ISOMETRIC');
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
    addLog('info', `DEPOT ROUTE  ▶  Truck ${lane.truck_id} passed Gate Alpha Laser scanner.`);
    await new Promise(r => setTimeout(r, 500));

    setCurrentStep('BAY_PARK');
    setPathProgress(35);
    addLog('info', `DEPOT ROUTE  ▶  Truck ${lane.truck_id} docked at ${lane.id} (${lane.omc}).`);
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
    addLog('info', `LASER SCAN  ▶  Optical telemetry scan active for ${lane.truck_id} @ ${lane.id}…`);

    try {
      const res = await authFetch(new URL("/api/v1/control/lockout-check", API_URL), {
        method: 'POST',
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
      const isHold = !res.ok || data?.status === 'GATE_HOLD' || data?.lockout_triggered;
      const newStatus: LaneStatus = isHold ? 'HOLD' : 'PASS';
      const newHoldReason = isHold 
        ? `Meter volume exceeds invoiced volume (+${(lane.metered_volume - lane.invoiced_volume).toLocaleString()} L unbilled)`
        : 'All volumetric parameters matched. Barrier arm cleared.';

      const updatedLane = { ...lane, status: newStatus, hold_reason: newHoldReason };
      setLanes(prev => prev.map(l => l.id === lane.id ? updatedLane : l));
      setSelectedLane(updatedLane);

      if (isHold) {
        addLog('hold', `HOLD TRIGGERED  🔴  ${lane.truck_id} (${lane.omc}) — unbilled volume +${lane.variance_liters}L. GATE ARM LOCKED.`);

        addLog('action', `KRA iCMS ⚙  Generating automated tax adjustment note…`);
        try {
          const taxRes = await authFetch(new URL("/api/v1/control/icms-adjustment-note", API_URL), {
            method: 'POST',
            body: JSON.stringify({
              dispatch_id: `D-${lane.truck_id.replace(/\s/g, '')}`,
              anomaly_id: `ANOM-${lane.truck_id.replace(/\s/g, '')}`,
              kra_pin: "P051123456Z",
              original_invoice_ref: `INV-${lane.invoiced_volume}`,
              adjusted_volume_l: lane.variance_liters,
              unit_price_kes: 145.5,
              note_type: "DEBIT_NOTE",
              resolution_notes: `Gantry telemetry unbilled volume delta (+${lane.variance_liters} L)`,
            }),
          });
          const taxData = await taxRes.json();
          const ref = taxData?.adjustment_note_id ?? taxData?.kra_ack_number ?? `KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-DEMO`;
          addLog('action', `KRA iCMS ✅  Tax adjustment queued — Ref: ${ref}`);
        } catch {
          addLog('action', `KRA iCMS ✅  Tax adjustment queued — Ref: KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-DEMO`);
        }

        addLog('alert', `ALERT 📣 PagerDuty incident dispatched to Depot Manager.`);
      } else {
        addLog('pass', `PASS 🟢 ${lane.truck_id} — volumes verified. Barrier OPEN.`);
      }
    } catch {
      const simulatedHold = lane.variance_liters > 50 || lane.dwell_time_minutes > 45;
      const newStatus: LaneStatus = simulatedHold ? 'HOLD' : 'PASS';
      const newHoldReason = simulatedHold 
        ? `Meter volume exceeds invoiced volume (+${lane.variance_liters.toLocaleString()} L unbilled)`
        : 'All volumetric parameters matched. Barrier arm cleared.';

      const updatedLane = { ...lane, status: newStatus, hold_reason: newHoldReason };
      setLanes(prev => prev.map(l => l.id === lane.id ? updatedLane : l));
      setSelectedLane(updatedLane);
      if (simulatedHold) {
        addLog('hold', `HOLD TRIGGERED 🔴 ${lane.truck_id} — variance +${lane.variance_liters}L. GATE ARM LOCKED.`);
        addLog('action', `KRA iCMS ✅ Tax adjustment note queued — Ref: KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-DEMO`);
        addLog('alert', `ALERT 📣 Manager incident notification dispatched.`);
      } else {
        addLog('pass', `PASS 🟢 ${lane.truck_id} — volumes matched. Barrier OPEN.`);
      }
    } finally {
      setScanning(null);
    }
  }

  function handleManualOverride(lane: Lane) {
    const code = prompt(`⚠️ ENTER MANAGER OVERRIDE AUTH CODE for ${lane.truck_id} (${lane.id}):`, "KPC-MGR-9941");
    if (code) {
      const updated = {
        ...lane,
        status: 'PASS' as LaneStatus,
        variance_liters: 0,
        hold_reason: 'All volumetric parameters matched. Barrier arm cleared. (Manager Override Issued)',
      };
      setLanes(prev => prev.map(l => l.id === lane.id ? updated : l));
      addLog('alert', `OVERRIDE 🔑 Emergency Gate Clearance issued by Manager (Auth: ${code}). ${lane.truck_id} unlocked.`);
      if (selectedLane?.id === lane.id) {
        setSelectedLane(updated);
      }
    }
  }

  function handleTriggerDemurrage(lane: Lane) {
    const demurrageAmount = Math.max(0, (lane.dwell_time_minutes - lane.free_dwell_limit_minutes) * 150);
    addLog('action', `DEMURRAGE 🧾 Auto-billed KES ${demurrageAmount.toLocaleString()} to ${lane.omc} for ${lane.truck_id} (${lane.dwell_time_minutes}m dwell).`);
    alert(`✅ Auto-demurrage invoice for KES ${demurrageAmount.toLocaleString()} issued to ${lane.omc}!`);
  }

  function handleTriggerIcms(lane: Lane) {
    const ref = `KRA-ADJ-${lane.truck_id.replace(/\s/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    addLog('action', `KRA iCMS ⚙ Tax adjustment note issued for ${lane.truck_id} (${lane.variance_liters}L) — Ref: ${ref}`);
    alert(`✅ KRA iCMS Tax Adjustment Note queued!\nReference ID: ${ref}`);
  }

  const holdCount = lanes.filter(l => l.status === 'HOLD').length;
  const passCount = lanes.filter(l => l.status === 'PASS').length;
  const warningCount = lanes.filter(l => l.status === 'WARNING').length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 shadow-[0_0_25px_rgba(6,182,212,0.12)] backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-white font-['Outfit',sans-serif] tracking-tight flex items-center gap-2">
              <span className="text-amber-400">🛢️</span> 3D Depot Volumetric Matrix & Autonomous Control Plane
            </h2>
            <span className="px-3 py-1 text-[10px] font-black uppercase rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_12px_rgba(6,182,212,0.4)] animate-pulse">
              LIVE 3D SIMULATION
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1 font-medium">
            Real-time gantry volumetric telemetry, optical gate lockout barriers, and KRA iCMS automated tax adjustments.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('3D_ISOMETRIC')}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                viewMode === '3D_ISOMETRIC'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md font-black'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              3D Isometric
            </button>
            <button
              type="button"
              onClick={() => setViewMode('2D_BLUEPRINT')}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                viewMode === '2D_BLUEPRINT'
                  ? 'bg-cyan-500 text-slate-950 shadow-md font-black'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              2D Matrix
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono font-bold">
            <span className="text-rose-400 font-extrabold">{holdCount}</span> <span className="text-slate-400 text-[10px]">HOLD</span>
            <span className="text-slate-700">|</span>
            <span className="text-amber-400 font-extrabold">{warningCount}</span> <span className="text-slate-400 text-[10px]">WARN</span>
            <span className="text-slate-700">|</span>
            <span className="text-emerald-400 font-extrabold">{passCount}</span> <span className="text-slate-400 text-[10px]">PASS</span>
          </div>

          <button
            type="button"
            onClick={() => runAnimatedPath(selectedLane ?? lanes[1])}
            disabled={isSimulatingPath || scanning !== null}
            className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSimulatingPath ? '🚛 Traversal Active…' : `⚡ Run 3D Path (${selectedLane?.id ?? 'Bay 02'})`}
          </button>
        </div>
      </div>

      {/* 3D Depot Route & Pipeline Visualizer Stage Container */}
      <div className="relative rounded-3xl bg-slate-950 border-2 border-slate-800/80 p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden min-h-[420px] flex flex-col justify-between">
        {/* Glowing Neon Cyber Grid Backdrop */}
        <div 
          className="absolute inset-0 opacity-25 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(6, 182, 212, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(245, 158, 11, 0.15) 1px, transparent 1px)`,
            backgroundSize: `36px 36px`,
          }}
        />

        {/* Ambient Top & Bottom Neon Beams */}
        <div className="absolute -top-24 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Telemetry Step Progress HUD Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between border-b border-slate-800/80 pb-4 gap-3">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-amber-400 font-black tracking-wider uppercase">DEPOT ROUTE TRAJECTORY:</span>
            {[
              { id: 'ENTRY', label: '1. Gate Alpha' },
              { id: 'BAY_PARK', label: '2. Bay Dock' },
              { id: 'LASER_SCAN', label: '3. Laser Telemetry' },
              { id: 'LOCKOUT_CHECK', label: '4. Barrier Arm' },
            ].map((st) => (
              <span
                key={st.id}
                className={`px-3 py-1 rounded-lg text-[10px] font-black border transition-all ${
                  currentStep === st.id
                    ? 'bg-amber-500/20 text-amber-300 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)] scale-105'
                    : 'bg-slate-900/80 text-slate-500 border-slate-800'
                }`}
              >
                {st.label}
              </span>
            ))}
          </div>

          <span className="text-[11px] font-mono text-slate-300 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-cyan-500/30 shadow-inner">
            ACTIVE TARGET: <strong className="text-cyan-300 font-extrabold">{selectedLane?.truck_id}</strong> ({selectedLane?.omc})
          </span>
        </div>

        {/* Animated 3D Path Track with Glowing Energy Flow */}
        <div className="relative z-10 my-8 py-4">
          <div className="relative h-4 w-full bg-slate-900/90 rounded-full border border-slate-700/80 overflow-hidden shadow-[inner_0_2px_8px_rgba(0,0,0,0.8)]">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 via-amber-400 to-emerald-400 transition-all duration-700 rounded-full shadow-[0_0_20px_#f59e0b]"
              style={{ width: `${pathProgress}%` }}
            />
          </div>

          {/* Animated 3D Isometric Truck Icon Carrier */}
          <div 
            className="absolute -top-3 transition-all duration-700 transform -translate-x-1/2 flex flex-col items-center z-20 cursor-pointer group"
            style={{ left: `${pathProgress}%` }}
            onClick={() => setIsInspectorOpen(true)}
          >
            <div className="px-2.5 py-1 text-[10px] font-mono font-black rounded-lg bg-slate-950 text-cyan-300 border border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.5)] mb-1 whitespace-nowrap group-hover:scale-110 transition-transform">
              🚛 {selectedLane?.truck_id} • {selectedLane?.omc}
            </div>
            <div className="text-4xl filter drop-shadow-[0_0_16px_rgba(245,158,11,0.9)] animate-bounce">
              🚚
            </div>
          </div>
        </div>

        {/* 3D Isometric Gantry Bay Matrix Grid */}
        <div 
          className={`relative z-10 transition-all duration-500 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 ${
            viewMode === '3D_ISOMETRIC' ? 'perspective-1000 transform [transform-style:preserve-3d]' : ''
          }`}
        >
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
                className={`relative group cursor-pointer transition-all duration-300 p-4 rounded-2xl border flex flex-col justify-between min-h-[200px] ${
                  viewMode === '3D_ISOMETRIC'
                    ? 'hover:-translate-y-2 hover:rotate-x-3 hover:shadow-[0_15px_30px_rgba(0,0,0,0.9)]'
                    : ''
                } ${
                  isSelected
                    ? 'bg-slate-900/95 border-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.4)] scale-[1.04] z-20'
                    : isHold
                    ? 'bg-rose-950/30 border-rose-600/80 hover:border-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.25)]'
                    : 'bg-slate-900/60 border-slate-800 hover:border-cyan-500/50 hover:bg-slate-900/90'
                }`}
              >
                {/* Laser Scanning Beam Sweep Indicator */}
                {isScan && (
                  <div className="absolute inset-x-0 top-0 h-1.5 bg-cyan-400 shadow-[0_0_20px_#22d3ee] animate-bounce z-30" />
                )}

                {/* Bay Header & Status Halo */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-black text-slate-200">{lane.id}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded-full ${
                      isHold ? 'bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-ping' :
                      isScan ? 'bg-cyan-400 shadow-[0_0_12px_#22d3ee] animate-pulse' :
                      lane.status === 'WARNING' ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24]' :
                      'bg-emerald-400 shadow-[0_0_10px_#34d399]'
                    }`} />
                    <span className="text-[10px] font-mono font-black uppercase text-slate-300">{lane.status}</span>
                  </div>
                </div>

                {/* 3D Docking Bay Platform with Headlight Beam */}
                <div className="my-2 relative flex items-center justify-center h-20 bg-slate-950/90 rounded-xl border border-slate-800 overflow-hidden shadow-inner group-hover:border-slate-700">
                  <div className={`absolute left-0 inset-y-0 w-2 transition-colors ${
                    isHold ? 'bg-rose-500 shadow-[0_0_14px_#f43f5e]' : isPass ? 'bg-emerald-400 shadow-[0_0_12px_#34d399]' : 'bg-amber-400'
                  }`} />
                  <div className="text-3xl select-none filter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">🚚</div>
                  <span className="absolute bottom-1 right-2 text.10px] font-mono text-cyan-300 font-black">{lane.truck_id}</span>
                  <span className="absolute top-1 right-2 text-[9px] font-mono text-slate-500">{lane.omc.slice(0, 10)}</span>
                </div>

                {/* Volumetric Telemetry & Variance Breakdown */}
                <div className="space-y-1 text-[11px] font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>Metered:</span>
                    <span className="text-slate-100 font-bold">{lane.metered_volume.toLocaleString()}L</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Variance:</span>
                    <span className={lane.variance_liters > 50 ? 'text-rose-400 font-black' : 'text-emerald-400 font-black'}>
                      {lane.variance_liters > 0 ? `+${lane.variance_liters}` : lane.variance_liters}L
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Bay Quick HUD Inspector Trigger Bar */}
        {selectedLane && (
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 mt-6 p-4 rounded-2xl bg-slate-900/90 border border-slate-700 shadow-xl text-xs font-mono">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-amber-400 font-black flex items-center gap-1.5 text-sm">
                <span>📍</span> Active Bay: {selectedLane.id} ({selectedLane.truck_id})
              </span>
              <span className="text-slate-400">OMC: <strong className="text-slate-100">{selectedLane.omc}</strong></span>
              <span className="text-slate-400">Dwell: <strong className="text-amber-400">{selectedLane.dwell_time_minutes} mins</strong></span>
              <span className="text-slate-400">Product: <strong className="text-cyan-300">{selectedLane.product}</strong></span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsInspectorOpen(true)}
                className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-md"
              >
                🔍 Open Inspector Modal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Terminal Real-Time Event Audit Log Box */}
      <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl min-h-[250px]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900/90">
          <span className="text-xs font-black text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            ⚡ Real-Time Control Audit & Tax Log Stream
          </span>
          <span className="text-[10px] text-cyan-400 font-mono font-bold">KRA iCMS GATEWAY ONLINE</span>
        </div>

        <div
          ref={logRef}
          className="flex-1 overflow-y-auto p-4 space-y-1.5 font-mono text-xs max-h-[260px] bg-slate-950/80"
        >
          {log.map((entry, i) => (
            <div key={i} className="flex gap-3 leading-relaxed">
              <span className="text-slate-600 shrink-0 select-none">{entry.ts}</span>
              <span className={LOG_COLORS[entry.type]}>{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Rich Inspector Modal Dialog */}
      {isInspectorOpen && selectedLane && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-xl bg-slate-900 border-2 border-slate-700 rounded-3xl p-6 sm:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.9)] text-slate-100 font-sans space-y-6">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-2xl font-black font-['Outfit',sans-serif] text-cyan-400 flex items-center gap-2">
                  <span>🏗️</span> {selectedLane.id} Inspector
                </h3>
                <p className="text-sm font-mono text-slate-300 mt-1">
                  Truck <strong className="text-amber-400">{selectedLane.truck_id}</strong> • OMC: <strong className="text-white">{selectedLane.omc}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsInspectorOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-black text-lg transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Metrics Breakdown Grid */}
            <div className="grid grid-cols-2 gap-4 text-xs font-mono bg-slate-950 p-5 rounded-2xl border border-slate-800">
              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider text-[10px] font-bold">Gate Clearance Status</span>
                <div>
                  <span className={`inline-block px-3 py-1 rounded-lg font-black text-xs uppercase ${
                    selectedLane.status === 'HOLD' ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.3)]' :
                    selectedLane.status === 'WARNING' ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50' :
                    'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                  }`}>
                    {selectedLane.status === 'HOLD' ? 'HOLD_TRIGGERED' : selectedLane.status}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider text-[10px] font-bold">Product Category</span>
                <p className="font-bold text-base text-cyan-300">{selectedLane.product}</p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-3">
                <span className="text-slate-400 uppercase tracking-wider text-[10px] font-bold">Physical Meter Reading</span>
                <p className="font-bold text-base text-slate-100">{selectedLane.metered_volume.toLocaleString()} Liters</p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-3">
                <span className="text-slate-400 uppercase tracking-wider text-[10px] font-bold">Billed Commercial Invoice</span>
                <p className="font-bold text-base text-slate-100">{selectedLane.invoiced_volume.toLocaleString()} Liters</p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-3">
                <span className="text-slate-400 uppercase tracking-wider text-[10px] font-bold">Volume Variance Delta</span>
                <p className={`font-black text-base ${selectedLane.variance_liters > 50 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {selectedLane.variance_liters > 0 ? `+${selectedLane.variance_liters.toLocaleString()}` : selectedLane.variance_liters} Liters
                </p>
              </div>

              <div className="space-y-1 border-t border-slate-800 pt-3">
                <span className="text-slate-400 uppercase tracking-wider text-[10px] font-bold">Gantry Dwell Duration</span>
                <p className={`font-bold text-sm ${selectedLane.dwell_time_minutes > selectedLane.free_dwell_limit_minutes ? 'text-amber-400' : 'text-slate-200'}`}>
                  {selectedLane.dwell_time_minutes} mins <span className="text-[10px] text-slate-500 font-normal">(Free: {selectedLane.free_dwell_limit_minutes}m)</span>
                </p>
              </div>
            </div>

            {/* Automated Hold / Clearance Preview Banner */}
            <div className={`p-4 rounded-2xl border text-xs font-mono leading-relaxed transition-all ${
              selectedLane.status === 'HOLD'
                ? 'bg-rose-950/40 border-rose-700/80 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                : 'bg-emerald-950/40 border-emerald-700/80 text-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.2)]'
            }`}>
              <div className="font-black uppercase tracking-wider text-[10px] mb-1.5 flex items-center justify-between">
                <span>Automated Hold Preview</span>
                <span className={`px-2.5 py-0.5 rounded-md font-black text-[10px] ${
                  selectedLane.status === 'HOLD' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}>
                  {selectedLane.status === 'HOLD' ? '🔒 EXIT BLOCKED' : '🟢 BARRIER CLEARED'}
                </span>
              </div>
              <p className="font-bold text-sm">
                {selectedLane.hold_reason}
              </p>
            </div>

            {/* Recommended Action Buttons */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Recommended Autonomous Actions</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {selectedLane.status === 'HOLD' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleTriggerIcms(selectedLane)}
                      className="p-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 font-bold transition-all text-left flex items-center gap-2 cursor-pointer shadow-md"
                    >
                      <span>⚡</span> Issue KRA iCMS Tax Note
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTriggerDemurrage(selectedLane)}
                      className="p-3 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/50 font-bold transition-all text-left flex items-center gap-2 cursor-pointer shadow-md"
                    >
                      <span>🧾</span> Auto-Bill Demurrage
                    </button>

                    <button
                      type="button"
                      onClick={() => handleManualOverride(selectedLane)}
                      className="col-span-1 sm:col-span-2 p-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 font-black transition-all text-center flex items-center justify-center gap-2 cursor-pointer shadow-md"
                    >
                      <span>🔑</span> Execute Manager Emergency Gate Override
                    </button>
                  </>
                )}

                {selectedLane.status === 'PASS' && (
                  <div className="col-span-2 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-center font-bold font-mono">
                    ✅ Gate Clear — All volumetric parameters matched. Barrier arm cleared for exit.
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsInspectorOpen(false)}
                className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold transition-colors cursor-pointer"
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
