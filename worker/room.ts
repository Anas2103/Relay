import { DurableObject } from "cloudflare:workers";
import { LIMITS, type ClientEvent, type Message, type ServerEvent } from "../shared/types";
import type { Env } from "./env";

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

/**
 * One instance per chat room. Holds every open WebSocket for that room and
 * broadcasts messages, typing and presence. Uses the WebSocket Hibernation API,
 * so an idle room costs nothing while connections stay open.
 *
 * Only reachable through the Worker, which has already checked the session and
 * room membership and passes the verified identity in X-* headers.
 */
export class ChatRoom extends DurableObject<Env> {
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

  /**
   * RPC called by the admin API: disconnect every socket belonging to a user
   * (suspended, deleted or signed out everywhere). Close code 4001 tells the
   * client not to reconnect.
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

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 10_000) return;

    let event: ClientEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;

    if (event.type === "typing") {
      this.broadcast(
        { type: "typing", userId: att.userId, displayName: att.displayName, isTyping: !!event.isTyping },
        ws,
      );
      return;
    }
    if (event.type !== "send") return;

    const clientId = typeof event.clientId === "string" ? event.clientId.slice(0, 64) : undefined;
    const body = typeof event.body === "string" ? event.body.trim() : "";
    if (!body || body.length > LIMITS.messageMax) {
      this.sendTo(ws, { type: "error", message: `Messages must be 1–${LIMITS.messageMax} characters.`, clientId });
      return;
    }

    const now = Date.now();
    att.tokens = Math.min(BUCKET_SIZE, att.tokens + (now - att.refilledAt) / REFILL_MS);
    att.refilledAt = now;
    if (att.tokens < 1) {
      ws.serializeAttachment(att);
      this.sendTo(ws, { type: "error", message: "You're sending messages too fast.", clientId });
      return;
    }
    att.tokens -= 1;
    ws.serializeAttachment(att);

    const message: Message = {
      id: crypto.randomUUID(),
      roomId: att.roomId,
      userId: att.userId,
      username: att.username,
      displayName: att.displayName,
      body,
      createdAt: now,
    };

    try {
      await this.env.DB.prepare(
        "INSERT INTO messages (id, room_id, user_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
        .bind(message.id, message.roomId, message.userId, message.body, message.createdAt)
        .run();
    } catch (err) {
      console.error("Failed to save message", err);
      this.sendTo(ws, { type: "error", message: "Couldn't save your message. Try again.", clientId });
      return;
    }

    this.broadcast({ type: "message", message: { ...message, clientId } });
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
