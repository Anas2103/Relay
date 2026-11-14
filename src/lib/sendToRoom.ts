import type { ClientEvent, ServerEvent } from "../../shared/types";

/**
 * Sends one message into a chat through a short-lived connection, so it works
 * for chats that aren't open (forwarding, call records). Resolves when the
 * server confirms it, rejects with the server's error message otherwise.
 */
export function sendToRoom(roomId: string, event: Omit<Extract<ClientEvent, { type: "send" }>, "type" | "clientId">): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${roomId}/ws`);
    const clientId = crypto.randomUUID();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve();
    };
    const timeout = window.setTimeout(() => finish(new Error("Couldn't send. Check your connection.")), 10_000);
    ws.onopen = () => ws.send(JSON.stringify({ type: "send", clientId, ...event } satisfies ClientEvent));
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      let ev: ServerEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.type === "message" && ev.message.clientId === clientId) finish();
      else if (ev.type === "error" && ev.clientId === clientId) finish(new Error(ev.message));
    };
    ws.onclose = () => finish(new Error("Couldn't send. Check your connection."));
  });
}
