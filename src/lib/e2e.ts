import { E2E_PREFIX, isEncrypted, type SecretInfo } from "../../shared/types";

/**
 * End-to-end encryption for secret chats, using only the browser's WebCrypto.
 *
 *  - Each device makes an ECDH P-256 key pair per secret chat. The private key is
 *    created NON-EXTRACTABLE and stored as a CryptoKey object in IndexedDB: no
 *    script (not ours, not an attacker's) can ever read its bytes, and it never
 *    leaves this device. Only the public key is sent to the server.
 *  - Both devices combine their private key with the other's public key (ECDH)
 *    and run HKDF-SHA256 (salted with the chat id) to get the same AES-256-GCM key.
 *  - Every message gets a fresh random 96-bit IV; the chat id is bound in as
 *    authenticated data, so ciphertext can't be replayed into another chat.
 *  - Text is padded to a multiple of 32 bytes, so message lengths leak less.
 *
 * Format: "e2e1." + base64url(iv) + "." + base64url(ciphertext + GCM tag)
 */

const DB_NAME = "relay-e2e";
const STORE = "keys";
const PAD = 32;
const enc = new TextEncoder();
const dec = new TextDecoder();

interface StoredKey {
  roomId: string;
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
}

// ---------- base64url ----------

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ---------- IndexedDB ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "roomId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Storage unavailable"));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Storage error"));
    });
  } finally {
    db.close();
  }
}

async function loadKey(roomId: string): Promise<StoredKey | null> {
  try {
    return ((await tx("readonly", (s) => s.get(roomId))) as StoredKey | undefined) ?? null;
  } catch {
    return null;
  }
}

/** True when this browser can do secret chats (WebCrypto + IndexedDB, secure context). */
export function e2eSupported(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof indexedDB !== "undefined";
}

/** Whether this device holds keys for any secret chat (used to warn before signing out). */
export async function hasAnySecretKeys(): Promise<boolean> {
  try {
    return (await tx("readonly", (s) => s.count())) > 0;
  } catch {
    return false;
  }
}

/** Signing out removes this device's secret-chat keys (like Telegram): those chats can't be read here again. */
export async function wipeAllKeys(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.clear());
  } catch {
    // nothing stored
  }
  derived.clear();
}

export async function forgetKey(roomId: string): Promise<void> {
  derived.delete(roomId);
  try {
    await tx("readwrite", (s) => s.delete(roomId));
  } catch {
    // nothing stored
  }
}

/**
 * Makes this device's key pair for a secret chat and stores the private half.
 * `pendingId` is used before the chat exists (we need the public key to create it);
 * call `adoptKey` once the server returns the real chat id.
 */
export async function createDeviceKey(pendingId: string): Promise<{ deviceId: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const deviceId = crypto.randomUUID();
  await tx("readwrite", (s) => s.put({ roomId: pendingId, deviceId, publicKey, privateKey: pair.privateKey } satisfies StoredKey));
  return { deviceId, publicKey };
}

export async function adoptKey(pendingId: string, roomId: string): Promise<void> {
  const k = await loadKey(pendingId);
  if (!k) return;
  await tx("readwrite", (s) => s.put({ ...k, roomId }));
  await tx("readwrite", (s) => s.delete(pendingId));
}

// ---------- Session keys ----------

const derived = new Map<string, Promise<CryptoKey>>();

export type SecretState =
  /** Keys are being checked. */
  | { kind: "loading" }
  /** You started it; waiting for them to accept on one of their devices. */
  | { kind: "waiting" }
  /** They invited you; accept on this device to start. */
  | { kind: "invite" }
  /** It's set up on another of your devices (or you signed out here since). */
  | { kind: "elsewhere" }
  /** Ready to send and read. */
  | { kind: "ready"; key: CryptoKey; fingerprint: string[] }
  | { kind: "unsupported" };

/** Works out what this device can do in a secret chat, deriving the shared key when possible. */
export async function secretState(info: SecretInfo, meId: string): Promise<SecretState> {
  if (!e2eSupported()) return { kind: "unsupported" };
  const mine = info.keys.find((k) => k.userId === meId);
  const theirs = info.keys.find((k) => k.userId !== meId);
  const local = await loadKey(info.roomId);

  if (!mine) return info.initiatorId === meId ? { kind: "elsewhere" } : { kind: "invite" };
  if (!local || local.deviceId !== mine.deviceId) return { kind: "elsewhere" };
  if (!theirs) return { kind: "waiting" };

  let keyPromise = derived.get(info.roomId);
  if (!keyPromise) {
    keyPromise = deriveKey(local.privateKey, theirs.publicKey, info.roomId);
    derived.set(info.roomId, keyPromise);
  }
  try {
    const key = await keyPromise;
    return { kind: "ready", key, fingerprint: await fingerprint(info) };
  } catch {
    derived.delete(info.roomId);
    return { kind: "elsewhere" };
  }
}

async function deriveKey(privateKey: CryptoKey, theirPublic: string, roomId: string): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey("raw", fromB64url(theirPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(roomId), info: enc.encode("relay secret chat v1") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------- Messages ----------

export async function encryptText(key: CryptoKey, roomId: string, text: string): Promise<string> {
  const raw = enc.encode(text);
  const padded = new Uint8Array(Math.ceil((raw.length + 1) / PAD) * PAD);
  padded.set(raw); // the rest is zero bytes, stripped after decrypting
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(roomId) }, key, padded);
  return `${E2E_PREFIX}${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

/** Returns the text, or null if it can't be decrypted with this key (wrong device, tampered). */
export async function decryptText(key: CryptoKey, roomId: string, body: string): Promise<string | null> {
  if (!isEncrypted(body)) return null;
  const [ivPart, ctPart] = body.slice(E2E_PREFIX.length).split(".");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(ivPart), additionalData: enc.encode(roomId) },
      key,
      fromB64url(ctPart),
    );
    const bytes = new Uint8Array(plain);
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return dec.decode(bytes.subarray(0, end));
  } catch {
    return null;
  }
}

// ---------- Verification ----------

const EMOJI = [
  "🐶", "🐱", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦉",
  "🦄", "🐝", "🦋", "🐢", "🐙", "🦀", "🐬", "🐳", "🌵", "🌲", "🌻", "🍄", "🌙", "⭐", "⚡", "🔥",
  "🌈", "❄️", "🍎", "🍋", "🍉", "🍇", "🍓", "🍒", "🥑", "🌽", "🍩", "🍪", "🎂", "🍿", "⚽", "🏀",
  "🎸", "🎧", "🎨", "🚀", "✈️", "🚲", "⛵", "🏠", "⏰", "💡", "🔑", "🎁", "📚", "🧩", "🎈", "💎",
];

/**
 * A short code both people see identically. Compare it (in person or on a call):
 * if it matches, nobody swapped keys in the middle.
 */
async function fingerprint(info: SecretInfo): Promise<string[]> {
  const material = [...info.keys.map((k) => k.publicKey)].sort().join("|") + "|" + info.roomId;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(material)));
  return Array.from(hash.subarray(0, 8), (b) => EMOJI[b % 64]);
}
