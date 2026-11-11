import type { AdminStats, AdminUser, AdminUserUpdate, AuditEntry, Role, User } from "../shared/types";
import { hashPassword, requireAdmin } from "./auth";
import type { Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { isUniqueViolation, validDisplayName, validPassword, validUsername } from "./validate";

/**
 * Admin API. Admins can manage accounts but deliberately have NO endpoint for
 * reading anyone's messages. Every write is recorded in admin_audit.
 */
export async function routeAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const admin = await requireAdmin(request, env);
  const p = url.pathname;
  const m = request.method;

  if (p === "/api/admin/stats" && m === "GET") return json({ stats: await getStats(env) });
  if (p === "/api/admin/users" && m === "GET") return listUsers(env, url);
  if (p === "/api/admin/users" && m === "POST") return createUser(request, env, admin);
  if (p === "/api/admin/audit" && m === "GET") return listAudit(env);

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
  id: string;
  username: string;
  display_name: string;
  role: Role;
  suspended_at: number | null;
  created_at: number;
  last_login_at: number | null;
  message_count: number;
  active_sessions: number;
}

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.role, u.suspended_at, u.created_at, u.last_login_at,
         (SELECT COUNT(*) FROM messages WHERE user_id = u.id) AS message_count,
         (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?1) AS active_sessions
    FROM users u`;

function toAdminUser(r: UserRow): AdminUser {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    suspendedAt: r.suspended_at,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    messageCount: r.message_count,
    activeSessions: r.active_sessions,
  };
}

async function getUser(env: Env, id: string): Promise<AdminUser> {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE u.id = ?2`).bind(Date.now(), id).first<UserRow>();
  if (!row) throw new HttpError(404, "User not found.");
  return toAdminUser(row);
}

async function audit(
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
  await Promise.all(
    results.map((r) => env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(r.room_id)).kick(userId).catch(() => 0)),
  );
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
       (SELECT COUNT(*) FROM sessions WHERE expires_at > ?3) AS active_sessions`,
  )
    .bind(now - 7 * 86_400_000, now - 86_400_000, now)
    .first<Record<string, number>>();
  return {
    users: row?.users ?? 0,
    admins: row?.admins ?? 0,
    suspended: row?.suspended ?? 0,
    messages: row?.messages ?? 0,
    rooms: row?.rooms ?? 0,
    newUsers7d: row?.new_users_7d ?? 0,
    messages24h: row?.messages_24h ?? 0,
    activeSessions: row?.active_sessions ?? 0,
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
  return json({ users: results.map(toAdminUser) });
}

async function createUser(request: Request, env: Env, admin: User): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown; displayName?: unknown; role?: unknown }>(
    request,
  );
  const username = validUsername(body.username);
  const password = validPassword(body.password);
  const displayName = validDisplayName(body.displayName, username);
  const role: Role = body.role === "admin" ? "admin" : "user";

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

async function updateUser(request: Request, env: Env, admin: User, id: string): Promise<Response> {
  const body = await readJson<AdminUserUpdate>(request);
  const target = await getUser(env, id);
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
  await revokeAccess(env, id);
  await audit(env, admin, "user.signout_all", target);
  return json({ user: await getUser(env, id) });
}

async function deleteUser(env: Env, admin: User, id: string): Promise<Response> {
  if (id === admin.id) throw new HttpError(400, "You can't delete your own account.");
  const target = await getUser(env, id);
  if (target.role === "admin" && (await adminCount(env)) <= 1) {
    throw new HttpError(400, "You can't delete the last admin.");
  }

  await revokeAccess(env, id);
  // DMs involving this user are removed entirely (cascades to their members and messages).
  // Their messages in group chats are removed too, then the account itself.
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM rooms WHERE type = 'dm' AND id IN (SELECT room_id FROM room_members WHERE user_id = ?1)",
    ).bind(id),
    env.DB.prepare("DELETE FROM messages WHERE user_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(id),
  ]);

  await audit(env, admin, "user.delete", target, `${target.messageCount} messages removed`);
  return json({ ok: true });
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
