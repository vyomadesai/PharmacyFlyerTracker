import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'app.lastActivityAt';
const PERSIST_EVERY_MS = 10_000;

let lastActivityAt = 0;
let lastPersistedAt = 0;
let loadPromise: Promise<void> | null = null;

async function loadStored() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const stored = Number(raw || 0);
    if (Number.isFinite(stored) && stored > lastActivityAt) {
      lastActivityAt = stored;
    }
  } catch {
    // ignore storage errors; memory value is still used
  }
}

function ensureLoaded() {
  if (!loadPromise) loadPromise = loadStored();
  return loadPromise;
}

function persist(force = false) {
  if (!force && lastActivityAt - lastPersistedAt < PERSIST_EVERY_MS) return;
  lastPersistedAt = lastActivityAt;
  AsyncStorage.setItem(STORAGE_KEY, String(lastActivityAt)).catch(() => {});
}

/** Record that the user just interacted with the app. */
export function touchActivity() {
  lastActivityAt = Date.now();
  persist(false);
}

/** Write the latest activity timestamp immediately (e.g. when the app goes to background). */
export function flushActivity() {
  if (!lastActivityAt) lastActivityAt = Date.now();
  persist(true);
}

/** Last time the user interacted with the app, across restarts. */
export async function getLastActivityAt(): Promise<number> {
  await ensureLoaded();
  return lastActivityAt;
}

/** Milliseconds since the last user interaction. */
export async function getIdleMs(): Promise<number> {
  const last = await getLastActivityAt();
  if (!last) return 0;
  return Math.max(0, Date.now() - last);
}
