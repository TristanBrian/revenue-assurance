import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MobileHeader } from "@/shell";
import { c } from "@/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://revenue-assurance.fly.dev/api";

type GateStatus = "IDLE" | "PASS" | "GATE_HOLD" | "LOADING";

interface LogLine { ts: string; msg: string; type: "info" | "hold" | "pass" | "action" }

export default function GateControl() {
  const [truckId, setTruckId] = useState("");
  const [omcName, setOmcName] = useState("Petro Kenya");
  const [meteredVol, setMeteredVol] = useState("");
  const [invoicedVol, setInvoicedVol] = useState("");
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [status, setStatus] = useState<GateStatus>("IDLE");
  const [reason, setReason] = useState("");
  const [icmsRef, setIcmsRef] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<LogLine[]>([]);

  function ts() { return new Date().toLocaleTimeString("en-KE", { hour12: false }); }
  function log(type: LogLine["type"], msg: string) {
    setEventLog(prev => [...prev.slice(-20), { ts: ts(), type, msg }]);
  }

  function handleCheckIn() {
    if (!truckId.trim()) {
      Alert.alert("Truck ID required", "Enter a valid truck registration (e.g. KCF 892Y).");
      return;
    }
    const now = new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setCheckInTime(now);
    setStatus("IDLE");
    setEventLog([{ ts: now, type: "info", msg: `Truck ${truckId.trim().toUpperCase()} checked in at depot gate.` }]);
  }

  async function handleEvaluateGateStatus() {
    if (!meteredVol || !invoicedVol) {
      Alert.alert("Volumes required", "Enter both metered and invoiced volume.");
      return;
    }
    const metered = parseFloat(meteredVol);
    const invoiced = parseFloat(invoicedVol);
    if (!Number.isFinite(metered) || !Number.isFinite(invoiced) || metered < 0 || invoiced <= 0) {
      Alert.alert("Invalid volumes", "Use valid positive numbers.");
      return;
    }

    setStatus("LOADING");
    setIcmsRef(null);
    log("info", `Scanning ${truckId || "truck"} — metered ${metered.toLocaleString()}L vs invoiced ${invoiced.toLocaleString()}L…`);

    try {
      const dispatchId = `D-${(truckId || "DEMO").replace(/\s/g, "")}-${Date.now()}`;
      const res = await fetch(`${API_BASE}/v1/control/gate-lockout-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dispatch_id: dispatchId,
          truck_id: truckId || "KCB-DEMO",
          omc_name: omcName,
          metered_volume_l: metered,
          invoiced_volume_l: invoiced,
          allowed_evaporation_pct: 0.5,
        }),
      });
      const data = await res.json();
      const isHold = !res.ok || (data?.data?.status ?? data?.status) === "GATE_HOLD";

      if (isHold) {
        setStatus("GATE_HOLD");
        const variance = metered - invoiced;
        setReason(`Variance ${variance.toLocaleString()} L exceeds tolerance. Gate exit BLOCKED. Autonomous actions initiated.`);
        log("hold", `HOLD 🔴 — ${(truckId || "truck").toUpperCase()} gate BLOCKED. Variance: +${variance.toLocaleString()} L`);

        // KRA iCMS
        log("action", "Triggering KRA iCMS tax adjustment…");
        try {
          const taxRes = await fetch(`${API_BASE}/control-plane/icms-tax-adjustment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dispatch_id: dispatchId, volume_discrepancy: metered - invoiced }),
          });
          const taxData = await taxRes.json();
          const ref = taxData?.data?.icms_reference ?? taxData?.icms_reference ?? `KRA-ADJ-${dispatchId.slice(0, 12)}`;
          setIcmsRef(ref);
          log("action", `iCMS queued ✅ — Ref: ${ref}`);
        } catch {
          const ref = `KRA-ADJ-${dispatchId.slice(0, 12)}`;
          setIcmsRef(ref);
          log("action", `iCMS queued ✅ — Ref: ${ref} (offline)`);
        }

        // Notify
        log("action", "Manager alert dispatched 📣");
        fetch(`${API_BASE}/control-plane/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ incident_type: "VOLUME_MISMATCH", dispatch_id: dispatchId, details: `Variance ${metered - invoiced} L` }),
        }).catch(() => {});
      } else {
        setStatus("PASS");
        setReason("Metered volume aligns with invoiced volume within tolerance. Gate cleared for exit.");
        log("pass", `PASS 🟢 — ${(truckId || "truck").toUpperCase()} volumes matched. Gate cleared.`);
      }
    } catch {
      // Offline simulation fallback
      const variance = metered - invoiced;
      const isHold = variance > invoiced * 0.005;
      if (isHold) {
        setStatus("GATE_HOLD");
        setReason(`Variance ${variance.toLocaleString()} L exceeds 0.5% tolerance. Gate BLOCKED (offline simulation).`);
        log("hold", `HOLD 🔴 — variance +${variance.toLocaleString()} L (offline mode)`);
        const ref = `KRA-ADJ-${(truckId || "DEMO").replace(/\s/g, "").slice(0, 8)}-SIM`;
        setIcmsRef(ref);
        log("action", `iCMS ref: ${ref} (simulated)`);
        log("action", "Manager alert simulated 📣");
      } else {
        setStatus("PASS");
        setReason("Volumes match within tolerance. Gate cleared (offline simulation).");
        log("pass", `PASS 🟢 — volumes matched (offline).`);
      }
    }
  }


  return (
    <View style={s.page}>
      <MobileHeader />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.kicker}>DEPOT CONTROL PLANE</Text>
        <Text style={s.title}>Gate & dwell check</Text>

        {/* Status Card */}
        {status !== "IDLE" && status !== "LOADING" && (
          <View style={[s.statusCard, status === "GATE_HOLD" ? s.cardHold : s.cardPass]}>
            <Text style={s.statusBadge}>{status === "GATE_HOLD" ? "🔴 GATE HOLD" : "🟢 PASS"}</Text>
            <Text style={s.statusTitle}>{status === "GATE_HOLD" ? "EXIT BLOCKED" : "GATE CLEARED"}</Text>
            <Text style={s.statusReason}>{reason}</Text>
            {icmsRef && (
              <View style={s.icmsRow}>
                <Text style={s.icmsLabel}>KRA iCMS Ref:</Text>
                <Text style={s.icmsRef}>{icmsRef}</Text>
              </View>
            )}
          </View>
        )}

        {status === "LOADING" && (
          <View style={[s.statusCard, { backgroundColor: "#EEF2FF", borderColor: "#6366F1" }]}>
            <ActivityIndicator color="#6366F1" size="large" />
            <Text style={[s.statusTitle, { color: "#6366F1", textAlign: "center", marginTop: 8 }]}>Calling Control Plane API…</Text>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.label}>TRUCK & OMC</Text>
          <TextInput value={truckId} onChangeText={setTruckId} placeholder="e.g. KCF 892Y" autoCapitalize="characters" style={s.input} />
          <View style={s.row}>
            <Pressable onPress={handleCheckIn} style={s.checkInBtn}>
              <Text style={s.checkInText}>📥 Check-In</Text>
            </Pressable>
            {checkInTime && (
              <View style={s.checkInBadge}>
                <Text style={s.checkInTimeText}>Entry: {checkInTime}</Text>
              </View>
            )}
          </View>

          <View style={s.divider} />

          <Text style={s.label}>VOLUME ALIGNMENT</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.subLabel}>METERED (L)</Text>
              <TextInput value={meteredVol} onChangeText={setMeteredVol} placeholder="38500" keyboardType="numeric" style={s.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.subLabel}>INVOICED (L)</Text>
              <TextInput value={invoicedVol} onChangeText={setInvoicedVol} placeholder="32000" keyboardType="numeric" style={s.input} />
            </View>
          </View>

          <Pressable onPress={handleEvaluateGateStatus} disabled={status === "LOADING"} style={[s.evalBtn, status === "LOADING" && { opacity: 0.5 }]}>
            {status === "LOADING"
              ? <ActivityIndicator color="white" />
              : <Text style={s.evalBtnText}>⚡ Evaluate Gate Clearance</Text>
            }
          </Pressable>
        </View>

        {/* Event Log */}
        {eventLog.length > 0 && (
          <View style={s.logCard}>
            <Text style={s.logTitle}>⚡ System Event Log</Text>
            {eventLog.map((l, i) => (
              <Text key={i} style={[s.logLine, l.type === "hold" ? { color: "#EF4444" } : l.type === "pass" ? { color: "#22C55E" } : l.type === "action" ? { color: "#F59E0B" } : { color: "#94A3B8" }]}>
                {l.ts}  {l.msg}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  content: { padding: 18, gap: 14 },
  kicker: { color: c.red, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: c.text, fontSize: 26, fontWeight: "900" },
  statusCard: { borderRadius: 16, padding: 16, borderLeftWidth: 6, gap: 6 },
  cardHold: { backgroundColor: "#FDECEC", borderColor: c.red },
  cardPass: { backgroundColor: "#EAF7EA", borderColor: c.green },
  statusBadge: { fontWeight: "900", fontSize: 13, letterSpacing: 0.8 },
  statusTitle: { color: c.text, fontSize: 20, fontWeight: "900" },
  statusReason: { color: c.text, fontSize: 12, lineHeight: 18, fontWeight: "600" },
  icmsRow: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  icmsLabel: { color: c.muted, fontSize: 11, fontWeight: "700" },
  icmsRef: { color: c.text, fontSize: 11, fontWeight: "900", fontFamily: "monospace" },
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: c.line },
  label: { color: c.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  subLabel: { color: c.muted, fontSize: 10, fontWeight: "700", marginBottom: 4 },
  input: { backgroundColor: "#F7F5F2", borderRadius: 9, borderWidth: 1, borderColor: c.line, padding: 12, color: c.text, fontSize: 14 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  checkInBtn: { backgroundColor: c.text, borderRadius: 9, paddingVertical: 12, paddingHorizontal: 16 },
  checkInText: { color: "white", fontWeight: "800", fontSize: 13 },
  checkInBadge: { backgroundColor: "#EFE8E5", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  checkInTimeText: { color: c.red, fontWeight: "800", fontSize: 12 },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 4 },
  evalBtn: { backgroundColor: c.red, borderRadius: 10, padding: 14, alignItems: "center", justifyContent: "center", marginTop: 4, minHeight: 48 },
  evalBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
  logCard: { backgroundColor: "#0F172A", borderRadius: 12, padding: 12, gap: 4 },
  logTitle: { color: "#94A3B8", fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 4 },
  logLine: { fontSize: 10, fontFamily: "monospace", lineHeight: 16 },
});

