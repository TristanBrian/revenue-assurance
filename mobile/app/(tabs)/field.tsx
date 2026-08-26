import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { MobileHeader } from "@/shell";
import { submitFieldVerification } from "@/api";
import { queueVerification, queuedVerifications, registerVerificationSync, syncVerifications, type VerificationDraft } from "@/field-sync";
import { c } from "@/theme";

const pillars = ["Scholarship", "Plus", "Vocational", "Tech"] as const;
const states = ["verified", "not_verified", "needs_review"] as const;

export default function FieldVerification() {
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [pillar, setPillar] = useState<(typeof pillars)[number]>("Scholarship");
  const [status, setStatus] = useState<(typeof states)[number]>("verified");
  const [notes, setNotes] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [queue, setQueue] = useState<VerificationDraft[]>([]);
  const [busy, setBusy] = useState(false);

  async function refreshQueue() { setQueue(await queuedVerifications()); }
  useEffect(() => { refreshQueue(); registerVerificationSync().catch(() => undefined); }, []);

  async function capturePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { Alert.alert("Camera permission", "Allow camera access to attach timestamped evidence."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!result.canceled) setPhotoUri(result.assets[0]?.uri ?? null);
  }

  async function save() {
    if (!/^BEN-\d{4,}$/i.test(beneficiaryId.trim())) { Alert.alert("Beneficiary ID required", "Use an ID such as BEN-0158."); return; }
    setBusy(true);
    let location: Location.LocationObject | null = null;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.granted) location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch { /* GPS is optional when offline or unavailable. */ }
    const now = new Date().toISOString();
    const item: VerificationDraft = { verification_id: `VER-${Date.now()}`, beneficiary_id: beneficiaryId.trim().toUpperCase(), pillar, participation_status: status, notes, latitude: location?.coords.latitude ?? null, longitude: location?.coords.longitude ?? null, captured_at: now, photo_uri: photoUri, updated_at: now };
    await queueVerification(item);
    try { await syncVerifications(submitFieldVerification); Alert.alert("Saved", "Verification captured. It will remain queued if the API is unavailable."); } catch { Alert.alert("Saved offline", "The verification is queued on this device."); }
    setBeneficiaryId(""); setNotes(""); setPhotoUri(null); await refreshQueue(); setBusy(false);
  }

  async function sync() { setBusy(true); const result = await syncVerifications(submitFieldVerification); await refreshQueue(); setBusy(false); Alert.alert("Sync complete", `${result.sent} sent, ${result.remaining} remaining.`); }

  return <View style={s.page}><MobileHeader /><ScrollView contentContainerStyle={s.content}><Text style={s.kicker}>INUKA FIELD OPERATIONS</Text><Text style={s.title}>Beneficiary verification</Text><Text style={s.sub}>Capture participation evidence offline. GPS and photo timestamps travel with the signed event when connectivity returns.</Text><View style={s.card}><Text style={s.label}>BENEFICIARY ID</Text><TextInput value={beneficiaryId} onChangeText={setBeneficiaryId} placeholder="BEN-0158" autoCapitalize="characters" style={s.input} /><Text style={s.label}>PROGRAM PILLAR</Text><View style={s.row}>{pillars.map((item) => <Pressable key={item} onPress={() => setPillar(item)} style={[s.chip, pillar === item && s.chipOn]}><Text style={[s.chipText, pillar === item && s.chipTextOn]}>{item}</Text></Pressable>)}</View><Text style={s.label}>PARTICIPATION RESULT</Text><View style={s.row}>{states.map((item) => <Pressable key={item} onPress={() => setStatus(item)} style={[s.chip, status === item && s.chipOn]}><Text style={[s.chipText, status === item && s.chipTextOn]}>{item.replace("_", " ")}</Text></Pressable>)}</View><Text style={s.label}>FIELD NOTES</Text><TextInput value={notes} onChangeText={setNotes} placeholder="Describe the verification evidence" multiline style={[s.input, s.notes]} /><View style={s.row}><Pressable onPress={capturePhoto} style={s.secondary}><Text style={s.secondaryText}>{photoUri ? "Photo attached" : "Take timestamped photo"}</Text></Pressable><Pressable onPress={save} disabled={busy} style={s.primary}>{busy ? <ActivityIndicator color="white" /> : <Text style={s.primaryText}>Save verification</Text>}</Pressable></View></View><View style={s.queue}><View style={s.queueHead}><View><Text style={s.queueTitle}>Offline queue</Text><Text style={s.sub}>{queue.length} verification{queue.length === 1 ? "" : "s"} waiting</Text></View><Pressable onPress={sync} disabled={busy} style={s.sync}><Text style={s.syncText}>Sync now</Text></Pressable></View>{queue.map((item) => <View key={item.verification_id} style={s.queueItem}><Text style={s.queueId}>{item.beneficiary_id}</Text><Text style={s.queueMeta}>{item.pillar} · {item.participation_status} · {item.latitude == null ? "GPS pending" : "GPS captured"}</Text></View>)}</View></ScrollView></View>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: c.bg }, content: { padding: 18, gap: 14 }, kicker: { color: c.red, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, title: { color: c.text, fontSize: 26, fontWeight: "900" }, sub: { color: c.muted, fontSize: 13, lineHeight: 20 }, card: { backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: c.line }, label: { color: c.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 }, input: { backgroundColor: "#F7F5F2", borderRadius: 9, borderWidth: 1, borderColor: c.line, padding: 12, color: c.text, fontSize: 14 }, notes: { minHeight: 76, textAlignVertical: "top" }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { borderWidth: 1, borderColor: c.line, borderRadius: 20, paddingVertical: 9, paddingHorizontal: 12 }, chipOn: { backgroundColor: c.red, borderColor: c.red }, chipText: { color: c.muted, fontSize: 12, fontWeight: "700" }, chipTextOn: { color: "white" }, primary: { flex: 1, minWidth: 140, backgroundColor: c.red, borderRadius: 9, alignItems: "center", justifyContent: "center", padding: 13 }, primaryText: { color: "white", fontWeight: "800" }, secondary: { flex: 1, minWidth: 140, borderRadius: 9, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center", padding: 13 }, secondaryText: { color: c.text, fontWeight: "700", fontSize: 12, textAlign: "center" }, queue: { backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: c.line }, queueHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, queueTitle: { color: c.text, fontSize: 16, fontWeight: "800" }, sync: { borderRadius: 8, backgroundColor: "#EFE8E5", paddingVertical: 9, paddingHorizontal: 12 }, syncText: { color: c.red, fontWeight: "800", fontSize: 12 }, queueItem: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 9 }, queueId: { color: c.text, fontWeight: "800", fontFamily: "monospace" }, queueMeta: { color: c.muted, fontSize: 12, marginTop: 3 } });
