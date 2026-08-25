import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useAuth } from "@/auth";
import { c } from "@/theme";
import { logout } from "@/api";

export default function Profile() {
  const { user } = useAuth();

  const handleLogout = async () => {
    await logout();
    // Auth context will handle redirect
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={{ padding: 20 }}>
      <Text style={s.title}>Profile</Text>

      <View style={s.avatar}>
        <Text style={s.avatarText}>
          {user?.full_name?.[0] || user?.email?.[0] || "U"}
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.label}>Full Name</Text>
        <Text style={s.value}>{user?.full_name || "Not set"}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.label}>Email</Text>
        <Text style={s.value}>{user?.email}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.label}>Roles</Text>
        <Text style={s.value}>{user?.roles?.join(", ") || "None"}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.label}>Permissions</Text>
        <Text style={s.value}>{user?.permissions?.join(", ") || "None"}</Text>
      </View>

      <Pressable style={s.button} onPress={handleLogout}>
        <Text style={s.buttonText}>Sign Out</Text>
      </Pressable>

      <Text style={s.version}>FlowGuard Mobile v1.0.0</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  title: { color: c.text, fontSize: 28, fontWeight: "900", marginBottom: 20 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.cyan,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 20,
  },
  avatarText: { color: c.bg, fontSize: 32, fontWeight: "900" },
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.line, marginBottom: 12 },
  label: { color: c.muted, fontSize: 12, fontWeight: "600" },
  value: { color: c.text, fontSize: 16, fontWeight: "600", marginTop: 4 },
  button: { backgroundColor: c.red, padding: 16, borderRadius: 14, alignItems: "center", marginTop: 20 },
  buttonText: { color: c.bg, fontWeight: "900" },
  version: { color: c.muted, fontSize: 12, textAlign: "center", marginTop: 20 },
});