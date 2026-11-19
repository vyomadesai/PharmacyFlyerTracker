import { useState } from 'react';
import { Alert, Button, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import KeyboardAwareScreen from '../../src/components/KeyboardAwareScreen';
import { api } from '../../src/services/api';
import { Doctor } from '../../src/types/types';

export default function DoctorSearchScreen() {
  const [q, setQ] = useState('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);

  async function search() {
    if (!q.trim()) return;
    try {
      const res = await api.get('/doctors/search', { params: { q } });
      setDoctors(res.data);
    } catch (e: any) {
      const message = e?.response?.data?.message;
      Alert.alert('Search failed', message || 'Could not search Master_Doctor. Check backend connection and login.');
    }
  }

  async function selectDoctor(doctor: Doctor) {
    await AsyncStorage.setItem('selectedDoctor', JSON.stringify(doctor));
    router.push('/delivery/form');
  }

  async function manualEntry() {
    await AsyncStorage.removeItem('selectedDoctor');
    router.push('/delivery/form');
  }

  return (
    <KeyboardAwareScreen style={styles.container}>
      <Text style={styles.title}>Search Doctor</Text>
      <TextInput style={styles.input} placeholder="Name, location, ZIP, phone, NPI" value={q} onChangeText={setQ} />
      <Button title="Search" onPress={search} />
      <View style={{ height: 12 }} />
      <Button title="Manual Doctor Entry" onPress={manualEntry} />
      <FlatList
        data={doctors}
        keyExtractor={(item) => String(item.ID)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => selectDoctor(item)}>
            <Text style={styles.cardTitle}>Dr. {item.Doctor_FirstName} {item.Doctor_LastName}</Text>
            {item.Practice_Name ? <Text>{item.Practice_Name}</Text> : null}
            <Text>{item.Doctor_AddressStreet}</Text>
            <Text>{item.Doctor_AddressCity}, {item.Doctor_AddressState} {item.Doctor_AddressZip}</Text>
            <Text>{item.Doctor_Phone || item.Doctor_MobileNo}</Text>
          </Pressable>
        )}
      />
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 12, borderRadius: 8, marginBottom: 12 },
  card: { padding: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, marginVertical: 8 },
  cardTitle: { fontSize: 17, fontWeight: '700' }
});
