import type { ChillTrack, ChillVideo } from "../shared/types";
import { rateLimit, requireUser } from "./auth";
import type { Env } from "./env";
import { HttpError, json } from "./http";
import { routeFun } from "./fun";
import { assertAllowed } from "./policy";

/*
 * Chill: a YouTube Shorts feed and a music player, to pass the time.
 *
 *  - Shorts come from the YouTube Data API (needs the free YOUTUBE_API_KEY secret)
 *    and play in YouTube's own embedded player, so there's no liking, commenting
 *    or signing in: just watching.
 *  - Music comes from Audius (free, full-length songs, no key). Searches, cover art
 *    and the audio itself go through this server, so the app's strict security
 *    rules stay closed to other sites and nobody's address is shown to Audius.
 *
 * Search results are cached in D1 for a few hours: workers.dev has no edge cache,
 * and YouTube's free quota (10,000 units a day, 100 per search) is shared by everyone.
 */

const AUDIUS = "https://api.audius.co/v1";
const APP = "app_name=RelayChat";
const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const TRACK_ID = /^[A-Za-z0-9]{1,16}$/;
const HOUR = 3600_000;

/** Ready-made Shorts feeds (each is one YouTube search). */
export const SHORTS_TOPICS: Record<string, string> = {
  foryou: "trending",
  funny: "funny",
  music: "music",
  gaming: "gaming",
  football: "football",
  satisfying: "satisfying",
  food: "cooking food",
  animals: "cute animals",
};

export async function routeChill(request: Request, env: Env, path: string, url: URL): Promise<Response> {
  const me = await requireUser(request, env);
  if (request.method !== "GET") throw new HttpError(405, "Not allowed.");

  if (path === "/api/chill/status") return json({ youtube: !!env.YOUTUBE_API_KEY });

  await assertAllowed(env, me.id, "chill");

  if (path === "/api/chill/shorts") {
    if (!env.YOUTUBE_API_KEY) throw new HttpError(503, "Shorts aren't set up yet: the owner needs to add a free YouTube API key.");
    const topic = url.searchParams.get("topic") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const page = (url.searchParams.get("page") ?? "").slice(0, 64);
    const words = q || SHORTS_TOPICS[topic] || SHORTS_TOPICS.foryou;
    // A typed search costs quota every time; the topic feeds are shared and cached longer.
    if (q) await rateLimit(env, `chill-yt:${me.id}`, 30, 60 * 60_000);
    return json(await cachedSearch(env, `shorts:${words.toLowerCase()}:${page}`, q ? 6 * HOUR : 12 * HOUR, () => searchShorts(env, words, page)));
  }

  // Any video (watch-together search).
  if (path === "/api/chill/videos") {
    if (!env.YOUTUBE_API_KEY) throw new HttpError(503, "Video search isn't set up — paste a YouTube link instead.");
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (!q) throw new HttpError(400, "Type something to search.");
    await rateLimit(env, `chill-yt:${me.id}`, 30, 60 * 60_000);
    return json(await cachedSearch(env, `videos:${q.toLowerCase()}`, 12 * HOUR, () => searchShorts(env, q, "", false)));
  }

  if (path === "/api/chill/music") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (q) await rateLimit(env, `chill-music:${me.id}`, 120, 60 * 60_000);
    const key = q ? `music:${q.toLowerCase()}` : "music:trending";
    return json(await cachedSearch(env, key, q ? 6 * HOUR : 2 * HOUR, () => searchMusic(q)));
  }

  let match = path.match(/^\/api\/chill\/stream\/([^/]+)$/);
  if (match && TRACK_ID.test(match[1])) return streamTrack(request, match[1]);

  match = path.match(/^\/api\/chill\/art\/([^/]+)$/);
  if (match && TRACK_ID.test(match[1])) return trackArt(env, match[1]);

  // Radio, podcasts, trivia, jokes & facts.
  const fun = await routeFun(request, env, path, url, me.id, (key, ttl, load) => cachedSearch(env, key, ttl, load));
  if (fun) return fun;

  throw new HttpError(404, "Not found.");
}

// ---------- cache ----------

async function cachedSearch<T>(env: Env, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = await env.DB.prepare("SELECT value FROM chill_cache WHERE key = ?1 AND expires_at > ?2").bind(key, now).first<{ value: string }>();
  if (hit) return JSON.parse(hit.value) as T;
  const value = await load();
  await env.DB.prepare("INSERT OR REPLACE INTO chill_cache (key, value, expires_at) VALUES (?1, ?2, ?3)")
    .bind(key, JSON.stringify(value), now + ttl)
    .run();
  return value;
}

/** Called by the cron: drop expired search results. */
export async function expireChillCache(env: Env): Promise<number> {
  const r = await env.DB.prepare("DELETE FROM chill_cache WHERE expires_at < ?1").bind(Date.now()).run();
  return r.meta.changes ?? 0;
}

// ---------- YouTube ----------

/** YouTube sends titles HTML-escaped ("Tom &amp; Jerry"). */
function unescape(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function searchShorts(env: Env, words: string, page: string, shorts = true): Promise<{ videos: ChillVideo[]; next: string | null }> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    safeSearch: "moderate",
    maxResults: shorts ? "25" : "12",
    q: shorts ? `${words} #shorts` : words,
    key: env.YOUTUBE_API_KEY!,
  });
  // "short" = under 4 minutes; "#shorts" steers it to real vertical Shorts.
  if (shorts) params.set("videoDuration", "short");
  if (page) params.set("pageToken", page);
  const res = await fetch(`${YT_SEARCH}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && /quota/i.test(body)) {
      throw new HttpError(503, "YouTube's free daily limit is used up. Shorts are back after midnight (US Pacific time).");
    }
    console.error("YouTube search failed", res.status, body.slice(0, 300));
    throw new HttpError(502, "YouTube isn't answering right now. Try again in a moment.");
  }
  const data = (await res.json()) as {
    nextPageToken?: string;
    items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url: string }> } }[];
  };
  const videos: ChillVideo[] = [];
  for (const it of data.items ?? []) {
    const id = it.id?.videoId;
    if (!id || !/^[\w-]{11}$/.test(id)) continue;
    const t = it.snippet?.thumbnails ?? {};
    videos.push({
      id,
      title: unescape(it.snippet?.title ?? ""),
      channel: unescape(it.snippet?.channelTitle ?? ""),
      thumb: (t.high ?? t.medium ?? t.default)?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  }
  return { videos, next: data.nextPageToken ?? null };
}

// ---------- Audius ----------

interface AudiusTrack {
  id: string;
  title: string;
  duration: number;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  is_delete?: boolean;
  artwork?: Record<string, string> | null;
  user?: { name?: string };
}

async function searchMusic(q: string): Promise<{ tracks: ChillTrack[] }> {
  const url = q ? `${AUDIUS}/tracks/search?query=${encodeURIComponent(q)}&limit=40&${APP}` : `${AUDIUS}/tracks/trending?limit=40&${APP}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new HttpError(502, "The music service isn't answering right now. Try again in a moment.");
  const data = (await res.json()) as { data?: AudiusTrack[] };
  const tracks: ChillTrack[] = (data.data ?? [])
    .filter((t) => t.is_streamable !== false && !t.is_stream_gated && !t.is_delete && TRACK_ID.test(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.user?.name ?? "",
      duration: t.duration,
      art: !!(t.artwork?.["480x480"] ?? t.artwork?.["150x150"]),
    }));
  return { tracks };
}

/** The song itself, passed through (seeking works: the Range header goes along). */
async function streamTrack(request: Request, id: string): Promise<Response> {
  const headers = new Headers();
  const range = request.headers.get("Range");
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("Range", range);
  const res = await fetch(`${AUDIUS}/tracks/${id}/stream?${APP}`, { headers });
  if (!res.ok && res.status !== 206) throw new HttpError(res.status === 404 ? 404 : 502, "This song can't be played right now.");
  const out = new Headers();
  for (const h of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.get("Content-Type")?.startsWith("audio/")) out.set("Content-Type", "audio/mpeg");
  out.set("Cache-Control", "private, max-age=3600");
  return new Response(res.body, { status: res.status, headers: out });
}

/** Cover art, passed through (the page only loads pictures from Relay itself). */
async function trackArt(env: Env, id: string): Promise<Response> {
  // The picture's address, plus the same picture on Audius's backup servers.
  const urls = await cachedSearch(env, `art2:${id}`, 24 * HOUR, async () => {
    const res = await fetch(`${AUDIUS}/tracks/${id}?${APP}`);
    if (!res.ok) return [] as string[];
    const art = ((await res.json()) as { data?: AudiusTrack }).data?.artwork as (Record<string, string> & { mirrors?: string[] }) | undefined;
    const main = art?.["480x480"] ?? art?.["150x150"];
    if (!main || !main.startsWith("https://")) return [];
    const path = new URL(main).pathname;
    return [main, ...(Array.isArray(art?.mirrors) ? art.mirrors : []).filter((m) => /^https:\/\/[\w.-]+$/.test(m)).map((m) => m + path)].slice(0, 4);
  });
  // Some storage servers are slow or down: give each a few seconds, then try the next.
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
      const type = res.headers.get("Content-Type") ?? "";
      if (res.ok && /^image\/(jpeg|png|webp)$/.test(type)) {
        return new Response(res.body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
      }
    } catch {
      // try the next one
    }
  }
  throw new HttpError(404, "No cover art.");
}
