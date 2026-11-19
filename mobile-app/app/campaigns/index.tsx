import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../src/services/api';
import { Campaign } from '../../src/types/types';

export default function CampaignsScreen() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/campaigns/active').then(r => setCampaigns(r.data)).finally(() => setLoading(false));
  }, []);

  async function selectCampaign(campaign: Campaign) {
    await AsyncStorage.setItem('selectedCampaign', JSON.stringify(campaign));
    router.push('/doctors/search');
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Campaign</Text>
      <View style={styles.qaButton}>
        <Button title="Today's Assigned Route" onPress={() => router.push('/route')} />
      </View>
      <FlatList
        data={campaigns}
        keyExtractor={(item) => String(item.CampaignId)}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => selectCampaign(item)}>
            <Text style={styles.cardTitle}>{item.CampaignName}</Text>
            <Text>{item.Description}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  qaButton: { marginBottom: 16 },
  card: { padding: 16, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: '700' }
});
