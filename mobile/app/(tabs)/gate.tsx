import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

export default function GateScreen() {
  const [truckId, setTruckId] = useState<string | null>(null);
  const [status, setStatus] = useState<'IDLE' | 'SCANNED' | 'CHECKED_IN' | 'LOADING' | 'GATE_HOLD' | 'PASS' | 'OFFLINE_SYNC'>('IDLE');
  const [discrepancy, setDiscrepancy] = useState<string | null>(null);

  useEffect(() => {
    // Mock offline sync queue processor
    if (status === 'OFFLINE_SYNC') {
      setTimeout(() => {
        setStatus('PASS');
      }, 2000);
    }
  }, [status]);

  const handleScanManifest = () => {
    // Mocking a QR scan
    setTruckId("KCD 789M");
    setStatus("SCANNED");
  };

  const handleCheckIn = () => {
    setStatus("CHECKED_IN");
  };

  const handleCheckOut = () => {
    // Simulate Gate Check API with Volume Discrepancy
    const mockDiscrepancy = Math.random() > 0.5; // 50% chance of hold
    
    if (mockDiscrepancy) {
      setDiscrepancy("Volume Mismatch: Meter (5000L) > Invoice (4950L) + Tolerance");
      setStatus("GATE_HOLD");
    } else {
      setStatus("PASS");
    }
  };

  const handleOfflineSync = () => {
    setStatus("OFFLINE_SYNC");
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Gate & Dwell Tracker</Text>

      {status === 'IDLE' && (
        <TouchableOpacity style={styles.button} onPress={handleScanManifest}>
          <Text style={styles.buttonText}>📷 Scan Manifest QR</Text>
        </TouchableOpacity>
      )}

      {status === 'SCANNED' && (
        <View style={styles.card}>
          <Text style={styles.label}>Truck Scanned: {truckId}</Text>
          <TouchableOpacity style={styles.button} onPress={handleCheckIn}>
            <Text style={styles.buttonText}>📍 Check-In (Start Dwell Time)</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'CHECKED_IN' && (
        <View style={styles.card}>
          <Text style={styles.label}>Truck: {truckId}</Text>
          <Text style={styles.subtext}>Dwell Time Active...</Text>
          <TouchableOpacity style={styles.button} onPress={handleCheckOut}>
            <Text style={styles.buttonText}>🏁 Check-Out & Verify</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'GATE_HOLD' && (
        <View style={[styles.card, styles.holdCard]}>
          <Text style={styles.holdText}>🛑 GATE HOLD</Text>
          <Text style={styles.errorText}>{discrepancy}</Text>
          <TouchableOpacity style={[styles.button, { marginTop: 20 }]} onPress={() => setStatus('IDLE')}>
            <Text style={styles.buttonText}>Reset</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'PASS' && (
        <View style={[styles.card, styles.passCard]}>
          <Text style={styles.passText}>✅ CLEARED</Text>
          <Text style={{ color: 'white', marginTop: 10 }}>Automated Demurrage (if any) Invoiced.</Text>
          <TouchableOpacity style={[styles.button, { marginTop: 20 }]} onPress={() => setStatus('IDLE')}>
            <Text style={styles.buttonText}>Next Truck</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'OFFLINE_SYNC' && (
        <View style={styles.card}>
          <Text style={styles.label}>🔄 Syncing offline records...</Text>
        </View>
      )}

      <TouchableOpacity style={styles.offlineButton} onPress={handleOfflineSync}>
        <Text style={styles.offlineText}>Force Offline Sync (3 pending)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, flex: 1, backgroundColor: '#0A192F', justifyContent: 'center' },
  header: { fontSize: 24, fontWeight: 'bold', color: 'white', marginBottom: 30, textAlign: 'center' },
  button: { backgroundColor: '#3B82F6', padding: 15, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  card: { backgroundColor: '#1E293B', padding: 20, borderRadius: 10, alignItems: 'center' },
  label: { color: 'white', fontSize: 18, marginBottom: 15 },
  subtext: { color: '#94A3B8', marginBottom: 15 },
  holdCard: { backgroundColor: '#7F1D1D', borderColor: '#EF4444', borderWidth: 2 },
  holdText: { color: 'white', fontSize: 28, fontWeight: 'bold' },
  errorText: { color: '#FECACA', marginTop: 10, textAlign: 'center' },
  passCard: { backgroundColor: '#064E3B', borderColor: '#10B981', borderWidth: 2 },
  passText: { color: 'white', fontSize: 28, fontWeight: 'bold' },
  offlineButton: { marginTop: 40, alignItems: 'center' },
  offlineText: { color: '#94A3B8', textDecorationLine: 'underline' }
});
