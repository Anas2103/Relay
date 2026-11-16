import { LIMITS, type OwnerSearchHit, type OwnerStory, type OwnerUserDetail, type User } from "../shared/types";
import { audit, roomNames } from "./admin";
import type { SessionUser } from "./auth";
import { lobby, room, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { mediaHeaders } from "./media";
import { pushTo } from "./push";
import { toUser } from "./rooms";

/*
 * Owner-only powers (Grimm, the highest authority), on top of everything admins can do:
 *  - broadcast an alert to everyone, sign everyone out at once
 *  - see any account's devices and chats; sign out one device; erase everything they wrote
 *  - join any group as its admin (to moderate it from the inside)
 *  - moderate anyone's stories
 *  - search every conversation (except secret chats, which nobody can read)
 * Every call is written to the audit log.
 */

const UUID = "[0-9a-f-]{36}";
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function routeOwner(request: Request, env: Env, url: URL, owner: SessionUser): Promise<Response> {
  const p = url.pathname.slice("/api/admin/owner".length);
  const m = request.method;
  let match: RegExpMatchArray | null;

  if (p === "/broadcast" && m === "POST") return broadcast(request, env, owner);
  if (p === "/signout-all" && m === "POST") return signOutAll(env, owner);
  if (p === "/search" && m === "GET") return search(env, url, owner);
  if (p === "/stories" && m === "GET") return listStories(env);

  if ((match = p.match(new RegExp(`^/stories/(${UUID})(/media)?$`)))) {
    if (match[2] && m === "GET") return storyMedia(env, match[1]);
    if (!match[2] && m === "DELETE") return deleteStory(env, owner, match[1]);
  }
  if ((match = p.match(new RegExp(`^/users/(${UUID})$`))) && m === "GET") return userDetail(env, match[1]);
  if ((match = p.match(new RegExp(`^/users/(${UUID})/sessions/([0-9a-f]{64})$`))) && m === "DELETE") {
    return signOutDevice(env, owner, match[1], match[2]);
  }
  if ((match = p.match(new RegExp(`^/users/(${UUID})/messages$`))) && m === "DELETE") return eraseMessages(env, owner, match[1]);
  if ((match = p.match(new RegExp(`^/rooms/(${UUID})/join$`))) && m === "POST") return joinGroup(env, owner, match[1]);
  throw new HttpError(404, "Not found.");
}

async function target(env: Env, id: string): Promise<{ id: string; username: string; super_admin: number }> {
  const u = await env.DB.prepare("SELECT id, username, super_admin FROM users WHERE id = ?1").bind(id).first<{ id: string; username: string; super_admin: number }>();
  if (!u) throw new HttpError(404, "User not found.");
  return u;
}

// ---------- Everyone ----------

/** An alert on every screen right now (and a push to phones that are closed). */
async function broadcast(request: Request, env: Env, owner: User): Promise<Response> {
  const body = await readJson<{ title?: unknown; text?: unknown; push?: unknown }>(request);
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, LIMITS.announcementMax) : "";
  if (!text) throw new HttpError(400, "Write the message first.");
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE suspended_at IS NULL").all<{ id: string }>();
  const ids = results.map((r) => r.id);
  await lobby(env).notify(ids, { type: "broadcast", title: title || "Message from the owner", text, at: Date.now() });
  if (body.push === true) await pushTo(env, ids.filter((id) => id !== owner.id)).catch(() => undefined);
  await audit(env, owner, "owner.broadcast", null, `${title ? `${title}: ` : ""}${text.slice(0, 120)} (to ${ids.length} people)`);
  return json({ ok: true, sent: ids.length });
}

/** Signs out every device of every account (yours stays signed in on this device). */
async function signOutAll(env: Env, owner: SessionUser): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT DISTINCT user_id FROM sessions WHERE user_id != ?1").bind(owner.id).all<{ user_id: string }>();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id != ?1").bind(owner.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2").bind(owner.id, owner.sessionHash),
  ]);
  await lobby(env).notify(results.map((r) => r.user_id), { type: "signed-out" });
  await audit(env, owner, "owner.signout_all", null, `${results.length} accounts signed out`);
  return json({ ok: true, accounts: results.length });
}

// ---------- One account ----------

async function userDetail(env: Env, id: string): Promise<Response> {
  await target(env, id);
  const now = Date.now();
  const [sessions, rooms, stats] = await Promise.all([
    env.DB.prepare(
      "SELECT token_hash, device, location, created_at, last_active_at FROM sessions WHERE user_id = ?1 AND expires_at > ?2 ORDER BY COALESCE(last_active_at, created_at) DESC",
    )
      .bind(id, now)
      .all<{ token_hash: string; device: string | null; location: string | null; created_at: number; last_active_at: number | null }>(),
    env.DB.prepare(
      `SELECT r.id, r.type, r.name, r.dm_key,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS members,
              (SELECT COUNT(*) FROM messages WHERE room_id = r.id AND user_id = ?1) AS messages,
              (SELECT MAX(created_at) FROM messages WHERE room_id = r.id) AS last_at,
              (SELECT group_concat(u.display_name, ', ') FROM room_members om JOIN users u ON u.id = om.user_id
                WHERE om.room_id = r.id AND om.user_id != ?1) AS others
         FROM rooms r JOIN room_members me ON me.room_id = r.id AND me.user_id = ?1
        ORDER BY last_at DESC NULLS LAST LIMIT 200`,
    )
      .bind(id)
      .all<{ id: string; type: "dm" | "group"; name: string | null; dm_key: string | null; members: number; messages: number; last_at: number | null; others: string | null }>(),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM messages WHERE user_id = ?1 AND deleted_at IS NULL) AS messages,
              (SELECT COUNT(*) FROM messages WHERE user_id = ?1 AND media_id IS NOT NULL) AS media,
              (SELECT COUNT(*) FROM message_reactions WHERE user_id = ?1) AS reactions,
              (SELECT COUNT(*) FROM stories WHERE user_id = ?1 AND expires_at > ?2) AS stories,
              (SELECT COUNT(*) FROM reports WHERE target_user_id = ?1) AS reports_against,
              (SELECT COUNT(*) FROM reports WHERE reporter_id = ?1) AS reports_filed,
              (SELECT COUNT(*) FROM blocks WHERE blocked_id = ?1) AS blocked_by`,
    )
      .bind(id, now)
      .first<{ messages: number; media: number; reactions: number; stories: number; reports_against: number; reports_filed: number; blocked_by: number }>(),
  ]);
  const detail: OwnerUserDetail = {
    sessions: sessions.results.map((s) => ({ id: s.token_hash, device: s.device, location: s.location, createdAt: s.created_at, lastActiveAt: s.last_active_at })),
    rooms: rooms.results.map((r) => ({
      id: r.id,
      type: r.type,
      secret: !!r.dm_key?.startsWith("secret:"),
      title: r.type === "group" ? (r.name ?? "Group") : r.dm_key?.startsWith("saved:") ? "Saved Messages" : (r.others ?? "Chat"),
      members: r.members,
      messages: r.messages,
      lastAt: r.last_at,
    })),
    stats: {
      messages: stats?.messages ?? 0,
      media: stats?.media ?? 0,
      reactions: stats?.reactions ?? 0,
      stories: stats?.stories ?? 0,
      reportsAgainst: stats?.reports_against ?? 0,
      reportsFiled: stats?.reports_filed ?? 0,
      blockedBy: stats?.blocked_by ?? 0,
    },
  };
  return json({ detail });
}

async function signOutDevice(env: Env, owner: User, userId: string, hash: string): Promise<Response> {
  const t = await target(env, userId);
  const res = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash = ?2").bind(userId, hash).run();
  if (!res.meta.changes) throw new HttpError(404, "That device is already signed out.");
  // Close its live connections; its other devices reconnect on their own.
  await lobby(env).kick(userId).catch(() => undefined);
  await audit(env, owner, "owner.signout_device", t);
  return json({ ok: true });
}

/** Deletes every message (and file) the account ever sent, everywhere, like "delete for everyone". */
async function eraseMessages(env: Env, owner: User, userId: string): Promise<Response> {
  const t = await target(env, userId);
  if (t.super_admin === 1 && t.id !== owner.id) throw new HttpError(403, "Not allowed.");
  const { results } = await env.DB.prepare("SELECT id, room_id, media_id FROM messages WHERE user_id = ?1 AND deleted_at IS NULL")
    .bind(userId)
    .all<{ id: string; room_id: string; media_id: string | null }>();
  const deletedAt = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE messages SET deleted_at = ?1, body = '', meta = NULL, media_id = NULL, pinned_at = NULL, pinned_by = NULL WHERE user_id = ?2 AND deleted_at IS NULL",
    ).bind(deletedAt, userId),
    env.DB.prepare("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE user_id = ?1)").bind(userId),
  ]);
  // Remove their files and update open chats, room by room.
  const byRoom = new Map<string, typeof results>();
  for (const r of results) byRoom.set(r.room_id, [...(byRoom.get(r.room_id) ?? []), r]);
  for (const [roomId, msgs] of byRoom) {
    const stub = room(env, roomId);
    for (const msg of msgs) {
      if (msg.media_id) await stub.deleteMedia(msg.media_id).catch(() => undefined);
      await stub.notifyDeleted(msg.id, deletedAt).catch(() => undefined);
    }
  }
  const { results: members } = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM room_members WHERE room_id IN (SELECT room_id FROM room_members WHERE user_id = ?1)`,
  )
    .bind(userId)
    .all<{ user_id: string }>();
  if (members.length) await lobby(env).notify(members.map((r) => r.user_id), { type: "rooms-changed" });
  await audit(env, owner, "owner.erase_messages", t, `${results.length} messages in ${byRoom.size} chats`);
  return json({ ok: true, deleted: results.length });
}

// ---------- Groups ----------

/** Puts the owner in any group as an admin (or makes them admin there), to moderate from inside. */
async function joinGroup(env: Env, owner: User, roomId: string): Promise<Response> {
  const r = await env.DB.prepare("SELECT type FROM rooms WHERE id = ?1").bind(roomId).first<{ type: string }>();
  if (!r) throw new HttpError(404, "Chat not found.");
  if (r.type !== "group") throw new HttpError(400, "You can join groups. Private chats stay between their two people (you can still review them).");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM group_bans WHERE room_id = ?1 AND user_id = ?2").bind(roomId, owner.id),
    env.DB.prepare(
      `INSERT INTO room_members (room_id, user_id, joined_at, role) VALUES (?1, ?2, ?3, 'admin')
       ON CONFLICT(room_id, user_id) DO UPDATE SET role = 'admin'`,
    ).bind(roomId, owner.id, now),
  ]);
  const { results } = await env.DB.prepare("SELECT user_id FROM room_members WHERE room_id = ?1").bind(roomId).all<{ user_id: string }>();
  await lobby(env).notify(results.map((x) => x.user_id), { type: "rooms-changed" });
  await audit(env, owner, "owner.join_group", null, await roomNames(env, roomId));
  return json({ ok: true, roomId });
}

// ---------- Stories ----------

async function listStories(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.kind, s.text, s.background, s.created_at, s.expires_at,
            u.id AS user_id, u.username, u.display_name, u.avatar_version,
            (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id) AS views
       FROM stories s JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > ?1 ORDER BY s.created_at DESC LIMIT 300`,
  )
    .bind(Date.now())
    .all<{ id: string; kind: "text" | "image"; text: string; background: string | null; created_at: number; expires_at: number; user_id: string; username: string; display_name: string; avatar_version: number | null; views: number }>();
  const stories: OwnerStory[] = results.map((r) => ({
    id: r.id,
    user: toUser({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_version: r.avatar_version }),
    kind: r.kind,
    text: r.text,
    background: r.background,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    views: r.views,
  }));
  return json({ stories });
}

async function storyMedia(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT mime, data FROM stories WHERE id = ?1").bind(id).first<{ mime: string | null; data: ArrayBuffer | number[] | null }>();
  if (!row?.data || !row.mime) throw new HttpError(404, "No photo.");
  const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  return new Response(bytes, { headers: mediaHeaders(row.mime, "no-store") });
}

async function deleteStory(env: Env, owner: User, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT s.user_id, u.username FROM stories s JOIN users u ON u.id = s.user_id WHERE s.id = ?1")
    .bind(id)
    .first<{ user_id: string; username: string }>();
  if (!row) throw new HttpError(404, "Story not found.");
  await env.DB.prepare("DELETE FROM stories WHERE id = ?1").bind(id).run();
  await audit(env, owner, "owner.delete_story", { id: row.user_id, username: row.username });
  return json({ ok: true });
}

// ---------- Search everything ----------

/** Words in any conversation or group (secret chats are encrypted, so they never match). */
async function search(env: Env, url: URL, owner: User): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) throw new HttpError(400, "Type at least 2 characters.");
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.room_id, m.user_id, m.kind, m.body, m.created_at, u.username, u.display_name, r.type, r.name,
            (SELECT group_concat(x.display_name, ' & ') FROM room_members om JOIN users x ON x.id = om.user_id WHERE om.room_id = r.id) AS people
       FROM messages m JOIN users u ON u.id = m.user_id JOIN rooms r ON r.id = m.room_id
      WHERE m.deleted_at IS NULL AND m.body NOT LIKE 'e2e1.%' AND m.body LIKE ?1 ESCAPE '\\'
      ORDER BY m.created_at DESC LIMIT 100`,
  )
    .bind(like(q))
    .all<{ id: string; room_id: string; user_id: string; kind: OwnerSearchHit["kind"]; body: string; created_at: number; username: string; display_name: string; type: "dm" | "group"; name: string | null; people: string | null }>();
  const hits: OwnerSearchHit[] = results.map((r) => ({
    roomId: r.room_id,
    roomTitle: r.type === "group" ? (r.name ?? "Group") : (r.people ?? "Chat"),
    roomType: r.type,
    messageId: r.id,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    kind: r.kind,
    body: r.body.slice(0, 500),
    createdAt: r.created_at,
  }));
  await audit(env, owner, "owner.search", null, `"${q}" (${hits.length} results)`);
  return json({ hits });
}
