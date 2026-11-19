import { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardAwareScrollView from '../src/components/KeyboardAwareScrollView';
import { api, getApiUrl, validateStoredSession } from '../src/services/api';
import { AuthUser, getUserDisplayName } from '../src/types/auth';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [emailOrMobile, setEmailOrMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    validateStoredSession().then((valid) => {
      if (!mounted) return;
      if (valid) {
        router.replace('/route-three');
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function login() {
    const loginValue = emailOrMobile.trim();

    if (!loginValue || !password) {
      Alert.alert('Missing login details', 'Enter your User ID/email/phone and password.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.post('/auth/login', { emailOrMobile: loginValue, password });
      const user = res.data.user as AuthUser;

      await AsyncStorage.setItem('token', res.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(user));
      Alert.alert('Signed in', `Welcome, ${getUserDisplayName(user)}.`);
      router.replace('/route-three');
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.message;
      Alert.alert(
        'Login failed',
        message || (status === 404 ? `Server returned 404. Login endpoint not found at ${getApiUrl('/auth/login')}. Restart backend and check API_BASE_URL.` : status ? `Server returned ${status}. Check credentials.` : 'Cannot reach backend API. Check API_BASE_URL and that backend is running.')
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={[styles.container, { marginTop: insets.top, paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.kicker}>Field app</Text>
      <Text style={styles.title}>Pharmacy Flyer Tracker</Text>
      <Text style={styles.subtitle}>Check in at a practice, confirm who is there, then drop the flyer.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Username / Email / Phone</Text>
        <TextInput
          style={styles.input}
          placeholder="Email, User ID, or phone"
          placeholderTextColor="#94a3b8"
          value={emailOrMobile}
          onChangeText={setEmailOrMobile}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          <Pressable
            style={styles.eyeButton}
            onPress={() => setShowPassword((current) => !current)}
            disabled={loading}
          >
            <Text style={styles.eyeButtonText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.loginButton, loading && styles.disabledButton]} onPress={login} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginButtonText}>Sign in</Text>}
        </Pressable>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: 'center', backgroundColor: '#f4f7f7' },
  kicker: { color: '#3f5b76', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  title: { fontSize: 28, fontWeight: '800', color: '#0f172a', letterSpacing: -0.3 },
  subtitle: { fontSize: 15, color: '#64748b', marginTop: 8, marginBottom: 20, lineHeight: 22, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', padding: 16 },
  label: { fontSize: 12, color: '#64748b', fontWeight: '800', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, marginBottom: 14, fontSize: 16, color: '#0f172a' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', borderRadius: 12, marginBottom: 16 },
  passwordInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: '#0f172a' },
  eyeButton: { paddingHorizontal: 14, paddingVertical: 12 },
  eyeButtonText: { color: '#3f5b76', fontWeight: '800' },
  loginButton: { backgroundColor: '#3f5b76', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  loginButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  disabledButton: { opacity: 0.6 },
});
