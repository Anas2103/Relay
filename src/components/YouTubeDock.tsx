import { useEffect, useRef, useState } from "react";
import { attachYouTube, clearMusic, toggle, useMusic, youtubeEvent } from "../lib/music";
import { embedUrl, useYouTube } from "../lib/youtube";
import { PauseIcon, PlayIcon, XIcon } from "./ui";

/**
 * The small floating player for full songs. It stays on screen while a song plays
 * (YouTube's rules: the video must be visible), and you can drag it to any corner.
 * It's mounted once for the whole app, so the music keeps going while you chat.
 */
export function YouTubeDock() {
  const m = useMusic();
  if (!m.video) return null;
  return <Dock video={m.video} />;
}

function Dock({ video }: { video: string }) {
  const m = useMusic();
  const frame = useRef<HTMLIFrameElement>(null);
  // The player is created once with the first song; later songs load into the same player
  // (so the browser keeps letting it play with sound).
  const [first] = useState(video);
  const [src] = useState(() => embedUrl(first, { autoplay: 1, controls: 0, disablekb: 1, fs: 0 }));
  const { yt, command } = useYouTube(frame, "dock");
  const loaded = useRef(first);
  // Out of the way: above your profile on a computer, under the header on a phone.
  const [corner, setCorner] = useState<"br" | "bl" | "tr" | "tl">(() => (window.matchMedia("(min-width: 768px)").matches ? "bl" : "tr"));
  const [stuck, setStuck] = useState(false);
  const t = m.queue[m.index];

  // Let the player engine drive this player.
  useEffect(() => {
    attachYouTube({
      load: (id) => {
        if (loaded.current === id) {
          command("seekTo", [0, true]);
          command("playVideo");
        } else {
          loaded.current = id;
          command("loadVideoById", [{ videoId: id, startSeconds: 0 }]);
        }
      },
      play: () => command("playVideo"),
      pause: () => command("pauseVideo"),
      seek: (s) => command("seekTo", [s, true]),
      volume: (v) => command("setVolume", [v]),
    });
    return () => attachYouTube(null);
  }, [command]);

  // ...and report back what it's doing.
  // (Each change reported once: "ended" twice would skip two songs.)
  useEffect(() => youtubeEvent({ state: yt.state }), [yt.state]);
  useEffect(() => youtubeEvent({ time: yt.time, duration: yt.duration }), [yt.time, yt.duration]);
  useEffect(() => {
    if (yt.error !== null) youtubeEvent({ error: true });
  }, [yt.error]);

  useEffect(() => {
    if (yt.ready) command("setVolume", [m.volume]);
  }, [yt.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Some browsers (iPhone) only start a video from a tap on the video itself.
  useEffect(() => {
    setStuck(false);
    const timer = window.setTimeout(() => setStuck(yt.state !== 1 && yt.state !== 3), 4000);
    return () => window.clearTimeout(timer);
  }, [video]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (yt.state === 1) setStuck(false);
  }, [yt.state]);

  const place = { br: "right-3 bottom-24", bl: "left-3 bottom-[76px]", tr: "right-3 top-[68px]", tl: "left-3 top-[68px]" }[corner];
  const nextCorner = { br: "bl", bl: "tl", tl: "tr", tr: "br" } as const;

  return (
    <div
      className={`fixed z-40 w-[200px] overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10 transition-all md:w-[240px] ${place}`}
      style={{ marginBottom: corner.startsWith("b") ? "env(safe-area-inset-bottom)" : undefined }}
      aria-label="Now playing video"
    >
      <div className="relative h-[200px] md:h-[200px]">
        <iframe
          ref={frame}
          src={src}
          title={t ? `${t.title} — ${t.artist}` : "Music"}
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          className={`size-full border-0 ${stuck ? "" : "pointer-events-none"}`}
        />
        {stuck && (
          <p className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs font-semibold text-white drop-shadow">Tap the video to start</p>
        )}
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5 text-white">
        <button onClick={toggle} aria-label={m.playing ? "Pause music" : "Play music"} className="rounded-full p-1.5 hover:bg-white/15">
          {m.playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </button>
        <button onClick={() => setCorner(nextCorner[corner])} className="min-w-0 flex-1 text-left" title="Move to another corner">
          <span className="block truncate text-xs font-semibold">{t?.title ?? "Music"}</span>
          <span className="block truncate text-[10px] text-white/60">{t?.artist} · YouTube</span>
        </button>
        <button onClick={clearMusic} aria-label="Stop music" className="rounded-full p-1.5 text-white/70 hover:bg-white/15 hover:text-white">
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
