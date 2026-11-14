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
  acceptRequest,
  blockUser,
  connectSocket,
  declineRequest,
  getGallery,
  getMediaFile,
  getMessages,
  listBlocked,
  listRooms,
  openDm,
  searchMessages,
  unblockUser,
  uploadMedia,
} from "./rooms";
import { getAvatar, getProfile, searchUsers } from "./users";
import {
  addMembers,
  createGroup,
  deleteMyAccount,
  expireMessages,
  exportMyData,
  forwardMedia,
  getSite,
  joinInvite,
  linkPreview,
  previewInvite,
  setInvite,
  listMembers,
  listPinned,
  listStarred,
  readSiteSettings,
  removeMember,
  setMemberRole,
  setStar,
  updateRoom,
} from "./features";
import { routePush } from "./push";
import { acceptSecret, deleteChat, getSecretInfo, openSaved, startSecret, updatePrefs } from "./secret";
import { createReport, getGroupPhoto, listBans, searchEverywhere, setGroupPhoto, unban } from "./moderation";
import { describeDevice, describeLocation, startLogin, verifyLogin } from "./security";
import { isUniqueViolation, validDisplayName, validPassword, validUsername } from "./validate";

export { ChatRoom } from "./room";
export { Lobby } from "./lobby";

const ID = "([0-9a-f-]{36})";
const FIFTEEN_MIN = 15 * 60 * 1000;

export default {
  /** Every 15 minutes: remove disappearing messages whose timer ran out, plus housekeeping. */
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(expireMessages(env).then((n) => void (n && console.log("expired messages:", n))));
  },

  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request, url);
      return secure(await route(request, env, url));
    } catch (err) {
      if (err instanceof HttpError) return secure(json({ error: err.message }, err.status));
      console.error(err);
      return secure(json({ error: "Something went wrong. Please try again." }, 500));
    }
  },
} satisfies ExportedHandler<Env>;

/** Hardening headers on every API response (pages get theirs from public/_headers). */
const API_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; media-src 'self'; img-src 'self'; frame-ancestors 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

function secure(res: Response): Response {
  if (res.status === 101 || res.webSocket) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = request.method;
  let match: RegExpMatchArray | null;

  // Auth
  if (p === "/api/auth/register" && m === "POST") return register(request, env);
  if (p === "/api/auth/login" && m === "POST") return login(request, env);
  if (p === "/api/auth/2fa" && m === "POST") return verifyLogin(request, env);
  if (p === "/api/auth/logout" && m === "POST") return logout(request, env);
  if (p === "/api/me" && m === "GET") {
    const user = await getSessionUser(request, env);
    return user ? json({ user: await loadMe(env, user.id) }) : json({ error: "Not signed in." }, 401);
  }

  // Account, admin, app-wide socket
  if (p === "/api/account/export" && m === "GET") return exportMyData(request, env);
  if (p === "/api/account" && m === "DELETE") return deleteMyAccount(request, env);
  if (p === "/api/account" || p.startsWith("/api/account/")) return routeAccount(request, env, url);
  if (p === "/api/site" && m === "GET") return getSite(env);

  // Maintenance mode (set by the owner): only admins can use the app meanwhile.
  if ((await readSiteSettings(env)).maintenance) {
    const user = await getSessionUser(request, env);
    if (user?.role !== "admin") throw new HttpError(503, "Relay is down for maintenance. Please check back soon.");
  }

  if (p.startsWith("/api/push/")) return routePush(request, env, url);
  if (p === "/api/link-preview" && m === "GET") return linkPreview(request, env, url);
  if (p.startsWith("/api/admin/")) return routeAdmin(request, env, url);
  if (p === "/api/lobby" && m === "GET") return connectLobby(request, env, url);
  if (p === "/api/calls/ice" && m === "GET") return iceServers(request, env);

  // Users
  if (p === "/api/users/search" && m === "GET") return searchUsers(request, env, url);
  if (p === "/api/search" && m === "GET") return searchEverywhere(request, env, url);
  if (p === "/api/reports" && m === "POST") return createReport(request, env);
  if (p === "/api/blocks" && m === "GET") return listBlocked(request, env);
  if ((match = p.match(new RegExp(`^/api/users/${ID}/block$`))) && m === "POST") return blockUser(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/users/${ID}/unblock$`))) && m === "POST") return unblockUser(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/users/${ID}$`))) && m === "GET") return getProfile(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/users/${ID}/avatar$`))) && m === "GET") return getAvatar(request, env, match[1]);

  // Rooms
  if (p === "/api/rooms" && m === "GET") {
    const user = await requireUser(request, env);
    return json({ rooms: await listRooms(env, user.id) });
  }
  if (p === "/api/rooms/dm" && m === "POST") return openDm(request, env);
  if (p === "/api/groups" && m === "POST") return createGroup(request, env);
  if (p === "/api/rooms/saved" && m === "POST") return openSaved(request, env);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}$`))) && m === "DELETE") return deleteChat(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/prefs$`))) && m === "PATCH") return updatePrefs(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/bans$`))) && m === "GET") return listBans(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/bans/${ID}$`))) && m === "DELETE") return unban(request, env, match[1], match[2]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/avatar$`)))) {
    if (m === "GET") return getGroupPhoto(request, env, match[1]);
    if (m === "PUT") return setGroupPhoto(request, env, match[1], false);
    if (m === "DELETE") return setGroupPhoto(request, env, match[1], true);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/invite$`)))) {
    if (m === "POST") return setInvite(request, env, match[1], true);
    if (m === "DELETE") return setInvite(request, env, match[1], false);
  }
  if ((match = p.match(/^\/api\/invite\/([A-Za-z0-9]{12})$/))) {
    if (m === "GET") return previewInvite(request, env, match[1]);
    if (m === "POST") return joinInvite(request, env, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/secret$`)))) {
    if (m === "POST") return startSecret(request, env, match[1]);
    if (m === "GET") return getSecretInfo(request, env, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/secret/accept$`))) && m === "POST") return acceptSecret(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}$`))) && m === "PATCH") return updateRoom(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/accept$`))) && m === "POST") {
    return acceptRequest(request, env, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/decline$`))) && m === "POST") {
    return declineRequest(request, env, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/members$`)))) {
    if (m === "GET") return listMembers(request, env, match[1]);
    if (m === "POST") return addMembers(request, env, match[1]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/members/${ID}$`)))) {
    if (m === "DELETE") return removeMember(request, env, match[1], match[2], url.searchParams.get("ban") === "1");
    if (m === "PATCH") return setMemberRole(request, env, match[1], match[2]);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/pinned$`))) && m === "GET") return listPinned(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/starred$`))) && m === "GET") return listStarred(request, env, match[1]);
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/messages/${ID}/star$`)))) {
    if (m === "POST") return setStar(request, env, match[1], match[2], true);
    if (m === "DELETE") return setStar(request, env, match[1], match[2], false);
  }
  if ((match = p.match(new RegExp(`^/api/rooms/${ID}/forward$`))) && m === "POST") return forwardMedia(request, env, match[1]);
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
  if (!(await readSiteSettings(env)).registrationOpen) {
    throw new HttpError(403, "Sign-ups are closed right now. Ask an admin to create an account for you.");
  }
  const body = await readJson<{ username?: unknown; password?: unknown; displayName?: unknown }>(request);

  const username = validUsername(body.username);
  const password = validPassword(body.password, username);
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

  const { token, maxAge } = await createSession(env, id, { device: describeDevice(request), location: describeLocation(request) });
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

  // With two-step verification on, this returns a challenge and the session is only created after the code.
  return startLogin(env, request, row.id);
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
  const me = await loadMe(env, (await requireUser(request, env)).id);

  const forwarded = new Request(request);
  forwarded.headers.set("X-User-Id", me.id);
  forwarded.headers.set("X-Display-Name", me.displayName);
  forwarded.headers.set("X-Hide-Presence", me.settings.lastSeen === "nobody" || me.settings.presence === "invisible" ? "1" : "0");
  forwarded.headers.set("X-Session", (await getSessionUser(request, env))!.sessionHash.slice(0, 16));
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
