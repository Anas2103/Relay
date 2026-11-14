import { DurableObject } from "cloudflare:workers";
import {
  E2E_RE,
  isEncrypted,
  LIMITS,
  mentionedUsernames,
  messagePreview,
  type ClientEvent,
  type MediaMeta,
  type Message,
  type MessageKind,
  type PollInfo,
  type ScheduledMessage,
  type ServerEvent,
  SCHEDULE_MAX_DAYS,
} from "../shared/types";
import { lobby, type Env } from "./env";
import { loadMessage, quoteBody } from "./messages";
import { pushConfigured, pushTo } from "./push";

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
  /** Message requests: nothing can be sent until the other person accepts. Cached once accepted. */
  private accepted = false;
  /** Secret (end-to-end encrypted) chat: only ciphertext is accepted. Never changes once created. */
  private secret: boolean | null = null;

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
    // Messages waiting to be sent at a set time. Kept here, next to the room, and sent by the alarm.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scheduled (
      id           TEXT PRIMARY KEY,
      room_id      TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      username     TEXT NOT NULL,
      display_name TEXT NOT NULL,
      body         TEXT NOT NULL,
      send_at      INTEGER NOT NULL,
      reply_to_id  TEXT,
      silent       INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL
    )`);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** One alarm serves both jobs: cleaning unsent uploads and sending scheduled messages. */
  private async rearm(): Promise<void> {
    const due = this.sql.exec<{ t: number | null }>("SELECT MIN(send_at) AS t FROM scheduled").one().t;
    const upload = this.sql.exec<{ t: number | null }>("SELECT MIN(created_at) AS t FROM media WHERE attached = 0").one().t;
    const times = [due, upload !== null ? upload + UNATTACHED_MEDIA_TTL_MS : null].filter((t): t is number => t !== null);
    if (times.length) await this.ctx.storage.setAlarm(Math.max(Math.min(...times), Date.now() + 50));
    else await this.ctx.storage.deleteAlarm();
  }

  private scheduledFor(userId: string): ScheduledMessage[] {
    return this.sql
      .exec<{ id: string; body: string; send_at: number; silent: number; reply_to_id: string | null }>(
        "SELECT id, body, send_at, silent, reply_to_id FROM scheduled WHERE user_id = ? ORDER BY send_at",
        userId,
      )
      .toArray()
      .map((r) => ({ id: r.id, body: r.body, sendAt: r.send_at, silent: r.silent === 1, replyToId: r.reply_to_id }));
  }

  private sendScheduledList(userId: string): void {
    const data = JSON.stringify({ type: "scheduled", items: this.scheduledFor(userId) } satisfies ServerEvent);
    for (const s of this.openSockets()) {
      if ((s.deserializeAttachment() as Attachment).userId !== userId) continue;
      try {
        s.send(data);
      } catch {
        // gone
      }
    }
  }

  private async onSchedule(ws: WebSocket, att: Attachment, e: Extract<ClientEvent, { type: "schedule" }>): Promise<void> {
    const body = typeof e.body === "string" ? e.body.trim() : "";
    if (!body) throw new UserError("Message is empty.");
    await this.checkBody(att.roomId, body);
    if (!(await this.isAccepted(att.roomId))) throw new UserError("You can send messages once your request is accepted.");
    if (await this.isBlocked(att.roomId, att.userId)) throw new UserError("You can't send messages in this chat.");
    const sendAt = Number(e.sendAt);
    if (!Number.isFinite(sendAt) || sendAt < Date.now() + 5_000 || sendAt > Date.now() + SCHEDULE_MAX_DAYS * 86_400_000) {
      throw new UserError(`Pick a time in the future (up to ${SCHEDULE_MAX_DAYS} days ahead).`);
    }
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM scheduled WHERE user_id = ?", att.userId).one().n;
    if (count >= LIMITS.scheduledPerChat) throw new UserError(`You can schedule up to ${LIMITS.scheduledPerChat} messages per chat.`);
    this.takeToken(ws, att);
    this.sql.exec(
      "INSERT INTO scheduled (id, room_id, user_id, username, display_name, body, send_at, reply_to_id, silent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      crypto.randomUUID(),
      att.roomId,
      att.userId,
      att.username,
      att.displayName,
      body,
      Math.round(sendAt),
      typeof e.replyToId === "string" ? e.replyToId : null,
      e.silent === true ? 1 : 0,
      Date.now(),
    );
    await this.rearm();
    this.sendScheduledList(att.userId);
  }

  /** Sends a stored scheduled message now, as if its author had just pressed send. */
  private async deliverScheduled(id: string): Promise<void> {
    const row = this.sql
      .exec<{ room_id: string; user_id: string; username: string; display_name: string; body: string; reply_to_id: string | null; silent: number }>(
        "SELECT room_id, user_id, username, display_name, body, reply_to_id, silent FROM scheduled WHERE id = ?",
        id,
      )
      .toArray()[0];
    if (!row) return;
    this.sql.exec("DELETE FROM scheduled WHERE id = ?", id);
    const att: Attachment = { userId: row.user_id, username: row.username, displayName: row.display_name, roomId: row.room_id, tokens: BUCKET_SIZE, refilledAt: Date.now() };
    try {
      await this.onSend(null, att, { type: "send", clientId: id, kind: "text", body: row.body, replyToId: row.reply_to_id ?? undefined, silent: row.silent === 1 }, id);
    } catch (err) {
      // The chat changed in the meantime (left the group, blocked, admins-only…): the message is dropped.
      console.log("scheduled message not sent:", err instanceof Error ? err.message : err);
    }
    this.sendScheduledList(row.user_id);
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
    await this.rearm();
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

  /** Called by the Worker when a message request is accepted. */
  async setAccepted(): Promise<void> {
    this.accepted = true;
  }

  private async isAccepted(roomId: string): Promise<boolean> {
    if (this.accepted) return true;
    const row = await this.env.DB.prepare("SELECT status FROM rooms WHERE id = ?1").bind(roomId).first<{ status: string }>();
    this.accepted = row?.status === "accepted";
    return this.accepted;
  }

  private async isSecret(roomId: string): Promise<boolean> {
    if (this.secret !== null) return this.secret;
    const row = await this.env.DB.prepare("SELECT dm_key FROM rooms WHERE id = ?1").bind(roomId).first<{ dm_key: string | null }>();
    this.secret = !!row?.dm_key?.startsWith("secret:");
    return this.secret;
  }

  /**
   * Text rules. Secret chats only take well-formed ciphertext (the server can't read it);
   * every other chat refuses anything that looks encrypted, so a normal chat can never
   * pretend to be private.
   */
  private async checkBody(roomId: string, body: string): Promise<void> {
    if (await this.isSecret(roomId)) {
      if (body.length > LIMITS.cipherMax || !E2E_RE.test(body)) throw new UserError("This secret chat only accepts encrypted messages.");
      return;
    }
    if (body.length > LIMITS.messageMax) throw new UserError(`Messages can be at most ${LIMITS.messageMax} characters.`);
    if (isEncrypted(body)) throw new UserError("That message can't be sent here.");
  }

  /** 1:1 chats only: true if the other person has blocked, or is blocked by, the given user. */
  private async isBlocked(roomId: string, userId: string): Promise<boolean> {
    const row = await this.env.DB.prepare(
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

  /** Someone left or was removed from a group: close their sockets (4003 = removed, don't reconnect). */
  async removeMember(userId: string): Promise<void> {
    for (const s of this.ctx.getWebSockets()) {
      if ((s.deserializeAttachment() as Attachment).userId !== userId) continue;
      try {
        s.close(4003, "Removed from chat");
      } catch {
        // already closed
      }
    }
    this.broadcastPresence();
  }

  /** Called by the cron job: these messages disappeared. Remove their files and tell open chats. */
  async expire(messageIds: string[], mediaIds: string[]): Promise<void> {
    for (const id of mediaIds) await this.deleteMedia(id);
    if (messageIds.length) this.broadcast({ type: "expired", messageIds });
  }

  /** Called by the owner's moderation tools after a message was removed. */
  async notifyDeleted(messageId: string, deletedAt: number): Promise<void> {
    this.broadcast({ type: "delete", messageId, deletedAt });
  }

  /** Called when the whole conversation is deleted. */
  async wipeMedia(): Promise<void> {
    this.sql.exec("DELETE FROM media_chunks");
    this.sql.exec("DELETE FROM media");
    this.sql.exec("DELETE FROM scheduled");
    await this.rearm();
  }

  async alarm(): Promise<void> {
    const cutoff = Date.now() - UNATTACHED_MEDIA_TTL_MS;
    this.sql.exec(
      "DELETE FROM media_chunks WHERE media_id IN (SELECT id FROM media WHERE attached = 0 AND created_at < ?)",
      cutoff,
    );
    this.sql.exec("DELETE FROM media WHERE attached = 0 AND created_at < ?", cutoff);
    const due = this.sql.exec<{ id: string }>("SELECT id FROM scheduled WHERE send_at <= ? ORDER BY send_at", Date.now() + 1000).toArray();
    for (const { id } of due) await this.deliverScheduled(id);
    await this.rearm();
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
    if (typeof raw !== "string" || raw.length > 40_000) return;

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
          if (!(await this.isAccepted(att.roomId))) return;
          if (await this.isBlocked(att.roomId, att.userId)) return;
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
        case "pin":
          return await this.onPin(att, event.messageId, event.pinned === true);
        case "vote":
          this.takeToken(ws, att);
          return await this.onVote(att, event.messageId, event.options);
        case "schedule":
          return await this.onSchedule(ws, att, event);
        case "unschedule":
          this.sql.exec("DELETE FROM scheduled WHERE id = ? AND user_id = ?", String(event.id), att.userId);
          await this.rearm();
          return this.sendScheduledList(att.userId);
        case "send-now": {
          const owned = this.sql.exec("SELECT 1 FROM scheduled WHERE id = ? AND user_id = ?", String(event.id), att.userId).toArray().length > 0;
          if (owned) await this.deliverScheduled(String(event.id));
          await this.rearm();
          return;
        }
        case "list-scheduled":
          return this.sendScheduledList(att.userId);
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

  private takeToken(ws: WebSocket | null, att: Attachment): void {
    if (!ws) return; // scheduled messages were already rate-limited when they were scheduled
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
    ws: WebSocket | null,
    att: Attachment,
    event: Extract<ClientEvent, { type: "send" }>,
    clientId: string,
  ): Promise<void> {
    const kind: MessageKind = (["image", "voice", "video", "file", "call", "poll"] as const).includes(event.kind as never)
      ? event.kind
      : "text";
    const body = kind === "call" ? "" : typeof event.body === "string" ? event.body.trim() : "";
    if (kind === "text" && !body) throw new UserError("Message is empty.");
    if (kind === "poll" && (!body || body.length > LIMITS.pollQuestionMax)) {
      throw new UserError(`Ask a question (up to ${LIMITS.pollQuestionMax} characters).`);
    }
    if (body) await this.checkBody(att.roomId, body);
    // Secret chats carry encrypted text (and call records) only; files would reach the server unencrypted.
    if (kind !== "text" && kind !== "call" && (await this.isSecret(att.roomId))) {
      throw new UserError("Secret chats are text-only.");
    }
    if (!(await this.isAccepted(att.roomId))) {
      throw new UserError("You can send messages once your request is accepted.");
    }
    if (await this.isBlocked(att.roomId, att.userId)) {
      throw new UserError("You can't send messages in this chat.");
    }

    // Group rules: announcement channels (only admins post) and slow mode. Admins are exempt from both.
    const rules = await this.env.DB.prepare(
      `SELECT r.disappear_ms, r.admins_only, r.slow_mode_ms, m.role,
              (SELECT MAX(created_at) FROM messages WHERE room_id = r.id AND user_id = ?2 AND kind != 'call') AS last_sent
         FROM rooms r JOIN room_members m ON m.room_id = r.id AND m.user_id = ?2
        WHERE r.id = ?1`,
    )
      .bind(att.roomId, att.userId)
      .first<{ disappear_ms: number | null; admins_only: number; slow_mode_ms: number; role: string; last_sent: number | null }>();
    if (!rules) throw new UserError("You're not in this chat anymore.");
    if (rules.role !== "admin" && kind !== "call") {
      if (rules.admins_only === 1) throw new UserError("Only admins can send messages in this group.");
      const wait = rules.slow_mode_ms && rules.last_sent ? rules.last_sent + rules.slow_mode_ms - Date.now() : 0;
      if (wait > 0) throw new UserError(`Slow mode is on. You can send another message in ${formatWait(wait)}.`);
    }

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
    } else if (kind === "poll") {
      meta = { mime: "", size: 0, poll: sanitizePoll((event.meta as { poll?: unknown } | undefined)?.poll) };
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

    // Forwarded messages are labelled (never for call records).
    if (kind !== "call" && (event.meta as { forwarded?: unknown } | undefined)?.forwarded === true) {
      meta = { ...(meta ?? { mime: "", size: 0 }), forwarded: true };
    }

    // "Send without sound": the people receiving it get no alert or sound.
    const silent = event.silent === true && kind !== "call";
    if (silent) meta = { ...(meta ?? { mime: "", size: 0 }), silent: true };

    // Disappearing messages: the chat's timer at the moment of sending.
    const expiresAt = rules.disappear_ms ? now + rules.disappear_ms : null;

    const id = crypto.randomUUID();
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO messages (id, room_id, user_id, body, created_at, kind, media_id, meta, reply_to_id, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(id, att.roomId, att.userId, body, now, kind, mediaId, meta ? JSON.stringify(meta) : null, replyToId, expiresAt),
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
      pinnedAt: null,
      expiresAt,
      ...(kind === "poll" ? { votes: {} } : {}),
    };

    this.broadcast({ type: "message", message: { ...message, clientId } });
    this.broadcast({ type: "read", userId: att.userId, at: now });

    // Who's @mentioned (or replied to): they're alerted even if they muted the chat.
    const { results: people } = await this.env.DB.prepare(
      `SELECT m.user_id, u.username, m.muted_until > ?2 AS muted, json_extract(u.settings, '$.presence') = 'dnd' AS dnd
         FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ?1`,
    )
      .bind(att.roomId, now)
      .all<{ user_id: string; username: string; muted: number | null; dnd: number | null }>();
    const members = people.map((p) => p.user_id);
    const named = new Set(kind === "text" && !isEncrypted(body) ? mentionedUsernames(body) : []);
    const mentions = people
      .filter((p) => p.user_id !== att.userId && (named.has(p.username.toLowerCase()) || p.user_id === message.replyTo?.userId))
      .map((p) => p.user_id);

    // Update everyone's sidebar (and notify them if they're elsewhere in the app).
    const hub = lobby(this.env);
    await hub.notify(members, {
      type: "activity",
      roomId: att.roomId,
      fromUserId: att.userId,
      fromName: att.displayName,
      lastMessage: { preview: messagePreview(message), createdAt: now, userId: att.userId },
      ...(silent ? { silent: true } : {}),
      ...(mentions.length ? { mentions } : {}),
    });

    // People with the app closed get a push notification (no message content in it), unless they
    // muted the chat (mentions still get through), turned on Do Not Disturb, or it was sent silently.
    if (pushConfigured(this.env) && !silent) {
      const mentioned = new Set(mentions);
      const recipients = people
        .filter((p) => p.user_id !== att.userId && p.dnd !== 1 && (p.muted !== 1 || mentioned.has(p.user_id)))
        .map((p) => p.user_id);
      const online = new Set(await hub.onlineAmong(recipients));
      const offline = recipients.filter((id) => !online.has(id));
      if (offline.length) this.ctx.waitUntil(pushTo(this.env, offline));
    }
  }

  private async replyPreview(messageId: string): Promise<Message["replyTo"]> {
    const m = await loadMessage(this.env.DB, messageId);
    if (!m) return null;
    return {
      id: m.id,
      userId: m.userId,
      displayName: m.displayName,
      kind: m.kind,
      body: m.deletedAt || m.meta?.viewOnce ? "" : quoteBody(m.body),
      deleted: m.deletedAt !== null,
    };
  }

  /** Replaces the user's answer to a poll (an empty list takes the vote back), then shares the new totals. */
  private async onVote(att: Attachment, messageId: unknown, raw: unknown): Promise<void> {
    const msg = await this.findMessage(att, messageId);
    if (msg.kind !== "poll") throw new UserError("That message isn't a poll.");
    const row = await this.env.DB.prepare("SELECT meta FROM messages WHERE id = ?1").bind(msg.id).first<{ meta: string | null }>();
    const poll = (JSON.parse(row?.meta ?? "{}") as MediaMeta).poll;
    if (!poll) throw new UserError("That poll is broken.");
    const picked = Array.isArray(raw)
      ? [...new Set(raw.filter((v): v is number => Number.isInteger(v) && v >= 0 && v < poll.options.length))]
      : [];
    if (!poll.multiple && picked.length > 1) throw new UserError("Pick just one answer.");
    const now = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM poll_votes WHERE message_id = ?1 AND user_id = ?2").bind(msg.id, att.userId),
      ...picked.map((i) =>
        this.env.DB.prepare("INSERT INTO poll_votes (message_id, user_id, option_idx, created_at) VALUES (?1, ?2, ?3, ?4)").bind(
          msg.id,
          att.userId,
          i,
          now,
        ),
      ),
    ]);
    const { results } = await this.env.DB.prepare("SELECT user_id, option_idx FROM poll_votes WHERE message_id = ?1")
      .bind(msg.id)
      .all<{ user_id: string; option_idx: number }>();
    const votes: Record<string, number[]> = {};
    for (const v of results) (votes[v.user_id] ??= []).push(v.option_idx);
    this.broadcast({ type: "votes", messageId: msg.id, votes });
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
    if (!body) throw new UserError("Message is empty.");
    await this.checkBody(att.roomId, body);

    const editedAt = Date.now();
    await this.env.DB.prepare("UPDATE messages SET body = ?1, edited_at = ?2 WHERE id = ?3")
      .bind(body, editedAt, msg.id)
      .run();
    this.broadcast({ type: "edit", messageId: msg.id, body, editedAt });
  }

  /** Pin or unpin for everyone in the chat. At most 3 pins: pinning a 4th unpins the oldest. */
  private async onPin(att: Attachment, messageId: unknown, pinned: boolean): Promise<void> {
    const msg = await this.findMessage(att, messageId);
    if (msg.kind === "call") throw new UserError("Call records can't be pinned.");
    if (!pinned) {
      await this.env.DB.prepare("UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = ?1").bind(msg.id).run();
      this.broadcast({ type: "pin", messageId: msg.id, pinnedAt: null });
      return;
    }
    const { results } = await this.env.DB.prepare(
      "SELECT id FROM messages WHERE room_id = ?1 AND pinned_at IS NOT NULL AND id != ?2 ORDER BY pinned_at ASC",
    )
      .bind(att.roomId, msg.id)
      .all<{ id: string }>();
    const pinnedAt = Date.now();
    const unpin = results.slice(0, Math.max(0, results.length - 2)).map((r) => r.id);
    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE messages SET pinned_at = ?1, pinned_by = ?2 WHERE id = ?3").bind(pinnedAt, att.userId, msg.id),
      ...unpin.map((id) => this.env.DB.prepare("UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = ?1").bind(id)),
    ]);
    for (const id of unpin) this.broadcast({ type: "pin", messageId: id, pinnedAt: null });
    this.broadcast({ type: "pin", messageId: msg.id, pinnedAt });
  }

  private async onDelete(att: Attachment, messageId: unknown): Promise<void> {
    const msg = await this.findMessage(att, messageId);
    if (msg.user_id !== att.userId) throw new UserError("You can only delete your own messages.");

    const deletedAt = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE messages SET deleted_at = ?1, body = '', meta = NULL, media_id = NULL, pinned_at = NULL, pinned_by = NULL WHERE id = ?2",
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

function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** 2–10 distinct, non-empty answers. */
function sanitizePoll(raw: unknown): PollInfo {
  const input = (raw && typeof raw === "object" ? raw : {}) as { options?: unknown; multiple?: unknown };
  const options = Array.isArray(input.options)
    ? input.options.map((o) => (typeof o === "string" ? o.trim().replace(/\s+/g, " ") : "")).filter(Boolean)
    : [];
  if (options.some((o) => o.length > LIMITS.pollOptionMax)) throw new UserError(`Answers can be at most ${LIMITS.pollOptionMax} characters.`);
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new UserError("Each answer must be different.");
  if (options.length < LIMITS.pollOptionsMin || options.length > LIMITS.pollOptionsMax) {
    throw new UserError(`A poll needs ${LIMITS.pollOptionsMin} to ${LIMITS.pollOptionsMax} answers.`);
  }
  return { options, multiple: input.multiple === true };
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
    if (input.viewOnce === true) meta.viewOnce = true;
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
