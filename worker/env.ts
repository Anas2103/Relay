import type { ChatRoom } from "./room";

export interface Env {
  DB: D1Database;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
}
