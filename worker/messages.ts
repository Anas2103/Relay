import { isEncrypted, type MediaMeta, type Message, type MessageKind, type ReplyPreview } from "../shared/types";

/** Reply quotes are shortened, except encrypted ones (cutting ciphertext would make it undecryptable). */
export function quoteBody(body: string): string {
  return isEncrypted(body) ? body : body.slice(0, 200);
}

export interface MessageRow {
  id: string;
  room_id: string;
  user_id: string;
  username: string;
  display_name: string;
  kind: MessageKind;
  body: string;
  media_id: string | null;
  meta: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  created_at: number;
  pinned_at: number | null;
  expires_at: number | null;
  r_id: string | null;
  r_user_id: string | null;
  r_display_name: string | null;
  r_kind: MessageKind | null;
  r_body: string | null;
  r_meta: string | null;
  r_deleted_at: number | null;
}

/** Message columns plus a preview of the message it replies to. */
export const MESSAGE_SELECT = `
  SELECT m.id, m.room_id, m.user_id, u.username, u.display_name, m.kind, m.body, m.media_id, m.meta,
         m.edited_at, m.deleted_at, m.created_at, m.pinned_at, m.expires_at,
         r.id AS r_id, r.user_id AS r_user_id, ru.display_name AS r_display_name, r.kind AS r_kind,
         r.body AS r_body, r.meta AS r_meta, r.deleted_at AS r_deleted_at
    FROM messages m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN messages r ON r.id = m.reply_to_id
    LEFT JOIN users ru ON ru.id = r.user_id`;

function parseMeta(raw: string | null): MediaMeta | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MediaMeta;
  } catch {
    return null;
  }
}

function replyPreview(r: MessageRow): ReplyPreview | null {
  if (!r.r_id) return null;
  const deleted = r.r_deleted_at !== null;
  const meta = parseMeta(r.r_meta);
  return {
    id: r.r_id,
    userId: r.r_user_id!,
    displayName: r.r_display_name ?? "Unknown",
    kind: r.r_kind ?? "text",
    // View-once photo captions stay hidden in reply previews too.
    body: deleted || meta?.viewOnce ? "" : quoteBody(r.r_body ?? ""),
    deleted,
  };
}

export function rowToMessage(
  r: MessageRow,
  reactions: Record<string, string> = {},
  viewedBy: string[] = [],
  votes?: Record<string, number[]>,
): Message {
  return {
    ...(r.kind === "poll" ? { votes: votes ?? {} } : {}),
    id: r.id,
    roomId: r.room_id,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    kind: r.kind,
    body: r.body,
    mediaId: r.media_id,
    meta: parseMeta(r.meta),
    replyTo: replyPreview(r),
    reactions,
    viewedBy,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    pinnedAt: r.pinned_at,
    expiresAt: r.expires_at,
  };
}

/** SQL condition: message `m` hasn't disappeared yet (the cron job deletes it soon after). */
export const NOT_EXPIRED = "(m.expires_at IS NULL OR m.expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)";

/** Loads rows, then attaches reactions and view-once state in two batched queries. */
export async function hydrateMessages(db: D1Database, rows: MessageRow[]): Promise<Message[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(",");

  const pollIds = rows.filter((r) => r.kind === "poll").map((r) => r.id);
  const [reactions, views, votes] = await db.batch<{ message_id: string; user_id: string; emoji?: string; option_idx?: number }>([
    db.prepare(`SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`).bind(...ids),
    db.prepare(`SELECT message_id, user_id FROM media_views WHERE message_id IN (${placeholders})`).bind(...ids),
    pollIds.length
      ? db.prepare(`SELECT message_id, user_id, option_idx FROM poll_votes WHERE message_id IN (${pollIds.map((_, i) => `?${i + 1}`).join(",")})`).bind(...pollIds)
      : db.prepare("SELECT NULL AS message_id WHERE 0"),
  ]);
  const voteMap = new Map<string, Record<string, number[]>>();
  for (const v of votes.results) {
    const entry = voteMap.get(v.message_id) ?? {};
    (entry[v.user_id] ??= []).push(v.option_idx!);
    voteMap.set(v.message_id, entry);
  }

  const reactionMap = new Map<string, Record<string, string>>();
  for (const r of reactions.results) {
    const entry = reactionMap.get(r.message_id) ?? {};
    entry[r.user_id] = r.emoji!;
    reactionMap.set(r.message_id, entry);
  }
  const viewMap = new Map<string, string[]>();
  for (const v of views.results) {
    viewMap.set(v.message_id, [...(viewMap.get(v.message_id) ?? []), v.user_id]);
  }

  return rows.map((r) => rowToMessage(r, reactionMap.get(r.id) ?? {}, viewMap.get(r.id) ?? [], voteMap.get(r.id)));
}

export async function loadMessage(db: D1Database, id: string): Promise<Message | null> {
  const row = await db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?1`).bind(id).first<MessageRow>();
  if (!row) return null;
  const [msg] = await hydrateMessages(db, [row]);
  return msg;
}

export async function roomMemberIds(db: D1Database, roomId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT user_id FROM room_members WHERE room_id = ?1")
    .bind(roomId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}
