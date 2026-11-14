import {
  isBubbleStyle,
  isAccentColor,
  isDarkTheme,
  isLightTheme,
  isWallpaper,
  LIMITS,
  type Settings,
  type User,
} from "../shared/types";
import {
  hashPassword,
  loadMe,
  parseSettings,
  rateLimit,
  requireUser,
  type SessionUser,
  verifyPassword,
} from "./auth";
import { lobby, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { readUpload } from "./media";
import { routeSecurity, signOutOtherDevices } from "./security";
import { str, validDisplayName, validPassword } from "./validate";

const FIFTEEN_MIN = 15 * 60 * 1000;

/** Self-service account settings for the signed-in user. */
export async function routeAccount(request: Request, env: Env, url: URL): Promise<Response> {
  const me = await requireUser(request, env);
  const p = url.pathname;
  const m = request.method;

  if (p === "/api/account" && m === "PATCH") return updateProfile(request, env, me);
  if (p === "/api/account/password" && m === "POST") return changePassword(request, env, me);
  if (p === "/api/account/avatar" && m === "PUT") return uploadAvatar(request, env, me);
  if (p === "/api/account/avatar" && m === "DELETE") return removeAvatar(env, me);
  const security = await routeSecurity(request, env, url);
  if (security) return security;

  throw new HttpError(404, "Not found.");
}

/** Tells everyone you chat with to refresh, so new names/pictures show up instantly. */
async function announceProfileChange(env: Env, userId: string): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT other.user_id FROM room_members me
       JOIN room_members other ON other.room_id = me.room_id
      WHERE me.user_id = ?1`,
  )
    .bind(userId)
    .all<{ user_id: string }>();
  await lobby(env).notify(results.map((r) => r.user_id), { type: "rooms-changed" });
}

async function updateProfile(request: Request, env: Env, me: User): Promise<Response> {
  const body = await readJson<{ displayName?: unknown; bio?: unknown; settings?: unknown; statusText?: unknown }>(request);
  const sets: string[] = [];
  const binds: unknown[] = [];
  let publicChange = false;

  if (body.displayName !== undefined) {
    sets.push("display_name = ?");
    binds.push(validDisplayName(body.displayName, me.username));
    publicChange = true;
  }
  if (body.bio !== undefined) {
    const bio = str(body.bio).trim();
    if (bio.length > LIMITS.bioMax) throw new HttpError(400, `Bio can be at most ${LIMITS.bioMax} characters.`);
    sets.push("bio = ?");
    binds.push(bio);
  }
  if (body.statusText !== undefined) {
    const statusText = str(body.statusText).replace(/\s+/g, " ").trim();
    if ([...statusText].length > LIMITS.statusMax) throw new HttpError(400, `Status can be at most ${LIMITS.statusMax} characters.`);
    sets.push("status_text = ?");
    binds.push(statusText);
    publicChange = true;
  }
  if (body.settings !== undefined) {
    if (!body.settings || typeof body.settings !== "object") throw new HttpError(400, "Invalid settings.");
    const current = (await loadMe(env, me.id)).settings;
    const patch = body.settings as Partial<Record<keyof Settings, unknown>>;
    const next: Settings = parseSettings(JSON.stringify({ ...current, ...patch }));
    const checks: [keyof Settings, (v: unknown) => boolean, string][] = [
      ["bubbleColor", isBubbleStyle, "Unknown bubble color."],
      ["accentColor", isAccentColor, "Unknown app color."],
      ["wallpaper", isWallpaper, "Unknown wallpaper."],
      ["lightTheme", isLightTheme, "Unknown light theme."],
      ["darkTheme", isDarkTheme, "Unknown dark theme."],
      ["noiseSuppression", (v) => v === "ai" || v === "standard" || v === "off", "Unknown noise suppression mode."],
    ];
    for (const [key, valid, message] of checks) {
      if (patch[key] !== undefined && !valid(patch[key])) throw new HttpError(400, message);
    }
    // "Last seen" privacy applies right away to your open app.
    const hidden = (x: Settings) => x.lastSeen === "nobody" || x.presence === "invisible";
    if (hidden(next) !== hidden(current)) await lobby(env).setHidden(me.id, hidden(next));
    if (next.presence !== current.presence) publicChange = true;
    // Your bubble color is visible to the people you chat with, so tell them to refresh.
    if (patch.bubbleColor !== undefined && patch.bubbleColor !== current.bubbleColor) publicChange = true;
    sets.push("settings = ?");
    binds.push(JSON.stringify(next));
  }

  if (sets.length) {
    binds.push(me.id);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
    if (publicChange) await announceProfileChange(env, me.id);
  }
  return json({ user: await loadMe(env, me.id) });
}

async function uploadAvatar(request: Request, env: Env, me: User): Promise<Response> {
  await rateLimit(env, `avatar:${me.id}`, 20, FIFTEEN_MIN);
  const { bytes, mime } = await readUpload(request, "image", LIMITS.avatarMaxBytes);
  const version = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(me.id, mime, bytes, version),
    env.DB.prepare("UPDATE users SET avatar_version = ?1 WHERE id = ?2").bind(version, me.id),
  ]);
  await announceProfileChange(env, me.id);
  return json({ user: await loadMe(env, me.id) });
}

async function removeAvatar(env: Env, me: User): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM avatars WHERE user_id = ?1").bind(me.id),
    env.DB.prepare("UPDATE users SET avatar_version = NULL WHERE id = ?1").bind(me.id),
  ]);
  await announceProfileChange(env, me.id);
  return json({ user: await loadMe(env, me.id) });
}

async function changePassword(request: Request, env: Env, me: SessionUser): Promise<Response> {
  // Stops someone with a stolen session from brute-forcing the current password.
  await rateLimit(env, `password-change:${me.id}`, 5, FIFTEEN_MIN);

  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
  const currentPassword = str(body.currentPassword);
  const newPassword = validPassword(body.newPassword, me.username);

  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1")
    .bind(me.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new HttpError(400, "Your current password is incorrect.");
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, "Your new password must be different from the current one.");
  }

  await env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2")
    .bind(await hashPassword(newPassword), me.id)
    .run();
  await signOutOtherDevices(env, me);
  return json({ ok: true });
}
