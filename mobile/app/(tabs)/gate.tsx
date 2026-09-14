import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MobileHeader } from "@/shell";
import { c } from "@/theme";

type GateStatus = "IDLE" | "PASS" | "GATE_HOLD";

export default function GateControl() {
  const [truckId, setTruckId] = useState("");
  const [omcName, setOmcName] = useState("Petro Kenya");
  const [meteredVol, setMeteredVol] = useState("");
  const [invoicedVol, setInvoicedVol] = useState("");
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [status, setStatus] = useState<GateStatus>("IDLE");
  const [reason, setReason] = useState("");

  function handleCheckIn() {
    if (!truckId.trim()) {
      Alert.alert("Truck ID required", "Enter a valid truck registration (e.g. KCF 892Y).");
      return;
    }
    const now = new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setCheckInTime(now);
    setStatus("IDLE");
    Alert.alert("Preview check-in", `Truck ${truckId.trim().toUpperCase()} recorded in this preview only. Entry time: ${now}`);
  }

  function handleEvaluateGateStatus() {
    if (!meteredVol || !invoicedVol) {
      Alert.alert("Volumes required", "Enter both metered volume and invoiced volume to evaluate gate clearance.");
      return;
    }
    const metered = parseFloat(meteredVol);
    const invoiced = parseFloat(invoicedVol);
    if (!Number.isFinite(metered) || !Number.isFinite(invoiced) || metered < 0 || invoiced <= 0) { Alert.alert("Invalid volumes", "Use a non-negative metered quantity and a positive invoiced quantity."); return; }
    const evapTolerance = invoiced * 0.0015; // 0.15%

    if (metered > invoiced + evapTolerance) {
      const excess = metered - invoiced;
      setStatus("GATE_HOLD");
      setReason(`METER VOLUME EXCEEDS INVOICE VOLUME BY +${excess.toLocaleString()} L. Preview recommends a hold. No gate command has been sent.`);
    } else {
      setStatus("PASS");
      setReason("Metered volume aligns with invoiced volume within 0.15% tolerance. Preview only; no exit authorization has been issued.");
    }
  }

  return (
    <View style={s.page}>
      <MobileHeader />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.kicker}>DEPOT CONTROL PLANE</Text>
        <Text style={s.title}>Gate & dwell preview</Text>
        <Text style={s.sub}>
          Demonstration only. Entries are stored in screen memory; 0.15% is an illustrative tolerance. Use the approved depot process for gate clearance.
        </Text>

        {/* Instant Gate-Hold / Release Screen Indicator */}
        {status !== "IDLE" && (
          <View style={[s.statusCard, status === "GATE_HOLD" ? s.cardHold : s.cardPass]}>
            <Text style={s.statusBadge}>{status === "GATE_HOLD" ? "🔴 GATE HOLD" : "🟢 PASS"}</Text>
            <Text style={s.statusTitle}>{status === "GATE_HOLD" ? "PREVIEW: HOLD RECOMMENDED" : "PREVIEW: WITHIN TOLERANCE"}</Text>
            <Text style={s.statusReason}>{reason}</Text>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.label}>TRUCK REGISTRATION & OMC</Text>
          <TextInput
            value={truckId}
            onChangeText={setTruckId}
            placeholder="e.g. KCF 892Y"
            autoCapitalize="characters"
            style={s.input}
          />

          <View style={s.row}>
            <Pressable onPress={handleCheckIn} style={s.checkInBtn}>
              <Text style={s.checkInText}>📥 Check-In Truck</Text>
            </Pressable>
            {checkInTime && (
              <View style={s.checkInBadge}>
                <Text style={s.checkInTimeText}>Entry: {checkInTime}</Text>
              </View>
            )}
          </View>

          <View style={s.divider} />

          <Text style={s.label}>VOLUME ALIGNMENT EVALUATION</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.subLabel}>METERED VOL (L)</Text>
              <TextInput
                value={meteredVol}
                onChangeText={setMeteredVol}
                placeholder="38500"
                keyboardType="numeric"
                style={s.input}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={s.subLabel}>INVOICED VOL (L)</Text>
              <TextInput
                value={invoicedVol}
                onChangeText={setInvoicedVol}
                placeholder="32000"
                keyboardType="numeric"
                style={s.input}
              />
            </View>
          </View>

          <Pressable onPress={handleEvaluateGateStatus} style={s.evalBtn}>
            <Text style={s.evalBtnText}>⚡ Evaluate Gate Clearance</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  content: { padding: 18, gap: 14 },
  kicker: { color: c.red, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: c.text, fontSize: 26, fontWeight: "900" },
  sub: { color: c.muted, fontSize: 13, lineHeight: 20 },
  statusCard: { borderRadius: 16, padding: 16, borderLeftWidth: 6, gap: 4 },
  cardHold: { backgroundColor: "#FDECEC", borderColor: c.red },
  cardPass: { backgroundColor: "#EAF7EA", borderColor: c.green },
  statusBadge: { fontWeight: "900", fontSize: 13, letterSpacing: 0.8 },
  statusTitle: { color: c.text, fontSize: 18, fontWeight: "900" },
  statusReason: { color: c.text, fontSize: 12, lineHeight: 18, fontWeight: "600", marginTop: 2 },
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
  evalBtn: { backgroundColor: c.red, borderRadius: 10, padding: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  evalBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
});
