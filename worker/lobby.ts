import { DurableObject } from "cloudflare:workers";
import { CALL_SIGNAL_TYPES, type CallEnvelope, type LobbyEvent } from "../shared/types";
import type { Env } from "./env";

interface LobbyAttachment {
  userId: string;
  displayName: string;
  /** Privacy: "Last seen: nobody". They don't share their presence, and (like Telegram) don't see anyone else's. */
  hidden?: boolean;
}

const UUID_RE = /^[0-9a-f-]{36}$/;

/**
 * One app-wide Durable Object. Every open tab keeps one WebSocket here, tagged
 * with its user id. It powers:
 *  - online / last-seen presence (shown only to people you have a chat with)
 *  - instant sidebar updates and notifications for chats you don't have open
 *
 * Uses WebSocket hibernation, so idle connections cost nothing. A single
 * instance comfortably handles thousands of connections; past that it would be
 * sharded per user.
 */
export class Lobby extends DurableObject<Env> {
  /** "from|to|room" -> expiry. Avoids a database lookup for every network candidate during a call. */
  private callPermissions = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    const userId = request.headers.get("X-User-Id")!;
    const displayName = request.headers.get("X-Display-Name") ?? "Someone";
    const hidden = request.headers.get("X-Hide-Presence") === "1";
    const session = request.headers.get("X-Session") ?? "";
    const wasOnline = this.isUserOnline(userId);

    const { 0: client, 1: server } = new WebSocketPair();
    // Tagged by user (for notifications) and by device session (so one device can be signed out remotely).
    this.ctx.acceptWebSocket(server, session ? [userId, `s:${session}`] : [userId]);
    server.serializeAttachment({ userId, displayName, hidden } satisfies LobbyAttachment);

    const contacts = await this.contactsOf(userId);
    const online = hidden ? [] : contacts.filter((id) => this.isUserOnline(id) && !this.isHidden(id));
    server.send(JSON.stringify({ type: "hello", online } satisfies LobbyEvent));

    if (!wasOnline && !hidden) this.sendTo(contacts, { type: "presence", userId, online: true, lastSeenAt: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Relays WebRTC call signaling (offer / answer / network candidates / hang-up)
   * between two people who share a conversation. The call audio/video itself
   * flows directly between the two browsers, never through here.
   * Keep-alive pings are auto-answered and never reach this method.
   */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 64_000) return;
    let msg: CallEnvelope;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg?.type !== "call") return;
    const { to, roomId, callId, signal } = msg;
    if (
      typeof to !== "string" ||
      !UUID_RE.test(roomId ?? "") ||
      typeof callId !== "string" ||
      callId.length > 64 ||
      !signal ||
      !(CALL_SIGNAL_TYPES as readonly string[]).includes(signal.type)
    ) {
      return;
    }

    const me = ws.deserializeAttachment() as LobbyAttachment;
    if (!(await this.canCall(me.userId, to, roomId))) return;

    // Nobody to ring: tell the caller straight away instead of ringing forever.
    if (signal.type === "invite" && !this.isUserOnline(to)) {
      ws.send(
        JSON.stringify({ type: "call", from: to, fromName: "", roomId, callId, signal: { type: "unavailable" } } satisfies LobbyEvent),
      );
      return;
    }

    this.sendTo([to], { type: "call", from: me.userId, fromName: me.displayName, roomId, callId, signal });

    // Answered or declined on one device: stop ringing on the user's other devices.
    if (signal.type === "accept" || signal.type === "decline") {
      const handled = JSON.stringify({
        type: "call",
        from: to,
        fromName: "",
        roomId,
        callId,
        signal: { type: "handled" },
      } satisfies LobbyEvent);
      for (const other of this.ctx.getWebSockets(me.userId)) {
        if (other !== ws) {
          try {
            other.send(handled);
          } catch {
            // gone
          }
        }
      }
    }
  }

  /** Only two different people who are both members of the given conversation may call each other. */
  private async canCall(from: string, to: string, roomId: string): Promise<boolean> {
    if (from === to) return false;
    const key = `${from}|${to}|${roomId}`;
    const cached = this.callPermissions.get(key);
    if (cached && cached > Date.now()) return true;
    const row = await this.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM room_members m
         JOIN rooms r ON r.id = m.room_id AND r.status = 'accepted'
        WHERE m.room_id = ?1 AND m.user_id IN (?2, ?3)`,
    )
      .bind(roomId, from, to)
      .first<{ n: number }>();
    if (row?.n !== 2) return false;
    // No calls while a block exists in either direction.
    const blocked = await this.env.DB.prepare(
      "SELECT 1 FROM blocks WHERE (blocker_id = ?1 AND blocked_id = ?2) OR (blocker_id = ?2 AND blocked_id = ?1) LIMIT 1",
    )
      .bind(from, to)
      .first();
    if (blocked) return false;
    this.callPermissions.set(key, Date.now() + 10 * 60 * 1000);
    return true;
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, "Closing");
    } catch {
      // already closed
    }
    await this.onDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  // ---------- RPC (called by the Worker and room Durable Objects) ----------

  /** Sends an event to every open tab of the given users. */
  async notify(userIds: string[], event: LobbyEvent): Promise<void> {
    this.sendTo(userIds, event);
  }

  /** When two people start a chat, tell each whether the other is online right now. */
  async introduce(a: string, b: string): Promise<void> {
    for (const [viewer, subject] of [
      [a, b],
      [b, a],
    ]) {
      if (this.isUserOnline(subject) && !this.isHidden(subject) && !this.isHidden(viewer)) {
        this.sendTo([viewer], { type: "presence", userId: subject, online: true, lastSeenAt: null });
      }
    }
  }

  /** Called when someone changes their "Last seen" privacy setting. */
  async setHidden(userId: string, hidden: boolean): Promise<void> {
    const sockets = this.ctx.getWebSockets(userId);
    if (sockets.length === 0) return;
    const before = this.isHidden(userId);
    for (const ws of sockets) {
      const att = (ws.deserializeAttachment() ?? {}) as LobbyAttachment;
      ws.serializeAttachment({ ...att, hidden });
    }
    if (before === hidden) return;
    const contacts = await this.contactsOf(userId);
    // Others stop (or start) seeing them online...
    this.sendTo(contacts, { type: "presence", userId, online: !hidden, lastSeenAt: null });
    // ...and they stop (or start) seeing others.
    const visible = hidden ? [] : contacts.filter((id) => this.isUserOnline(id) && !this.isHidden(id));
    this.sendTo([userId], { type: "hello", online: visible });
  }

  async onlineAmong(userIds: string[]): Promise<string[]> {
    return userIds.filter((id) => this.isUserOnline(id));
  }

  /** Disconnects a user everywhere (suspended / deleted / signed out). */
  async kick(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) {
      try {
        ws.close(4001, "Signed out");
      } catch {
        // already closed
      }
    }
  }

  /** One device was signed out from another: close its live connection right away. */
  async kickSession(sessionId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(`s:${sessionId}`)) {
      try {
        // Tell the app first (it signs out straight away), then hang up.
        ws.send(JSON.stringify({ type: "signed-out" } satisfies LobbyEvent));
        ws.close(4001, "Signed out");
      } catch {
        // already closed
      }
    }
  }

  // ---------- internals ----------

  private isHidden(userId: string): boolean {
    return this.ctx.getWebSockets(userId).some((ws) => ((ws.deserializeAttachment() ?? {}) as LobbyAttachment).hidden === true);
  }

  private isUserOnline(userId: string, exclude?: WebSocket): boolean {
    return this.ctx
      .getWebSockets(userId)
      .some((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN);
  }

  private async onDisconnect(ws: WebSocket): Promise<void> {
    const { userId, hidden } = (ws.deserializeAttachment() ?? {}) as Partial<LobbyAttachment>;
    if (!userId || this.isUserOnline(userId, ws)) return;

    const lastSeenAt = Date.now();
    await this.env.DB.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2").bind(lastSeenAt, userId).run();
    if (!hidden) this.sendTo(await this.contactsOf(userId), { type: "presence", userId, online: false, lastSeenAt });
  }

  /** Everyone the user shares a conversation with. */
  private async contactsOf(userId: string): Promise<string[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT DISTINCT other.user_id
         FROM room_members me
         JOIN room_members other ON other.room_id = me.room_id AND other.user_id != me.user_id
         JOIN rooms r ON r.id = me.room_id AND r.status = 'accepted'
        WHERE me.user_id = ?1
          AND NOT EXISTS (SELECT 1 FROM blocks b
             WHERE (b.blocker_id = me.user_id AND b.blocked_id = other.user_id)
                OR (b.blocker_id = other.user_id AND b.blocked_id = me.user_id))`,
    )
      .bind(userId)
      .all<{ user_id: string }>();
    return results.map((r) => r.user_id);
  }

  private sendTo(userIds: string[], event: LobbyEvent): void {
    const data = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      for (const ws of this.ctx.getWebSockets(id)) {
        try {
          ws.send(data);
        } catch {
          // socket went away
        }
      }
    }
  }
}
