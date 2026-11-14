import {
  LIMITS,
  messagePreview,
  type GalleryTab,
  type MediaKind,
  type MediaMeta,
  type MessageKind,
  type MessagePage,
  type Room,
  type User,
} from "../shared/types";
import { parseSettings, rateLimit, requireUser } from "./auth";
import { lobby, room, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { cleanFileName, mediaHeaders, parseRange, readUpload } from "./media";
import { hydrateMessages, MESSAGE_SELECT, NOT_EXPIRED, roomMemberIds, type MessageRow } from "./messages";

const PAGE_SIZE = 50;
const TEN_MIN = 10 * 60 * 1000;

interface RoomRow {
  status: "pending" | "accepted";
  requested_by: string | null;
  i_blocked: number;
  blocked_me: number;
  my_role: "member" | "admin";
  member_count: number;
  disappear_ms: number | null;
  dm_key: string | null;
  pinned_at: number | null;
  archived: number;
  muted_until: number | null;
  id: string;
  type: "dm" | "group";
  name: string | null;
  created_at: number;
  peer_id: string | null;
  peer_username: string | null;
  peer_display_name: string | null;
  peer_avatar_version: number | null;
  peer_settings: string | null;
  last_kind: MessageKind | null;
  last_body: string | null;
  last_meta: string | null;
  last_deleted_at: number | null;
  last_at: number | null;
  last_user_id: string | null;
  unread: number;
  mentions: number;
  admins_only: number;
  slow_mode_ms: number;
  invite_code: string | null;
  peer_status: string | null;
  room_avatar: number | null;
}

export async function listRooms(env: Env, userId: string, onlyRoomId?: string): Promise<Room[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.type, r.name, r.created_at, r.status, r.requested_by, r.disappear_ms, r.dm_key, m.role AS my_role,
            m.pinned_at, m.archived, m.muted_until, r.admins_only, r.slow_mode_ms, r.invite_code, r.avatar_version AS room_avatar,
            pu.status_text AS peer_status,
            (SELECT COUNT(*) FROM messages x
              WHERE r.type = 'group' AND x.room_id = r.id AND x.created_at > m.last_read_at
                AND x.user_id != m.user_id AND x.deleted_at IS NULL
                AND (x.body LIKE '%@' || (SELECT username FROM users WHERE id = m.user_id) || '%'
                     OR EXISTS (SELECT 1 FROM messages y WHERE y.id = x.reply_to_id AND y.user_id = m.user_id))) AS mentions,
            (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count,
            pu.id AS peer_id, pu.username AS peer_username, pu.display_name AS peer_display_name,
            pu.avatar_version AS peer_avatar_version, pu.settings AS peer_settings,
            lm.kind AS last_kind, lm.body AS last_body, lm.meta AS last_meta, lm.deleted_at AS last_deleted_at,
            lm.created_at AS last_at, lm.user_id AS last_user_id,
            (SELECT COUNT(*) FROM messages x
              WHERE x.room_id = r.id AND x.created_at > m.last_read_at
                AND x.user_id != m.user_id AND x.deleted_at IS NULL
                AND (x.expires_at IS NULL OR x.expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)) AS unread,
            EXISTS (SELECT 1 FROM blocks WHERE blocker_id = m.user_id AND blocked_id = pu.id) AS i_blocked,
            EXISTS (SELECT 1 FROM blocks WHERE blocker_id = pu.id AND blocked_id = m.user_id) AS blocked_me
       FROM room_members m
       JOIN rooms r ON r.id = m.room_id
       LEFT JOIN users pu ON r.type = 'dm' AND pu.id =
            (SELECT user_id FROM room_members WHERE room_id = r.id AND user_id != m.user_id LIMIT 1)
       LEFT JOIN messages lm ON lm.id =
            (SELECT id FROM messages
              WHERE room_id = r.id AND (expires_at IS NULL OR expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)
              ORDER BY created_at DESC, id DESC LIMIT 1)
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
      status: r.status,
      requestedBy: r.requested_by,
      blocked: r.i_blocked === 1,
      blockedMe: r.blocked_me === 1,
      role: r.my_role === "admin" ? "admin" : "member",
      memberCount: r.member_count,
      disappearMs: r.disappear_ms ?? null,
      secret: !!r.dm_key?.startsWith("secret:"),
      saved: !!r.dm_key?.startsWith("saved:"),
      pinned: r.pinned_at !== null,
      archived: r.archived === 1,
      mutedUntil: r.muted_until ?? null,
      unreadCount: r.unread,
      mentions: r.mentions,
      avatarVersion: r.room_avatar ?? null,
      adminsOnly: r.admins_only === 1,
      slowModeMs: r.slow_mode_ms ?? 0,
      // Only group admins get the invite link.
      inviteCode: r.my_role === "admin" ? r.invite_code : null,
      peer: r.peer_id
        ? {
            id: r.peer_id,
            username: r.peer_username!,
            displayName: r.peer_display_name!,
            avatarVersion: r.peer_avatar_version,
            bubbleColor: parseSettings(r.peer_settings).bubbleColor,
            statusText: r.peer_status ?? "",
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

  const block = await blockState(env, me.id, other.id);
  if (block.iBlocked) throw new HttpError(403, "You've blocked this person. Unblock them to start a chat.");
  if (block.blockedMe) throw new HttpError(403, "You can't start a chat with this person.");

  const dmKey = [me.id, other.id].sort().join(":");
  const existing = await env.DB.prepare("SELECT id, status, requested_by FROM rooms WHERE dm_key = ?1")
    .bind(dmKey)
    .first<{ id: string; status: string; requested_by: string | null }>();
  if (existing) {
    // They already sent you a request and you're asking to chat with them: that's a yes.
    if (existing.status === "pending" && existing.requested_by && existing.requested_by !== me.id) {
      await markAccepted(env, existing.id, me.id, existing.requested_by);
    }
    const [room] = await listRooms(env, me.id, existing.id);
    return json({ room });
  }

  // A brand-new conversation starts as a message request: no messages, calls or
  // online status until the other person accepts.
  await rateLimit(env, `requests:${me.id}`, 20, 60 * 60 * 1000);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO rooms (id, type, dm_key, created_at, status, requested_by) VALUES (?1, 'dm', ?2, ?3, 'pending', ?4)",
  )
    .bind(crypto.randomUUID(), dmKey, now, me.id)
    .run();
  const dm = await env.DB.prepare("SELECT id FROM rooms WHERE dm_key = ?1").bind(dmKey).first<{ id: string }>();
  if (!dm) throw new Error("DM room missing after insert");

  const addMember = env.DB.prepare(
    "INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?1, ?2, ?3)",
  );
  await env.DB.batch([addMember.bind(dm.id, me.id, now), addMember.bind(dm.id, other.id, now)]);
  await lobby(env).notify([other.id], { type: "rooms-changed" });

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

/**
 * History, in one of four modes:
 *  - latest page (default)
 *  - ?before=<ts>&beforeId=  older page (scrolling up)
 *  - ?after=<ts>&afterId=    newer page (scrolling down after a jump)
 *  - ?around=<messageId>     a window centred on one message (search results, reply jumps)
 */
export async function getMessages(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const sp = url.searchParams;
  const db = env.DB;

  const older = (ts: number | null, id: string, limit: number) =>
    db
      .prepare(
        `${MESSAGE_SELECT}
          WHERE m.room_id = ?1 AND ${NOT_EXPIRED} AND (?2 IS NULL OR (m.created_at, m.id) < (?2, ?3))
          ORDER BY m.created_at DESC, m.id DESC LIMIT ?4`,
      )
      .bind(roomId, ts, id, limit);
  const newer = (ts: number, id: string, inclusive: boolean, limit: number) =>
    db
      .prepare(
        `${MESSAGE_SELECT}
          WHERE m.room_id = ?1 AND ${NOT_EXPIRED} AND (m.created_at, m.id) ${inclusive ? ">=" : ">"} (?2, ?3)
          ORDER BY m.created_at ASC, m.id ASC LIMIT ?4`,
      )
      .bind(roomId, ts, id, limit);
  const reads = db.prepare("SELECT user_id, last_read_at FROM room_members WHERE room_id = ?1").bind(roomId);

  let rows: MessageRow[];
  let hasMore = false;
  let hasNewer = false;
  let readRows: { user_id: string; last_read_at: number }[];
  const around = sp.get("around");
  const after = Number(sp.get("after")) || null;

  if (around) {
    const target = await db
      .prepare("SELECT created_at FROM messages WHERE id = ?1 AND room_id = ?2")
      .bind(around, roomId)
      .first<{ created_at: number }>();
    if (!target) throw new HttpError(404, "Message not found.");
    const half = PAGE_SIZE / 2;
    const [before, from, r] = await db.batch<MessageRow & { user_id: string; last_read_at: number }>([
      older(target.created_at, around, half + 1),
      newer(target.created_at, around, true, half + 1),
      reads,
    ]);
    hasMore = before.results.length > half;
    hasNewer = from.results.length > half;
    rows = [...before.results.slice(0, half).reverse(), ...from.results.slice(0, half)];
    readRows = r.results;
  } else if (after) {
    const [page, r] = await db.batch<MessageRow & { user_id: string; last_read_at: number }>([
      newer(after, sp.get("afterId") ?? "", false, PAGE_SIZE + 1),
      reads,
    ]);
    hasNewer = page.results.length > PAGE_SIZE;
    rows = page.results.slice(0, PAGE_SIZE);
    readRows = r.results;
  } else {
    const [page, r] = await db.batch<MessageRow & { user_id: string; last_read_at: number }>([
      older(Number(sp.get("before")) || null, sp.get("beforeId") ?? "", PAGE_SIZE + 1),
      reads,
    ]);
    hasMore = page.results.length > PAGE_SIZE;
    rows = page.results.slice(0, PAGE_SIZE).reverse();
    readRows = r.results;
  }

  const messages = await hydrateMessages(db, rows);
  const readState = Object.fromEntries(readRows.map((r) => [r.user_id, r.last_read_at]));
  return json({ messages, hasMore, hasNewer, readState } satisfies MessagePage);
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const NOT_VIEW_ONCE = "COALESCE(json_extract(m.meta, '$.viewOnce'), 0) != 1";

/** Full-text-ish search inside one conversation: message text, captions and document names. */
export async function searchMessages(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return json({ messages: [] });

  const { results } = await env.DB.prepare(
    `${MESSAGE_SELECT}
      WHERE m.room_id = ?1 AND m.deleted_at IS NULL AND ${NOT_EXPIRED} AND (
        (m.kind IN ('text', 'image', 'video') AND m.body LIKE ?2 ESCAPE '\\' AND ${NOT_VIEW_ONCE})
        OR (m.kind = 'file' AND json_extract(m.meta, '$.name') LIKE ?2 ESCAPE '\\')
      )
      ORDER BY m.created_at DESC, m.id DESC LIMIT 50`,
  )
    .bind(roomId, likePattern(q))
    .all<MessageRow>();
  return json({ messages: await hydrateMessages(env.DB, results) });
}

const GALLERY_FILTERS: Record<GalleryTab, string> = {
  media: `m.kind IN ('image', 'video') AND ${NOT_VIEW_ONCE}`,
  files: "m.kind = 'file'",
  voice: "m.kind = 'voice'",
  links: "m.kind IN ('text', 'image', 'video') AND (m.body LIKE '%http://%' OR m.body LIKE '%https://%')",
};

/** "Media, links and docs" — every photo, video, document, voice note or link in a chat, newest first. */
export async function getGallery(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const tab = url.searchParams.get("tab") as GalleryTab;
  const filter = GALLERY_FILTERS[tab];
  if (!filter) throw new HttpError(400, "Unknown gallery tab.");

  const limit = 60;
  const { results } = await env.DB.prepare(
    `${MESSAGE_SELECT}
      WHERE m.room_id = ?1 AND m.deleted_at IS NULL AND ${NOT_EXPIRED} AND ${filter}
        AND (?2 IS NULL OR (m.created_at, m.id) < (?2, ?3))
      ORDER BY m.created_at DESC, m.id DESC LIMIT ?4`,
  )
    .bind(roomId, Number(url.searchParams.get("before")) || null, url.searchParams.get("beforeId") ?? "", limit + 1)
    .all<MessageRow>();
  return json({
    messages: await hydrateMessages(env.DB, results.slice(0, limit)),
    hasMore: results.length > limit,
  });
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

const MEDIA_KINDS: MediaKind[] = ["image", "voice", "video", "file"];

/** Step 1 of sending a photo / video / voice note / document: upload the bytes, get an id back. */
export async function uploadMedia(request: Request, env: Env, url: URL, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  await assertAccepted(env, roomId);
  if (await roomHasBlock(env, roomId, me.id)) throw new HttpError(403, "You can't send messages in this chat.");
  // Secret chats are text-only: a file uploaded here would sit on the server unencrypted.
  const kind0 = await env.DB.prepare("SELECT dm_key FROM rooms WHERE id = ?1").bind(roomId).first<{ dm_key: string | null }>();
  if (kind0?.dm_key?.startsWith("secret:")) throw new HttpError(403, "Secret chats are text-only.");
  await rateLimit(env, `upload:${me.id}`, 60, TEN_MIN);

  const kind = url.searchParams.get("kind") as MediaKind;
  if (!MEDIA_KINDS.includes(kind)) throw new HttpError(400, "Unknown upload type.");
  const name = kind === "file" ? cleanFileName(url.searchParams.get("name")) : undefined;
  const { bytes, mime } = await readUpload(request, kind, LIMITS.uploadMaxBytes[kind], name);
  const mediaId = await room(env, roomId).putMedia(me.id, mime, bytes, name);
  return json({ mediaId }, 201);
}

/**
 * Serves a message's photo / video / voice note / document, with byte-range
 * support. Documents always download (never open in the page). View-once
 * photos can be opened exactly once by each recipient (never by the sender),
 * and are destroyed after everyone has opened them.
 */
export async function getMediaFile(env: Env, request: Request, roomId: string, messageId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);

  const msg = await env.DB.prepare(
    "SELECT user_id, kind, media_id, meta, deleted_at FROM messages WHERE id = ?1 AND room_id = ?2",
  )
    .bind(messageId, roomId)
    .first<{ user_id: string; kind: MessageKind; media_id: string | null; meta: string | null; deleted_at: number | null }>();
  if (!msg || msg.deleted_at !== null || !msg.media_id) throw new HttpError(404, "File not found.");

  const viewOnce = (JSON.parse(msg.meta ?? "{}") as MediaMeta).viewOnce === true;
  const stub = room(env, roomId);

  if (!viewOnce) {
    const info = await stub.mediaInfo(msg.media_id);
    if (!info) throw new HttpError(404, "File not found.");
    const download = msg.kind === "file" ? (info.name ?? "file") : undefined;
    const headers = mediaHeaders(info.mime, "immutable", download);
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

  const file = await stub.getMedia(msg.media_id);
  if (msg.user_id === me.id) throw new HttpError(403, "View-once media can only be opened by the recipient.");
  if (!file) throw new HttpError(410, "This has already been opened.");

  // Atomic: only the first request per person succeeds.
  const claimed = await env.DB.prepare(
    `INSERT INTO media_views (message_id, user_id, viewed_at) VALUES (?1, ?2, ?3)
     ON CONFLICT DO NOTHING RETURNING user_id`,
  )
    .bind(messageId, me.id, Date.now())
    .first();
  if (!claimed) throw new HttpError(410, "You've already opened this.");

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

/** The person who received a message request accepts it. */
export async function acceptRequest(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const row = await env.DB.prepare("SELECT status, requested_by, dm_key FROM rooms WHERE id = ?1")
    .bind(roomId)
    .first<{ status: string; requested_by: string | null; dm_key: string | null }>();
  if (!row) throw new HttpError(404, "Chat not found.");
  // Secret chats are accepted with this device's encryption key (see secret.ts).
  if (row.dm_key?.startsWith("secret:")) throw new HttpError(400, "Open the secret chat to accept it on this device.");
  if (row.status === "pending") {
    if (row.requested_by === me.id) throw new HttpError(400, "Waiting for them to accept your request.");
    await markAccepted(env, roomId, me.id, row.requested_by);
  }
  const [result] = await listRooms(env, me.id, roomId);
  if (!result) throw new HttpError(404, "This request was cancelled.");
  return json({ room: result });
}

/** Turns a request into a normal chat and tells the requester (and both sides' online status). */
export async function markAccepted(env: Env, roomId: string, accepterId: string, requesterId: string | null): Promise<void> {
  await env.DB.prepare("UPDATE rooms SET status = 'accepted' WHERE id = ?1").bind(roomId).run();
  await room(env, roomId).setAccepted();
  if (requesterId) {
    const hub = lobby(env);
    await hub.notify([requesterId], { type: "rooms-changed" });
    await hub.introduce(accepterId, requesterId);
  }
}

/** Declining (or cancelling your own request) removes the conversation for both people. */
export async function declineRequest(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const row = await env.DB.prepare("SELECT status FROM rooms WHERE id = ?1").bind(roomId).first<{ status: string }>();
  if (!row) throw new HttpError(404, "Chat not found.");
  if (row.status !== "pending") throw new HttpError(400, "This conversation was already accepted.");
  const members = await roomMemberIds(env.DB, roomId);
  await env.DB.prepare("DELETE FROM rooms WHERE id = ?1").bind(roomId).run();
  await lobby(env).notify(members, { type: "rooms-changed" });
  return json({ ok: true });
}

/** Throws unless the conversation has been accepted (used for uploads; the room checks sends itself). */
export async function assertAccepted(env: Env, roomId: string): Promise<void> {
  const row = await env.DB.prepare("SELECT status FROM rooms WHERE id = ?1").bind(roomId).first<{ status: string }>();
  if (row?.status !== "accepted") throw new HttpError(403, "You can send messages once your request is accepted.");
}

// ---------- Blocking ----------

/** Whether a block exists in each direction between two people. */
export async function blockState(env: Env, meId: string, otherId: string): Promise<{ iBlocked: boolean; blockedMe: boolean }> {
  const { results } = await env.DB.prepare(
    "SELECT blocker_id FROM blocks WHERE (blocker_id = ?1 AND blocked_id = ?2) OR (blocker_id = ?2 AND blocked_id = ?1)",
  )
    .bind(meId, otherId)
    .all<{ blocker_id: string }>();
  return {
    iBlocked: results.some((r) => r.blocker_id === meId),
    blockedMe: results.some((r) => r.blocker_id === otherId),
  };
}

/** True if the given user is blocked by, or is blocking, anyone they share this room with. */
export async function roomHasBlock(env: Env, roomId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM room_members other
       JOIN rooms r ON r.id = other.room_id AND r.type = 'dm'
       JOIN blocks b ON (b.blocker_id = other.user_id AND b.blocked_id = ?2)
                     OR (b.blocker_id = ?2 AND b.blocked_id = other.user_id)
      WHERE other.room_id = ?1 AND other.user_id != ?2 LIMIT 1`,
  )
    .bind(roomId, userId)
    .first();
  return !!row;
}

export async function blockUser(request: Request, env: Env, targetId: string): Promise<Response> {
  const me = await requireUser(request, env);
  if (targetId === me.id) throw new HttpError(400, "You can't block yourself.");
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?1").bind(targetId).first<{ id: string }>();
  if (!target) throw new HttpError(404, "User not found.");
  await env.DB.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?1, ?2, ?3)")
    .bind(me.id, targetId, Date.now())
    .run();
  // Refresh both sidebars; they stop seeing each other's presence.
  await lobby(env).notify([me.id, targetId], { type: "rooms-changed" });
  return json({ ok: true });
}

export async function unblockUser(request: Request, env: Env, targetId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await env.DB.prepare("DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2").bind(me.id, targetId).run();
  await lobby(env).notify([me.id, targetId], { type: "rooms-changed" });
  return json({ ok: true });
}

export async function listBlocked(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_version, b.created_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ?1 ORDER BY b.created_at DESC`,
  )
    .bind(me.id)
    .all<{ id: string; username: string; display_name: string; avatar_version: number | null; created_at: number }>();
  return json({
    blocked: results.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      avatarVersion: r.avatar_version,
      blockedAt: r.created_at,
    })),
  });
}
