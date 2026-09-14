import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const base = String(
  process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:8000"
).replace(/\/$/, "");

const key = "reconova_access_token";
const legacyKey = "flowguard_access_token";
const memoryStore: Record<string, string> = {};

async function getItem(k: string): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined" ? localStorage.getItem(k) : memoryStore[k] ?? null;
    }
    const isAvail = await SecureStore.isAvailableAsync().catch(() => false);
    if (isAvail && typeof SecureStore.getItemAsync === "function") {
      return await SecureStore.getItemAsync(k);
    }
    return memoryStore[k] ?? null;
  } catch {
    return memoryStore[k] ?? null;
  }
}

async function setItem(k: string, v: string): Promise<void> {
  try {
    memoryStore[k] = v;
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(k, v);
      }
      return;
    }
    const isAvail = await SecureStore.isAvailableAsync().catch(() => false);
    if (isAvail && typeof SecureStore.setItemAsync === "function") {
      await SecureStore.setItemAsync(k, v);
    }
  } catch {
    // fallback to memoryStore
  }
}

async function deleteItem(k: string): Promise<void> {
  try {
    delete memoryStore[k];
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(k);
      }
      return;
    }
    const isAvail = await SecureStore.isAvailableAsync().catch(() => false);
    if (isAvail && typeof SecureStore.deleteItemAsync === "function") {
      await SecureStore.deleteItemAsync(k).catch(() => {});
    }
  } catch {
    // fallback clean
  }
}

export type Direction = "inbound" | "outbound" | "all";
export type User = { id: string; email: string; full_name: string | null; roles: string[]; permissions: string[] };
export type Metrics = {
  total_paid_kes: number;
  total_leakage_kes: number;
  reconciliation_rate: number;
  anomaly_count: number;
  critical_count: number;
  pending_count: number;
  review_count: number;
};
export type Anomaly = {
  dispatch_id: string;
  customer: string;
  product: string;
  depot: string | null;
  leakage_kes: number;
  break_type: string;
  status: string;
  age_days: number;
  fraud_score?: number | null;
};
export type Alert = { id: string; title: string; message: string; severity: string; created_at: string; is_read: boolean };
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type GraphNode = { id: string; label: string; type: "omc" | "depot" | "officer" | "beneficiary"; leakage_kes: number; risk_level: RiskLevel; community_id?: number | null };
export type GraphEdge = { source: string; target: string; weight: number; anomaly_count: number; shared_account?: boolean };
export type FraudGraph = { nodes: GraphNode[]; edges: GraphEdge[]; communities: { id: number; node_ids: string[]; member_count: number; total_leakage_kes: number; risk_level: RiskLevel }[]; summary: { node_count: number; edge_count: number; community_count: number; top_risk_entities: GraphNode[] } };
export type FieldVerificationPayload = { verification_id: string; beneficiary_id: string; pillar: "Scholarship" | "Plus" | "Vocational" | "Tech"; participation_status: "verified" | "not_verified" | "needs_review"; notes: string; latitude: number | null; longitude: number | null; captured_at: string; photo_uri: string | null; updated_at: string };

async function req<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const h = new Headers(init.headers);
  h.set("Accept", "application/json");
  if (init.body) h.set("Content-Type", "application/json");
  if (auth) {
    const t = (await getItem(key)) ?? (await getItem(legacyKey));
    if (t) h.set("Authorization", "Bearer " + t);
  }
  let r: Response;
  try {
    r = await fetch(base + path, { ...init, headers: h });
  } catch {
    throw new Error("Cannot reach Reconova at " + base + ". Check the API URL and network.");
  }
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(b?.Message ?? "Request failed (" + r.status + ")");
  return b?.Data as T;
}

export async function login(email: string, password: string) {
  const x = await req<{ access_token: string | null; reset_required: boolean; terms_required: boolean }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, false);
  if (!x.access_token) {
    throw new Error(x.reset_required ? "Complete your password reset in the web portal." : "Accept the latest terms in the web portal.");
  }
  await setItem(key, x.access_token);
  return me();
}

export const me = () => req<User>("/api/auth/me");
export const session = async () => !!((await getItem(key)) ?? (await getItem(legacyKey)));
export const logout = async () => {
  await deleteItem(key);
  await deleteItem(legacyKey);
};

export async function metrics(d: Direction) {
  if (process.env.EXPO_PUBLIC_PREVIEW_MODE === "true") return { total_paid_kes: 1_204_780_000, total_leakage_kes: 218_030_000, reconciliation_rate: 82.1, anomaly_count: 726, critical_count: 726, pending_count: 41, review_count: 20 };
  return (await req<{ metrics: Metrics }>("/api/reconcile/metrics?materiality=100000&direction=" + d, { method: "POST" })).metrics;
}

export async function anomalies(d: Direction) {
  return (await req<{ anomalies: Anomaly[] }>("/api/reconcile/anomalies?materiality=100000&page=1&page_size=30&direction=" + d)).anomalies;
}

export async function alerts() {
  const x = await req<{ alerts?: Alert[]; items?: Alert[] }>("/api/alerts?page=1&page_size=30");
  return x.alerts ?? x.items ?? [];
}

export async function fraudGraph(direction: "inbound" | "outbound") {
  if (process.env.EXPO_PUBLIC_PREVIEW_MODE === "true") {
    const inbound: GraphNode[] = [{id:"OMC-17",label:"Petro Kenya",type:"omc",leakage_kes:42_800_000,risk_level:"Critical",community_id:1},{id:"DEP-NBI",label:"Nairobi Depot",type:"depot",leakage_kes:38_200_000,risk_level:"High",community_id:1},{id:"OMC-04",label:"Lake Oil",type:"omc",leakage_kes:27_400_000,risk_level:"High",community_id:1},{id:"DEP-ELD",label:"Eldoret Depot",type:"depot",leakage_kes:19_700_000,risk_level:"Medium",community_id:2},{id:"OMC-11",label:"Rift Energy",type:"omc",leakage_kes:16_900_000,risk_level:"High",community_id:2}];
    const outbound: GraphNode[] = [{id:"OFF-09",label:"A. Mwangi",type:"officer",leakage_kes:12_600_000,risk_level:"Critical",community_id:1},{id:"BEN-221",label:"Beneficiary 221",type:"beneficiary",leakage_kes:8_900_000,risk_level:"High",community_id:1},{id:"BEN-145",label:"Beneficiary 145",type:"beneficiary",leakage_kes:7_400_000,risk_level:"High",community_id:1},{id:"OFF-14",label:"J. Otieno",type:"officer",leakage_kes:5_800_000,risk_level:"Medium",community_id:2},{id:"BEN-307",label:"Beneficiary 307",type:"beneficiary",leakage_kes:4_300_000,risk_level:"High",community_id:2}];
    const nodes=direction==="inbound"?inbound:outbound;const edges=nodes.slice(1).map((n,i)=>({source:i<2?nodes[0].id:nodes[3].id,target:n.id,weight:n.leakage_kes,anomaly_count:9-i,shared_account:direction==="outbound"&&i===1}));
    return {nodes,edges,communities:[{id:1,node_ids:nodes.slice(0,3).map(n=>n.id),member_count:3,total_leakage_kes:nodes.slice(0,3).reduce((a,n)=>a+n.leakage_kes,0),risk_level:"Critical" as RiskLevel},{id:2,node_ids:nodes.slice(3).map(n=>n.id),member_count:2,total_leakage_kes:nodes.slice(3).reduce((a,n)=>a+n.leakage_kes,0),risk_level:"High" as RiskLevel}],summary:{node_count:nodes.length,edge_count:edges.length,community_count:2,top_risk_entities:nodes.slice(0,3)}};
  }
  return req<{status:string;data:FraudGraph}>(`/api/graph?materiality=100000&direction=${direction}`).then(x=>x.data);
}

export const readAlert = (id: string) => req("/api/alerts/" + encodeURIComponent(id) + "/read", { method: "POST" });

export async function submitFieldVerification(payload: FieldVerificationPayload): Promise<void> {
  await req("/api/inuka/stream/events", { method: "POST", body: JSON.stringify({ event_type: "verification.captured", pillar: payload.pillar, beneficiary_id: payload.beneficiary_id, source_system: "reconova-mobile-field-app", occurred_at: payload.captured_at, payload }) });
}

export async function ask(message: string, direction: "inbound" | "outbound" = "inbound") {
  return (await req<{ reply: string }>(`/api/fraud/chat?direction=${direction}`, { method: "POST", body: JSON.stringify({ message, anomaly_id: null }) })).reply;
}
