import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { shared } from '../styles/distributor';

export default function ScreenBackButton({ label = 'Back' }: { label?: string }) {
  return (
    <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}>
      <Text style={[shared.meta, { color: '#3f5b76', fontWeight: '700' }]}>← {label}</Text>
    </Pressable>
  );
}
