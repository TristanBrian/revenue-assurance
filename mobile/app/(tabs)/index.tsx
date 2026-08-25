import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { metrics, type Metrics } from "@/api";
import { useAuth } from "@/auth";
import { c } from "@/theme";

function formatKes(value: number): string {
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return `KES ${value.toLocaleString()}`;
}

export default function Overview() {
  const { user } = useAuth();
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const result = await metrics("all");
      setData(result);
    } catch (error) {
      console.error("Failed to load metrics:", error);
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

  const cards = [
    { label: "Total Paid", value: data?.total_paid_kes ?? 0, format: "KES" },
    { label: "Total Leakage", value: data?.total_leakage_kes ?? 0, format: "KES" },
    { label: "Anomalies", value: data?.anomaly_count ?? 0 },
    { label: "Critical", value: data?.critical_count ?? 0, tone: "critical" },
    { label: "Pending", value: data?.pending_count ?? 0 },
    { label: "Reconciliation Rate", value: data?.reconciliation_rate ?? 0, format: "percent" },
  ];

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={{ padding: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.cyan} />}
    >
      <Text style={s.greeting}>Welcome back,</Text>
      <Text style={s.name}>{user?.full_name || user?.email?.split("@")[0] || "User"}</Text>

      <View style={s.grid}>
        {cards.map((card, i) => {
          let displayValue: string;
          if (card.format === "KES") {
            displayValue = formatKes(card.value as number);
          } else if (card.format === "percent") {
            displayValue = `${(card.value as number).toFixed(1)}%`;
          } else {
            displayValue = (card.value as number).toLocaleString();
          }

          const isCritical = card.tone === "critical" && (card.value as number) > 0;

          return (
            <View key={i} style={[s.card, isCritical && s.cardCritical]}>
              <Text style={s.cardLabel}>{card.label}</Text>
              <Text style={[s.cardValue, isCritical && s.cardValueCritical]}>{displayValue}</Text>
            </View>
          );
        })}
      </View>

      {/* Quick actions */}
      <View style={s.quickActions}>
        <Text style={s.sectionTitle}>Quick Actions</Text>
        <View style={s.actionRow}>
          <View style={s.actionButton}>
            <Text style={s.actionIcon}>📊</Text>
            <Text style={s.actionLabel}>Anomalies</Text>
          </View>
          <View style={s.actionButton}>
            <Text style={s.actionIcon}>🤖</Text>
            <Text style={s.actionLabel}>AI Analyst</Text>
          </View>
          <View style={s.actionButton}>
            <Text style={s.actionIcon}>🔔</Text>
            <Text style={s.actionLabel}>Alerts</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.bg },
  greeting: { color: c.muted, fontSize: 14 },
  name: { color: c.text, fontSize: 28, fontWeight: "900", marginBottom: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 16,
    width: "47%",
    borderWidth: 1,
    borderColor: c.line,
  },
  cardCritical: {
    borderColor: c.red,
    backgroundColor: c.card + "15",
  },
  cardLabel: { color: c.muted, fontSize: 12, fontWeight: "600" },
  cardValue: { color: c.text, fontSize: 20, fontWeight: "900", marginTop: 6 },
  cardValueCritical: { color: c.red },
  quickActions: { marginTop: 24 },
  sectionTitle: { color: c.text, fontSize: 16, fontWeight: "700", marginBottom: 12 },
  actionRow: { flexDirection: "row", gap: 12 },
  actionButton: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 14,
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.line,
  },
  actionIcon: { fontSize: 24, marginBottom: 4 },
  actionLabel: { color: c.muted, fontSize: 11, fontWeight: "600" },
});