import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// IMPORTANT: for real phone testing, use your computer LAN IP, not localhost.
// export const API_BASE_URL = 'http://192.168.86.212:4001/api';
export const API_BASE_URL = 'https://domains-stretch-climb-allocation.trycloudflare.com/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 180000,
});

export function getApiUrl(path: string) {
  const base = API_BASE_URL.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export function describeApiError(error: unknown, fallback: string) {
  const err = error as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string } };
  };
  const apiMessage = err?.response?.data?.message?.trim();
  if (apiMessage) return apiMessage;

  const status = err?.response?.status;
  if (status) return `${fallback} (HTTP ${status}).`;

  const raw = String(err?.message || '');
  const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(raw);
  if (timedOut) {
    return 'The server took too long to build your route. Wait a few seconds and tap Check In again.';
  }
  if (!err?.response || /Network Error/i.test(raw)) {
    return `Check-in did not finish. The app lost the connection while the server was building your route. Stay on Wi-Fi and try again — the second try is usually faster.`;
  }
  return raw || fallback;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

export function isAuthError(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 401;
}

api.interceptors.request.use(async (config) => {
  const token = (await AsyncStorage.getItem('token'))?.trim();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401) {
      const hadToken = await AsyncStorage.getItem('token');
      await AsyncStorage.multiRemove(['token', 'user']);
      if (hadToken && unauthorizedHandler) {
        unauthorizedHandler();
      }
    }
    return Promise.reject(error);
  },
);

export async function validateStoredSession() {
  const token = (await AsyncStorage.getItem('token'))?.trim();
  if (!token) return false;
  try {
    await api.get('/auth/me');
    return true;
  } catch (error) {
    if (isAuthError(error)) {
      await AsyncStorage.multiRemove(['token', 'user']);
    }
    return false;
  }
}
