/**
 * App passcode (like Telegram's "Passcode lock"): a PIN that locks Relay on this device.
 * Only a slow PBKDF2 hash of the PIN is stored, in this browser. It protects against someone
 * picking up your unlocked phone or computer; it's per device and never sent to the server.
 */

/** Fire this window event to lock the app right now (Settings → "Lock now"). */
export const LOCK_EVENT = "relay:lock";

const KEY = "relay:passcode:v1";
const FAILS_KEY = "relay:passcode:fails";
const ITERATIONS = 310_000;

export const AUTO_LOCK_OPTIONS = [
  { label: "After 1 minute away", minutes: 1 },
  { label: "After 5 minutes away", minutes: 5 },
  { label: "After 1 hour away", minutes: 60 },
  { label: "Only when Relay restarts", minutes: 0 },
] as const;

interface Stored {
  userId: string;
  salt: string;
  hash: string;
  iterations: number;
  autoLockMinutes: number;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

/** The passcode set on this device for this account, if any. */
export function passcodeFor(userId: string): { autoLockMinutes: number } | null {
  const s = read();
  return s && s.userId === userId ? { autoLockMinutes: s.autoLockMinutes } : null;
}

export async function setPasscode(userId: string, pin: string, autoLockMinutes: number): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const stored: Stored = { userId, salt: b64(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS, autoLockMinutes };
  localStorage.setItem(KEY, JSON.stringify(stored));
  localStorage.removeItem(FAILS_KEY);
}

export function setAutoLock(minutes: number): void {
  const s = read();
  if (s) localStorage.setItem(KEY, JSON.stringify({ ...s, autoLockMinutes: minutes }));
}

export function clearPasscode(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(FAILS_KEY);
  } catch {
    // storage blocked
  }
}

/** After 5 wrong tries, each further try has to wait longer (30 s, 1 min, 2 min… up to 30 min). */
export function lockoutRemaining(): number {
  try {
    const f = JSON.parse(localStorage.getItem(FAILS_KEY) ?? "{}") as { until?: number };
    return Math.max(0, (f.until ?? 0) - Date.now());
  } catch {
    return 0;
  }
}

export async function checkPasscode(pin: string): Promise<boolean> {
  const s = read();
  if (!s || lockoutRemaining() > 0) return false;
  const ok = (await derive(pin, unb64(s.salt), s.iterations)) === s.hash;
  let fails: { count: number; until: number } = { count: 0, until: 0 };
  try {
    fails = { count: 0, until: 0, ...JSON.parse(localStorage.getItem(FAILS_KEY) ?? "{}") };
  } catch {
    // reset
  }
  if (ok) {
    localStorage.removeItem(FAILS_KEY);
    return true;
  }
  fails.count += 1;
  if (fails.count >= 5) fails.until = Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** (fails.count - 5));
  localStorage.setItem(FAILS_KEY, JSON.stringify(fails));
  return false;
}
