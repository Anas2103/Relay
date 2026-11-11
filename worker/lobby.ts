import { DurableObject } from "cloudflare:workers";
import type { LobbyEvent } from "../shared/types";
import type { Env } from "./env";

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
    const wasOnline = this.isUserOnline(userId);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId });

    const contacts = await this.contactsOf(userId);
    const online = contacts.filter((id) => this.isUserOnline(id));
    server.send(JSON.stringify({ type: "hello", online } satisfies LobbyEvent));

    if (!wasOnline) this.sendTo(contacts, { type: "presence", userId, online: true, lastSeenAt: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(): Promise<void> {
    // Clients only send keep-alive pings, which are auto-answered.
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
      if (this.isUserOnline(subject)) {
        this.sendTo([viewer], { type: "presence", userId: subject, online: true, lastSeenAt: null });
      }
    }
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

  // ---------- internals ----------

  private isUserOnline(userId: string, exclude?: WebSocket): boolean {
    return this.ctx
      .getWebSockets(userId)
      .some((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN);
  }

  private async onDisconnect(ws: WebSocket): Promise<void> {
    const { userId } = (ws.deserializeAttachment() ?? {}) as { userId?: string };
    if (!userId || this.isUserOnline(userId, ws)) return;

    const lastSeenAt = Date.now();
    await this.env.DB.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2").bind(lastSeenAt, userId).run();
    this.sendTo(await this.contactsOf(userId), { type: "presence", userId, online: false, lastSeenAt });
  }

  /** Everyone the user shares a conversation with. */
  private async contactsOf(userId: string): Promise<string[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT DISTINCT other.user_id
         FROM room_members me
         JOIN room_members other ON other.room_id = me.room_id AND other.user_id != me.user_id
        WHERE me.user_id = ?1`,
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
