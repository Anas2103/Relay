/**
 * Offline copy of your account, chat list and the latest messages of each chat,
 * kept in this browser (IndexedDB). With no network, Relay still opens and shows
 * your chats; everything refreshes as soon as you're back online.
 *
 * - Secret chats are stored exactly as the server has them: encrypted.
 * - Signing out wipes it, and it can be turned off per device (Privacy & security).
 */

const DB_NAME = "relay-offline";
const STORE = "cache";
const PREF_KEY = "relay:offline-cache";
/** Messages kept per chat. */
const KEEP_MESSAGES = 60;

export function offlineEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export async function setOfflineEnabled(on: boolean): Promise<void> {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // private mode
  }
  if (!on) await clearOffline();
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Saves a value (best effort: never breaks the app). */
export function offlinePut(key: string, value: unknown): void {
  if (!offlineEnabled() || typeof indexedDB === "undefined") return;
  // Trim message pages so the cache stays small.
  let v = value;
  if (key.startsWith("messages:") && value && typeof value === "object" && Array.isArray((value as { messages?: unknown[] }).messages)) {
    const page = value as { messages: unknown[] };
    v = { ...page, messages: page.messages.slice(-KEEP_MESSAGES), hasMore: true };
  }
  void run("readwrite", (s) => s.put(v, key)).catch(() => {});
}

export async function offlineGet<T>(key: string): Promise<T | undefined> {
  if (!offlineEnabled() || typeof indexedDB === "undefined") return undefined;
  try {
    return (await run<T>("readonly", (s) => s.get(key) as IDBRequest<T>)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** A chat was deleted or ended: drop its saved messages from this device. */
export async function offlineForgetRoom(roomId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run("readwrite", (st) => void st.delete(`messages:${roomId}`)).catch(() => {});
}

export async function clearOffline(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run("readwrite", (s) => void s.clear()).catch(() => {});
}

// ---- Online / offline status for the UI ----

type Listener = () => void;
const listeners = new Set<Listener>();
/** True when the last request couldn't reach the server, or the device says it's offline. */
let offline = typeof navigator !== "undefined" ? !navigator.onLine : false;

export function setReachable(ok: boolean) {
  const next = !ok;
  if (next === offline) return;
  offline = next;
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setReachable(true));
  window.addEventListener("offline", () => setReachable(false));
}

export const connection = {
  offline: () => offline,
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};
