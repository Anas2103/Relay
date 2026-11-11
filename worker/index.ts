import { LIMITS, type Message, type Role, type Room, type User } from "../shared/types";
import { routeAccount } from "./account";
import { routeAdmin } from "./admin";
import {
  createSession,
  deleteSession,
  getDummyHash,
  getSessionUser,
  hashPassword,
  rateLimit,
  requireUser,
  sessionCookie,
  verifyPassword,
} from "./auth";
import type { Env } from "./env";
import { assertSameOrigin, clientIp, HttpError, json, readJson } from "./http";
import { isUniqueViolation, validDisplayName, validPassword, validUsername } from "./validate";

export { ChatRoom } from "./room";

const ID_RE = /^[0-9a-f-]{36}$/;
const PAGE_SIZE = 50;
const FIFTEEN_MIN = 15 * 60 * 1000;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request, url);
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname: p } = url;
  const m = request.method;

  if (p === "/api/auth/register" && m === "POST") return register(request, env);
  if (p === "/api/auth/login" && m === "POST") return login(request, env);
  if (p === "/api/auth/logout" && m === "POST") return logout(request, env);
  if (p === "/api/me" && m === "GET") {
    const user = await getSessionUser(request, env);
    return user ? json({ user }) : json({ error: "Not signed in." }, 401);
  }
  if (p === "/api/users/search" && m === "GET") return searchUsers(request, env, url);
  if (p === "/api/rooms" && m === "GET") {
    const user = await requireUser(request, env);
    return json({ rooms: await listRooms(env, user.id) });
  }
  if (p === "/api/rooms/dm" && m === "POST") return openDm(request, env);
  if (p.startsWith("/api/admin/")) return routeAdmin(request, env, url);
  if (p === "/api/account" || p.startsWith("/api/account/")) return routeAccount(request, env, url);

  const roomRoute = p.match(/^\/api\/rooms\/([^/]+)\/(messages|ws)$/);
  if (roomRoute && m === "GET") {
    const [, roomId, action] = roomRoute;
    if (!ID_RE.test(roomId)) throw new HttpError(404, "Chat not found.");
    return action === "ws" ? connectSocket(request, env, url, roomId) : getMessages(request, env, url, roomId);
  }

  throw new HttpError(404, "Not found.");
}

// ---------- Auth ----------

async function register(request: Request, env: Env): Promise<Response> {
  await rateLimit(env, `register:${clientIp(request)}`, 10, FIFTEEN_MIN);
  const body = await readJson<{ username?: unknown; password?: unknown; displayName?: unknown }>(request);

  const username = validUsername(body.username);
  const password = validPassword(body.password);
  const displayName = validDisplayName(body.displayName, username);

  const existing = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?1").bind(username).first();
  if (existing) throw new HttpError(409, "That username is taken.");

  const user: User = { id: crypto.randomUUID(), username, displayName, role: "user" };
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    )
      .bind(user.id, user.username, user.displayName, await hashPassword(password), now)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "That username is taken.");
    throw err;
  }

  const { token, maxAge } = await createSession(env, user.id);
  return json({ user }, 201, { "Set-Cookie": sessionCookie(token, maxAge) });
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  await rateLimit(env, `login-ip:${clientIp(request)}`, 20, FIFTEEN_MIN);
  await rateLimit(env, `login-user:${username.toLowerCase()}`, 10, FIFTEEN_MIN);

  const row = await env.DB.prepare(
    "SELECT id, username, display_name, password_hash, role, suspended_at FROM users WHERE username = ?1",
  )
    .bind(username)
    .first<{
      id: string;
      username: string;
      display_name: string;
      password_hash: string;
      role: Role;
      suspended_at: number | null;
    }>();

  // Always run a hash check so response time doesn't reveal whether the username exists.
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row || !ok) throw new HttpError(401, "Wrong username or password.");
  // Only revealed after a correct password, so it can't be used to probe accounts.
  if (row.suspended_at !== null) throw new HttpError(403, "This account has been suspended.");

  await env.DB.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2").bind(Date.now(), row.id).run();
  const { token, maxAge } = await createSession(env, row.id);
  const user: User = { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
  return json({ user }, 200, { "Set-Cookie": sessionCookie(token, maxAge) });
}

async function logout(request: Request, env: Env): Promise<Response> {
  await deleteSession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

// ---------- Users & rooms ----------

async function searchUsers(request: Request, env: Env, url: URL): Promise<Response> {
  const me = await requireUser(request, env);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, LIMITS.usernameMax);
  if (!q) return json({ users: [] });

  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { results } = await env.DB.prepare(
    `SELECT id, username, display_name FROM users
      WHERE id != ?1 AND suspended_at IS NULL AND (username LIKE ?2 ESCAPE '\\' OR display_name LIKE ?2 ESCAPE '\\')
      ORDER BY username LIMIT 10`,
  )
    .bind(me.id, `${escaped}%`)
    .all<{ id: string; username: string; display_name: string }>();

  return json({ users: results.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name })) });
}

interface RoomRow {
  id: string;
  type: "dm" | "group";
  name: string | null;
  created_at: number;
  peer_id: string | null;
  peer_username: string | null;
  peer_display_name: string | null;
  last_body: string | null;
  last_at: number | null;
  last_user_id: string | null;
}

async function listRooms(env: Env, userId: string, onlyRoomId?: string): Promise<Room[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.type, r.name, r.created_at,
            pu.id AS peer_id, pu.username AS peer_username, pu.display_name AS peer_display_name,
            lm.body AS last_body, lm.created_at AS last_at, lm.user_id AS last_user_id
       FROM room_members m
       JOIN rooms r ON r.id = m.room_id
       LEFT JOIN users pu ON r.type = 'dm' AND pu.id =
            (SELECT user_id FROM room_members WHERE room_id = r.id AND user_id != m.user_id LIMIT 1)
       LEFT JOIN messages lm ON lm.id =
            (SELECT id FROM messages WHERE room_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1)
      WHERE m.user_id = ?1 AND (?2 IS NULL OR r.id = ?2)
      ORDER BY COALESCE(lm.created_at, r.created_at) DESC`,
  )
    .bind(userId, onlyRoomId ?? null)
    .all<RoomRow>();

  return results.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    createdAt: r.created_at,
    peer: r.peer_id ? { id: r.peer_id, username: r.peer_username!, displayName: r.peer_display_name! } : null,
    lastMessage:
      r.last_at !== null ? { body: r.last_body!, createdAt: r.last_at, userId: r.last_user_id! } : null,
  }));
}

async function openDm(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const body = await readJson<{ username?: unknown }>(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";

  const other = await env.DB.prepare("SELECT id FROM users WHERE username = ?1 AND suspended_at IS NULL")
    .bind(username)
    .first<{ id: string }>();
  if (!other) throw new HttpError(404, "User not found.");
  if (other.id === me.id) throw new HttpError(400, "You can't start a chat with yourself.");

  const dmKey = [me.id, other.id].sort().join(":");
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO rooms (id, type, dm_key, created_at) VALUES (?1, 'dm', ?2, ?3)")
    .bind(crypto.randomUUID(), dmKey, now)
    .run();
  const room = await env.DB.prepare("SELECT id FROM rooms WHERE dm_key = ?1").bind(dmKey).first<{ id: string }>();
  if (!room) throw new Error("DM room missing after insert");

  const addMember = env.DB.prepare(
    "INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?1, ?2, ?3)",
  );
  await env.DB.batch([addMember.bind(room.id, me.id, now), addMember.bind(room.id, other.id, now)]);

  const [result] = await listRooms(env, me.id, room.id);
  return json({ room: result });
}

async function assertMember(env: Env, roomId: string, userId: string): Promise<void> {
  const row = await env.DB.prepare("SELECT 1 FROM room_members WHERE room_id = ?1 AND user_id = ?2")
    .bind(roomId, userId)
    .first();
  // 404 rather than 403, so people can't probe which room ids exist.
  if (!row) throw new HttpError(404, "Chat not found.");
}

// ---------- Messages ----------

async function getMessages(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);

  const before = Number(url.searchParams.get("before")) || null;
  const beforeId = url.searchParams.get("beforeId") ?? "";

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.room_id, m.user_id, u.username, u.display_name, m.body, m.created_at
       FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ?1 AND (?2 IS NULL OR (m.created_at, m.id) < (?2, ?3))
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?4`,
  )
    .bind(roomId, before, beforeId, PAGE_SIZE + 1)
    .all<{
      id: string;
      room_id: string;
      user_id: string;
      username: string;
      display_name: string;
      body: string;
      created_at: number;
    }>();

  const hasMore = results.length > PAGE_SIZE;
  const messages: Message[] = results
    .slice(0, PAGE_SIZE)
    .reverse()
    .map((r) => ({
      id: r.id,
      roomId: r.room_id,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      body: r.body,
      createdAt: r.created_at,
    }));

  return json({ messages, hasMore });
}

async function connectSocket(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "Expected a WebSocket upgrade.");
  }
  // Browsers always send Origin on WebSocket handshakes; reject other sites.
  if (request.headers.get("Origin") !== url.origin) throw new HttpError(403, "Cross-origin request blocked.");

  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);

  const forwarded = new Request(request);
  forwarded.headers.set("X-User-Id", me.id);
  forwarded.headers.set("X-Username", me.username);
  forwarded.headers.set("X-Display-Name", me.displayName);
  forwarded.headers.set("X-Room-Id", roomId);

  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(roomId));
  return stub.fetch(forwarded);
}
