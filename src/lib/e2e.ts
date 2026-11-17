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
 *  - Every message gets a fresh random 96-bit IV. The chat id AND the sender's id
 *    are bound in as authenticated data: ciphertext can't be replayed into another
 *    chat, and the server can't pass one person's message off as the other's.
 *  - Text is padded to a multiple of 32 bytes, so message lengths leak less.
 *  - Photos are encrypted the same way (their own IV, padded to 4 KB steps), and
 *    their size, type and caption travel inside the encrypted message.
 *
 * Format: "e2e1." + base64url(iv) + "." + base64url(ciphertext + GCM tag)
 * Photos: "RLE1" + iv (12 bytes) + ciphertext + GCM tag
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
  /** When this key was made (keys this new are never pruned: their chat may not be listed yet). */
  createdAt?: number;
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

/**
 * Destroys the keys of secret chats that no longer exist (the other person ended
 * it, or it was deleted on another device). Without the key, nothing from that
 * chat can ever be decrypted again — anywhere — even if a copy survived somewhere.
 * `liveIds` must be the full, fresh chat list from the server.
 */
export async function pruneKeys(liveIds: Set<string>): Promise<string[]> {
  let all: StoredKey[] = [];
  try {
    all = ((await tx("readonly", (s) => s.getAll())) as StoredKey[]) ?? [];
  } catch {
    return [];
  }
  const now = Date.now();
  const dead = all.filter((k) => !liveIds.has(k.roomId) && now - (k.createdAt ?? 0) > 10 * 60 * 1000);
  for (const k of dead) await forgetKey(k.roomId);
  return dead.map((k) => k.roomId);
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
  await tx("readwrite", (s) => s.put({ roomId: pendingId, deviceId, publicKey, privateKey: pair.privateKey, createdAt: Date.now() } satisfies StoredKey));
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

/** Authenticated data: which chat, and who wrote it. */
const aad = (roomId: string, senderId: string) => enc.encode(`${roomId}|${senderId}`);

export async function encryptText(key: CryptoKey, roomId: string, senderId: string, text: string): Promise<string> {
  const raw = enc.encode(text);
  const padded = new Uint8Array(Math.ceil((raw.length + 1) / PAD) * PAD);
  padded.set(raw); // the rest is zero bytes, stripped after decrypting
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(roomId, senderId) }, key, padded);
  return `${E2E_PREFIX}${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

/**
 * Returns the text, or null if it can't be decrypted with this key (wrong device,
 * tampered, or not really from `senderId`). Messages from before sender-binding
 * only had the chat id as authenticated data; those still open.
 */
export async function decryptText(key: CryptoKey, roomId: string, senderId: string, body: string): Promise<string | null> {
  if (!isEncrypted(body)) return null;
  const [ivPart, ctPart] = body.slice(E2E_PREFIX.length).split(".");
  if (!ivPart || !ctPart) return null;
  const iv = fromB64url(ivPart);
  const ct = fromB64url(ctPart);
  for (const additionalData of [aad(roomId, senderId), enc.encode(roomId)]) {
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData }, key, ct);
      const bytes = new Uint8Array(plain);
      let end = bytes.length;
      while (end > 0 && bytes[end - 1] === 0) end--;
      return dec.decode(bytes.subarray(0, end));
    } catch {
      // try the next form
    }
  }
  return null;
}

// ---------- Photos ----------

const MEDIA_MAGIC = enc.encode("RLE1");
const MEDIA_PAD = 4096;
const mediaAad = (roomId: string, senderId: string) => enc.encode(`relay-media|${roomId}|${senderId}`);

/** Encrypts a file's bytes. The result is all the server ever stores. */
export async function encryptBytes(key: CryptoKey, roomId: string, senderId: string, data: Blob): Promise<Blob> {
  const raw = new Uint8Array(await data.arrayBuffer());
  // 4-byte length, the bytes, then zeros up to the next 4 KB (so the exact size doesn't leak).
  const padded = new Uint8Array(Math.ceil((raw.length + 4) / MEDIA_PAD) * MEDIA_PAD);
  new DataView(padded.buffer).setUint32(0, raw.length);
  padded.set(raw, 4);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: mediaAad(roomId, senderId) }, key, padded));
  return new Blob([MEDIA_MAGIC, iv, ct], { type: "application/octet-stream" });
}

/** Decrypts a photo; null if it isn't ours, was tampered with, or isn't from `senderId`. */
export async function decryptBytes(key: CryptoKey, roomId: string, senderId: string, data: ArrayBuffer, mime: string): Promise<Blob | null> {
  const b = new Uint8Array(data);
  if (b.length < 4 + 12 + 16 || MEDIA_MAGIC.some((v, i) => b[i] !== v)) return null;
  try {
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(4, 16), additionalData: mediaAad(roomId, senderId) }, key, b.subarray(16)),
    );
    const len = new DataView(plain.buffer).getUint32(0);
    if (len > plain.length - 4) return null;
    return new Blob([plain.subarray(4, 4 + len)], { type: mime });
  } catch {
    return null;
  }
}

/** What a secret photo's (encrypted) message says: caption, size and type. */
export interface SecretPhoto {
  caption: string;
  width: number;
  height: number;
  mime: string;
}

export function photoBody(p: SecretPhoto): string {
  return JSON.stringify({ v: 1, c: p.caption, w: p.width, h: p.height, m: p.mime });
}

export function parsePhotoBody(text: string): SecretPhoto | null {
  try {
    const o = JSON.parse(text) as { v?: number; c?: unknown; w?: unknown; h?: unknown; m?: unknown };
    if (o.v !== 1) return null;
    const num = (v: unknown) => (typeof v === "number" && v > 0 && v < 20_000 ? Math.round(v) : 0);
    const mime = typeof o.m === "string" && /^image\/(jpeg|png|webp|gif)$/.test(o.m) ? o.m : "image/jpeg";
    return { caption: typeof o.c === "string" ? o.c : "", width: num(o.w), height: num(o.h), mime };
  } catch {
    return null;
  }
}

// ---------- Verification ----------

const EMOJI = [
  "🐶",
  "🐱",
  "🦊",
  "🐻",
  "🐼",
  "🐨",
  "🐯",
  "🦁",
  "🐮",
  "🐷",
  "🐸",
  "🐵",
  "🐔",
  "🐧",
  "🐦",
  "🦉",
  "🦄",
  "🐝",
  "🦋",
  "🐢",
  "🐙",
  "🦀",
  "🐬",
  "🐳",
  "🌵",
  "🌲",
  "🌻",
  "🍄",
  "🌙",
  "⭐",
  "⚡",
  "🔥",
  "🌈",
  "❄️",
  "🍎",
  "🍋",
  "🍉",
  "🍇",
  "🍓",
  "🍒",
  "🥑",
  "🌽",
  "🍩",
  "🍪",
  "🎂",
  "🍿",
  "⚽",
  "🏀",
  "🎸",
  "🎧",
  "🎨",
  "🚀",
  "✈️",
  "🚲",
  "⛵",
  "🏠",
  "⏰",
  "💡",
  "🔑",
  "🎁",
  "📚",
  "🧩",
  "🎈",
  "💎",
];

/**
 * A short code both people see identically. Compare it (in person or on a call):
 * if it matches, nobody swapped keys in the middle.
 */
async function fingerprint(info: SecretInfo): Promise<string[]> {
  const material =
    info.keys
      .map((k) => k.publicKey)
      .sort()
      .join("|") +
    "|" +
    info.roomId;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(material)));
  return Array.from(hash.subarray(0, 8), (b) => EMOJI[b % 64]);
}
