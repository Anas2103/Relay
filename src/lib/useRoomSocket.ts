import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientEvent, LobbyEvent, ServerEvent } from "../../shared/types";
import { UNAUTHORIZED_EVENT } from "./api";

export type SocketStatus = "connecting" | "open" | "reconnecting";

const PING_MS = 25_000;

/**
 * Keeps one WebSocket open, reconnecting with exponential backoff and sending
 * keep-alive pings (mobile networks silently drop idle connections). Emits a
 * synthetic "connected" event on every (re)connect so the caller can catch up.
 */
function useSocket<E>(path: string | null, onEvent: (event: E | { type: "connected" }) => void) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!path) return; // disabled (e.g. maintenance mode)
    let stopped = false;
    let attempt = 0;
    let timer: number | undefined;
    let ping: number | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}${path}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
        handlerRef.current({ type: "connected" });
        window.clearInterval(ping);
        ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
      };
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        try {
          handlerRef.current(JSON.parse(ev.data));
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = (ev) => {
        window.clearInterval(ping);
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        if (ev.code === 4001) {
          // Server revoked this session; don't reconnect.
          window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
          return;
        }
        setStatus("reconnecting");
        const delay = Math.min(10_000, 500 * 2 ** attempt++) + Math.random() * 300;
        timer = window.setTimeout(connect, delay);
      };
    };

    setStatus("connecting");
    connect();

    // Reconnect immediately when the device comes back online or the tab wakes up.
    const reconnectNow = () => {
      if (!wsRef.current && !stopped) {
        window.clearTimeout(timer);
        attempt = 0;
        connect();
      }
    };
    const onVisible = () => document.visibilityState === "visible" && reconnectNow();
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [path]);

  const send = useCallback((event: unknown): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(event));
    return true;
  }, []);

  return { status, send };
}

export type SocketEvent = ServerEvent | { type: "connected" };

export function useRoomSocket(roomId: string, onEvent: (event: SocketEvent) => void) {
  const { status, send } = useSocket<ServerEvent>(`/api/rooms/${roomId}/ws`, onEvent);
  return { status, send: send as (event: ClientEvent) => boolean };
}

export function useLobbySocket(onEvent: (event: LobbyEvent | { type: "connected" }) => void, enabled = true) {
  return useSocket<LobbyEvent>(enabled ? "/api/lobby" : null, onEvent);
}
