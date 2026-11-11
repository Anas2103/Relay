import { routeAccount } from "./account";
import { routeAdmin } from "./admin";
import {
  createSession,
  deleteSession,
  getDummyHash,
  getSessionUser,
  hashPassword,
  loadMe,
  rateLimit,
  requireUser,
  sessionCookie,
  verifyPassword,
} from "./auth";
import { lobby, type Env } from "./env";
import { assertSameOrigin, clientIp, HttpError, json, readJson } from "./http";
import {
  connectSocket,
  getGallery,
  getMediaFile,
  getMessages,
  listRooms,
  openDm,
  searchMessages,
  uploadMedia,
} from "./rooms";
import { getAvatar, getProfile, searchUsers } from "./users";
import { isUniqueViolation, validDisplayName, validPassword, validUsername } from "./validate";

export { ChatRoom } from "./room";
export { Lobby } from "./lobby";

const ID = "([0-9a-f-]{36})";
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
  const p = url.pathname;
  const m = request.method;
  let match: RegExpMatchArray | null;

  // Auth
  if (p === "/api/auth/register" && m === "POST") return register(request, env);
  if (p === "/api/auth/login" && m === "POST") return login(request, env);
  if (p === "/api/auth/logout" && m === "POST") return logout(request, env);
  if (p === "/api/me" && m === "GET") {
    const user = await getSessionUser(request, env);
    return user ? json({ user: await loadMe(env, user.id) }) : json({ error: "Not signed in." }, 401);
  }

  // Account, admin, app-wide socket
  if (p === "/api/account" || p.startsWith("/api/account/")) return routeAccount(request, env, url);
  if (p.startsWith("/api/admin/")) return routeAdmin(request, env, url);
  if (p === "/api/lobby" && m === "GET") return connectLobby(request, env, url);
  if (p === "/api/calls/ice" && m === "GET") return iceServers(request, env);

  // Users
  if (p === "/api/users/search" && m === "GET") return searchUsers(request, env, url);
  if ((match = p.match(new RegExp(`^/api/users/${ID}$`))) && m === "GET") return getProfile(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/users/${ID}/avatar$`))) && m === "GET") return getAvatar(request, env, match[1]);

  // Rooms
  if (p === "/api/rooms" && m === "GET") {
    const user = await requireUser(request, env);
    return json({ rooms: await listRooms(env, user.id) });
  }
  if (p === "/api/rooms/dm" && m === "POST") return openDm(request, env);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/messages$`))) && m === "GET") {
    return getMessages(request, env, url, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/ws$`))) && m === "GET") {
    return connectSocket(request, env, url, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/media$`))) && m === "POST") {
    return uploadMedia(request, env, url, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/messages/${ID}/media$`))) && m === "GET") {
    return getMediaFile(env, request, match[1], match[2]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/search$`))) && m === "GET") {
    return searchMessages(request, env, url, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/gallery$`))) && m === "GET") {
    return getGallery(request, env, url, match[1]);
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

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    )
      .bind(id, username, displayName, await hashPassword(password), now)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "That username is taken.");
    throw err;
  }

  const { token, maxAge } = await createSession(env, id);
  return json({ user: await loadMe(env, id) }, 201, { "Set-Cookie": sessionCookie(token, maxAge) });
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  await rateLimit(env, `login-ip:${clientIp(request)}`, 20, FIFTEEN_MIN);
  await rateLimit(env, `login-user:${username.toLowerCase()}`, 10, FIFTEEN_MIN);

  const row = await env.DB.prepare("SELECT id, password_hash, suspended_at FROM users WHERE username = ?1")
    .bind(username)
    .first<{ id: string; password_hash: string; suspended_at: number | null }>();

  // Always run a hash check so response time doesn't reveal whether the username exists.
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row || !ok) throw new HttpError(401, "Wrong username or password.");
  // Only revealed after a correct password, so it can't be used to probe accounts.
  if (row.suspended_at !== null) throw new HttpError(403, "This account has been suspended.");

  await env.DB.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2").bind(Date.now(), row.id).run();
  const { token, maxAge } = await createSession(env, row.id);
  return json({ user: await loadMe(env, row.id) }, 200, { "Set-Cookie": sessionCookie(token, maxAge) });
}

async function logout(request: Request, env: Env): Promise<Response> {
  await deleteSession(env, request);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

// ---------- App-wide live connection ----------

async function connectLobby(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "Expected a WebSocket upgrade.");
  }
  if (request.headers.get("Origin") !== url.origin) throw new HttpError(403, "Cross-origin request blocked.");
  const me = await requireUser(request, env);

  const forwarded = new Request(request);
  forwarded.headers.set("X-User-Id", me.id);
  forwarded.headers.set("X-Display-Name", me.displayName);
  return lobby(env).fetch(forwarded);
}

// ---------- Calls ----------

const PUBLIC_STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

/**
 * Network routes for WebRTC calls. STUN (free, public) lets most devices connect
 * directly. Some mobile/corporate networks need a TURN relay: if the optional
 * TURN_KEY_ID / TURN_KEY_API_TOKEN secrets are set, short-lived Cloudflare TURN
 * credentials are generated per call (Cloudflare's free tier covers small apps).
 */
async function iceServers(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env);
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ iceServers: PUBLIC_STUN, relay: false });
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 4 * 60 * 60 }),
      },
    );
    if (!res.ok) throw new Error(`TURN ${res.status}`);
    const data = (await res.json()) as { iceServers: unknown };
    const servers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    return json({ iceServers: [...PUBLIC_STUN, ...servers], relay: true });
  } catch (err) {
    console.error("TURN credentials failed", err);
    return json({ iceServers: PUBLIC_STUN, relay: false });
  }
}
