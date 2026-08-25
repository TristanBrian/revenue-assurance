import { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Pressable } from "react-native";
import { alerts, readAlert, type Alert } from "@/api";
import { c } from "@/theme";

export default function AlertsScreen() {
  const [data, setData] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const result = await alerts();
      setData(result);
    } catch (error) {
      console.error("Failed to load alerts:", error);
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

  const markRead = async (id: string) => {
    try {
      await readAlert(id);
      setData((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    } catch (error) {
      console.error("Failed to mark alert as read:", error);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={c.cyan} size="large" />
      </View>
    );
  }

  const unreadCount = data.filter((a) => !a.is_read).length;

  return (
    <View style={s.page}>
      <View style={s.header}>
        <Text style={s.title}>Alerts</Text>
        {unreadCount > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{unreadCount}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.cyan} />}
        renderItem={({ item }) => (
          <Pressable
            style={[s.card, item.is_read && s.read]}
            onPress={() => !item.is_read && markRead(item.id)}
          >
            <View style={s.row}>
              <Text style={[s.severity, { color: item.severity === "critical" ? c.red : c.cyan }]}>
                {item.severity.toUpperCase()}
              </Text>
              {!item.is_read && <View style={s.dot} />}
            </View>
            <Text style={s.titleText}>{item.title}</Text>
            <Text style={s.message}>{item.message}</Text>
            <Text style={s.time}>{new Date(item.created_at).toLocaleString()}</Text>
          </Pressable>
        )}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListEmptyComponent={
          <Text style={s.empty}>No alerts. Stay vigilant! 🛡️</Text>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  title: { color: c.text, fontSize: 28, fontWeight: "900" },
  badge: { backgroundColor: c.red, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2 },
  badgeText: { color: c.bg, fontSize: 12, fontWeight: "700" },
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.line },
  read: { opacity: 0.6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  severity: { fontWeight: "700", fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.cyan },
  titleText: { color: c.text, fontSize: 16, fontWeight: "700", marginTop: 6 },
  message: { color: c.text, fontSize: 14, marginTop: 4 },
  time: { color: c.muted, fontSize: 11, marginTop: 8 },
  empty: { textAlign: "center", color: c.muted, fontSize: 16, paddingTop: 40 },
});