import { useSyncExternalStore } from "react";
import type { ChillTrack } from "../../shared/types";
import { calls } from "./calls";
import { applySpeaker, devicePrefs, liveChoice } from "./devices";

/**
 * Chill → Music: one player for the whole app, so a song keeps playing while you
 * chat. Two ways to play:
 *  - an <audio> element: radio, podcasts, song previews (all through Relay's server);
 *  - YouTube's player, for full songs: you pick a song from Apple Music's catalog
 *    (so it's the right one), and Relay plays its official YouTube version in a
 *    small player that stays on screen (YouTube requires the video to be visible).
 * Lock-screen / headphone buttons work through the Media Session API.
 */

export type Repeat = "off" | "all" | "one";

export interface MusicState {
  queue: ChillTrack[];
  index: number;
  playing: boolean;
  loading: boolean;
  /** Seconds. */
  time: number;
  duration: number;
  /** 0–100. */
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  error: string | null;
  /** Playback speed (podcasts); songs and radio always play at 1×. */
  rate: number;
  /** Something was played since the app opened (shows the mini player until you stop it). */
  started: boolean;
  /** The YouTube video playing the current song (shown in the floating player), if any. */
  video: string | null;
  /** Only a 30-second preview could be found for this song. */
  preview: boolean;
}

const KEY = "relay:music";

export const trackArt = (t: ChillTrack) => t.artUrl ?? (t.art ? `/api/chill/art/${t.id}` : null);
const streamUrl = (t: ChillTrack) => t.src ?? `/api/chill/stream/${t.id}`;

// ---------- podcasts: remember where you stopped ----------
const POS_KEY = "relay:podcast-pos";
function positions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function savePosition(id: string, seconds: number) {
  try {
    const all = positions();
    if (seconds < 5) delete all[id];
    else all[id] = Math.floor(seconds);
    // Keep the 200 most recent.
    const keys = Object.keys(all);
    if (keys.length > 200) delete all[keys[0]];
    localStorage.setItem(POS_KEY, JSON.stringify(all));
  } catch {
    // private mode
  }
}
export const resumeAt = (id: string) => positions()[id] ?? 0;

function load(): Pick<MusicState, "queue" | "index" | "volume" | "shuffle" | "repeat"> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MusicState>;
    const queue = Array.isArray(raw.queue) ? raw.queue.filter((t) => t && typeof t.id === "string").slice(0, 200) : [];
    return {
      queue,
      index: typeof raw.index === "number" && raw.index >= 0 && raw.index < queue.length ? raw.index : 0,
      volume: typeof raw.volume === "number" && raw.volume >= 0 && raw.volume <= 100 ? raw.volume : 80,
      shuffle: raw.shuffle === true,
      repeat: raw.repeat === "all" || raw.repeat === "one" ? raw.repeat : "off",
    };
  } catch {
    return { queue: [], index: 0, volume: 80, shuffle: false, repeat: "off" };
  }
}

let state: MusicState = { ...load(), playing: false, loading: false, time: 0, duration: 0, error: null, started: false, rate: 1, video: null, preview: false };
const listeners = new Set<() => void>();
let el: HTMLAudioElement | null = null;

function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
  if ("queue" in patch || "index" in patch || "volume" in patch || "shuffle" in patch || "repeat" in patch) {
    try {
      const { queue, index, volume, shuffle, repeat } = state;
      localStorage.setItem(KEY, JSON.stringify({ queue, index, volume, shuffle, repeat }));
    } catch {
      // private mode
    }
  }
}

function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "auto";
  el.volume = state.volume / 100;
  el.addEventListener("play", () => !usingYt && set({ playing: true, error: null }));
  el.addEventListener("pause", () => !usingYt && set({ playing: false }));
  el.addEventListener("waiting", () => !usingYt && set({ loading: true }));
  el.addEventListener("playing", () => !usingYt && set({ loading: false }));
  el.addEventListener("canplay", () => !usingYt && set({ loading: false }));
  let lastSaved = 0;
  el.addEventListener("timeupdate", () => {
    if (usingYt) return;
    set({ time: el!.currentTime });
    const t = current();
    if (t?.kind === "podcast" && Math.abs(el!.currentTime - lastSaved) > 5) {
      lastSaved = el!.currentTime;
      savePosition(t.id, el!.currentTime);
    }
  });
  el.addEventListener("durationchange", () => !usingYt && set({ duration: Number.isFinite(el!.duration) ? el!.duration : (current()?.duration ?? 0) }));
  el.addEventListener("ended", () => {
    if (usingYt) return;
    const done = current();
    if (done?.kind === "podcast") savePosition(done.id, 0);
    if (state.repeat === "one") {
      el!.currentTime = 0;
      void el!.play().catch(() => {});
    } else next(true);
  });
  el.addEventListener("error", () => {
    if (!el?.src || usingYt) return;
    if (current()?.live) {
      set({ loading: false, playing: false, error: "This station is off the air right now — try another" });
      return;
    }
    set({ loading: false, playing: false, error: "Couldn't play this — skipping" });
    // Skip a broken song after a moment (but don't loop forever on a fully broken queue).
    const failedAt = state.index;
    window.setTimeout(() => state.index === failedAt && state.queue.length > 1 && next(true), 1500);
  });
  return el;
}

const current = () => state.queue[state.index] as ChillTrack | undefined;

// ---------- the YouTube player (full songs) ----------

/** What the floating player (YouTubeDock) lets us do. */
export interface YtControl {
  load: (videoId: string) => void;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  volume: (percent: number) => void;
}
let yt: YtControl | null = null;
let usingYt = false;
let runSeq = 0;
const videoCache = new Map<string, string | null>();

/** The floating player registers itself here when it mounts. */
export function attachYouTube(control: YtControl | null) {
  yt = control;
}

/** Reports from the floating player. */
export function youtubeEvent(e: { state?: number; time?: number; duration?: number; error?: boolean }) {
  if (!usingYt) return;
  if (e.error) {
    // This video won't play: fall back to the preview.
    const t = current();
    if (t) {
      videoCache.set(t.id, null);
      playPreview(t, "The full song couldn't play — here's a 30-second preview");
    }
    return;
  }
  const patch: Partial<MusicState> = {};
  if (e.time !== undefined) patch.time = e.time;
  if (e.duration) patch.duration = e.duration;
  if (e.state === 1) Object.assign(patch, { playing: true, loading: false, error: null });
  if (e.state === 2) Object.assign(patch, { playing: false, loading: false });
  if (e.state === 3) patch.loading = true;
  if (Object.keys(patch).length) set(patch);
  if (e.state === 0) {
    if (state.repeat === "one") {
      yt?.seek(0);
      yt?.play();
    } else next(true);
  }
}

const itunesId = (t: ChillTrack) => t.id.replace(/^it-/, "");

function stopAudio() {
  if (el && !el.paused) el.pause();
}

function playPreview(t: ChillTrack, note: string) {
  usingYt = false;
  yt?.pause();
  set({ video: null, preview: true, error: note });
  const a = audio();
  a.src = `/api/chill/songs/${itunesId(t)}/preview`;
  void applySpeaker(a, liveChoice("speaker"));
  a.playbackRate = 1;
  a.play().catch(() => set({ loading: false, playing: false }));
}

async function findVideo(t: ChillTrack): Promise<string | null> {
  if (videoCache.has(t.id)) return videoCache.get(t.id)!;
  const res = await fetch(`/api/chill/songs/${itunesId(t)}/video`).catch(() => null);
  const id = res?.ok ? (((await res.json()) as { videoId?: string }).videoId ?? null) : null;
  // Remember "not found" only when the server said so (not on a network hiccup or a full quota).
  if (id || res?.status === 404) videoCache.set(t.id, id);
  return id;
}

function start(at: number) {
  const t = state.queue[at];
  if (!t) return;
  const run = ++runSeq;
  set({ index: at, time: 0, duration: t.duration, loading: true, error: null, started: true, preview: false });
  updateSession();

  if (t.kind === "itunes") {
    stopAudio();
    void findVideo(t).then((videoId) => {
      if (run !== runSeq) return; // something else was picked meanwhile
      if (!videoId) return playPreview(t, "Couldn't find the full song — playing a 30-second preview");
      usingYt = true;
      set({ video: videoId, preview: false });
      yt?.load(videoId);
      yt?.volume(state.volume);
    });
    return;
  }

  usingYt = false;
  yt?.pause();
  set({ video: null });
  const a = audio();
  a.src = streamUrl(t);
  void applySpeaker(a, liveChoice("speaker"));
  a.playbackRate = t.kind === "podcast" ? state.rate : 1;
  // A podcast picks up where you left it.
  const from = t.kind === "podcast" ? resumeAt(t.id) : 0;
  if (from > 0) a.addEventListener("loadedmetadata", () => (a.currentTime = from), { once: true });
  a.play().catch((err: unknown) => {
    set({ loading: false, playing: false, error: (err as { name?: string })?.name === "NotAllowedError" ? "Tap play to start" : null });
  });
}

/** Plays `list` starting from `at` (it becomes the queue). */
export function playList(list: ChillTrack[], at: number) {
  set({ queue: list.slice(0, 200) });
  start(at);
}

/** Adds a song after the current one. */
export function playNextInQueue(t: ChillTrack) {
  const cur = current();
  if (cur?.id === t.id) return;
  const q = state.queue.filter((x) => x.id !== t.id);
  const ci = cur ? q.findIndex((x) => x.id === cur.id) : -1;
  q.splice(ci + 1, 0, t);
  set({ queue: q, index: Math.max(0, ci) });
}

export function addToQueue(t: ChillTrack) {
  if (state.queue.some((x) => x.id === t.id)) return;
  set({ queue: [...state.queue, t] });
}

export function removeFromQueue(i: number) {
  if (i === state.index) return;
  const q = state.queue.filter((_, j) => j !== i);
  set({ queue: q, index: i < state.index ? state.index - 1 : state.index });
}

export function toggle() {
  if (!current()) return;
  if (usingYt) {
    if (state.playing) yt?.pause();
    else yt?.play();
    return;
  }
  const a = audio();
  if (!a.src) return start(state.index);
  if (a.paused) void a.play().catch(() => {});
  else a.pause();
}

export function pause() {
  el?.pause();
  if (usingYt) yt?.pause();
}

export function next(auto = false) {
  const n = state.queue.length;
  if (!n) return;
  if (state.shuffle && n > 1) {
    let i = state.index;
    while (i === state.index) i = Math.floor(Math.random() * n);
    return start(i);
  }
  if (state.index + 1 < n) return start(state.index + 1);
  if (state.repeat === "all" || !auto) return start(0);
  pause(); // end of the queue
}

export function prev() {
  // Like every player: back to the start of the song first, then the one before.
  if (usingYt ? state.time > 3 : el && el.currentTime > 3 && !current()?.live) {
    seek(0);
    return;
  }
  start(state.index > 0 ? state.index - 1 : state.queue.length - 1);
}

export function seek(seconds: number) {
  if (usingYt) {
    yt?.seek(Math.max(0, seconds));
    set({ time: Math.max(0, seconds) });
  } else if (el && !current()?.live) el.currentTime = Math.max(0, seconds);
}

/** Jump forward/back (podcasts: ±15 s / 30 s). */
export function skipBy(seconds: number) {
  if (usingYt) seek(state.time + seconds);
  else if (el && !current()?.live) el.currentTime = Math.max(0, el.currentTime + seconds);
}

export function setRate(rate: number) {
  set({ rate });
  if (el && current()?.kind === "podcast") el.playbackRate = rate;
}

export function setVolume(v: number) {
  set({ volume: v });
  if (el) el.volume = v / 100;
  yt?.volume(v);
}

export function setShuffle(on: boolean) {
  set({ shuffle: on });
}

export function cycleRepeat() {
  set({ repeat: state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off" });
}

/** Stops and forgets the queue. */
export function clearMusic() {
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  usingYt = false;
  runSeq++;
  yt?.pause();
  set({ queue: [], index: 0, playing: false, time: 0, duration: 0, error: null, started: false, video: null, preview: false });
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
}

// ---------- lock screen, headphones, other sounds ----------

function updateSession() {
  const t = current();
  if (!t || !("mediaSession" in navigator)) return;
  const art = trackArt(t);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: "Relay · Chill",
    artwork: art ? [{ src: art, sizes: "480x480", type: "image/jpeg" }] : [],
  });
}

if (typeof window !== "undefined") {
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => toggle()],
      ["pause", () => pause()],
      ["nexttrack", () => next()],
      ["previoustrack", () => prev()],
      ["seekto", (d) => d.seekTime !== undefined && seek(d.seekTime)],
      ["seekbackward", () => skipBy(-15)],
      ["seekforward", () => skipBy(30)],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // not supported here
      }
    }
  }
  // A call or a voice message takes over: pause the music.
  let lastPhase = calls.getState().phase;
  calls.subscribe(() => {
    const phase = calls.getState().phase;
    if (phase !== lastPhase && (phase === "incoming" || phase === "outgoing")) pause();
    lastPhase = phase;
  });
  window.addEventListener("relay:voice-play", () => pause());
  // Follow the speaker chosen in Settings → Voice & video.
  devicePrefs.subscribe(() => el && void applySpeaker(el, liveChoice("speaker")));
}

export const music = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

export function useMusic(): MusicState {
  return useSyncExternalStore(music.subscribe, music.get, music.get);
}

export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
