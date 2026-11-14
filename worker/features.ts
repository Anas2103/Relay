import {
  LIMITS,
  type GroupMember,
  type LinkPreview,
  type MediaMeta,
  type MessageKind,
  type SiteSettings,
  DISAPPEAR_OPTIONS,
  isEncrypted,
  SLOW_MODE_OPTIONS,
  type InvitePreview,
} from "../shared/types";
import { rateLimit, requireUser, verifyPassword } from "./auth";
import { lobby, room, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { hydrateMessages, MESSAGE_SELECT, NOT_EXPIRED, roomMemberIds, type MessageRow } from "./messages";
import { assertAccepted, assertMember, listRooms, roomHasBlock } from "./rooms";
import { removeAccount } from "./admin";

const MAX_GROUP_MEMBERS = 50;
const TEN_MIN = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** Ids from `ids` that are the user's accepted, unblocked 1:1 contacts. Groups can only be built from friends. */
async function friendsAmong(env: Env, meId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map((_, i) => `?${i + 2}`).join(",");
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT other.user_id AS id
       FROM room_members me
       JOIN rooms r ON r.id = me.room_id AND r.type = 'dm' AND r.status = 'accepted'
       JOIN room_members other ON other.room_id = me.room_id AND other.user_id != me.user_id
      WHERE me.user_id = ?1 AND other.user_id IN (${placeholders})
        AND NOT EXISTS (SELECT 1 FROM blocks b
           WHERE (b.blocker_id = ?1 AND b.blocked_id = other.user_id) OR (b.blocker_id = other.user_id AND b.blocked_id = ?1))`,
  )
    .bind(meId, ...ids)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

function cleanIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)))].slice(0, max);
}

function cleanGroupName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new HttpError(400, "Give the group a name.");
  if (name.length > LIMITS.groupNameMax) throw new HttpError(400, `Group names can be at most ${LIMITS.groupNameMax} characters.`);
  return name;
}

export async function createGroup(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `groups:${me.id}`, 10, 60 * 60 * 1000);
  const body = await readJson<{ name?: unknown; memberIds?: unknown }>(request);
  const name = cleanGroupName(body.name);
  const wanted = cleanIds(body.memberIds, MAX_GROUP_MEMBERS - 1).filter((id) => id !== me.id);
  if (wanted.length === 0) throw new HttpError(400, "Pick at least one friend to add.");
  const members = await friendsAmong(env, me.id, wanted);
  if (members.length !== wanted.length) throw new HttpError(400, "You can only add friends who accepted your friend request.");

  const id = crypto.randomUUID();
  const now = Date.now();
  const add = env.DB.prepare("INSERT INTO room_members (room_id, user_id, joined_at, role) VALUES (?1, ?2, ?3, ?4)");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rooms (id, type, name, created_at, status, created_by) VALUES (?1, 'group', ?2, ?3, 'accepted', ?4)",
    ).bind(id, name, now, me.id),
    add.bind(id, me.id, now, "admin"),
    ...members.map((m) => add.bind(id, m, now, "member")),
  ]);
  await lobby(env).notify(members, { type: "rooms-changed" });
  const [result] = await listRooms(env, me.id, id);
  return json({ room: result }, 201);
}

async function memberRole(env: Env, roomId: string, userId: string): Promise<{ role: string; type: string } | null> {
  return env.DB.prepare(
    "SELECT m.role, r.type FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.room_id = ?1 AND m.user_id = ?2",
  )
    .bind(roomId, userId)
    .first<{ role: string; type: string }>();
}

// ---------------------------------------------------------------------------
// Invite links (like Telegram's t.me/+… links)
// ---------------------------------------------------------------------------

const INVITE_RE = /^[A-Za-z0-9]{12}$/;

function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => alphabet[b % alphabet.length]).join("");
}

/** Admins create (or replace, which breaks the old link) or turn off the group's invite link. */
export async function setInvite(request: Request, env: Env, roomId: string, on: boolean): Promise<Response> {
  const me = await requireUser(request, env);
  const mine = await memberRole(env, roomId, me.id);
  if (!mine) throw new HttpError(404, "Chat not found.");
  if (mine.type !== "group" || mine.role !== "admin") throw new HttpError(403, "Only group admins can manage invite links.");
  await rateLimit(env, `invite:${me.id}`, 30, 60 * 60 * 1000);
  await env.DB.prepare("UPDATE rooms SET invite_code = ?1 WHERE id = ?2").bind(on ? newInviteCode() : null, roomId).run();
  const [result] = await listRooms(env, me.id, roomId);
  return json({ room: result });
}

async function findInvite(env: Env, code: string) {
  if (!INVITE_RE.test(code)) throw new HttpError(404, "This invite link is invalid or was reset.");
  const row = await env.DB.prepare(
    "SELECT id, name, (SELECT COUNT(*) FROM room_members WHERE room_id = rooms.id) AS members FROM rooms WHERE invite_code = ?1 AND type = 'group'",
  )
    .bind(code)
    .first<{ id: string; name: string; members: number }>();
  if (!row) throw new HttpError(404, "This invite link is invalid or was reset.");
  return row;
}

export async function previewInvite(request: Request, env: Env, code: string): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `invite-look:${me.id}`, 60, TEN_MIN);
  const row = await findInvite(env, code);
  const member = !!(await memberRole(env, row.id, me.id));
  const preview: InvitePreview = { code, roomId: row.id, name: row.name, memberCount: row.members, member };
  return json({ invite: preview });
}

export async function joinInvite(request: Request, env: Env, code: string): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `invite-join:${me.id}`, 20, TEN_MIN);
  const row = await findInvite(env, code);
  if (!(await memberRole(env, row.id, me.id))) {
    const banned = await env.DB.prepare("SELECT 1 FROM group_bans WHERE room_id = ?1 AND user_id = ?2").bind(row.id, me.id).first();
    if (banned) throw new HttpError(403, "You've been removed from this group and can't rejoin with a link.");
    if (row.members >= MAX_GROUP_MEMBERS) throw new HttpError(400, `This group is full (${MAX_GROUP_MEMBERS} people).`);
    const before = await roomMemberIds(env.DB, row.id);
    const now = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at, role, last_read_at) VALUES (?1, ?2, ?3, 'member', ?3)",
    )
      .bind(row.id, me.id, now)
      .run();
    await lobby(env).notify([...before, me.id], { type: "rooms-changed" });
  }
  const [result] = await listRooms(env, me.id, row.id);
  return json({ room: result });
}

export async function listMembers(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_version, m.role
       FROM room_members m JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ?1 ORDER BY m.role = 'admin' DESC, u.display_name COLLATE NOCASE`,
  )
    .bind(roomId)
    .all<{ id: string; username: string; display_name: string; avatar_version: number | null; role: "member" | "admin" }>();
  const members: GroupMember[] = results.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    avatarVersion: r.avatar_version,
    groupRole: r.role === "admin" ? "admin" : "member",
  }));
  return json({ members });
}

export async function addMembers(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  const mine = await memberRole(env, roomId, me.id);
  if (!mine) throw new HttpError(404, "Chat not found.");
  if (mine.type !== "group") throw new HttpError(400, "People can only be added to groups.");
  if (mine.role !== "admin") throw new HttpError(403, "Only group admins can add people.");
  const body = await readJson<{ userIds?: unknown }>(request);
  const wanted = cleanIds(body.userIds, MAX_GROUP_MEMBERS);
  const friends = await friendsAmong(env, me.id, wanted);
  if (friends.length !== wanted.length || wanted.length === 0) {
    throw new HttpError(400, "You can only add friends who accepted your friend request.");
  }
  const existing = new Set(await roomMemberIds(env.DB, roomId));
  const fresh = friends.filter((id) => !existing.has(id));
  if (existing.size + fresh.length > MAX_GROUP_MEMBERS) throw new HttpError(400, `Groups can have at most ${MAX_GROUP_MEMBERS} people.`);
  const now = Date.now();
  if (fresh.length) {
    // An admin adding someone back lifts their ban.
    await env.DB.batch(fresh.map((id) => env.DB.prepare("DELETE FROM group_bans WHERE room_id = ?1 AND user_id = ?2").bind(roomId, id)));
    await env.DB.batch(
      fresh.map((id) =>
        env.DB.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at, role, last_read_at) VALUES (?1, ?2, ?3, 'member', ?3)").bind(
          roomId,
          id,
          now,
        ),
      ),
    );
  }
  await lobby(env).notify([...existing, ...fresh], { type: "rooms-changed" });
  return json({ added: fresh.length });
}

/** Admins remove someone; anyone can remove themselves (= leave). */
export async function removeMember(request: Request, env: Env, roomId: string, userId: string, ban = false): Promise<Response> {
  const me = await requireUser(request, env);
  const mine = await memberRole(env, roomId, me.id);
  if (!mine) throw new HttpError(404, "Chat not found.");
  if (mine.type !== "group") throw new HttpError(400, "You can only leave groups.");
  const leaving = userId === me.id;
  if (!leaving && mine.role !== "admin") throw new HttpError(403, "Only group admins can remove people.");
  const target = await memberRole(env, roomId, userId);
  if (!target) throw new HttpError(404, "That person isn't in this group.");

  const before = await roomMemberIds(env.DB, roomId);
  await env.DB.prepare("DELETE FROM room_members WHERE room_id = ?1 AND user_id = ?2").bind(roomId, userId).run();
  // Removed and banned: invite links won't let them back in.
  if (ban && !leaving) {
    await env.DB.prepare("INSERT OR IGNORE INTO group_bans (room_id, user_id, banned_by, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(roomId, userId, me.id, Date.now())
      .run();
  }
  // Keep at least one admin; delete the group once it's empty.
  await env.DB.prepare(
    `UPDATE room_members SET role = 'admin'
      WHERE room_id = ?1 AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_id = ?1 AND role = 'admin')
        AND user_id = (SELECT user_id FROM room_members WHERE room_id = ?1 ORDER BY joined_at ASC LIMIT 1)`,
  )
    .bind(roomId)
    .run();
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?1").bind(roomId).first<{ n: number }>();
  const stub = room(env, roomId);
  await stub.removeMember(userId);
  if (!left?.n) {
    await env.DB.prepare("DELETE FROM rooms WHERE id = ?1").bind(roomId).run();
    await stub.wipeMedia();
  }
  await lobby(env).notify(before, { type: "rooms-changed" });
  return json({ ok: true });
}

/** Admins make someone an admin (or step them down). */
export async function setMemberRole(request: Request, env: Env, roomId: string, userId: string): Promise<Response> {
  const me = await requireUser(request, env);
  const mine = await memberRole(env, roomId, me.id);
  if (!mine || mine.type !== "group") throw new HttpError(404, "Chat not found.");
  if (mine.role !== "admin") throw new HttpError(403, "Only group admins can do that.");
  const body = await readJson<{ role?: unknown }>(request);
  const role = body.role === "admin" ? "admin" : "member";
  if (userId === me.id && role === "member") {
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?1 AND role = 'admin'")
      .bind(roomId)
      .first<{ n: number }>();
    if ((admins?.n ?? 0) <= 1) throw new HttpError(400, "A group needs at least one admin.");
  }
  const res = await env.DB.prepare("UPDATE room_members SET role = ?1 WHERE room_id = ?2 AND user_id = ?3").bind(role, roomId, userId).run();
  if (!res.meta.changes) throw new HttpError(404, "That person isn't in this group.");
  await lobby(env).notify(await roomMemberIds(env.DB, roomId), { type: "rooms-changed" });
  return json({ ok: true });
}

/** Rename a group (admins) or set the disappearing-messages timer (anyone in a 1:1, admins in a group). */
export async function updateRoom(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  const mine = await memberRole(env, roomId, me.id);
  if (!mine) throw new HttpError(404, "Chat not found.");
  const isAdmin = mine.type === "dm" || mine.role === "admin";
  const body = await readJson<{ name?: unknown; disappearMs?: unknown; adminsOnly?: unknown; slowModeMs?: unknown }>(request);
  if (body.adminsOnly !== undefined || body.slowModeMs !== undefined) {
    if (mine.type !== "group" || mine.role !== "admin") throw new HttpError(403, "Only group admins can change this.");
    if (body.adminsOnly !== undefined) {
      await env.DB.prepare("UPDATE rooms SET admins_only = ?1 WHERE id = ?2").bind(body.adminsOnly === true ? 1 : 0, roomId).run();
    }
    if (body.slowModeMs !== undefined) {
      const ms = Number(body.slowModeMs);
      if (!SLOW_MODE_OPTIONS.some((o) => o.ms === ms)) throw new HttpError(400, "Unknown slow mode.");
      await env.DB.prepare("UPDATE rooms SET slow_mode_ms = ?1 WHERE id = ?2").bind(ms, roomId).run();
    }
  }
  if (body.name !== undefined) {
    if (mine.type !== "group") throw new HttpError(400, "Only groups have a name.");
    if (mine.role !== "admin") throw new HttpError(403, "Only group admins can rename the group.");
    await env.DB.prepare("UPDATE rooms SET name = ?1 WHERE id = ?2").bind(cleanGroupName(body.name), roomId).run();
  }
  if (body.disappearMs !== undefined) {
    if (!isAdmin) throw new HttpError(403, "Only group admins can change this.");
    const ms = body.disappearMs === null ? null : Number(body.disappearMs);
    if (!DISAPPEAR_OPTIONS.some((o) => o.ms === ms)) throw new HttpError(400, "Unknown timer.");
    await assertAccepted(env, roomId);
    await env.DB.prepare("UPDATE rooms SET disappear_ms = ?1 WHERE id = ?2").bind(ms, roomId).run();
  }
  await lobby(env).notify(await roomMemberIds(env.DB, roomId), { type: "rooms-changed" });
  const [result] = await listRooms(env, me.id, roomId);
  return json({ room: result });
}

// ---------------------------------------------------------------------------
// Pinned & starred
// ---------------------------------------------------------------------------

export async function listPinned(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const { results } = await env.DB.prepare(
    `${MESSAGE_SELECT} WHERE m.room_id = ?1 AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL AND ${NOT_EXPIRED}
      ORDER BY m.pinned_at DESC LIMIT 3`,
  )
    .bind(roomId)
    .all<MessageRow>();
  return json({ messages: await hydrateMessages(env.DB, results) });
}

export async function listStarred(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const { results } = await env.DB.prepare(
    `${MESSAGE_SELECT} JOIN starred s ON s.message_id = m.id AND s.user_id = ?2
      WHERE m.room_id = ?1 AND m.deleted_at IS NULL AND ${NOT_EXPIRED}
      ORDER BY s.created_at DESC LIMIT 200`,
  )
    .bind(roomId, me.id)
    .all<MessageRow>();
  return json({ messages: await hydrateMessages(env.DB, results) });
}

export async function setStar(request: Request, env: Env, roomId: string, messageId: string, starred: boolean): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const msg = await env.DB.prepare("SELECT 1 FROM messages WHERE id = ?1 AND room_id = ?2 AND deleted_at IS NULL")
    .bind(messageId, roomId)
    .first();
  if (!msg) throw new HttpError(404, "Message not found.");
  if (starred) {
    await env.DB.prepare("INSERT OR IGNORE INTO starred (user_id, message_id, created_at) VALUES (?1, ?2, ?3)")
      .bind(me.id, messageId, Date.now())
      .run();
  } else {
    await env.DB.prepare("DELETE FROM starred WHERE user_id = ?1 AND message_id = ?2").bind(me.id, messageId).run();
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Forwarding
// ---------------------------------------------------------------------------

/**
 * Copies a photo / video / voice note / document into another chat so it can be
 * forwarded. Returns the new upload id plus what the client should send with it.
 * View-once media can never be forwarded.
 */
export async function forwardMedia(request: Request, env: Env, targetRoomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `forward:${me.id}`, 60, TEN_MIN);
  const body = await readJson<{ fromRoomId?: unknown; messageId?: unknown }>(request);
  const fromRoomId = typeof body.fromRoomId === "string" ? body.fromRoomId : "";
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  await assertMember(env, fromRoomId, me.id);
  await assertMember(env, targetRoomId, me.id);
  await assertAccepted(env, targetRoomId);
  if (await roomHasBlock(env, targetRoomId, me.id)) throw new HttpError(403, "You can't send messages in this chat.");

  const msg = await env.DB.prepare(
    `SELECT kind, body, media_id, meta, deleted_at FROM messages m
      WHERE id = ?1 AND room_id = ?2 AND ${NOT_EXPIRED}`,
  )
    .bind(messageId, fromRoomId)
    .first<{ kind: MessageKind; body: string; media_id: string | null; meta: string | null; deleted_at: number | null }>();
  if (!msg || msg.deleted_at !== null || !msg.media_id) throw new HttpError(404, "That message can't be forwarded.");
  const meta = (msg.meta ? JSON.parse(msg.meta) : {}) as MediaMeta;
  if (meta.viewOnce) throw new HttpError(403, "View-once media can't be forwarded.");

  const file = await room(env, fromRoomId).getMedia(msg.media_id);
  if (!file) throw new HttpError(404, "That file is no longer available.");
  const mediaId = await room(env, targetRoomId).putMedia(me.id, file.mime, new Uint8Array(file.data), file.name ?? undefined);
  return json({
    mediaId,
    kind: msg.kind,
    body: msg.body,
    meta: { width: meta.width, height: meta.height, duration: meta.duration, waveform: meta.waveform, forwarded: true },
  });
}

// ---------------------------------------------------------------------------
// Link previews
// ---------------------------------------------------------------------------

const PREVIEW_TTL = 24 * 60 * 60 * 1000;
const PREVIEW_MAX_BYTES = 256 * 1024;

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function metaContent(html: string, keys: string[]): string {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i",
    );
    const m = html.match(re);
    const v = m?.[1] ?? m?.[2];
    if (v && v.trim()) return decodeEntities(v.trim());
  }
  return "";
}

/** Only plain http(s) URLs on public host names. */
function safeUrl(raw: string): URL | null {
  if (raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  // No IP addresses (keeps previews to real websites).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  url.hash = "";
  return url;
}

export async function linkPreview(request: Request, env: Env, reqUrl: URL): Promise<Response> {
  const me = await requireUser(request, env);
  const url = safeUrl(reqUrl.searchParams.get("url") ?? "");
  if (!url) throw new HttpError(400, "Not a link we can preview.");
  const key = url.toString();

  const cached = await env.DB.prepare("SELECT data, fetched_at FROM link_previews WHERE url = ?1")
    .bind(key)
    .first<{ data: string; fetched_at: number }>();
  if (cached && Date.now() - cached.fetched_at < PREVIEW_TTL) {
    return json({ preview: JSON.parse(cached.data) as LinkPreview | null }, 200, { "Cache-Control": "private, max-age=3600" });
  }
  await rateLimit(env, `preview:${me.id}`, 60, TEN_MIN);

  let preview: LinkPreview | null = null;
  try {
    const res = await fetch(key, {
      headers: { "User-Agent": "RelayLinkPreview/1.0 (+link previews)", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    const type = res.headers.get("Content-Type") ?? "";
    if (res.ok && res.body && type.includes("html")) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < PREVIEW_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
      await reader.cancel().catch(() => {});
      const html = new TextDecoder().decode(
        chunks.reduce((acc, c) => {
          const out = new Uint8Array(acc.byteLength + c.byteLength);
          out.set(acc);
          out.set(c, acc.byteLength);
          return out;
        }, new Uint8Array()),
      );
      const title = metaContent(html, ["og:title", "twitter:title"]) || decodeEntities(html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim() ?? "");
      const description = metaContent(html, ["og:description", "twitter:description", "description"]);
      const siteName = metaContent(html, ["og:site_name"]) || url.hostname.replace(/^www\./, "");
      if (title) {
        preview = {
          url: key,
          title: title.slice(0, 200),
          description: description.slice(0, 300),
          siteName: siteName.slice(0, 80),
        };
      }
    }
  } catch {
    // unreachable / timed out: cache the miss so we don't retry for a while
  }
  await env.DB.prepare(
    "INSERT INTO link_previews (url, data, fetched_at) VALUES (?1, ?2, ?3) ON CONFLICT(url) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at",
  )
    .bind(key, JSON.stringify(preview), Date.now())
    .run();
  return json({ preview }, 200, { "Cache-Control": "private, max-age=3600" });
}

// ---------------------------------------------------------------------------
// Your data: export and delete
// ---------------------------------------------------------------------------

export async function exportMyData(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `export:${me.id}`, 5, 60 * 60 * 1000);
  const profile = await env.DB.prepare(
    "SELECT id, username, display_name, bio, role, created_at, last_login_at, settings FROM users WHERE id = ?1",
  )
    .bind(me.id)
    .first<Record<string, unknown>>();
  const rooms = await listRooms(env, me.id);
  const conversations = [];
  for (const r of rooms) {
    const { results } = await env.DB.prepare(
      `SELECT m.id, u.username AS sender, m.kind, m.body, m.meta, m.created_at, m.edited_at, m.deleted_at
         FROM messages m JOIN users u ON u.id = m.user_id
        WHERE m.room_id = ?1 AND ${NOT_EXPIRED} ORDER BY m.created_at ASC LIMIT 20000`,
    )
      .bind(r.id)
      .all<{ id: string; sender: string; kind: string; body: string; meta: string | null; created_at: number; edited_at: number | null; deleted_at: number | null }>();
    conversations.push({
      id: r.id,
      type: r.type,
      name: r.type === "group" ? r.name : (r.peer?.username ?? null),
      messages: results.map((m) => {
        const meta = m.meta ? (JSON.parse(m.meta) as MediaMeta) : null;
        return {
          id: m.id,
          from: m.sender,
          kind: m.kind,
          // View-once captions stay private.
          text: meta?.viewOnce ? "" : isEncrypted(m.body) ? "[end-to-end encrypted]" : m.body,
          file: meta?.name ?? null,
          sentAt: new Date(m.created_at).toISOString(),
          edited: m.edited_at !== null,
          deleted: m.deleted_at !== null,
        };
      }),
    });
  }
  const data = {
    exportedAt: new Date().toISOString(),
    profile: profile ? { ...profile, settings: JSON.parse(String(profile.settings ?? "{}")) } : null,
    conversations,
    note: "Photos, videos, voice notes and documents aren't included; open them in the app to save them.",
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="relay-export-${me.username}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function deleteMyAccount(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `delete-account:${me.id}`, 5, 15 * 60 * 1000);
  const body = await readJson<{ password?: unknown }>(request);
  const row = await env.DB.prepare("SELECT password_hash, role, super_admin FROM users WHERE id = ?1")
    .bind(me.id)
    .first<{ password_hash: string; role: string; super_admin: number }>();
  if (!row || !(await verifyPassword(typeof body.password === "string" ? body.password : "", row.password_hash))) {
    throw new HttpError(400, "Your password is incorrect.");
  }
  if (row.super_admin === 1) throw new HttpError(400, "The owner account can't be deleted.");
  if (row.role === "admin") {
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND suspended_at IS NULL").first<{ n: number }>();
    if ((admins?.n ?? 0) <= 1) throw new HttpError(400, "You're the last admin. Make someone else an admin first.");
  }
  await removeAccount(env, me.id);
  return json({ ok: true }, 200, { "Set-Cookie": "sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
}

// ---------------------------------------------------------------------------
// Site settings (owner-controlled) — read by everyone
// ---------------------------------------------------------------------------

/** Read on every request (maintenance check), so it's cached briefly per Worker instance. */
let siteCache: { at: number; value: SiteSettings } | null = null;

export async function readSiteSettings(env: Env, fresh = false): Promise<SiteSettings> {
  if (!fresh && siteCache && Date.now() - siteCache.at < 5000) return siteCache.value;
  const { results } = await env.DB.prepare("SELECT key, value FROM site_settings").all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  let announcement: SiteSettings["announcement"] = null;
  try {
    const a = JSON.parse(map.get("announcement") ?? "null");
    if (a && typeof a.text === "string" && a.text) announcement = { text: a.text, createdAt: Number(a.createdAt) || 0 };
  } catch {
    // ignore
  }
  const value: SiteSettings = {
    announcement,
    registrationOpen: map.get("registration") !== "closed",
    maintenance: map.get("maintenance") === "on",
  };
  siteCache = { at: Date.now(), value };
  return value;
}

export async function getSite(env: Env): Promise<Response> {
  return json({ site: await readSiteSettings(env) });
}

// ---------------------------------------------------------------------------
// Disappearing messages: cron cleanup
// ---------------------------------------------------------------------------

/** Deletes messages whose timer ran out (and their files), and tells open chats. Runs every few minutes. */
export async function expireMessages(env: Env): Promise<number> {
  let removed = 0;
  for (let round = 0; round < 10; round++) {
    const { results } = await env.DB.prepare(
      "SELECT id, room_id, media_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?1 LIMIT 200",
    )
      .bind(Date.now())
      .all<{ id: string; room_id: string; media_id: string | null }>();
    if (results.length === 0) break;
    const byRoom = new Map<string, { ids: string[]; media: string[] }>();
    for (const r of results) {
      const entry = byRoom.get(r.room_id) ?? { ids: [], media: [] };
      entry.ids.push(r.id);
      if (r.media_id) entry.media.push(r.media_id);
      byRoom.set(r.room_id, entry);
    }
    await env.DB.batch(results.map((r) => env.DB.prepare("DELETE FROM messages WHERE id = ?1").bind(r.id)));
    await Promise.all([...byRoom].map(([roomId, e]) => room(env, roomId).expire(e.ids, e.media).catch(() => undefined)));
    removed += results.length;
  }
  // Housekeeping
  await env.DB.batch([
    env.DB.prepare("DELETE FROM link_previews WHERE fetched_at < ?1").bind(Date.now() - 7 * PREVIEW_TTL),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(Date.now()),
  ]);
  return removed;
}

