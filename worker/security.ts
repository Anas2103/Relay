import { SESSION_IDLE_OPTIONS, type SecurityOverview, type SessionInfo } from "../shared/types";
import {
  createSession,
  loadMe,
  rateLimit,
  readCookie,
  requireUser,
  SESSION_COOKIE,
  sessionCookie,
  sha256Hex,
  verifyPassword,
  type SessionUser,
} from "./auth";
import { lobby, type Env } from "./env";
import { clientIp, HttpError, json, readJson } from "./http";
import { str } from "./validate";

const FIFTEEN_MIN = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECOVERY_CODES = 8;
const enc = new TextEncoder();

// ---------- Device & location labels ----------

/** "Chrome · Windows", "Safari · iPhone"... Only a label for the devices list, never used for security decisions. */
export function describeDevice(request: Request): string {
  const ua = request.headers.get("User-Agent") ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : ua
                ? "Browser"
                : "Unknown app";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Approximate place from Cloudflare's network info (city/country only, never the IP itself). */
export function describeLocation(request: Request): string {
  const cf = (request as Request & { cf?: { city?: string; country?: string } }).cf;
  let country = cf?.country ?? "";
  try {
    if (country && country !== "XX" && country !== "T1") country = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
  } catch {
    // keep the code
  }
  return [cf?.city, country].filter(Boolean).join(", ") || "Unknown location";
}

// ---------- TOTP (RFC 6238), works with Google Authenticator, Authy, 1Password, Bitwarden… ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(0, Math.floor(counter / 2 ** 32));
  msg.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg.buffer));
  const off = mac[mac.length - 1] & 0xf;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/**
 * Checks a 6-digit code (allowing 30 s of clock drift either way). Returns the time step it matched,
 * which must be newer than the last one used, so a code can never be replayed.
 */
async function matchTotp(secretB32: string, code: string, lastStep: number): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = Math.floor(Date.now() / 30_000);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue;
    const expected = await hotp(secret, step);
    if (crypto.subtle.timingSafeEqual(enc.encode(expected), enc.encode(code))) return step;
  }
  return null;
}

function newRecoveryCodes(): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)
  return Array.from({ length: RECOVERY_CODES }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Verifies an authenticator code or a recovery code (which is then used up). */
async function checkSecondFactor(env: Env, userId: string, rawCode: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT totp_secret, totp_last_step, recovery_codes FROM users WHERE id = ?1")
    .bind(userId)
    .first<{ totp_secret: string | null; totp_last_step: number; recovery_codes: string | null }>();
  if (!row?.totp_secret) return false;
  const code = rawCode.replace(/\s/g, "");

  const step = await matchTotp(row.totp_secret, code, row.totp_last_step);
  if (step !== null) {
    // Conditional update: two requests racing with the same code can't both win.
    const res = await env.DB.prepare("UPDATE users SET totp_last_step = ?1 WHERE id = ?2 AND totp_last_step < ?1").bind(step, userId).run();
    return res.meta.changes === 1;
  }

  const hashes: string[] = JSON.parse(row.recovery_codes ?? "[]");
  const hash = await sha256Hex(`recovery:${normalizeRecovery(code)}`);
  if (normalizeRecovery(code).length !== 10 || !hashes.includes(hash)) return false;
  const remaining = hashes.filter((h) => h !== hash);
  const res = await env.DB.prepare("UPDATE users SET recovery_codes = ?1 WHERE id = ?2 AND recovery_codes = ?3")
    .bind(JSON.stringify(remaining), userId, row.recovery_codes)
    .run();
  return res.meta.changes === 1;
}

async function hashCodes(codes: string[]): Promise<string> {
  return JSON.stringify(await Promise.all(codes.map((c) => sha256Hex(`recovery:${normalizeRecovery(c)}`))));
}

// ---------- Sign-in with two-step verification ----------

/** After a correct password: if 2-step is on, returns a short-lived challenge instead of a session. */
export async function startLogin(env: Env, request: Request, userId: string): Promise<Response> {
  const device = describeDevice(request);
  const location = describeLocation(request);
  const row = await env.DB.prepare("SELECT totp_secret FROM users WHERE id = ?1").bind(userId).first<{ totp_secret: string | null }>();
  if (row?.totp_secret) {
    const token = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_challenges WHERE expires_at < ?1").bind(Date.now()),
      env.DB.prepare("INSERT INTO login_challenges (token_hash, user_id, expires_at, device, location) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
        await sha256Hex(token),
        userId,
        Date.now() + CHALLENGE_TTL_MS,
        device,
        location,
      ),
    ]);
    return json({ twoFactor: true, challenge: token });
  }
  return finishLogin(env, userId, device, location);
}

async function finishLogin(env: Env, userId: string, device: string, location: string): Promise<Response> {
  await env.DB.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2").bind(Date.now(), userId).run();
  const { token, maxAge } = await createSession(env, userId, { device, location });
  // Like Telegram's "New login" message: every other open device hears about it straight away.
  await lobby(env).notify([userId], { type: "security", title: "New sign-in to your account", text: `${device} · ${location}` });
  return json({ user: await loadMe(env, userId) }, 200, { "Set-Cookie": sessionCookie(token, maxAge) });
}

/** Second step: the 6-digit code (or a recovery code). */
export async function verifyLogin(request: Request, env: Env): Promise<Response> {
  await rateLimit(env, `2fa-ip:${clientIp(request)}`, 20, FIFTEEN_MIN);
  const body = await readJson<{ challenge?: unknown; code?: unknown }>(request);
  const tokenHash = await sha256Hex(str(body.challenge));
  const challenge = await env.DB.prepare(
    "SELECT user_id, expires_at, attempts, device, location FROM login_challenges WHERE token_hash = ?1",
  )
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: number; attempts: number; device: string; location: string }>();
  if (!challenge || challenge.expires_at < Date.now()) throw new HttpError(401, "This sign-in expired. Enter your password again.");
  await rateLimit(env, `2fa-user:${challenge.user_id}`, 10, FIFTEEN_MIN);

  if (!(await checkSecondFactor(env, challenge.user_id, str(body.code)))) {
    // Five wrong codes and the password has to be entered again.
    if (challenge.attempts >= 4) {
      await env.DB.prepare("DELETE FROM login_challenges WHERE token_hash = ?1").bind(tokenHash).run();
      throw new HttpError(401, "Too many wrong codes. Enter your password again.");
    }
    await env.DB.prepare("UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?1").bind(tokenHash).run();
    throw new HttpError(400, "That code isn't right. Check your authenticator app and try again.");
  }
  await env.DB.prepare("DELETE FROM login_challenges WHERE token_hash = ?1").bind(tokenHash).run();
  const user = await env.DB.prepare("SELECT suspended_at FROM users WHERE id = ?1").bind(challenge.user_id).first<{ suspended_at: number | null }>();
  if (!user || user.suspended_at !== null) throw new HttpError(403, "This account has been suspended.");
  return finishLogin(env, challenge.user_id, challenge.device, challenge.location);
}

// ---------- Settings → Privacy & security ----------

export async function routeSecurity(request: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;
  const m = request.method;
  if (p === "/api/account/security" && m === "GET") return overview(request, env);
  if (p === "/api/account/security" && m === "PATCH") return updateSecurity(request, env);
  if (p === "/api/account/sessions" && m === "DELETE") return revokeOthers(request, env);
  const match = p.match(/^\/api\/account\/sessions\/([0-9a-f]{16})$/);
  if (match && m === "DELETE") return revokeOne(request, env, match[1]);
  if (p === "/api/account/2fa/setup" && m === "POST") return setupTwoFactor(request, env);
  if (p === "/api/account/2fa/enable" && m === "POST") return enableTwoFactor(request, env);
  if (p === "/api/account/2fa/disable" && m === "POST") return disableTwoFactor(request, env);
  if (p === "/api/account/2fa/recovery" && m === "POST") return regenerateRecovery(request, env);
  return null;
}

async function overview(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const [user, { results }] = await Promise.all([
    env.DB.prepare("SELECT totp_secret, recovery_codes, session_idle_days FROM users WHERE id = ?1")
      .bind(me.id)
      .first<{ totp_secret: string | null; recovery_codes: string | null; session_idle_days: number }>(),
    env.DB.prepare(
      `SELECT token_hash, device, location, created_at, last_active_at FROM sessions
        WHERE user_id = ?1 AND expires_at > ?2 ORDER BY COALESCE(last_active_at, created_at) DESC`,
    )
      .bind(me.id, Date.now())
      .all<{ token_hash: string; device: string | null; location: string | null; created_at: number; last_active_at: number | null }>(),
  ]);
  const sessions: SessionInfo[] = results.map((s) => ({
    id: s.token_hash.slice(0, 16),
    device: s.device ?? "Unknown device",
    location: s.location ?? "Unknown location",
    createdAt: s.created_at,
    lastActiveAt: s.last_active_at ?? s.created_at,
    current: s.token_hash === me.sessionHash,
  }));
  sessions.sort((a, b) => Number(b.current) - Number(a.current));
  const result: SecurityOverview = {
    twoFactor: !!user?.totp_secret,
    recoveryCodesLeft: user?.totp_secret ? (JSON.parse(user.recovery_codes ?? "[]") as string[]).length : 0,
    sessionIdleDays: user?.session_idle_days ?? 180,
    sessions,
  };
  return json({ security: result });
}

async function updateSecurity(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const body = await readJson<{ sessionIdleDays?: unknown }>(request);
  const days = Number(body.sessionIdleDays);
  if (!(SESSION_IDLE_OPTIONS as readonly number[]).includes(days)) throw new HttpError(400, "Pick one of the listed periods.");
  await env.DB.prepare("UPDATE users SET session_idle_days = ?1 WHERE id = ?2").bind(days, me.id).run();
  return overview(request, env);
}

async function revokeOne(request: Request, env: Env, id: string): Promise<Response> {
  const me = await requireUser(request, env);
  if (me.sessionHash.startsWith(id)) throw new HttpError(400, "That's this device. Use Sign out instead.");
  const row = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND substr(token_hash, 1, 16) = ?2 RETURNING token_hash")
    .bind(me.id, id)
    .first<{ token_hash: string }>();
  if (!row) throw new HttpError(404, "That device is already signed out.");
  await lobby(env).kickSession(row.token_hash.slice(0, 16));
  return overview(request, env);
}

async function revokeOthers(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const { results } = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2 RETURNING token_hash")
    .bind(me.id, me.sessionHash)
    .all<{ token_hash: string }>();
  const hub = lobby(env);
  for (const r of results) await hub.kickSession(r.token_hash.slice(0, 16));
  return overview(request, env);
}

async function requirePassword(env: Env, user: SessionUser, password: unknown): Promise<void> {
  await rateLimit(env, `reauth:${user.id}`, 8, FIFTEEN_MIN);
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(str(password), row.password_hash))) throw new HttpError(400, "Your password is incorrect.");
}

async function setupTwoFactor(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const body = await readJson<{ password?: unknown }>(request);
  await requirePassword(env, me, body.password);
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  await env.DB.prepare("UPDATE users SET totp_pending = ?1 WHERE id = ?2").bind(secret, me.id).run();
  const label = encodeURIComponent(`Relay:${me.username}`);
  return json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Relay&algorithm=SHA1&digits=6&period=30` });
}

async function enableTwoFactor(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `2fa-enable:${me.id}`, 10, FIFTEEN_MIN);
  const body = await readJson<{ code?: unknown }>(request);
  const row = await env.DB.prepare("SELECT totp_pending FROM users WHERE id = ?1").bind(me.id).first<{ totp_pending: string | null }>();
  if (!row?.totp_pending) throw new HttpError(400, "Start the setup again.");
  const step = await matchTotp(row.totp_pending, str(body.code).replace(/\s/g, ""), 0);
  if (step === null) throw new HttpError(400, "That code isn't right. Make sure your phone's clock is set automatically.");
  const codes = newRecoveryCodes();
  await env.DB.prepare(
    "UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ?1, recovery_codes = ?2 WHERE id = ?3",
  )
    .bind(step, await hashCodes(codes), me.id)
    .run();
  // Turning on 2-step signs out every other device, so a thief who already got in is kicked out too.
  await signOutOtherDevices(env, me);
  return json({ recoveryCodes: codes, user: await loadMe(env, me.id) });
}

async function disableTwoFactor(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const body = await readJson<{ password?: unknown }>(request);
  await requirePassword(env, me, body.password);
  await env.DB.prepare("UPDATE users SET totp_secret = NULL, totp_pending = NULL, recovery_codes = NULL WHERE id = ?1").bind(me.id).run();
  return json({ user: await loadMe(env, me.id) });
}

async function regenerateRecovery(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const body = await readJson<{ password?: unknown }>(request);
  await requirePassword(env, me, body.password);
  const codes = newRecoveryCodes();
  const res = await env.DB.prepare("UPDATE users SET recovery_codes = ?1 WHERE id = ?2 AND totp_secret IS NOT NULL")
    .bind(await hashCodes(codes), me.id)
    .run();
  if (res.meta.changes !== 1) throw new HttpError(400, "Two-step verification is off.");
  return json({ recoveryCodes: codes });
}

export async function signOutOtherDevices(env: Env, me: SessionUser): Promise<void> {
  const { results } = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2 RETURNING token_hash")
    .bind(me.id, me.sessionHash)
    .all<{ token_hash: string }>();
  const hub = lobby(env);
  for (const r of results) await hub.kickSession(r.token_hash.slice(0, 16));
}

/** The session id of the request's cookie, for tagging its live connection. */
export async function sessionTag(request: Request): Promise<string> {
  return (await sha256Hex(readCookie(request, SESSION_COOKIE) ?? "")).slice(0, 16);
}
