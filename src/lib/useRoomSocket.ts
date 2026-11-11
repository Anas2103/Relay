import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientEvent, ServerEvent } from "../../shared/types";
import { UNAUTHORIZED_EVENT } from "./api";

export type SocketStatus = "connecting" | "open" | "reconnecting";
export type SocketEvent = ServerEvent | { type: "connected" };

/**
 * Keeps one WebSocket open to a room, reconnecting with exponential backoff.
 * Emits a synthetic "connected" event on every (re)connect so the caller can
 * catch up on anything missed while offline.
 */
export function useRoomSocket(roomId: string, onEvent: (event: SocketEvent) => void) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: number | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${roomId}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
        handlerRef.current({ type: "connected" });
      };
      ws.onmessage = (ev) => {
        try {
          handlerRef.current(JSON.parse(ev.data));
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = (ev) => {
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

    // Reconnect immediately when the tab comes back online.
    const onOnline = () => {
      if (!wsRef.current) {
        window.clearTimeout(timer);
        attempt = 0;
        connect();
      }
    };
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId]);

  const send = useCallback((event: ClientEvent): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(event));
    return true;
  }, []);

  return { status, send };
}
