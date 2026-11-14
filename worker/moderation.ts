import { isEncrypted, LIMITS, REPORT_REASONS, type AdminReport, type GroupBan, type MessageKind, type ReportReason } from "../shared/types";
import { audit } from "./admin";
import { rateLimit, requireUser, type SessionUser } from "./auth";
import { lobby, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { mediaHeaders, readUpload } from "./media";
import { hydrateMessages, MESSAGE_SELECT, NOT_EXPIRED, roomMemberIds, type MessageRow } from "./messages";
import { assertMember } from "./rooms";
import { str } from "./validate";

const HOUR = 60 * 60 * 1000;

async function groupAdmin(env: Env, roomId: string, userId: string): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT m.role, r.type FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.room_id = ?1 AND m.user_id = ?2",
  )
    .bind(roomId, userId)
    .first<{ role: string; type: string }>();
  if (!row) throw new HttpError(404, "Chat not found.");
  if (row.type !== "group" || row.role !== "admin") throw new HttpError(403, "Only group admins can do that.");
}

// ---------------------------------------------------------------------------
// Search across all your chats (never secret chats: the server can't read them)
// ---------------------------------------------------------------------------

export async function searchEverywhere(request: Request, env: Env, url: URL): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `search:${me.id}`, 120, HOUR);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return json({ messages: [] });
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.DB.prepare(
    `${MESSAGE_SELECT}
       JOIN room_members mine ON mine.room_id = m.room_id AND mine.user_id = ?1
       JOIN rooms rr ON rr.id = m.room_id AND rr.status = 'accepted' AND COALESCE(rr.dm_key, '') NOT LIKE 'secret:%'
      WHERE m.deleted_at IS NULL AND ${NOT_EXPIRED}
        AND m.kind IN ('text', 'image', 'video', 'poll') AND m.body LIKE ?2 ESCAPE '\\'
        AND COALESCE(json_extract(m.meta, '$.viewOnce'), 0) != 1
      ORDER BY m.created_at DESC LIMIT 40`,
  )
    .bind(me.id, pattern)
    .all<MessageRow>();
  return json({ messages: await hydrateMessages(env.DB, results) });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Report a message (or a person). What was said is copied, so deleting it later doesn't hide it from the admins. */
export async function createReport(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  await rateLimit(env, `report:${me.id}`, 20, HOUR);
  const body = await readJson<{ reason?: unknown; details?: unknown; userId?: unknown; roomId?: unknown; messageId?: unknown; evidence?: unknown }>(request);
  const reason = str(body.reason) as ReportReason;
  if (!Object.hasOwn(REPORT_REASONS, reason)) throw new HttpError(400, "Pick a reason.");
  const details = str(body.details).trim().slice(0, LIMITS.reportDetailsMax) || null;

  let targetId = str(body.userId) || null;
  let roomId: string | null = null;
  let messageId: string | null = null;
  let snapshot: AdminReport["snapshot"] = null;

  if (body.messageId !== undefined) {
    roomId = str(body.roomId);
    await assertMember(env, roomId, me.id);
    const msg = await env.DB.prepare("SELECT id, user_id, kind, body, created_at FROM messages WHERE id = ?1 AND room_id = ?2")
      .bind(str(body.messageId), roomId)
      .first<{ id: string; user_id: string; kind: MessageKind; body: string; created_at: number }>();
    if (!msg) throw new HttpError(404, "Message not found.");
    if (msg.user_id === me.id) throw new HttpError(400, "You can't report your own message.");
    messageId = msg.id;
    targetId = msg.user_id;
    // Secret chats: the server only has ciphertext, so the reporter can choose to share what it said.
    const encrypted = isEncrypted(msg.body);
    const evidence = str(body.evidence).slice(0, LIMITS.messageMax);
    snapshot = { kind: msg.kind, body: encrypted ? evidence : msg.body.slice(0, LIMITS.messageMax), createdAt: msg.created_at, ...(encrypted ? { encrypted: true } : {}) };
  }
  if (!targetId || targetId === me.id) throw new HttpError(400, "Choose who to report.");
  // You can only report people you actually share a chat with.
  const shared = await env.DB.prepare(
    "SELECT 1 FROM room_members a JOIN room_members b ON b.room_id = a.room_id WHERE a.user_id = ?1 AND b.user_id = ?2 LIMIT 1",
  )
    .bind(me.id, targetId)
    .first();
  if (!shared) throw new HttpError(404, "User not found.");

  await env.DB.prepare(
    `INSERT INTO reports (id, reporter_id, target_user_id, room_id, message_id, reason, details, snapshot, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(crypto.randomUUID(), me.id, targetId, roomId, messageId, reason, details, snapshot ? JSON.stringify(snapshot) : null, Date.now())
    .run();
  // Admins with the app open see the new report count straight away.
  const { results: admins } = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all<{ id: string }>();
  await lobby(env).notify(admins.map((a) => a.id), { type: "site-changed" });
  return json({ ok: true }, 201);
}

export async function listReports(env: Env, url: URL): Promise<Response> {
  const status = url.searchParams.get("status") === "closed" ? "closed" : "open";
  const { results } = await env.DB.prepare(
    `SELECT r.*, ru.username AS r_username, ru.display_name AS r_name,
            tu.username AS t_username, tu.display_name AS t_name, tu.suspended_at AS t_suspended
       FROM reports r
       LEFT JOIN users ru ON ru.id = r.reporter_id
       LEFT JOIN users tu ON tu.id = r.target_user_id
      WHERE ${status === "open" ? "r.status = 'open'" : "r.status != 'open'"}
      ORDER BY r.created_at DESC LIMIT 100`,
  ).all<{
    id: string;
    reporter_id: string;
    target_user_id: string | null;
    room_id: string | null;
    reason: ReportReason;
    details: string | null;
    snapshot: string | null;
    status: AdminReport["status"];
    created_at: number;
    resolved_by: string | null;
    r_username: string | null;
    r_name: string | null;
    t_username: string | null;
    t_name: string | null;
    t_suspended: number | null;
  }>();
  const reports: AdminReport[] = results.map((r) => ({
    id: r.id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.created_at,
    reporter: r.r_username ? { id: r.reporter_id, username: r.r_username, displayName: r.r_name! } : null,
    target: r.t_username ? { id: r.target_user_id!, username: r.t_username, displayName: r.t_name!, suspended: r.t_suspended !== null } : null,
    roomId: r.room_id,
    snapshot: r.snapshot ? JSON.parse(r.snapshot) : null,
    resolvedBy: r.resolved_by,
  }));
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").first<{ n: number }>();
  return json({ reports, open: open?.n ?? 0 });
}

export async function resolveReport(request: Request, env: Env, admin: SessionUser, id: string): Promise<Response> {
  const body = await readJson<{ status?: unknown }>(request);
  const status = body.status === "dismissed" ? "dismissed" : body.status === "resolved" ? "resolved" : null;
  if (!status) throw new HttpError(400, "Unknown status.");
  const row = await env.DB.prepare(
    "UPDATE reports SET status = ?1, resolved_by = ?2, resolved_at = ?3 WHERE id = ?4 RETURNING target_user_id, reason",
  )
    .bind(status, admin.username, Date.now(), id)
    .first<{ target_user_id: string | null; reason: string }>();
  if (!row) throw new HttpError(404, "Report not found.");
  const target = row.target_user_id
    ? await env.DB.prepare("SELECT id, username FROM users WHERE id = ?1").bind(row.target_user_id).first<{ id: string; username: string }>()
    : null;
  await audit(env, admin, `report.${status}`, target, `reason: ${row.reason}`);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Group bans
// ---------------------------------------------------------------------------

export async function isBanned(env: Env, roomId: string, userId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM group_bans WHERE room_id = ?1 AND user_id = ?2").bind(roomId, userId).first());
}

export async function listBans(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await groupAdmin(env, roomId, me.id);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_version, b.created_at
       FROM group_bans b JOIN users u ON u.id = b.user_id WHERE b.room_id = ?1 ORDER BY b.created_at DESC`,
  )
    .bind(roomId)
    .all<{ id: string; username: string; display_name: string; avatar_version: number | null; created_at: number }>();
  const bans: GroupBan[] = results.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, avatarVersion: r.avatar_version, bannedAt: r.created_at }));
  return json({ bans });
}

export async function unban(request: Request, env: Env, roomId: string, userId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await groupAdmin(env, roomId, me.id);
  await env.DB.prepare("DELETE FROM group_bans WHERE room_id = ?1 AND user_id = ?2").bind(roomId, userId).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Group photos
// ---------------------------------------------------------------------------

export async function setGroupPhoto(request: Request, env: Env, roomId: string, remove: boolean): Promise<Response> {
  const me = await requireUser(request, env);
  await groupAdmin(env, roomId, me.id);
  await rateLimit(env, `group-photo:${me.id}`, 30, HOUR);
  if (remove) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM room_avatars WHERE room_id = ?1").bind(roomId),
      env.DB.prepare("UPDATE rooms SET avatar_version = NULL WHERE id = ?1").bind(roomId),
    ]);
  } else {
    const { bytes, mime } = await readUpload(request, "image", LIMITS.avatarMaxBytes);
    const version = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO room_avatars (room_id, mime, data, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(room_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      ).bind(roomId, mime, bytes, version),
      env.DB.prepare("UPDATE rooms SET avatar_version = ?1 WHERE id = ?2").bind(version, roomId),
    ]);
  }
  await lobby(env).notify(await roomMemberIds(env.DB, roomId), { type: "rooms-changed" });
  return json({ ok: true });
}

export async function getGroupPhoto(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const row = await env.DB.prepare("SELECT mime, data FROM room_avatars WHERE room_id = ?1").bind(roomId).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) throw new HttpError(404, "No group photo.");
  const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  return new Response(bytes, { headers: mediaHeaders(row.mime, "immutable") });
}
