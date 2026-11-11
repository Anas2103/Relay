import { DurableObject } from "cloudflare:workers";
import {
  LIMITS,
  messagePreview,
  type ClientEvent,
  type MediaMeta,
  type Message,
  type MessageKind,
  type ServerEvent,
} from "../shared/types";
import { lobby, type Env } from "./env";
import { loadMessage, roomMemberIds } from "./messages";

/** Per-connection state. Survives hibernation via serializeAttachment. */
interface Attachment {
  userId: string;
  username: string;
  displayName: string;
  roomId: string;
  tokens: number;
  refilledAt: number;
}

// Token bucket: bursts of up to 8 messages, refilling 1 per second.
const BUCKET_SIZE = 8;
const REFILL_MS = 1000;
const UNATTACHED_MEDIA_TTL_MS = 60 * 60 * 1000;
const CHUNK_BYTES = 1_000_000;
const EMOJI_RE = /^\p{Extended_Pictographic}/u;

class UserError extends Error {}

/**
 * One instance per chat room. Holds every open WebSocket for that room and
 * broadcasts messages, typing, reactions, edits, deletes and read receipts.
 *
 * It also stores the room's photos and voice notes in its own built-in SQLite
 * database (free, no external storage needed). Media is only ever served
 * through the Worker, which checks room membership first.
 *
 * Only reachable through the Worker, which has already checked the session and
 * room membership and passes the verified identity in X-* headers.
 */
export class ChatRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private lastTimestamp = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS media (
      id          TEXT PRIMARY KEY,
      uploader_id TEXT NOT NULL,
      mime        TEXT NOT NULL,
      size        INTEGER NOT NULL,
      data        BLOB NOT NULL,
      created_at  INTEGER NOT NULL,
      attached    INTEGER NOT NULL DEFAULT 0
    )`);
    // Large files are split into 1 MB chunks (SQLite values max out at 2 MB).
    this.sql.exec(`CREATE TABLE IF NOT EXISTS media_chunks (
      media_id TEXT NOT NULL,
      idx      INTEGER NOT NULL,
      data     BLOB NOT NULL,
      PRIMARY KEY (media_id, idx)
    )`);
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(media)").toArray().map((c) => c.name);
    if (!columns.includes("chunks")) this.sql.exec("ALTER TABLE media ADD COLUMN chunks INTEGER NOT NULL DEFAULT 0");
    if (!columns.includes("name")) this.sql.exec("ALTER TABLE media ADD COLUMN name TEXT");
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const attachment: Attachment = {
      userId: request.headers.get("X-User-Id")!,
      username: request.headers.get("X-Username")!,
      displayName: request.headers.get("X-Display-Name")!,
      roomId: request.headers.get("X-Room-Id")!,
      tokens: BUCKET_SIZE,
      refilledAt: Date.now(),
    };

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- Media storage (RPC) ----------

  async putMedia(uploaderId: string, mime: string, bytes: Uint8Array, name?: string): Promise<string> {
    const id = crypto.randomUUID();
    const chunks = Math.ceil(bytes.byteLength / CHUNK_BYTES);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO media (id, uploader_id, mime, size, data, created_at, chunks, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        uploaderId,
        mime,
        bytes.byteLength,
        new Uint8Array(0),
        Date.now(),
        chunks,
        name ?? null,
      );
      for (let i = 0; i < chunks; i++) {
        this.sql.exec(
          "INSERT INTO media_chunks (media_id, idx, data) VALUES (?, ?, ?)",
          id,
          i,
          bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES),
        );
      }
    });
    // Clean up uploads that never got sent.
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + UNATTACHED_MEDIA_TTL_MS);
    }
    return id;
  }

  async getMedia(id: string): Promise<{ mime: string; data: ArrayBuffer; name: string | null } | null> {
    const row = this.sql
      .exec<{ mime: string; data: ArrayBuffer; chunks: number; size: number; name: string | null }>(
        "SELECT mime, data, chunks, size, name FROM media WHERE id = ? AND attached = 1",
        id,
      )
      .toArray()[0];
    if (!row) return null;
    if (row.chunks === 0) return { mime: row.mime, data: row.data, name: row.name }; // stored before chunking existed

    const out = new Uint8Array(row.size);
    let offset = 0;
    for (const c of this.sql.exec<{ data: ArrayBuffer }>(
      "SELECT data FROM media_chunks WHERE media_id = ? ORDER BY idx",
      id,
    )) {
      out.set(new Uint8Array(c.data), offset);
      offset += c.data.byteLength;
    }
    return { mime: row.mime, data: out.buffer, name: row.name };
  }

  async mediaInfo(id: string): Promise<{ mime: string; size: number; name: string | null } | null> {
    return (
      this.sql
        .exec<{ mime: string; size: number; name: string | null }>(
          "SELECT mime, size, name FROM media WHERE id = ? AND attached = 1",
          id,
        )
        .toArray()[0] ?? null
    );
  }

  /** Reads bytes [start, end] (inclusive) touching only the chunks needed — fast video seeking. */
  async readMedia(id: string, start: number, end: number): Promise<ArrayBuffer | null> {
    const row = this.sql
      .exec<{ data: ArrayBuffer; chunks: number }>("SELECT data, chunks FROM media WHERE id = ? AND attached = 1", id)
      .toArray()[0];
    if (!row) return null;
    if (row.chunks === 0) return row.data.slice(start, end + 1);

    const first = Math.floor(start / CHUNK_BYTES);
    const last = Math.floor(end / CHUNK_BYTES);
    const out = new Uint8Array(end - start + 1);
    let written = 0;
    for (const c of this.sql.exec<{ idx: number; data: ArrayBuffer }>(
      "SELECT idx, data FROM media_chunks WHERE media_id = ? AND idx BETWEEN ? AND ? ORDER BY idx",
      id,
      first,
      last,
    )) {
      const chunkStart = c.idx * CHUNK_BYTES;
      const from = Math.max(start, chunkStart) - chunkStart;
      const to = Math.min(end + 1, chunkStart + c.data.byteLength) - chunkStart;
      const piece = new Uint8Array(c.data, from, to - from);
      out.set(piece, written);
      written += piece.byteLength;
    }
    return out.buffer;
  }

  async deleteMedia(id: string): Promise<void> {
    this.sql.exec("DELETE FROM media_chunks WHERE media_id = ?", id);
    this.sql.exec("DELETE FROM media WHERE id = ?", id);
  }

  /** Called when the whole conversation is deleted. */
  async wipeMedia(): Promise<void> {
    this.sql.exec("DELETE FROM media_chunks");
    this.sql.exec("DELETE FROM media");
  }

  async alarm(): Promise<void> {
    const cutoff = Date.now() - UNATTACHED_MEDIA_TTL_MS;
    this.sql.exec(
      "DELETE FROM media_chunks WHERE media_id IN (SELECT id FROM media WHERE attached = 0 AND created_at < ?)",
      cutoff,
    );
    this.sql.exec("DELETE FROM media WHERE attached = 0 AND created_at < ?", cutoff);
    const pending = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM media WHERE attached = 0").one().n;
    if (pending > 0) await this.ctx.storage.setAlarm(Date.now() + UNATTACHED_MEDIA_TTL_MS);
  }

  /** Called by the Worker after someone opens a view-once photo. */
  async notifyViewed(messageId: string, userId: string): Promise<void> {
    this.broadcast({ type: "viewed", messageId, userId });
  }

  /**
   * RPC called by the admin API: disconnect every socket belonging to a user.
   * Close code 4001 tells the client not to reconnect.
   */
  async kick(userId: string): Promise<number> {
    let closed = 0;
    for (const s of this.ctx.getWebSockets()) {
      if ((s.deserializeAttachment() as Attachment).userId !== userId) continue;
      try {
        s.close(4001, "Signed out");
      } catch {
        // already closed
      }
      closed++;
    }
    if (closed) this.broadcastPresence();
    return closed;
  }

  // ---------- WebSocket events ----------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 10_000) return;

    let event: ClientEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;
    const clientId = event.type === "send" && typeof event.clientId === "string" ? event.clientId.slice(0, 64) : undefined;

    try {
      switch (event.type) {
        case "send":
          return await this.onSend(ws, att, event, clientId!);
        case "typing":
          this.broadcast(
            { type: "typing", userId: att.userId, displayName: att.displayName, isTyping: !!event.isTyping },
            ws,
          );
          return;
        case "read":
          return await this.onRead(att, event.at);
        case "react":
          return await this.onReact(att, event.messageId, event.emoji);
        case "edit":
          return await this.onEdit(att, event.messageId, event.body);
        case "delete":
          return await this.onDelete(att, event.messageId);
      }
    } catch (err) {
      if (err instanceof UserError) {
        this.sendTo(ws, { type: "error", message: err.message, clientId });
      } else {
        console.error("Room event failed", err);
        this.sendTo(ws, { type: "error", message: "Something went wrong. Try again.", clientId });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, "Closing");
    } catch {
      // already closed
    }
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
  }

  // ---------- Handlers ----------

  private takeToken(ws: WebSocket, att: Attachment): void {
    const now = Date.now();
    att.tokens = Math.min(BUCKET_SIZE, att.tokens + (now - att.refilledAt) / REFILL_MS);
    att.refilledAt = now;
    if (att.tokens < 1) {
      ws.serializeAttachment(att);
      throw new UserError("You're sending messages too fast.");
    }
    att.tokens -= 1;
    ws.serializeAttachment(att);
  }

  private async onSend(
    ws: WebSocket,
    att: Attachment,
    event: Extract<ClientEvent, { type: "send" }>,
    clientId: string,
  ): Promise<void> {
    const kind: MessageKind = (["image", "voice", "video", "file", "call"] as const).includes(event.kind as never)
      ? event.kind
      : "text";
    const body = kind === "call" ? "" : typeof event.body === "string" ? event.body.trim() : "";
    if (body.length > LIMITS.messageMax) throw new UserError(`Messages can be at most ${LIMITS.messageMax} characters.`);
    if (kind === "text" && !body) throw new UserError("Message is empty.");

    this.takeToken(ws, att);

    // Timestamp is taken synchronously, in arrival order, and strictly increases per room.
    // (Several messages can arrive in the same millisecond, and the database writes below
    // can finish in any order — without this, quick bursts could display shuffled.)
    const now = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;

    let meta: MediaMeta | null = null;
    let mediaId: string | null = null;
    if (kind === "call") {
      const call = (event.meta as { call?: Record<string, unknown> } | undefined)?.call ?? {};
      const statuses = ["ended", "missed", "declined", "busy", "failed"] as const;
      const status = statuses.find((s) => s === call.status);
      if (!status) throw new UserError("Invalid call record.");
      const duration = Number(call.duration);
      meta = {
        mime: "",
        size: 0,
        call: {
          video: call.video === true,
          status,
          duration: status === "ended" && Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : undefined,
        },
      };
    } else if (kind !== "text") {
      mediaId = typeof event.mediaId === "string" ? event.mediaId : null;
      const media = mediaId
        ? this.sql
            .exec<{ mime: string; size: number; name: string | null }>(
              "SELECT mime, size, name FROM media WHERE id = ? AND uploader_id = ? AND attached = 0",
              mediaId,
              att.userId,
            )
            .toArray()[0]
        : undefined;
      if (!media) throw new UserError("Upload not found. Please try again.");
      const expected = { image: "image/", voice: "audio/", video: "video/", file: "application/" }[kind];
      if (!media.mime.startsWith(expected)) throw new UserError("Wrong file type.");
      meta = sanitizeMeta(kind, media, (event as { meta?: unknown }).meta);
    }

    let replyToId: string | null = null;
    if (typeof event.replyToId === "string") {
      const exists = await this.env.DB.prepare("SELECT 1 FROM messages WHERE id = ?1 AND room_id = ?2")
        .bind(event.replyToId, att.roomId)
        .first();
      if (exists) replyToId = event.replyToId;
    }

    const id = crypto.randomUUID();
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO messages (id, room_id, user_id, body, created_at, kind, media_id, meta, reply_to_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      ).bind(id, att.roomId, att.userId, body, now, kind, mediaId, meta ? JSON.stringify(meta) : null, replyToId),
      // Your own message counts as read by you.
      this.env.DB.prepare(
        "UPDATE room_members SET last_read_at = MAX(last_read_at, ?1) WHERE room_id = ?2 AND user_id = ?3",
      ).bind(now, att.roomId, att.userId),
    ]);
    if (mediaId) this.sql.exec("UPDATE media SET attached = 1 WHERE id = ?", mediaId);

    const message: Message = {
      id,
      roomId: att.roomId,
      userId: att.userId,
      username: att.username,
      displayName: att.displayName,
      kind,
      body,
      mediaId,
      meta,
      replyTo: replyToId ? await this.replyPreview(replyToId) : null,
      reactions: {},
      viewedBy: [],
      editedAt: null,
      deletedAt: null,
      createdAt: now,
    };

    this.broadcast({ type: "message", message: { ...message, clientId } });
    this.broadcast({ type: "read", userId: att.userId, at: now });

    // Update everyone's sidebar (and notify them if they're elsewhere in the app).
    const members = await roomMemberIds(this.env.DB, att.roomId);
    await lobby(this.env).notify(members, {
      type: "activity",
      roomId: att.roomId,
      fromUserId: att.userId,
      fromName: att.displayName,
      lastMessage: { preview: messagePreview(message), createdAt: now, userId: att.userId },
    });
  }

  private async replyPreview(messageId: string): Promise<Message["replyTo"]> {
    const m = await loadMessage(this.env.DB, messageId);
    if (!m) return null;
    return {
      id: m.id,
      userId: m.userId,
      displayName: m.displayName,
      kind: m.kind,
      body: m.deletedAt || m.meta?.viewOnce ? "" : m.body.slice(0, 200),
      deleted: m.deletedAt !== null,
    };
  }

  private async onRead(att: Attachment, at: unknown): Promise<void> {
    const ts = Math.min(Number(at) || 0, Date.now());
    if (ts <= 0) return;
    const row = await this.env.DB.prepare(
      `UPDATE room_members SET last_read_at = MAX(last_read_at, ?1)
        WHERE room_id = ?2 AND user_id = ?3 RETURNING last_read_at`,
    )
      .bind(ts, att.roomId, att.userId)
      .first<{ last_read_at: number }>();
    if (row) this.broadcast({ type: "read", userId: att.userId, at: row.last_read_at });
  }

  private async findMessage(att: Attachment, messageId: unknown) {
    if (typeof messageId !== "string") throw new UserError("Message not found.");
    const row = await this.env.DB.prepare(
      "SELECT user_id, kind, deleted_at, media_id FROM messages WHERE id = ?1 AND room_id = ?2",
    )
      .bind(messageId, att.roomId)
      .first<{ user_id: string; kind: MessageKind; deleted_at: number | null; media_id: string | null }>();
    if (!row || row.deleted_at !== null) throw new UserError("That message no longer exists.");
    return { id: messageId, ...row };
  }

  private async onReact(att: Attachment, messageId: unknown, emoji: unknown): Promise<void> {
    const msg = await this.findMessage(att, messageId);
    if (emoji === null) {
      await this.env.DB.prepare("DELETE FROM message_reactions WHERE message_id = ?1 AND user_id = ?2")
        .bind(msg.id, att.userId)
        .run();
      this.broadcast({ type: "reaction", messageId: msg.id, userId: att.userId, emoji: null });
      return;
    }
    if (typeof emoji !== "string" || emoji.length > 16 || !EMOJI_RE.test(emoji)) {
      throw new UserError("Invalid reaction.");
    }
    await this.env.DB.prepare(
      `INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
    )
      .bind(msg.id, att.userId, emoji, Date.now())
      .run();
    this.broadcast({ type: "reaction", messageId: msg.id, userId: att.userId, emoji });
  }

  private async onEdit(att: Attachment, messageId: unknown, rawBody: unknown): Promise<void> {
    const msg = await this.findMessage(att, messageId);
    if (msg.user_id !== att.userId) throw new UserError("You can only edit your own messages.");
    if (msg.kind !== "text") throw new UserError("Only text messages can be edited.");
    const body = typeof rawBody === "string" ? rawBody.trim() : "";
    if (!body || body.length > LIMITS.messageMax) throw new UserError(`Messages must be 1–${LIMITS.messageMax} characters.`);

    const editedAt = Date.now();
    await this.env.DB.prepare("UPDATE messages SET body = ?1, edited_at = ?2 WHERE id = ?3")
      .bind(body, editedAt, msg.id)
      .run();
    this.broadcast({ type: "edit", messageId: msg.id, body, editedAt });
  }

  private async onDelete(att: Attachment, messageId: unknown): Promise<void> {
    const msg = await this.findMessage(att, messageId);
    if (msg.user_id !== att.userId) throw new UserError("You can only delete your own messages.");

    const deletedAt = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE messages SET deleted_at = ?1, body = '', meta = NULL, media_id = NULL WHERE id = ?2",
      ).bind(deletedAt, msg.id),
      this.env.DB.prepare("DELETE FROM message_reactions WHERE message_id = ?1").bind(msg.id),
    ]);
    if (msg.media_id) await this.deleteMedia(msg.media_id);
    this.broadcast({ type: "delete", messageId: msg.id, deletedAt });
  }

  // ---------- Broadcasting ----------

  private openSockets(exclude?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => s !== exclude && s.readyState === WebSocket.OPEN);
  }

  private sendTo(ws: WebSocket, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // socket went away
    }
  }

  private broadcast(event: ServerEvent, exclude?: WebSocket): void {
    const data = JSON.stringify(event);
    for (const s of this.openSockets(exclude)) {
      try {
        s.send(data);
      } catch {
        // socket went away
      }
    }
  }

  /** Who currently has this chat open (used for "seen" behaviour, not the online dot). */
  private broadcastPresence(closing?: WebSocket): void {
    const sockets = this.openSockets(closing);
    const online = [...new Set(sockets.map((s) => (s.deserializeAttachment() as Attachment).userId))];
    const data = JSON.stringify({ type: "presence", online } satisfies ServerEvent);
    for (const s of sockets) {
      try {
        s.send(data);
      } catch {
        // socket went away
      }
    }
  }
}

/** Keeps only well-formed metadata; size and type always come from the stored file. */
function sanitizeMeta(
  kind: MessageKind,
  media: { mime: string; size: number; name: string | null },
  raw: unknown,
): MediaMeta {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const meta: MediaMeta = { mime: media.mime, size: media.size };
  const int = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : undefined;
  const seconds = (v: unknown, max: number) => {
    const d = Number(v);
    return Number.isFinite(d) && d > 0 ? Math.min(Math.round(d * 10) / 10, max) : undefined;
  };

  if (kind === "file") {
    meta.name = media.name ?? "file";
  } else if (kind === "image" || kind === "video") {
    meta.width = int(input.width, 10_000);
    meta.height = int(input.height, 10_000);
    if (kind === "video") meta.duration = seconds(input.duration, 24 * 3600);
    if (kind === "image" && input.viewOnce === true) meta.viewOnce = true;
  } else {
    meta.duration = seconds(input.duration, LIMITS.voiceMaxSeconds + 2);
    if (Array.isArray(input.waveform)) {
      meta.waveform = input.waveform
        .slice(0, 64)
        .map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : 0));
    }
  }
  return meta;
}
