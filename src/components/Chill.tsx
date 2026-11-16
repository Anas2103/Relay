import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ChillTrack, ChillVideo, Me } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { FunTab } from "./chill/Fun";
import { PodcastsTab } from "./chill/Podcasts";
import { RadioTab } from "./chill/Radio";
import { GamesHub } from "./games/GamesHub";
import {
  addToQueue,
  clearMusic,
  cycleRepeat,
  formatTime,
  music,
  next,
  pause as pauseMusic,
  playList,
  playNextInQueue,
  prev,
  removeFromQueue,
  seek,
  setRate,
  setShuffle,
  skipBy,
  setVolume,
  toggle,
  trackArt,
  useMusic,
} from "../lib/music";
import {
  BackIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClapperIcon,
  ListIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  SearchIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPrevIcon,
  Spinner,
  VolumeIcon,
  VolumeOffIcon,
  XIcon,
} from "./ui";

export type ChillTab = "shorts" | "music" | "radio" | "podcasts" | "games" | "fun";

const TABS: [ChillTab, string, string][] = [
  ["shorts", "Shorts", "🎬"],
  ["music", "Music", "🎵"],
  ["radio", "Radio", "📻"],
  ["podcasts", "Podcasts", "🎙️"],
  ["games", "Games", "🎮"],
  ["fun", "Fun", "😂"],
];

const TOPICS: [string, string][] = [
  ["foryou", "For you"],
  ["funny", "Funny"],
  ["music", "Music"],
  ["gaming", "Gaming"],
  ["football", "Football"],
  ["satisfying", "Satisfying"],
  ["food", "Food"],
  ["animals", "Animals"],
];

const YT = "https://www.youtube-nocookie.com";

/** Chill: YouTube Shorts and music, just to scroll, listen and pass the time. */
export function ChillView({ me, tab, onTab, onClose }: { me: Me; tab: ChillTab; onTab: (t: ChillTab) => void; onClose: () => void }) {
  const [youtube, setYoutube] = useState<boolean | null>(null);
  useEffect(() => {
    api.chillStatus().then(
      (s) => setYoutube(s.youtube),
      () => setYoutube(false),
    );
  }, []);

  const m = useMusic();
  const withPlayer = (tab === "music" || tab === "radio" || tab === "podcasts") && !!m.queue[m.index];

  return (
    <div className="panel flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 px-2 pt-2 md:px-3">
        <button onClick={onClose} aria-label="Back to chats" title="Back to chats" className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <BackIcon className="size-5" />
        </button>
        <h2 className="text-lg font-semibold tracking-tight">Chill</h2>
      </header>
      <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto px-3 pt-1 pb-2" role="tablist" aria-label="Chill">
        {TABS.map(([id, label, emoji]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              tab === id ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            <span aria-hidden="true">{emoji}</span>
            {label}
          </button>
        ))}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {tab === "shorts" ? (
            youtube === null ? (
              <Centered>
                <Spinner className="size-6" />
              </Centered>
            ) : youtube ? (
              <ShortsFeed />
            ) : (
              <ShortsSetup owner={!!me.superAdmin} />
            )
          ) : tab === "music" ? (
            <MusicTab />
          ) : tab === "radio" ? (
            <RadioTab />
          ) : tab === "podcasts" ? (
            <PodcastsTab />
          ) : tab === "games" ? (
            <GamesHub />
          ) : (
            <FunTab />
          )}
        </div>
        {withPlayer && <NowPlaying />}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">{children}</div>;
}

function ShortsSetup({ owner }: { owner: boolean }) {
  return (
    <Centered>
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent-fg">
        <ClapperIcon className="size-7" />
      </div>
      <h3 className="text-lg font-semibold">Shorts aren't switched on yet</h3>
      {owner ? (
        <div className="max-w-md space-y-2 text-left text-sm text-zinc-600 dark:text-zinc-300">
          <p>Shorts need a free YouTube API key (one time, about 5 minutes):</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open console.cloud.google.com, create a project.</li>
            <li>APIs &amp; Services → Library → enable “YouTube Data API v3”.</li>
            <li>Credentials → Create credentials → API key. Restrict it to “YouTube Data API v3”.</li>
            <li>
              In the Relay folder run <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npx wrangler secret put YOUTUBE_API_KEY</code> and paste it.
            </li>
          </ol>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">It's free: 10,000 units a day, and Relay caches feeds so everyone shares them.</p>
        </div>
      ) : (
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">The owner still needs to turn them on. Music works already →</p>
      )}
    </Centered>
  );
}

// ---------- Shorts ----------

function ShortsFeed() {
  const [topic, setTopic] = useState("foryou");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [videos, setVideos] = useState<ChillVideo[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // Start muted when music is playing, so the two don't play over each other.
  const [muted, setMuted] = useState(() => music.get().playing);
  const scroller = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const feedKey = `${topic}|${query}`;

  const load = useCallback(
    async (reset: boolean, page?: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const r = await api.shorts({ topic, q: query, page });
        setVideos((v) => {
          const all = reset ? r.videos : [...v, ...r.videos];
          const seen = new Set<string>();
          return all.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
        });
        setNextPage(r.next);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn't load Shorts.");
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [topic, query],
  );

  useEffect(() => {
    setVideos([]);
    setActive(0);
    scroller.current?.scrollTo({ top: 0 });
    void load(true);
  }, [feedKey, load]);

  // Which Short is on screen.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-i]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [videos.length]);

  // Keep the feed going.
  useEffect(() => {
    if (nextPage && active >= videos.length - 4) void load(false, nextPage);
  }, [active, videos.length, nextPage, load]);

  const go = useCallback((delta: number) => {
    const root = scroller.current;
    if (root) root.scrollBy({ top: delta * root.clientHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      if (e.key === "ArrowDown" || e.key === "j") (e.preventDefault(), go(1));
      if (e.key === "ArrowUp" || e.key === "k") (e.preventDefault(), go(-1));
      if (e.key === "m") setMuted((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const unmute = (m: boolean) => {
    setMuted(m);
    if (!m) pauseMusic(); // Short's sound on: the music steps aside
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <form onSubmit={search} className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 dark:bg-zinc-800">
          <SearchIcon className="size-4 shrink-0 text-zinc-400" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search Shorts"
            aria-label="Search Shorts"
            enterKeyHint="search"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setQuery("");
              }}
              aria-label="Clear search"
              className="text-zinc-400 hover:text-zinc-600"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </form>
        {!query && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Shorts topics">
            {TOPICS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={topic === id}
                onClick={() => setTopic(id)}
                className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition ${
                  topic === id ? "bg-accent text-accent-ink" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-black md:mx-3 md:mb-3 md:rounded-2xl md:overflow-hidden">
        <div ref={scroller} className="no-scrollbar h-full snap-y snap-mandatory overflow-y-auto overscroll-contain" aria-label="Shorts" data-testid="shorts-feed">
          {videos.map((v, i) => (
            <section key={v.id} data-i={i} className="relative flex h-full snap-start snap-always items-center justify-center">
              <ShortPlayer
                video={v}
                active={i === active}
                near={Math.abs(i - active) <= 1}
                muted={muted}
                onMuted={unmute}
                onSkip={() => i === active && go(1)}
              />
            </section>
          ))}
          {(loading || error || videos.length === 0) && (
            <div className="flex h-full snap-start items-center justify-center p-6 text-center text-sm text-white/70">
              {loading ? (
                <Spinner className="size-6" />
              ) : error ? (
                <div className="space-y-3">
                  <p>{error}</p>
                  <button onClick={() => void load(videos.length === 0, nextPage ?? undefined)} className="rounded-full bg-white/15 px-4 py-1.5 font-medium text-white hover:bg-white/25">
                    Try again
                  </button>
                </div>
              ) : (
                "Nothing found."
              )}
            </div>
          )}
        </div>
        {videos.length > 0 && (
          <div className="absolute top-1/2 right-3 z-10 hidden -translate-y-1/2 flex-col gap-2 md:flex">
            <button onClick={() => go(-1)} disabled={active === 0} aria-label="Previous Short" className="rounded-full bg-white/15 p-2.5 text-white backdrop-blur hover:bg-white/25 disabled:opacity-30">
              <ChevronUpIcon className="size-5" />
            </button>
            <button onClick={() => go(1)} aria-label="Next Short" className="rounded-full bg-white/15 p-2.5 text-white backdrop-blur hover:bg-white/25">
              <ChevronDownIcon className="size-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One Short. Only the one on screen gets YouTube's player (the rest are pictures),
 * controlled with YouTube's postMessage commands, so no extra script is loaded.
 */
function ShortPlayer({
  video,
  active,
  near,
  muted,
  onMuted,
  onSkip,
}: {
  video: ChillVideo;
  active: boolean;
  near: boolean;
  muted: boolean;
  onMuted: (m: boolean) => void;
  onSkip: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  // The URL is fixed when the player is created; later mute changes go by command.
  const [src] = useState(
    () =>
      `${YT}/embed/${video.id}?enablejsapi=1&autoplay=1&playsinline=1&controls=0&rel=0&loop=1&playlist=${video.id}&iv_load_policy=3&disablekb=1&mute=${muted ? 1 : 0}&origin=${encodeURIComponent(location.origin)}`,
  );

  const command = useCallback((func: string, args: unknown[] = []) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), YT);
  }, []);

  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setUserPaused(false);
      return;
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const stateOf = (info: unknown) =>
        typeof info === "number" ? info : typeof info === "object" && info && "playerState" in info ? (info as { playerState: number }).playerState : undefined;
      if (data.event === "onError") {
        setFailed(true);
        window.setTimeout(onSkip, 1200);
      } else if (data.event === "onStateChange" || data.event === "infoDelivery" || data.event === "initialDelivery") {
        const s = stateOf(data.info);
        if (s === 1) setPlaying(true);
        else if (s === 2 || s === 0) setPlaying(false);
      }
    };
    window.addEventListener("message", onMessage);
    // YouTube only reports its state after a "listening" hello.
    let tries = 0;
    const hello = window.setInterval(() => {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: video.id, channel: "widget" }), YT);
      if (++tries > 20) window.clearInterval(hello);
    }, 400);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(hello);
    };
  }, [active, video.id, onSkip]);

  // Sound on/off follows the button (and the M key).
  useEffect(() => {
    if (!active) return;
    command(muted ? "mute" : "unMute");
    if (!muted) command("setVolume", [100]);
  }, [muted, active, command]);

  // Browsers may refuse to autoplay with sound: then play muted and show the sound button.
  useEffect(() => {
    if (!active || muted || playing || userPaused || failed) return;
    const t = window.setTimeout(() => {
      onMuted(true);
      command("mute");
      command("playVideo");
    }, 2500);
    return () => window.clearTimeout(t);
  }, [active, muted, playing, userPaused, failed, command, onMuted]);

  const tap = () => {
    if (playing) {
      command("pauseVideo");
      setUserPaused(true);
    } else {
      command("playVideo");
      setUserPaused(false);
    }
  };

  return (
    <div className="relative aspect-[9/16] h-full max-w-full overflow-hidden bg-zinc-900">
      <img src={video.thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-60 blur-sm" />
      {active && !failed && near && (
        <iframe
          ref={frame}
          src={src}
          title={video.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          // YouTube refuses to play without knowing which site embeds it.
          referrerPolicy="strict-origin-when-cross-origin"
          className="pointer-events-none absolute inset-0 size-full border-0"
        />
      )}
      {/* Tap anywhere to pause/play; swipes scroll to the next Short. */}
      <button onClick={tap} aria-label={playing ? "Pause" : "Play"} className="absolute inset-0 z-[1] cursor-pointer" />
      {active && userPaused && !playing && (
        <span className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
          <span className="rounded-full bg-black/50 p-5 text-white">
            <PlayIcon className="size-8 translate-x-0.5" />
          </span>
        </span>
      )}
      {failed && (
        <span className="absolute inset-0 z-[2] flex items-center justify-center p-6 text-center text-sm text-white/80">This one can't play here — skipping…</span>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-16 text-white">
        <p className="line-clamp-2 text-sm font-semibold drop-shadow">{video.title}</p>
        <p className="mt-0.5 text-xs text-white/75">{video.channel} · YouTube</p>
      </div>
      <button
        onClick={() => onMuted(!muted)}
        aria-label={muted ? "Sound on" : "Sound off"}
        title={muted ? "Sound on (M)" : "Sound off (M)"}
        className={`absolute top-3 right-3 z-[3] flex items-center gap-1.5 rounded-full p-2.5 text-white backdrop-blur transition ${muted ? "bg-accent text-accent-ink" : "bg-black/40 hover:bg-black/60"}`}
      >
        {muted ? <VolumeOffIcon className="size-5" /> : <VolumeIcon className="size-5" />}
        {muted && active && <span className="pr-1 text-xs font-semibold">Tap for sound</span>}
      </button>
    </div>
  );
}

// ---------- Music ----------

function MusicTab() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<ChillTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = useMusic();
  const current = m.queue[m.index];

  // Search as you type (after a short pause).
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(draft.trim()), 450);
    return () => window.clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!query) {
      setTracks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Real songs from Apple Music's catalog: you pick the exact one, then it plays in full.
    api.songs(query).then(
      (r) => !cancelled && (setTracks(r.tracks), setLoading(false)),
      (err) => !cancelled && (setError(err instanceof ApiError ? err.message : "Couldn't search."), setLoading(false)),
    );
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 pb-2">
          <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 dark:bg-zinc-800">
            <SearchIcon className="size-4 shrink-0 text-zinc-400" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a song or an artist"
              aria-label="Search music"
              enterKeyHint="search"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {draft && (
              <button onClick={() => setDraft("")} aria-label="Clear search" className="text-zinc-400 hover:text-zinc-600">
                <XIcon className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-xs text-zinc-500 dark:text-zinc-400">
            {query ? `Results for “${query}” · tap a song to play it in full` : "Pick the exact song you want · keeps playing while you chat"}
          </p>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Songs">
          {loading && tracks.length === 0 ? (
            <li className="flex justify-center p-8">
              <Spinner className="size-6" />
            </li>
          ) : error ? (
            <li className="p-8 text-center text-sm text-zinc-500">{error}</li>
          ) : !query ? (
            <li className="flex flex-col items-center gap-2 p-10 text-center text-sm text-zinc-500">
              <MusicIcon className="size-8 opacity-50" />
              Type a song name or an artist above, then choose the song.
            </li>
          ) : tracks.length === 0 ? (
            <li className="p-8 text-center text-sm text-zinc-500">No songs found. Check the spelling or try the artist's name.</li>
          ) : (
            tracks.map((t, i) => {
              const isCurrent = current?.id === t.id;
              return (
                <li key={t.id} className={`group flex items-center gap-3 rounded-xl px-2 py-1.5 ${isCurrent ? "bg-accent/10" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"}`}>
                  <button onClick={() => (isCurrent ? toggle() : playList(tracks, i))} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Play ${t.title} by ${t.artist}`}>
                    <Art track={t} className="size-11 rounded-lg" playing={isCurrent && m.playing} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-medium ${isCurrent ? "text-accent-fg" : ""}`}>{t.title}</span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{t.artist}</span>
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{formatTime(t.duration)}</span>
                  </button>
                  <button onClick={() => playNextInQueue(t)} title="Play next" aria-label={`Play ${t.title} next`} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
                    <ListIcon className="size-4" />
                  </button>
                  <button onClick={() => addToQueue(t)} title="Add to queue" aria-label={`Add ${t.title} to the queue`} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
                    <PlusIcon className="size-4" />
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

function Art({ track, className, playing }: { track: ChillTrack; className: string; playing?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = trackArt(track);
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-zinc-200 text-zinc-400 dark:bg-zinc-700 ${className}`}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" /> : <MusicIcon className="size-1/2" />}
      {playing && (
        <span className="absolute inset-0 flex items-end justify-center gap-0.5 bg-black/40 pb-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="eq-bar w-1 rounded-full bg-white" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      )}
    </span>
  );
}

const PODCAST_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** The full player: cover, seek bar, controls, volume, queue. */
function NowPlaying() {
  const m = useMusic();
  const t = m.queue[m.index];
  const [showQueue, setShowQueue] = useState(false);
  if (!t) return null;
  const duration = m.duration || t.duration;
  return (
    <aside className="divider-t shrink-0 p-3 md:w-80 md:overflow-y-auto md:border-t-0 md:border-l md:border-zinc-200 md:dark:border-zinc-800" aria-label="Now playing">
      <div className="flex items-center gap-3 md:flex-col md:items-stretch">
        <Art track={t} className="size-14 rounded-xl md:aspect-square md:size-auto md:w-full md:rounded-2xl" />
        <div className="min-w-0 flex-1 md:mt-2">
          <p className="truncate font-semibold">{t.title}</p>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{t.artist}</p>
          {m.error && <p className="text-xs text-red-500">{m.error}</p>}
        </div>
      </div>
      {t.live ? (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-red-500">
          <span className={`size-2 rounded-full bg-red-500 ${m.playing ? "animate-pulse" : ""}`} /> LIVE
          <span className="font-normal text-zinc-500 tabular-nums">{m.playing ? formatTime(m.time) : "paused"}</span>
        </p>
      ) : (
        <div className="mt-3">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(duration))}
            value={Math.min(Math.round(m.time), Math.round(duration))}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            aria-valuetext={formatTime(m.time)}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-xs text-zinc-500 tabular-nums">
            <span>{formatTime(m.time)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}
      {t.kind === "podcast" && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <button onClick={() => skipBy(-15)} className="rounded-full px-2.5 py-1 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Back 15 seconds">
            ↺ 15s
          </button>
          <button
            onClick={() => setRate(PODCAST_RATES[(PODCAST_RATES.indexOf(m.rate) + 1) % PODCAST_RATES.length])}
            className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold dark:bg-zinc-800"
            aria-label={`Speed ${m.rate}×`}
          >
            {m.rate}×
          </button>
          <button onClick={() => skipBy(30)} className="rounded-full px-2.5 py-1 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Forward 30 seconds">
            30s ↻
          </button>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between">
        <IconToggle label="Shuffle" active={m.shuffle} onClick={() => setShuffle(!m.shuffle)}>
          <ShuffleIcon className="size-5" />
        </IconToggle>
        <button onClick={prev} aria-label="Previous song" className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <SkipPrevIcon className="size-5" />
        </button>
        <button onClick={toggle} aria-label={m.playing ? "Pause music" : "Play music"} className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow transition active:scale-95">
          {m.loading && m.playing ? <Spinner className="size-5" /> : m.playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5 translate-x-px" />}
        </button>
        <button onClick={() => next()} aria-label="Next song" className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <SkipNextIcon className="size-5" />
        </button>
        <IconToggle label={m.repeat === "one" ? "Repeat this song" : m.repeat === "all" ? "Repeat all" : "Repeat off"} active={m.repeat !== "off"} onClick={cycleRepeat}>
          <span className="relative">
            <RepeatIcon className="size-5" />
            {m.repeat === "one" && <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold">1</span>}
          </span>
        </IconToggle>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => setVolume(m.volume > 0 ? 0 : 80)} aria-label={m.volume > 0 ? "Mute music" : "Unmute music"} className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          {m.volume > 0 ? <VolumeIcon className="size-4" /> : <VolumeOffIcon className="size-4" />}
        </button>
        <input type="range" min={0} max={100} value={m.volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Music volume" className="min-w-0 flex-1 accent-[var(--accent)]" />
        <button onClick={() => setShowQueue((s) => !s)} aria-expanded={showQueue} className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          Queue ({m.queue.length})
        </button>
      </div>
      {showQueue && (
        <ol className="mt-2 max-h-60 space-y-0.5 overflow-y-auto md:max-h-none" aria-label="Queue">
          {m.queue.map((q, i) => (
            <li key={`${q.id}-${i}`} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${i === m.index ? "bg-accent/10 text-accent-fg" : ""}`}>
              <button onClick={() => playList(m.queue, i)} className="min-w-0 flex-1 truncate text-left">
                {q.title} <span className="text-xs text-zinc-500">· {q.artist}</span>
              </button>
              {i !== m.index && (
                <button onClick={() => removeFromQueue(i)} aria-label={`Remove ${q.title} from the queue`} className="text-zinc-400 hover:text-zinc-700">
                  <XIcon className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function IconToggle({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={active} title={label} className={`rounded-full p-2 transition ${active ? "text-accent-fg" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>
      {children}
    </button>
  );
}

/** A small "now playing" bar for the chat list, so the music keeps going while you chat. */
export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const m = useMusic();
  const t = m.queue[m.index];
  if (!t || !m.started || m.video) return null;
  const progress = (m.duration || t.duration) > 0 ? m.time / (m.duration || t.duration) : 0;
  return (
    <div className="relative mx-2 mb-1 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800" aria-label="Music player">
      <div className="flex items-center gap-2 p-1.5">
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Open Chill → Music">
          <Art track={t} className="size-9 rounded-lg" playing={m.playing} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t.title}</span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{t.artist}</span>
          </span>
        </button>
        <button onClick={prev} aria-label="Previous song" className="rounded-full p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">
          <SkipPrevIcon className="size-4" />
        </button>
        <button onClick={toggle} aria-label={m.playing ? "Pause music" : "Play music"} className="rounded-full p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">
          {m.playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </button>
        <button onClick={() => next()} aria-label="Next song" className="rounded-full p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">
          <SkipNextIcon className="size-4" />
        </button>
        <button onClick={clearMusic} aria-label="Stop music" className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700">
          <XIcon className="size-4" />
        </button>
      </div>
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent/80" style={{ width: `${Math.min(100, progress * 100)}%` }} />
    </div>
  );
}
