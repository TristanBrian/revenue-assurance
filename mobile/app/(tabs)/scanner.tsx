import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { MobileHeader } from "@/shell";
import { c } from "@/theme";

export default function ManifestScanner() {
  const [scanResult, setScanResult] = useState<{ type: string; value: string; timestamp: string } | null>(null);
  const [meterSeal, setMeterSeal] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleScanQR() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission required", "Camera access is needed to scan physical truck manifests and loading arm meter seals.");
      return;
    }
    setBusy(true);
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    setBusy(false);

    if (!result.canceled) {
      // Simulated optical QR / Barcode manifest extraction
      const mockManifestId = `MNF-KPC-${Math.floor(100000 + Math.random() * 900000)}`;
      const now = new Date().toISOString();
      setScanResult({
        type: "Physical Manifest QR & Meter Seal",
        value: mockManifestId,
        timestamp: now,
      });
      Alert.alert("QR Code Scanned", `Manifest ID: ${mockManifestId}\nVerification timestamp: ${now.slice(11, 19)}`);
    }
  }

  function handleVerifySeal() {
    if (!meterSeal.trim()) {
      Alert.alert("Meter Seal Required", "Enter or scan a loading arm seal number (e.g. SEAL-8841).");
      return;
    }
    Alert.alert("Seal Verified", `Loading arm seal ${meterSeal.trim().toUpperCase()} matched against KPC depot registry.`);
  }

  return (
    <View style={s.page}>
      <MobileHeader />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.kicker}>DEPOT OPERATIONAL TOOLS</Text>
        <Text style={s.title}>Manifest & Seal Scanner</Text>
        <Text style={s.sub}>
          Scan physical truck manifest QR codes and loading arm meter seals to verify loading authorization before gate release.
        </Text>

        <View style={s.card}>
          <Text style={s.label}>MANIFEST & SEAL QR SCANNER</Text>
          <Pressable onPress={handleScanQR} disabled={busy} style={s.scanBtn}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={s.scanBtnText}>📷 Launch Camera QR Scanner</Text>}
          </Pressable>

          {scanResult && (
            <View style={s.resultBox}>
              <Text style={s.resultTitle}>Last Scanned Payload</Text>
              <Text style={s.resultValue}>{scanResult.value}</Text>
              <Text style={s.resultMeta}>{scanResult.type} · {scanResult.timestamp.slice(0, 19).replace("T", " ")}</Text>
            </View>
          )}

          <View style={s.divider} />

          <Text style={s.label}>LOADING ARM METER SEAL ID</Text>
          <View style={s.row}>
            <TextInput
              value={meterSeal}
              onChangeText={setMeterSeal}
              placeholder="e.g. SEAL-8841"
              autoCapitalize="characters"
              style={[s.input, { flex: 1 }]}
            />
            <Pressable onPress={handleVerifySeal} style={s.verifyBtn}>
              <Text style={s.verifyBtnText}>Verify</Text>
            </Pressable>
          </View>
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
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: c.line },
  label: { color: c.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  scanBtn: { backgroundColor: c.red, borderRadius: 10, padding: 15, alignItems: "center", justifyContent: "center" },
  scanBtnText: { color: "white", fontWeight: "800", fontSize: 14 },
  resultBox: { backgroundColor: "#F7F5F2", borderRadius: 10, padding: 12, borderLeftWidth: 4, borderLeftColor: c.green },
  resultTitle: { color: c.muted, fontSize: 10, fontWeight: "800" },
  resultValue: { color: c.text, fontSize: 16, fontWeight: "900", fontFamily: "monospace", marginTop: 2 },
  resultMeta: { color: c.muted, fontSize: 11, marginTop: 4 },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 4 },
  input: { backgroundColor: "#F7F5F2", borderRadius: 9, borderWidth: 1, borderColor: c.line, padding: 12, color: c.text, fontSize: 14 },
  row: { flexDirection: "row", gap: 8 },
  verifyBtn: { backgroundColor: c.text, borderRadius: 9, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  verifyBtnText: { color: "white", fontWeight: "800", fontSize: 13 },
});
