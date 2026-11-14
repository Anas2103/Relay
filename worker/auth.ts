import {
  DEFAULT_SETTINGS,
  isBubbleStyle,
  isAccentColor,
  isColorName,
  FONTS,
  isDarkTheme,
  isLightTheme,
  isWallpaper,
  type Me,
  type Role,
  type Settings,
  type User,
} from "../shared/types";
import type { Env } from "./env";
import { HttpError } from "./http";

const enc = new TextEncoder();

// PBKDF2-SHA256. 100k iterations is the maximum Workers' WebCrypto allows.
const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = "sid";

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Returns a self-describing hash string: pbkdf2$<iterations>$<salt>$<hash>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
  const expected = fromB64(hashB64);
  const actual = await pbkdf2(password, fromB64(saltB64), Number(iter));
  if (actual.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
}

/** Used when the username doesn't exist, so failed logins take the same time either way. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("relay-dummy-password");
  return dummyHash;
}

/** A signed-in user plus the hash of the session they used (to tell "this device" apart). */
export type SessionUser = User & { sessionHash: string };

/** How often "last active" is written for a device (at most once per 5 minutes, to keep writes low). */
const ACTIVE_WRITE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function createSession(
  env: Env,
  userId: string,
  info: { device: string; location: string },
): Promise<{ token: string; maxAge: number }> {
  const token = toB64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at, device, location, last_active_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4)",
  )
    .bind(await sha256Hex(token), userId, now + SESSION_TTL_MS, now, info.device, info.location)
    .run();
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export async function deleteSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.avatar_version, s.last_active_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.suspended_at IS NULL
        AND COALESCE(s.last_active_at, s.created_at) > ?2 - u.session_idle_days * ?3`,
  )
    .bind(hash, now, DAY_MS)
    .first<{ id: string; username: string; display_name: string; role: Role; avatar_version: number | null; last_active_at: number | null }>();
  if (!row) return null;
  if (!row.last_active_at || now - row.last_active_at > ACTIVE_WRITE_MS) {
    // Using a device also extends its 30-day sign-in, so active devices stay signed in.
    await env.DB.prepare("UPDATE sessions SET last_active_at = ?1, expires_at = MAX(expires_at, ?2) WHERE token_hash = ?3")
      .bind(now, now + SESSION_TTL_MS, hash)
      .run();
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    avatarVersion: row.avatar_version,
    sessionHash: hash,
  };
}

/** The signed-in user's full profile including private settings. */
export async function loadMe(env: Env, userId: string): Promise<Me> {
  const row = await env.DB.prepare(
    "SELECT id, username, display_name, role, super_admin, avatar_version, bio, settings, status_text, totp_secret IS NOT NULL AS two_factor FROM users WHERE id = ?1",
  )
    .bind(userId)
    .first<{
      id: string;
      username: string;
      display_name: string;
      role: Role;
      super_admin: number;
      avatar_version: number | null;
      bio: string;
      settings: string;
      status_text: string;
      two_factor: number;
    }>();
  if (!row) throw new HttpError(401, "Please sign in.");
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    superAdmin: row.super_admin === 1,
    avatarVersion: row.avatar_version,
    bio: row.bio,
    settings: parseSettings(row.settings),
    statusText: row.status_text ?? "",
    twoFactor: row.two_factor === 1,
  };
}

export function parseSettings(raw: string | null): Settings {
  let parsed: Partial<Record<keyof Settings, unknown>> = {};
  try {
    parsed = JSON.parse(raw ?? "{}");
  } catch {
    // fall back to defaults
  }
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;
  const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
    options.includes(v as T) ? (v as T) : fallback;
  const bubbleColor = isBubbleStyle(parsed.bubbleColor) ? parsed.bubbleColor : d.bubbleColor;
  return {
    theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
    lightTheme: isLightTheme(parsed.lightTheme) ? parsed.lightTheme : d.lightTheme,
    darkTheme: isDarkTheme(parsed.darkTheme) ? parsed.darkTheme : d.darkTheme,
    // Before app colors existed, the bubble color colored the whole app — keep that look for existing users.
    accentColor: isAccentColor(parsed.accentColor) ? parsed.accentColor : isColorName(bubbleColor) ? bubbleColor : d.accentColor,
    bubbleColor,
    showOthersBubbles: bool(parsed.showOthersBubbles, d.showOthersBubbles),
    wallpaper: isWallpaper(parsed.wallpaper) ? parsed.wallpaper : d.wallpaper,
    sounds: bool(parsed.sounds, d.sounds),
    notifications: bool(parsed.notifications, d.notifications),
    noiseSuppression:
      parsed.noiseSuppression === "standard" || parsed.noiseSuppression === "off" || parsed.noiseSuppression === "ai"
        ? parsed.noiseSuppression
        : d.noiseSuppression,
    echoCancellation: bool(parsed.echoCancellation, d.echoCancellation),
    autoGainControl: bool(parsed.autoGainControl, d.autoGainControl),
    noiseGate: bool(parsed.noiseGate, d.noiseGate),
    cleanIncoming: bool(parsed.cleanIncoming, d.cleanIncoming),
    uiScale: num(parsed.uiScale, 85, 125, d.uiScale),
    messageSize: num(parsed.messageSize, 12, 22, d.messageSize),
    font: typeof parsed.font === "string" && Object.hasOwn(FONTS, parsed.font) ? (parsed.font as Settings["font"]) : d.font,
    bubbleRadius: num(parsed.bubbleRadius, 4, 24, d.bubbleRadius),
    density: oneOf(parsed.density, ["compact", "comfortable", "spacious"], d.density),
    chatWidth: oneOf(parsed.chatWidth, ["narrow", "normal", "wide"], d.chatWidth),
    avatarShape: oneOf(parsed.avatarShape, ["circle", "rounded", "square"], d.avatarShape),
    timeFormat: oneOf(parsed.timeFormat, ["auto", "12h", "24h"], d.timeFormat),
    bigEmoji: bool(parsed.bigEmoji, d.bigEmoji),
    animations: bool(parsed.animations, d.animations),
    listPreviews: bool(parsed.listPreviews, d.listPreviews),
    showOnlineRow: bool(parsed.showOnlineRow, d.showOnlineRow),
    enterToSend: bool(parsed.enterToSend, d.enterToSend),
    linkPreviews: bool(parsed.linkPreviews, d.linkPreviews),
    sendTyping: bool(parsed.sendTyping, d.sendTyping),
    notificationPreview: bool(parsed.notificationPreview, d.notificationPreview),
    lastSeen: oneOf(parsed.lastSeen, ["contacts", "nobody"], d.lastSeen),
    presence: oneOf(parsed.presence, ["online", "dnd", "invisible"], d.presence),
  };
}

export async function requireUser(request: Request, env: Env): Promise<SessionUser> {
  const user = await getSessionUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in.");
  return user;
}

/** The site owner (Grimm). Everything they read is written to the audit log by the caller. */
export async function requireSuperAdmin(request: Request, env: Env): Promise<SessionUser> {
  const user = await requireAdmin(request, env);
  const row = await env.DB.prepare("SELECT super_admin FROM users WHERE id = ?1").bind(user.id).first<{ super_admin: number }>();
  if (row?.super_admin !== 1) throw new HttpError(404, "Not found.");
  return user;
}

export async function requireAdmin(request: Request, env: Env): Promise<SessionUser> {
  const user = await requireUser(request, env);
  // 404 so the admin API's existence isn't revealed to regular users.
  if (user.role !== "admin") throw new HttpError(404, "Not found.");
  return user;
}

/** Fixed-window rate limit stored in D1. Throws 429 when exceeded. */
export async function rateLimit(env: Env, key: string, limit: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count        = CASE WHEN window_start < ?2 - ?3 THEN 1  ELSE count + 1 END,
       window_start = CASE WHEN window_start < ?2 - ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(key, now, windowMs)
    .first<{ count: number }>();
  if (row && row.count > limit) {
    throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
  }
}
