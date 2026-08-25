import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Pressable } from "react-native";
import { anomalies, type Anomaly } from "@/api";
import { c } from "@/theme";

export default function AnomaliesScreen() {
  const [data, setData] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const result = await anomalies("all");
      setData(result);
    } catch (error) {
      console.error("Failed to load anomalies:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={c.cyan} size="large" />
      </View>
    );
  }

  return (
    <View style={s.page}>
      <Text style={s.title}>Anomalies</Text>
      <Text style={s.subtitle}>{data.length} anomalies detected</Text>

      <FlatList
        data={data}
        keyExtractor={(item) => item.dispatch_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.cyan} />}
        renderItem={({ item }) => (
          <Pressable style={s.card}>
            <View style={s.row}>
              <Text style={s.dispatchId}>{item.dispatch_id}</Text>
              <Text style={[s.status, { color: item.status === "critical" ? c.red : c.cyan }]}>
                {item.status || "Pending"}
              </Text>
            </View>
            <Text style={s.customer}>{item.customer}</Text>
            <Text style={s.leakage}>KES {item.leakage_kes.toLocaleString()}</Text>
            <View style={s.tags}>
              <Text style={s.tag}>{item.break_type}</Text>
              {item.fraud_score && (
                <Text style={[s.tag, s.fraudTag]}>Score: {item.fraud_score}</Text>
              )}
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListEmptyComponent={
          <Text style={s.empty}>No anomalies found. All clear! ✅</Text>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.bg },
  title: { color: c.text, fontSize: 28, fontWeight: "900", paddingHorizontal: 20, paddingTop: 20 },
  subtitle: { color: c.muted, fontSize: 14, paddingHorizontal: 20, paddingBottom: 8 },
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.line },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dispatchId: { color: c.text, fontWeight: "700", fontSize: 14 },
  status: { fontWeight: "700", fontSize: 12, textTransform: "capitalize" },
  customer: { color: c.text, fontSize: 16, fontWeight: "600", marginTop: 4 },
  leakage: { color: c.cyan, fontSize: 18, fontWeight: "900", marginTop: 4 },
  tags: { flexDirection: "row", gap: 8, marginTop: 8 },
  tag: { backgroundColor: c.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, fontSize: 11, color: c.muted },
  fraudTag: { borderColor: c.cyan, borderWidth: 1, color: c.cyan },
  empty: { textAlign: "center", color: c.muted, fontSize: 16, paddingTop: 40 },
});