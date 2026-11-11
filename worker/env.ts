import type { Lobby } from "./lobby";
import type { ChatRoom } from "./room";

export interface Env {
  DB: D1Database;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
}

/** There is one Lobby instance for the whole app (presence + sidebar updates). */
export function lobby(env: Env) {
  return env.LOBBY.get(env.LOBBY.idFromName("global"));
}

export function room(env: Env, roomId: string) {
  return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(roomId));
}
