import {
  isEncrypted,
  LIMITS,
  messagePreview,
  type AdminRoom,
  type AdminStats,
  type AdminUser,
  type AdminUserUpdate,
  type AuditEntry,
  type MediaMeta,
  type MessageKind,
  type Role,
  type User,
} from "../shared/types";
import { hashPassword, requireAdmin, requireSuperAdmin } from "./auth";
import { lobby, room, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { mediaHeaders, parseRange } from "./media";
import { hydrateMessages, MESSAGE_SELECT, type MessageRow } from "./messages";
import { listReports, resolveReport } from "./moderation";
import { readSiteSettings } from "./features";
import { isUniqueViolation, validDisplayName, validPassword, validUsername } from "./validate";

/**
 * Admin API, with two levels:
 *  - Admins manage regular accounts (create, edit, reset passwords, suspend, sign out,
 *    delete), see the dashboard and the audit log. They can't touch other admins or
 *    the owner, and have NO way to read messages.
 *  - The owner (Grimm, super admin) can do everything: manage admins too (promote,
 *    demote, suspend, delete), review and moderate conversations, and control the
 *    whole site (announcement, sign-ups, maintenance mode). End-to-end encrypted
 *    secret chats are the one exception: they're unreadable by design, for everyone.
 * Every write, and every conversation the owner opens, is recorded in admin_audit.
 */
export async function routeAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const p = url.pathname;
  const m = request.method;

  // ---- Owner only (Grimm): conversations and site settings ----
  if (p.startsWith("/api/admin/rooms") || p === "/api/admin/site") {
    const owner = await requireSuperAdmin(request, env);
    if (p === "/api/admin/site" && m === "GET") return json({ site: await readSiteSettings(env) });
    if (p === "/api/admin/site" && m === "PUT") return updateSite(request, env, owner);
    if (p === "/api/admin/rooms" && m === "GET") return listAllRooms(env, url);
    const roomRoute = p.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})\/messages(?:\/([0-9a-f-]{36})\/media)?$/);
    if (roomRoute && m === "GET") {
      const [, roomId, messageId] = roomRoute;
      return messageId ? ownerMedia(env, request, roomId, messageId) : ownerMessages(env, url, owner, roomId);
    }
    const msgRoute = p.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})\/messages\/([0-9a-f-]{36})$/);
    if (msgRoute && m === "DELETE") return ownerDeleteMessage(env, owner, msgRoute[1], msgRoute[2]);
    const exportRoute = p.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})\/export$/);
    if (exportRoute && m === "GET") return ownerExport(env, owner, exportRoute[1]);
    const delRoute = p.match(/^\/api\/admin\/rooms\/([0-9a-f-]{36})$/);
    if (delRoute && m === "DELETE") return ownerDeleteRoom(env, owner, delRoute[1]);
    throw new HttpError(404, "Not found.");
  }

  if (p === "/api/admin/stats" && m === "GET") return json({ stats: await getStats(env) });
  if (p === "/api/admin/users" && m === "GET") return listUsers(env, url);
  if (p === "/api/admin/users" && m === "POST") return createUser(request, env, admin);
  if (p === "/api/admin/audit" && m === "GET") return listAudit(env);
  if (p === "/api/admin/reports" && m === "GET") return listReports(env, url);
  const reportRoute = p.match(/^\/api\/admin\/reports\/([0-9a-f-]{36})$/);
  if (reportRoute && m === "PATCH") return resolveReport(request, env, admin, reportRoute[1]);

  const userRoute = p.match(/^\/api\/admin\/users\/([0-9a-f-]{36})(\/sessions)?$/);
  if (userRoute) {
    const [, id, sessions] = userRoute;
    if (sessions && m === "DELETE") return signOutEverywhere(env, admin, id);
    if (!sessions && m === "PATCH") return updateUser(request, env, admin, id);
    if (!sessions && m === "DELETE") return deleteUser(env, admin, id);
  }

  throw new HttpError(404, "Not found.");
}

// ---------- Helpers ----------

interface UserRow {
  super_admin: number;
  id: string;
  username: string;
  display_name: string;
  role: Role;
  suspended_at: number | null;
  created_at: number;
  last_login_at: number | null;
  message_count: number;
  active_sessions: number;
  avatar_version: number | null;
}

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.role, u.super_admin, u.suspended_at, u.created_at, u.last_login_at, u.avatar_version,
         (SELECT COUNT(*) FROM messages WHERE user_id = u.id) AS message_count,
         (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?1) AS active_sessions
    FROM users u`;

function toAdminUser(r: UserRow, online = false): AdminUser {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    superAdmin: r.super_admin === 1,
    suspendedAt: r.suspended_at,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    messageCount: r.message_count,
    activeSessions: r.active_sessions,
    avatarVersion: r.avatar_version,
    online,
  };
}

async function getUser(env: Env, id: string): Promise<AdminUser> {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE u.id = ?2`).bind(Date.now(), id).first<UserRow>();
  if (!row) throw new HttpError(404, "User not found.");
  const online = await lobby(env).onlineAmong([id]).catch(() => [] as string[]);
  return toAdminUser(row, online.length > 0);
}

export async function audit(
  env: Env,
  admin: User,
  action: string,
  target: { id: string; username: string } | null,
  details?: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, admin_id, admin_username, action, target_id, target_username, details, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      crypto.randomUUID(),
      admin.id,
      admin.username,
      action,
      target?.id ?? null,
      target?.username ?? null,
      details ?? null,
      Date.now(),
    )
    .run();
}

async function adminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND suspended_at IS NULL",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Deletes all sessions and closes every live socket for a user. */
async function revokeAccess(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).run();
  const { results } = await env.DB.prepare("SELECT room_id FROM room_members WHERE user_id = ?1")
    .bind(userId)
    .all<{ room_id: string }>();
  await Promise.all([
    ...results.map((r) => room(env, r.room_id).kick(userId).catch(() => 0)),
    lobby(env).kick(userId).catch(() => undefined),
  ]);
}

// ---------- Handlers ----------

async function getStats(env: Env): Promise<AdminStats> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
       (SELECT COUNT(*) FROM users WHERE suspended_at IS NOT NULL) AS suspended,
       (SELECT COUNT(*) FROM messages) AS messages,
       (SELECT COUNT(*) FROM rooms) AS rooms,
       (SELECT COUNT(*) FROM users WHERE created_at > ?1) AS new_users_7d,
       (SELECT COUNT(*) FROM messages WHERE created_at > ?2) AS messages_24h,
       (SELECT COUNT(*) FROM sessions WHERE expires_at > ?3) AS active_sessions,
       (SELECT COUNT(*) FROM rooms WHERE status = 'pending') AS pending_requests,
       (SELECT COUNT(*) FROM users WHERE super_admin = 1) AS owners`,
  )
    .bind(now - 7 * 86_400_000, now - 86_400_000, now)
    .first<Record<string, number>>();

  // Activity per day for the last 14 days (UTC), with empty days filled in.
  const DAY = 86_400_000;
  const since = Math.floor(now / DAY) * DAY - 13 * DAY;
  const dayExpr = "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')";
  const [msgDays, userDays, top, everyone] = await env.DB.batch<Record<string, string | number | null>>([
    env.DB.prepare(`SELECT ${dayExpr} AS day, COUNT(*) AS n FROM messages WHERE created_at >= ?1 GROUP BY day`).bind(since),
    env.DB.prepare(`SELECT ${dayExpr} AS day, COUNT(*) AS n FROM users WHERE created_at >= ?1 GROUP BY day`).bind(since),
    env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_version, COUNT(*) AS n
         FROM messages m JOIN users u ON u.id = m.user_id
        WHERE m.created_at >= ?1 AND m.kind != 'call'
        GROUP BY u.id ORDER BY n DESC LIMIT 5`,
    ).bind(now - 7 * DAY),
    env.DB.prepare("SELECT id FROM users WHERE suspended_at IS NULL"),
  ]);
  const byDay = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [r.day as string, r.n as number]));
  const msgMap = byDay(msgDays.results);
  const userMap = byDay(userDays.results);
  const daily = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(since + i * DAY).toISOString().slice(0, 10);
    return { day, messages: msgMap.get(day) ?? 0, signups: userMap.get(day) ?? 0 };
  });
  const online = await lobby(env)
    .onlineAmong(everyone.results.map((r) => r.id as string))
    .catch(() => [] as string[]);
  return {
    users: row?.users ?? 0,
    admins: row?.admins ?? 0,
    suspended: row?.suspended ?? 0,
    messages: row?.messages ?? 0,
    rooms: row?.rooms ?? 0,
    newUsers7d: row?.new_users_7d ?? 0,
    messages24h: row?.messages_24h ?? 0,
    activeSessions: row?.active_sessions ?? 0,
    pendingRequests: row?.pending_requests ?? 0,
    owners: row?.owners ?? 0,
    onlineNow: online.length,
    daily,
    topSenders: top.results.map((r) => ({
      id: r.id as string,
      username: r.username as string,
      displayName: r.display_name as string,
      avatarVersion: r.avatar_version as number | null,
      messages: r.n as number,
    })),
  };
}

async function listUsers(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { results } = await env.DB.prepare(
    `${USER_SELECT}
      WHERE ?2 = '' OR u.username LIKE ?3 ESCAPE '\\' OR u.display_name LIKE ?3 ESCAPE '\\'
      ORDER BY u.created_at DESC
      LIMIT 200`,
  )
    .bind(Date.now(), q, `%${escaped}%`)
    .all<UserRow>();
  const online = new Set(await lobby(env).onlineAmong(results.map((r) => r.id)).catch(() => [] as string[]));
  return json({ users: results.map((r) => toAdminUser(r, online.has(r.id))) });
}

async function createUser(request: Request, env: Env, admin: User): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown; displayName?: unknown; role?: unknown }>(
    request,
  );
  const username = validUsername(body.username);
  const password = validPassword(body.password, username);
  const displayName = validDisplayName(body.displayName, username);
  const role: Role = body.role === "admin" ? "admin" : "user";
  if (role === "admin" && !(await isOwner(env, admin.id))) throw new HttpError(403, "Only the owner can create admin accounts.");

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(id, username, displayName, await hashPassword(password), role, Date.now())
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "That username is taken.");
    throw err;
  }

  await audit(env, admin, "user.create", { id, username }, role === "admin" ? "role: admin" : undefined);
  return json({ user: await getUser(env, id) }, 201);
}

async function isOwner(env: Env, userId: string): Promise<boolean> {
  const me = await env.DB.prepare("SELECT super_admin FROM users WHERE id = ?1").bind(userId).first<{ super_admin: number }>();
  return me?.super_admin === 1;
}

/** Admins manage regular accounts; only the owner (Grimm) can manage admins and the owner account. */
async function assertCanManage(env: Env, admin: User, target: AdminUser): Promise<void> {
  if (target.id === admin.id) return;
  if (target.role !== "admin" && !target.superAdmin) return;
  if (!(await isOwner(env, admin.id))) {
    throw new HttpError(403, target.superAdmin ? "Only the owner can change the owner account." : "Only the owner can manage other admins.");
  }
}

async function updateUser(request: Request, env: Env, admin: User, id: string): Promise<Response> {
  const body = await readJson<AdminUserUpdate>(request);
  const target = await getUser(env, id);
  await assertCanManage(env, admin, target);
  const isSelf = id === admin.id;

  const sets: string[] = [];
  const binds: unknown[] = [];
  const changes: string[] = [];
  let revoke = false;

  if (body.username !== undefined) {
    const username = validUsername(body.username);
    if (username !== target.username) {
      sets.push("username = ?");
      binds.push(username);
      changes.push(`username: ${target.username} → ${username}`);
    }
  }
  if (body.displayName !== undefined) {
    const displayName = validDisplayName(body.displayName, target.username);
    if (displayName !== target.displayName) {
      sets.push("display_name = ?");
      binds.push(displayName);
      changes.push(`display name: ${target.displayName} → ${displayName}`);
    }
  }
  if (body.role !== undefined && body.role !== target.role) {
    if (body.role !== "user" && body.role !== "admin") throw new HttpError(400, "Invalid role.");
    if (isSelf) throw new HttpError(400, "You can't change your own role.");
    if (!(await isOwner(env, admin.id))) throw new HttpError(403, "Only the owner can promote or demote admins.");
    if (target.role === "admin" && (await adminCount(env)) <= 1) {
      throw new HttpError(400, "There must always be at least one admin.");
    }
    sets.push("role = ?");
    binds.push(body.role);
    changes.push(`role: ${target.role} → ${body.role}`);
  }
  if (body.suspended !== undefined && body.suspended !== (target.suspendedAt !== null)) {
    if (isSelf) throw new HttpError(400, "You can't suspend yourself.");
    if (body.suspended && target.role === "admin" && (await adminCount(env)) <= 1) {
      throw new HttpError(400, "You can't suspend the last admin.");
    }
    sets.push("suspended_at = ?");
    binds.push(body.suspended ? Date.now() : null);
    changes.push(body.suspended ? "suspended" : "unsuspended");
    if (body.suspended) revoke = true;
  }
  if (body.password !== undefined && body.password !== "") {
    sets.push("password_hash = ?");
    binds.push(await hashPassword(validPassword(body.password)));
    changes.push("password reset");
    // Sign the user out everywhere, except the admin's own current session.
    if (!isSelf) revoke = true;
  }

  // Lost phone and recovery codes: an admin can turn two-step verification off (always audited).
  if (body.resetTwoFactor === true) {
    sets.push("totp_secret = NULL, totp_pending = NULL, recovery_codes = NULL");
    changes.push("two-step verification reset");
  }

  if (sets.length === 0) return json({ user: target });

  binds.push(id);
  try {
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "That username is taken.");
    throw err;
  }

  if (revoke) await revokeAccess(env, id);
  await audit(env, admin, "user.update", target, changes.join("; "));
  return json({ user: await getUser(env, id) });
}

async function signOutEverywhere(env: Env, admin: User, id: string): Promise<Response> {
  if (id === admin.id) throw new HttpError(400, "Use Sign out to end your own session.");
  const target = await getUser(env, id);
  await assertCanManage(env, admin, target);
  await revokeAccess(env, id);
  await audit(env, admin, "user.signout_all", target);
  return json({ user: await getUser(env, id) });
}

async function deleteUser(env: Env, admin: User, id: string): Promise<Response> {
  if (id === admin.id) throw new HttpError(400, "You can't delete your own account.");
  const target = await getUser(env, id);
  await assertCanManage(env, admin, target);
  if (target.role === "admin" && (await adminCount(env)) <= 1) {
    throw new HttpError(400, "You can't delete the last admin.");
  }

  await removeAccount(env, id);
  await audit(env, admin, "user.delete", target, `${target.messageCount} messages removed`);
  return json({ ok: true });
}

/**
 * Permanently removes an account: signs it out everywhere, deletes its 1:1 chats
 * (and their files), its messages in groups, and the account itself. Groups it
 * administered get a new admin. Used by admins and by "Delete my account".
 */
export async function removeAccount(env: Env, id: string): Promise<void> {
  await revokeAccess(env, id);

  const { results: dms } = await env.DB.prepare(
    `SELECT r.id, (SELECT user_id FROM room_members WHERE room_id = r.id AND user_id != ?1 LIMIT 1) AS other_id
       FROM rooms r JOIN room_members m ON m.room_id = r.id
      WHERE r.type = 'dm' AND m.user_id = ?1`,
  )
    .bind(id)
    .all<{ id: string; other_id: string | null }>();
  const { results: groups } = await env.DB.prepare(
    `SELECT m.room_id, m.role FROM room_members m JOIN rooms r ON r.id = m.room_id
      WHERE r.type = 'group' AND m.user_id = ?1`,
  )
    .bind(id)
    .all<{ room_id: string; role: string }>();

  // DMs involving this user are removed entirely (cascades to their members and messages).
  // Their messages in group chats are removed too, then the account itself.
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM rooms WHERE type = 'dm' AND id IN (SELECT room_id FROM room_members WHERE user_id = ?1)",
    ).bind(id),
    env.DB.prepare("DELETE FROM messages WHERE user_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(id),
  ]);

  // Groups they administered: make the longest-standing member an admin if none is left.
  for (const g of groups) {
    await env.DB.prepare(
      `UPDATE room_members SET role = 'admin'
        WHERE room_id = ?1 AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_id = ?1 AND role = 'admin')
          AND user_id = (SELECT user_id FROM room_members WHERE room_id = ?1 ORDER BY joined_at ASC LIMIT 1)`,
    )
      .bind(g.room_id)
      .run();
  }
  // Empty groups are removed.
  await env.DB.prepare(
    "DELETE FROM rooms WHERE type = 'group' AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_id = rooms.id)",
  ).run();

  // Remove the deleted DMs' photos/voice notes and refresh everyone's sidebar.
  await Promise.all(dms.map((d) => room(env, d.id).wipeMedia().catch(() => undefined)));
  const others = dms.map((d) => d.other_id).filter((x): x is string => !!x);
  const groupMembers = groups.length
    ? (
        await env.DB.prepare(
          `SELECT DISTINCT user_id FROM room_members WHERE room_id IN (${groups.map((_, i) => `?${i + 1}`).join(",")})`,
        )
          .bind(...groups.map((g) => g.room_id))
          .all<{ user_id: string }>()
      ).results.map((r) => r.user_id)
    : [];
  const notifyIds = [...new Set([...others, ...groupMembers])];
  if (notifyIds.length) await lobby(env).notify(notifyIds, { type: "rooms-changed" });
}

async function listAudit(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, admin_username, action, target_username, details, created_at
       FROM admin_audit ORDER BY created_at DESC LIMIT 200`,
  ).all<{
    id: string;
    admin_username: string;
    action: string;
    target_username: string | null;
    details: string | null;
    created_at: number;
  }>();
  const entries: AuditEntry[] = results.map((r) => ({
    id: r.id,
    adminUsername: r.admin_username,
    action: r.action,
    targetUsername: r.target_username,
    details: r.details,
    createdAt: r.created_at,
  }));
  return json({ entries });
}


// ---------- Owner (Grimm): conversations ----------

async function listAllRooms(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.type, r.status, r.created_at, r.name, r.dm_key,
            (SELECT COUNT(*) FROM messages WHERE room_id = r.id) AS message_count,
            COALESCE((SELECT MAX(created_at) FROM messages WHERE room_id = r.id), r.created_at) AS last_activity,
            (SELECT json_group_array(json_object('id', u.id, 'username', u.username, 'displayName', u.display_name, 'avatarVersion', u.avatar_version))
               FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = r.id) AS members,
            lm.kind AS last_kind, lm.body AS last_body, lm.meta AS last_meta, lm.deleted_at AS last_deleted_at
       FROM rooms r
       LEFT JOIN messages lm ON lm.id =
            (SELECT id FROM messages WHERE room_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1)
      WHERE ?1 = '' OR EXISTS (
        SELECT 1 FROM room_members m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = r.id AND (u.username LIKE ?2 ESCAPE '\\' OR u.display_name LIKE ?2 ESCAPE '\\'))
      ORDER BY last_activity DESC
      LIMIT 200`,
  )
    .bind(q, like)
    .all<{
      id: string;
      type: "dm" | "group";
      status: "pending" | "accepted";
      created_at: number;
      name: string | null;
      dm_key: string | null;
      message_count: number;
      last_activity: number;
      members: string;
      last_kind: MessageKind | null;
      last_body: string | null;
      last_meta: string | null;
      last_deleted_at: number | null;
    }>();
  const rooms: AdminRoom[] = results.map((r) => ({
    id: r.id,
    type: r.type,
    secret: !!r.dm_key?.startsWith("secret:"),
    name: r.name,
    status: r.status,
    createdAt: r.created_at,
    messageCount: r.message_count,
    lastActivity: r.last_activity,
    members: JSON.parse(r.members),
    lastPreview: r.last_kind
      ? messagePreview({ kind: r.last_kind, body: r.last_body ?? "", deletedAt: r.last_deleted_at, meta: safeMeta(r.last_meta) })
      : null,
  }));
  return json({ rooms });
}

async function ownerMessages(env: Env, url: URL, owner: User, roomId: string): Promise<Response> {
  const before = Number(url.searchParams.get("before")) || null;
  const { results } = await env.DB.prepare(
    `${MESSAGE_SELECT}
      WHERE m.room_id = ?1 AND (?2 IS NULL OR (m.created_at, m.id) < (?2, ?3))
      ORDER BY m.created_at DESC, m.id DESC LIMIT 101`,
  )
    .bind(roomId, before, url.searchParams.get("beforeId") ?? "")
    .all<MessageRow>();

  // Accountability: opening a conversation is always written to the audit log.
  if (!before) {
    const names = await env.DB.prepare(
      "SELECT group_concat(u.username, ', ') AS names FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ?1",
    )
      .bind(roomId)
      .first<{ names: string | null }>();
    const details = `conversation between ${names?.names ?? "deleted users"}`;
    // Re-opening the same conversation within 10 minutes counts as the same visit.
    const recent = await env.DB.prepare(
      `SELECT 1 FROM admin_audit
        WHERE admin_id = ?1 AND action = 'conversation.view' AND details = ?2 AND created_at > ?3`,
    )
      .bind(owner.id, details, Date.now() - 10 * 60 * 1000)
      .first();
    if (!recent) await audit(env, owner, "conversation.view", null, details);
  }
  const messages = (await hydrateMessages(env.DB, results.slice(0, 100).reverse())).map((m) =>
    // View-once media stays sealed, even for the owner.
    m.meta?.viewOnce ? { ...m, body: "", mediaId: null } : m,
  );
  return json({ messages, hasMore: results.length > 100 });
}

/** Owner access to a message's file, with byte ranges (video seeking). View-once media is never served. */
async function ownerMedia(env: Env, request: Request, roomId: string, messageId: string): Promise<Response> {
  const msg = await env.DB.prepare("SELECT kind, media_id, meta FROM messages WHERE id = ?1 AND room_id = ?2")
    .bind(messageId, roomId)
    .first<{ kind: string; media_id: string | null; meta: string | null }>();
  if (!msg?.media_id) throw new HttpError(404, "File not found (it may have been deleted).");
  if (safeMeta(msg.meta)?.viewOnce) throw new HttpError(403, "View-once media can't be opened from here.");
  const stub = room(env, roomId);
  const info = await stub.mediaInfo(msg.media_id);
  if (!info) throw new HttpError(404, "File not found (it may have been deleted).");
  const headers = mediaHeaders(info.mime, "no-store", msg.kind === "file" ? (info.name ?? "file") : undefined);
  const range = parseRange(request.headers.get("Range"), info.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const data = await stub.readMedia(msg.media_id, start, end);
  if (!data) throw new HttpError(404, "File not found.");
  return range
    ? new Response(data, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}` } })
    : new Response(data, { headers });
}

function safeMeta(raw: string | null): MediaMeta | null {
  try {
    return raw ? (JSON.parse(raw) as MediaMeta) : null;
  } catch {
    return null;
  }
}

// ---------- Owner (Grimm): moderation and site settings ----------

async function roomNames(env: Env, roomId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT r.type, r.name, group_concat(u.username, ', ') AS names
       FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id LEFT JOIN users u ON u.id = m.user_id
      WHERE r.id = ?1 GROUP BY r.id`,
  )
    .bind(roomId)
    .first<{ type: string; name: string | null; names: string | null }>();
  if (!row) throw new HttpError(404, "Chat not found.");
  return row.type === "group" ? `group "${row.name ?? "Group"}" (${row.names ?? ""})` : `conversation between ${row.names ?? "deleted users"}`;
}

/** Removes one message for everyone (like the sender deleting it). */
async function ownerDeleteMessage(env: Env, owner: User, roomId: string, messageId: string): Promise<Response> {
  const msg = await env.DB.prepare(
    "SELECT m.media_id, m.deleted_at, u.username FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?1 AND m.room_id = ?2",
  )
    .bind(messageId, roomId)
    .first<{ media_id: string | null; deleted_at: number | null; username: string }>();
  if (!msg) throw new HttpError(404, "Message not found.");
  if (msg.deleted_at !== null) return json({ ok: true });
  const deletedAt = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE messages SET deleted_at = ?1, body = '', meta = NULL, media_id = NULL, pinned_at = NULL, pinned_by = NULL WHERE id = ?2",
    ).bind(deletedAt, messageId),
    env.DB.prepare("DELETE FROM message_reactions WHERE message_id = ?1").bind(messageId),
  ]);
  const stub = room(env, roomId);
  if (msg.media_id) await stub.deleteMedia(msg.media_id);
  await stub.notifyDeleted(messageId, deletedAt);
  await audit(env, owner, "message.delete", null, `a message from @${msg.username} in ${await roomNames(env, roomId)}`);
  return json({ ok: true });
}

/** Deletes a whole conversation (messages, files, members) for everyone. */
async function ownerDeleteRoom(env: Env, owner: User, roomId: string): Promise<Response> {
  const details = await roomNames(env, roomId);
  const { results } = await env.DB.prepare("SELECT user_id FROM room_members WHERE room_id = ?1")
    .bind(roomId)
    .all<{ user_id: string }>();
  const members = results.map((r) => r.user_id);
  await env.DB.prepare("DELETE FROM rooms WHERE id = ?1").bind(roomId).run();
  const stub = room(env, roomId);
  await Promise.all(members.map((id) => stub.removeMember(id).catch(() => undefined)));
  await stub.wipeMedia();
  if (members.length) await lobby(env).notify(members, { type: "rooms-changed" });
  await audit(env, owner, "conversation.delete", null, details);
  return json({ ok: true });
}

/** Downloads a whole conversation as JSON (view-once content stays sealed). */
async function ownerExport(env: Env, owner: User, roomId: string): Promise<Response> {
  const details = await roomNames(env, roomId);
  const { results } = await env.DB.prepare(
    `SELECT m.id, u.username AS sender, m.kind, m.body, m.meta, m.created_at, m.edited_at, m.deleted_at
       FROM messages m JOIN users u ON u.id = m.user_id WHERE m.room_id = ?1 ORDER BY m.created_at ASC LIMIT 50000`,
  )
    .bind(roomId)
    .all<{ id: string; sender: string; kind: string; body: string; meta: string | null; created_at: number; edited_at: number | null; deleted_at: number | null }>();
  const data = {
    exportedAt: new Date().toISOString(),
    conversation: details,
    messages: results.map((r) => {
      const meta = safeMeta(r.meta);
      return {
        id: r.id,
        from: r.sender,
        kind: r.kind,
        text: meta?.viewOnce ? "" : isEncrypted(r.body) ? "[end-to-end encrypted]" : r.body,
        file: meta?.name ?? null,
        viewOnce: !!meta?.viewOnce,
        sentAt: new Date(r.created_at).toISOString(),
        edited: r.edited_at !== null,
        deleted: r.deleted_at !== null,
      };
    }),
  };
  await audit(env, owner, "conversation.export", null, details);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="conversation-${roomId.slice(0, 8)}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function updateSite(request: Request, env: Env, owner: User): Promise<Response> {
  const body = await readJson<{ announcement?: unknown; registrationOpen?: unknown; maintenance?: unknown }>(request);
  const changes: string[] = [];
  if (body.announcement !== undefined) {
    const text = typeof body.announcement === "string" ? body.announcement.trim() : "";
    if (text.length > LIMITS.announcementMax) throw new HttpError(400, `Announcements can be at most ${LIMITS.announcementMax} characters.`);
    const value = text ? JSON.stringify({ text, createdAt: Date.now() }) : "null";
    await env.DB.prepare("INSERT INTO site_settings (key, value) VALUES ('announcement', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(value)
      .run();
    changes.push(text ? `announcement: "${text.slice(0, 80)}"` : "announcement removed");
  }
  if (typeof body.registrationOpen === "boolean") {
    await env.DB.prepare("INSERT INTO site_settings (key, value) VALUES ('registration', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(body.registrationOpen ? "open" : "closed")
      .run();
    changes.push(body.registrationOpen ? "sign-ups opened" : "sign-ups closed");
  }
  if (typeof body.maintenance === "boolean") {
    await env.DB.prepare("INSERT INTO site_settings (key, value) VALUES ('maintenance', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(body.maintenance ? "on" : "off")
      .run();
    changes.push(body.maintenance ? "maintenance mode on" : "maintenance mode off");
  }
  if (changes.length) {
    await audit(env, owner, "site.update", null, changes.join("; "));
    // Everyone online picks up the new banner right away.
    const { results } = await env.DB.prepare("SELECT id FROM users WHERE suspended_at IS NULL").all<{ id: string }>();
    await lobby(env).notify(results.map((r) => r.id), { type: "site-changed" });
  }
  return json({ site: await readSiteSettings(env, true) });
}
