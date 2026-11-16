import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Talks to an embedded YouTube player (youtube-nocookie.com) through postMessage,
 * the documented "iframe API" protocol, without loading YouTube's script.
 */

export const YT_ORIGIN = "https://www.youtube-nocookie.com";

export function embedUrl(id: string, opts: Record<string, string | number> = {}): string {
  const p = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    iv_load_policy: "3",
    origin: location.origin,
    ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, String(v)])),
  });
  return `${YT_ORIGIN}/embed/${id}?${p}`;
}

export interface YtState {
  /** -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  state: number;
  time: number;
  duration: number;
  muted: boolean;
  error: number | null;
  ready: boolean;
}

export function useYouTube(frame: RefObject<HTMLIFrameElement | null>, key: string) {
  const [yt, setYt] = useState<YtState>({ state: -1, time: 0, duration: 0, muted: false, error: null, ready: false });
  const timeRef = useRef(0);

  const command = useCallback(
    (func: string, args: unknown[] = []) => {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), YT_ORIGIN);
    },
    [frame],
  );

  useEffect(() => {
    setYt({ state: -1, time: 0, duration: 0, muted: false, error: null, ready: false });
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (data.event === "onError") return setYt((s) => ({ ...s, error: Number(data.info) }));
      if (data.event === "onReady") return setYt((s) => ({ ...s, ready: true }));
      // A new video starting clears the last one's error.
      if (data.event === "onStateChange" && typeof data.info === "number")
        return setYt((s) => ({ ...s, state: data.info as number, ready: true, error: data.info === -1 || data.info === 1 ? null : s.error }));
      if ((data.event === "infoDelivery" || data.event === "initialDelivery") && data.info && typeof data.info === "object") {
        const i = data.info as { playerState?: number; currentTime?: number; duration?: number; muted?: boolean };
        if (typeof i.currentTime === "number") timeRef.current = i.currentTime;
        setYt((s) => ({
          ...s,
          ready: true,
          state: i.playerState ?? s.state,
          time: i.currentTime ?? s.time,
          duration: i.duration || s.duration,
          muted: i.muted ?? s.muted,
        }));
      }
    };
    window.addEventListener("message", onMessage);
    // The player only starts reporting after a "listening" hello.
    let tries = 0;
    const hello = window.setInterval(() => {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: key, channel: "widget" }), YT_ORIGIN);
      if (++tries > 25) window.clearInterval(hello);
    }, 400);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(hello);
    };
  }, [frame, key]);

  return { yt, command, timeRef };
}
