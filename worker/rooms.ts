import { LIMITS, messagePreview, type MediaMeta, type MessageKind, type Room, type User } from "../shared/types";
import { rateLimit, requireUser } from "./auth";
import { lobby, room, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { mediaHeaders, readUpload } from "./media";
import { hydrateMessages, MESSAGE_SELECT, roomMemberIds, type MessageRow } from "./messages";

const PAGE_SIZE = 50;
const TEN_MIN = 10 * 60 * 1000;

interface RoomRow {
  id: string;
  type: "dm" | "group";
  name: string | null;
  created_at: number;
  peer_id: string | null;
  peer_username: string | null;
  peer_display_name: string | null;
  peer_avatar_version: number | null;
  last_kind: MessageKind | null;
  last_body: string | null;
  last_meta: string | null;
  last_deleted_at: number | null;
  last_at: number | null;
  last_user_id: string | null;
  unread: number;
}

export async function listRooms(env: Env, userId: string, onlyRoomId?: string): Promise<Room[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.type, r.name, r.created_at,
            pu.id AS peer_id, pu.username AS peer_username, pu.display_name AS peer_display_name,
            pu.avatar_version AS peer_avatar_version,
            lm.kind AS last_kind, lm.body AS last_body, lm.meta AS last_meta, lm.deleted_at AS last_deleted_at,
            lm.created_at AS last_at, lm.user_id AS last_user_id,
            (SELECT COUNT(*) FROM messages x
              WHERE x.room_id = r.id AND x.created_at > m.last_read_at
                AND x.user_id != m.user_id AND x.deleted_at IS NULL) AS unread
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

  return results.map((r) => {
    let meta: MediaMeta | null = null;
    try {
      meta = r.last_meta ? JSON.parse(r.last_meta) : null;
    } catch {
      // ignore
    }
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      createdAt: r.created_at,
      unreadCount: r.unread,
      peer: r.peer_id
        ? {
            id: r.peer_id,
            username: r.peer_username!,
            displayName: r.peer_display_name!,
            avatarVersion: r.peer_avatar_version,
          }
        : null,
      lastMessage:
        r.last_at !== null
          ? {
              preview: messagePreview({
                kind: r.last_kind ?? "text",
                body: r.last_body ?? "",
                deletedAt: r.last_deleted_at,
                meta,
              }),
              createdAt: r.last_at,
              userId: r.last_user_id!,
            }
          : null,
    };
  });
}

export async function openDm(request: Request, env: Env): Promise<Response> {
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
  const dm = await env.DB.prepare("SELECT id FROM rooms WHERE dm_key = ?1").bind(dmKey).first<{ id: string }>();
  if (!dm) throw new Error("DM room missing after insert");

  const addMember = env.DB.prepare(
    "INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?1, ?2, ?3)",
  );
  await env.DB.batch([addMember.bind(dm.id, me.id, now), addMember.bind(dm.id, other.id, now)]);
  const hub = lobby(env);
  await hub.notify([other.id], { type: "rooms-changed" });
  await hub.introduce(me.id, other.id);

  const [result] = await listRooms(env, me.id, dm.id);
  return json({ room: result });
}

export async function assertMember(env: Env, roomId: string, userId: string): Promise<void> {
  const row = await env.DB.prepare("SELECT 1 FROM room_members WHERE room_id = ?1 AND user_id = ?2")
    .bind(roomId, userId)
    .first();
  // 404 rather than 403, so people can't probe which room ids exist.
  if (!row) throw new HttpError(404, "Chat not found.");
}

export async function getMessages(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);

  const before = Number(url.searchParams.get("before")) || null;
  const beforeId = url.searchParams.get("beforeId") ?? "";

  const [page, reads] = await env.DB.batch<MessageRow & { user_id: string; last_read_at: number }>([
    env.DB.prepare(
      `${MESSAGE_SELECT}
        WHERE m.room_id = ?1 AND (?2 IS NULL OR (m.created_at, m.id) < (?2, ?3))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ?4`,
    ).bind(roomId, before, beforeId, PAGE_SIZE + 1),
    env.DB.prepare("SELECT user_id, last_read_at FROM room_members WHERE room_id = ?1").bind(roomId),
  ]);

  const hasMore = page.results.length > PAGE_SIZE;
  const messages = await hydrateMessages(env.DB, page.results.slice(0, PAGE_SIZE).reverse());
  const readState = Object.fromEntries(reads.results.map((r) => [r.user_id, r.last_read_at]));
  return json({ messages, hasMore, readState });
}

export async function connectSocket(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
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
  return room(env, roomId).fetch(forwarded);
}

/** Step 1 of sending a photo / voice note: upload the bytes, get an id back. */
export async function uploadMedia(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  await rateLimit(env, `upload:${me.id}`, 40, TEN_MIN);

  const family = url.searchParams.get("kind") === "voice" ? "audio" : "image";
  const { bytes, mime } = await readUpload(request, family, LIMITS.mediaMaxBytes);
  const mediaId = await room(env, roomId).putMedia(me.id, mime, bytes);
  return json({ mediaId }, 201);
}

/**
 * Serves a message's photo / voice note. View-once photos can be opened exactly
 * once by each recipient (never by the sender), and are destroyed after
 * everyone has opened them.
 */
export async function getMediaFile(env: Env, request: Request, roomId: string, messageId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);

  const msg = await env.DB.prepare(
    "SELECT user_id, media_id, meta, deleted_at FROM messages WHERE id = ?1 AND room_id = ?2",
  )
    .bind(messageId, roomId)
    .first<{ user_id: string; media_id: string | null; meta: string | null; deleted_at: number | null }>();
  if (!msg || msg.deleted_at !== null || !msg.media_id) throw new HttpError(404, "File not found.");

  const viewOnce = (JSON.parse(msg.meta ?? "{}") as MediaMeta).viewOnce === true;
  const stub = room(env, roomId);
  const file = await stub.getMedia(msg.media_id);
  if (!viewOnce) {
    if (!file) throw new HttpError(404, "File not found.");
    return new Response(file.data, { headers: mediaHeaders(file.mime, "immutable") });
  }

  if (msg.user_id === me.id) throw new HttpError(403, "View-once photos can only be opened by the recipient.");
  if (!file) throw new HttpError(410, "This photo has already been opened.");

  // Atomic: only the first request per person succeeds.
  const claimed = await env.DB.prepare(
    `INSERT INTO media_views (message_id, user_id, viewed_at) VALUES (?1, ?2, ?3)
     ON CONFLICT DO NOTHING RETURNING user_id`,
  )
    .bind(messageId, me.id, Date.now())
    .first();
  if (!claimed) throw new HttpError(410, "You've already opened this photo.");

  // Destroy the photo once every recipient has seen it.
  const recipients = (await roomMemberIds(env.DB, roomId)).filter((id) => id !== msg.user_id);
  const viewed = await env.DB.prepare("SELECT COUNT(*) AS n FROM media_views WHERE message_id = ?1")
    .bind(messageId)
    .first<{ n: number }>();
  if ((viewed?.n ?? 0) >= recipients.length) await stub.deleteMedia(msg.media_id);
  await stub.notifyViewed(messageId, me.id);

  return new Response(file.data, { headers: mediaHeaders(file.mime, "no-store") });
}

export function toUser(r: { id: string; username: string; display_name: string; avatar_version: number | null }): User {
  return { id: r.id, username: r.username, displayName: r.display_name, avatarVersion: r.avatar_version };
}
