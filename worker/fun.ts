import type { ChillEpisode, ChillPodcast, ChillStation, ChillTrack, FunItem, TriviaQuestion } from "../shared/types";
import { rateLimit } from "./auth";
import type { Env } from "./env";
import { HttpError, json } from "./http";

/*
 * More of Chill: live radio, podcasts, trivia and jokes — all from free, open
 * services with no keys:
 *  - Radio Browser (radio-browser.info): 50,000+ live stations, Moroccan ones first.
 *  - Apple's podcast directory (iTunes Search) + each show's own RSS feed.
 *  - Open Trivia DB, JokeAPI and Useless Facts.
 * Like music, the audio and pictures come through this server: the page stays
 * closed to other sites, and http-only radio streams still play on https.
 */

const HOUR = 3600_000;
const UA = { "User-Agent": "RelayChat/1.0 (+https://relay-chat.bunbunchat.workers.dev)" };
const RADIO_HOSTS = ["https://de1.api.radio-browser.info", "https://de2.api.radio-browser.info", "https://fi1.api.radio-browser.info"];
const UUID = /^[0-9a-f-]{36}$/;
const NUM = /^\d{1,12}$/;

type Cache = <T>(key: string, ttl: number, load: () => Promise<T>) => Promise<T>;

export async function routeFun(request: Request, env: Env, path: string, url: URL, userId: string, cached: Cache): Promise<Response | null> {
  let m: RegExpMatchArray | null;

  // ---- songs: Apple Music's catalog to pick the right song, YouTube to play it in full ----
  if (path === "/api/chill/songs") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (!q) return json({ tracks: [] });
    await rateLimit(env, `chill-songs:${userId}`, 240, HOUR);
    return json(await cached(`songs:${q.toLowerCase()}`, 12 * HOUR, () => searchSongs(q)));
  }
  m = path.match(/^\/api\/chill\/songs\/(\d+)\/(art|preview|video)$/);
  if (m && NUM.test(m[1])) {
    const songId = m[1];
    const song = await cached(`song:${songId}`, 7 * 24 * HOUR, () => lookupSong(songId));
    if (!song) throw new HttpError(404, "Song not found.");
    if (m[2] === "art") return pipeImage(song.art);
    if (m[2] === "preview") return pipeAudio(request, song.preview ?? "", false);
    if (!env.YOUTUBE_API_KEY) throw new HttpError(503, "Full songs need the YouTube key.");
    await rateLimit(env, `chill-yt-song:${userId}`, 120, HOUR);
    // One search per song, then remembered for 30 days: the free YouTube quota goes a long way.
    const found = await cached(`songvideo2:${songId}`, 30 * 24 * HOUR, () => matchVideo(env.YOUTUBE_API_KEY!, song));
    if (!found) throw new HttpError(404, "Couldn't find this song on YouTube.");
    return json({ videoId: found });
  }

  // ---- radio ----
  if (path === "/api/chill/radio") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const country = (url.searchParams.get("country") ?? "").toUpperCase().slice(0, 2);
    const tag = (url.searchParams.get("tag") ?? "").trim().toLowerCase().slice(0, 30);
    const key = `radio:${q.toLowerCase()}:${country}:${tag}`;
    return json(await cached(key, 6 * HOUR, () => searchRadio(q, country, tag)));
  }
  m = path.match(/^\/api\/chill\/radio\/([^/]+)\/stream$/);
  if (m && UUID.test(m[1])) {
    const station = await cached(`station:${m[1]}`, 12 * HOUR, () => lookupStation(m![1]));
    if (!station) throw new HttpError(404, "This station is gone.");
    return pipeAudio(request, station, true);
  }

  // ---- podcasts ----
  if (path === "/api/chill/podcasts") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    if (q) await rateLimit(env, `chill-pod:${userId}`, 120, HOUR);
    return json(await cached(`pods:${q.toLowerCase()}`, 12 * HOUR, () => searchPodcasts(q)));
  }
  m = path.match(/^\/api\/chill\/podcasts\/(\d+)$/);
  if (m && NUM.test(m[1])) {
    const feed = await cached(`feed:${m[1]}`, 3 * HOUR, () => loadFeed(m![1]));
    return json({ episodes: feed.episodes.map(({ audio: _a, ...e }) => e) });
  }
  m = path.match(/^\/api\/chill\/podcasts\/(\d+)\/(\d+)\/audio$/);
  if (m && NUM.test(m[1])) {
    const feed = await cached(`feed:${m[1]}`, 3 * HOUR, () => loadFeed(m![1]));
    const ep = feed.episodes[Number(m[2])];
    if (!ep) throw new HttpError(404, "Episode not found.");
    return pipeAudio(request, ep.audio, false);
  }
  m = path.match(/^\/api\/chill\/podcasts\/(\d+)\/art$/);
  if (m && NUM.test(m[1])) {
    const art = await cached(`podart:${m[1]}`, 24 * HOUR, async () => (await lookupPodcast(m![1]))?.art ?? null);
    return pipeImage(art);
  }

  // ---- trivia, jokes, facts ----
  if (path === "/api/chill/trivia") {
    const category = (url.searchParams.get("category") ?? "").replace(/\D/g, "").slice(0, 3);
    const difficulty = ["easy", "medium", "hard"].includes(url.searchParams.get("difficulty") ?? "") ? url.searchParams.get("difficulty")! : "";
    // Open Trivia DB allows one request every 5 s per address, and every user shares
    // this server's address: fetch a big batch once, then deal from it.
    const pool = await cached(`trivia2:${category}:${difficulty}`, HOUR, () => loadTrivia(category, difficulty));
    return json({
      questions: shuffle([...pool])
        .slice(0, 10)
        .map(dealQuestion),
    });
  }
  if (path === "/api/chill/fun") {
    const kind = url.searchParams.get("kind") === "fact" ? "fact" : "joke";
    await rateLimit(env, `chill-fun:${userId}`, 300, HOUR);
    return json({ item: kind === "fact" ? await randomFact() : await randomJoke() });
  }
  return null;
}

// ---------- helpers ----------

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Only ports Workers can reach, and only http(s). */
function fetchable(u: string): boolean {
  try {
    const x = new URL(u);
    return (x.protocol === "http:" || x.protocol === "https:") && (x.port === "" || x.port === "80" || x.port === "443");
  } catch {
    return false;
  }
}

async function radioApi<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const host of RADIO_HOSTS) {
    try {
      const res = await fetch(host + path, { headers: UA, signal: AbortSignal.timeout(6000) });
      if (res.ok) return (await res.json()) as T;
      lastErr = res.status;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error("radio-browser failed", lastErr);
  throw new HttpError(502, "The radio directory isn't answering. Try again in a moment.");
}

/** Passes audio through, with Range (seeking podcasts); live radio never ends. */
async function pipeAudio(request: Request, src: string, live: boolean): Promise<Response> {
  if (!fetchable(src)) throw new HttpError(404, "This can't be played here.");
  const headers = new Headers(UA);
  const range = request.headers.get("Range");
  if (!live && range && /^bytes=\d*-\d*$/.test(range)) headers.set("Range", range);
  let res: Response;
  try {
    res = await fetch(src, { headers, redirect: "follow", signal: live ? undefined : AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, live ? "This station is off the air right now." : "This episode can't be reached right now.");
  }
  if (!res.ok && res.status !== 206) throw new HttpError(502, live ? "This station is off the air right now." : "This episode can't be reached right now.");
  const type = res.headers.get("Content-Type") ?? "";
  // A playlist or web page instead of sound: not playable.
  if (/text\/html|mpegurl|x-scpls/i.test(type)) throw new HttpError(415, "This one uses a format that can't play here.");
  const out = new Headers();
  out.set("Content-Type", /^(audio|video)\//.test(type) || type === "application/ogg" ? type : "audio/mpeg");
  if (!live) {
    for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
  }
  out.set("Cache-Control", live ? "no-store" : "private, max-age=3600");
  return new Response(res.body, { status: live ? 200 : res.status, headers: out });
}

async function pipeImage(src: string | null): Promise<Response> {
  if (!src || !src.startsWith("https://")) throw new HttpError(404, "No picture.");
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(6000) });
    const type = res.headers.get("Content-Type") ?? "";
    if (res.ok && /^image\/(jpeg|png|webp)$/.test(type)) {
      return new Response(res.body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
    }
  } catch {
    // fall through
  }
  throw new HttpError(404, "No picture.");
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

// ---------- radio ----------

interface RbStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  country: string;
  countrycode: string;
  tags: string;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
}

const PLAYABLE_CODECS = /^(mp3|aac|aac\+|ogg|opus)$/i;

async function searchRadio(q: string, country: string, tag: string): Promise<{ stations: ChillStation[] }> {
  const p = new URLSearchParams({ hidebroken: "true", order: "clickcount", reverse: "true", limit: "80" });
  if (q) p.set("name", q);
  if (/^[A-Z]{2}$/.test(country)) p.set("countrycode", country);
  if (tag) p.set("tag", tag);
  const list = await radioApi<RbStation[]>(`/json/stations/search?${p}`);
  const seen = new Set<string>();
  const stations: ChillStation[] = [];
  for (const s of list) {
    if (s.hls || !s.lastcheckok || !PLAYABLE_CODECS.test(s.codec) || !fetchable(s.url_resolved)) continue;
    const name = s.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    stations.push({
      id: s.stationuuid,
      name: name.slice(0, 80),
      country: s.country,
      countryCode: s.countrycode,
      tags: s.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 3),
      bitrate: s.bitrate,
    });
    if (stations.length >= 50) break;
  }
  return { stations };
}

async function lookupStation(uuid: string): Promise<string | null> {
  const list = await radioApi<RbStation[]>(`/json/stations/byuuid/${uuid}`);
  const s = list[0];
  // Count the listen, like the directory asks (helps its "popular" ranking).
  if (s) void fetch(`${RADIO_HOSTS[0]}/json/url/${uuid}`, { headers: UA }).catch(() => {});
  return s && fetchable(s.url_resolved) ? s.url_resolved : null;
}

// ---------- podcasts ----------

interface ItunesPodcast {
  collectionId: number;
  collectionName: string;
  artistName: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
}

async function searchPodcasts(q: string): Promise<{ podcasts: ChillPodcast[] }> {
  const url = q
    ? `https://itunes.apple.com/search?media=podcast&limit=30&term=${encodeURIComponent(q)}`
    : // Nothing typed: Apple's current top shows.
      "https://itunes.apple.com/search?media=podcast&limit=30&term=podcast&attribute=keywordsTerm";
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new HttpError(502, "The podcast directory isn't answering. Try again in a moment.");
  const data = (await res.json()) as { results?: ItunesPodcast[] };
  return {
    podcasts: (data.results ?? [])
      .filter((p) => p.feedUrl && fetchable(p.feedUrl))
      .map((p) => ({ id: String(p.collectionId), title: p.collectionName, author: p.artistName, genre: p.primaryGenreName ?? "" })),
  };
}

async function lookupPodcast(id: string): Promise<{ feed: string; art: string | null } | null> {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${id}`, { headers: UA });
  if (!res.ok) return null;
  const p = ((await res.json()) as { results?: ItunesPodcast[] }).results?.[0];
  if (!p?.feedUrl) return null;
  return { feed: p.feedUrl, art: p.artworkUrl600 ?? p.artworkUrl100 ?? null };
}

/** Reads a show's RSS feed: the newest 60 episodes with their audio. */
async function loadFeed(id: string): Promise<{ episodes: (ChillEpisode & { audio: string })[] }> {
  const pod = await lookupPodcast(id);
  if (!pod || !fetchable(pod.feed)) throw new HttpError(404, "This podcast can't be found.");
  const res = await fetch(pod.feed, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new HttpError(502, "This podcast's feed isn't answering.");
  // Feeds can be huge (every episode ever): read the first 4 MB, which holds the newest ones.
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 4_000_000) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  void reader.cancel().catch(() => {});
  const xml = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  const episodes: (ChillEpisode & { audio: string })[] = [];
  for (const item of xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []) {
    const enclosure = /<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i.exec(item)?.[1];
    if (!enclosure) continue;
    const audio = decodeEntities(enclosure);
    if (!fetchable(audio)) continue;
    const title = decodeEntities(/<title>([\s\S]*?)<\/title>/i.exec(item)?.[1] ?? "Episode");
    const dur = /<itunes:duration>([\s\S]*?)<\/itunes:duration>/i.exec(item)?.[1]?.trim() ?? "";
    const parts = dur.split(":").map(Number);
    const duration = parts.some(Number.isNaN) ? 0 : parts.reduce((acc, n) => acc * 60 + n, 0);
    const date = Date.parse(/<pubDate>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1] ?? "");
    episodes.push({ index: episodes.length, title: title.slice(0, 200), duration, date: Number.isNaN(date) ? null : date, audio });
    if (episodes.length >= 60) break;
  }
  return { episodes };
}

// ---------- trivia ----------

interface OtdbQuestion {
  category: string;
  difficulty: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

async function loadTrivia(category: string, difficulty: string): Promise<OtdbQuestion[]> {
  const p = new URLSearchParams({ amount: "50", encode: "url3986" });
  if (category) p.set("category", category);
  if (difficulty) p.set("difficulty", difficulty);
  const res = await fetch(`https://opentdb.com/api.php?${p}`, { headers: UA });
  const data = res.ok ? ((await res.json()) as { response_code: number; results: OtdbQuestion[] }) : null;
  if (!data || data.response_code !== 0 || !data.results.length) throw new HttpError(502, "Couldn't get questions right now. Try again in a few seconds.");
  const d = (s: string) => decodeURIComponent(s);
  // The open question bank has some crude ones: leave those out.
  const crude =
    /\b(racis\w*|urine|feces|poop|sex\w*|porn\w*|nazi\w*|drug\w*|cocaine|genital\w*|nude|naked|rape|suicide|cards against humanity|kill\w*|murder\w*)\b/i;
  const clean = data.results.filter((r) => ![r.question, r.correct_answer, ...r.incorrect_answers].some((s) => crude.test(d(s))));
  return clean.map((r) => ({
    category: d(r.category),
    difficulty: d(r.difficulty),
    question: d(r.question),
    correct_answer: d(r.correct_answer),
    incorrect_answers: r.incorrect_answers.map(d),
  }));
}

function dealQuestion(q: OtdbQuestion): TriviaQuestion {
  const answers = shuffle([q.correct_answer, ...q.incorrect_answers]);
  // True/False stays in that order.
  if (answers.length === 2 && answers.includes("True")) answers.sort((a) => (a === "True" ? -1 : 1));
  return { category: q.category, difficulty: q.difficulty, question: q.question, answers, correct: answers.indexOf(q.correct_answer) };
}

// ---------- jokes & facts ----------

async function randomJoke(): Promise<FunItem> {
  const res = await fetch("https://v2.jokeapi.dev/joke/Any?safe-mode&blacklistFlags=nsfw,religious,political,racist,sexist,explicit", { headers: UA });
  if (!res.ok) throw new HttpError(502, "No jokes right now. Try again in a moment.");
  const j = (await res.json()) as { type: string; joke?: string; setup?: string; delivery?: string; category?: string };
  return j.type === "single" ? { text: j.joke ?? "", answer: null, source: "JokeAPI" } : { text: j.setup ?? "", answer: j.delivery ?? null, source: "JokeAPI" };
}

async function randomFact(): Promise<FunItem> {
  const res = await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en", { headers: UA });
  if (!res.ok) throw new HttpError(502, "No facts right now. Try again in a moment.");
  const f = (await res.json()) as { text: string };
  return { text: f.text, answer: null, source: "Useless Facts" };
}

// ---------- songs ----------

interface ItunesSong {
  trackId: number;
  trackName: string;
  artistName: string;
  trackTimeMillis?: number;
  previewUrl?: string;
  artworkUrl100?: string;
}

interface Song {
  title: string;
  artist: string;
  duration: number;
  preview: string | null;
  art: string | null;
}

const bigArt = (u?: string) => (u ? u.replace(/\/\d+x\d+bb\./, "/600x600bb.") : null);

/** Real songs (the right ones), from Apple's free search. */
async function searchSongs(q: string): Promise<{ tracks: ChillTrack[] }> {
  const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=40&term=${encodeURIComponent(q)}`, { headers: UA });
  if (!res.ok) throw new HttpError(502, "The music search isn't answering. Try again in a moment.");
  const data = (await res.json()) as { results?: ItunesSong[] };
  const seen = new Set<string>();
  const tracks: ChillTrack[] = [];
  for (const t of data.results ?? []) {
    // The same song on several albums: keep the first.
    const key = `${t.trackName}|${t.artistName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      id: `it-${t.trackId}`,
      title: t.trackName,
      artist: t.artistName,
      duration: Math.round((t.trackTimeMillis ?? 0) / 1000),
      art: !!t.artworkUrl100,
      artUrl: `/api/chill/songs/${t.trackId}/art`,
      kind: "itunes",
    });
  }
  return { tracks };
}

async function lookupSong(id: string): Promise<Song | null> {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song`, { headers: UA });
  if (!res.ok) return null;
  const t = ((await res.json()) as { results?: ItunesSong[] }).results?.find((r) => String(r.trackId) === id);
  if (!t) return null;
  return {
    title: t.trackName,
    artist: t.artistName,
    duration: Math.round((t.trackTimeMillis ?? 0) / 1000),
    preview: t.previewUrl && fetchable(t.previewUrl) ? t.previewUrl : null,
    art: bigArt(t.artworkUrl100),
  };
}

/** ISO 8601 "PT3M35S" -> seconds. */
function isoSeconds(d: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9\u0600-\u06ff ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Finds the song's official YouTube version: searches music videos, then scores
 * them: same length as the real song, the right title, the artist's own channel
 * (or its "- Topic" / VEVO channel), and no covers, live or sped-up versions.
 */
async function matchVideo(key: string, song: Song): Promise<string | null> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoCategoryId: "10",
    maxResults: "8",
    q: `${song.artist} ${song.title}`,
    key,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && /quota/i.test(body)) throw new HttpError(503, "YouTube's free daily limit is used up: previews only until tomorrow.");
    throw new HttpError(502, "YouTube isn't answering right now.");
  }
  const ids = (((await res.json()) as { items?: { id?: { videoId?: string } }[] }).items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
  if (!ids.length) return null;
  // Lengths and channels for all of them (1 quota unit).
  const det = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet,status&id=${ids.join(",")}&key=${key}`);
  if (!det.ok) return ids[0];
  const items =
    (
      (await det.json()) as {
        items?: { id: string; contentDetails: { duration: string }; snippet: { title: string; channelTitle: string }; status?: { embeddable?: boolean } }[];
      }
    ).items ?? [];
  const title = norm(song.title);
  const artist = norm(song.artist.split(/,|&| feat\.? | ft\.? | x /i)[0]);
  const wantsVariant = /(cover|karaoke|instrumental|sped up|slowed|live|remix|acoustic)/.test(song.title.toLowerCase());
  let best: { id: string; score: number } | null = null;
  for (const v of items) {
    if (v.status?.embeddable === false) continue;
    const vt = norm(v.snippet.title);
    // The full title, brackets included: "(Live On The VMAs)" must count.
    const raw = v.snippet.title.toLowerCase();
    const ch = norm(v.snippet.channelTitle);
    const len = isoSeconds(v.contentDetails.duration);
    let score = 0;
    if (song.duration) score -= Math.min(60, Math.abs(len - song.duration)) * 1.5;
    if (vt.includes(title)) score += 30;
    if (artist && (vt.includes(artist) || ch.includes(artist))) score += 20;
    if (ch.endsWith(" topic") || /vevo/.test(ch) || (artist && ch.replace(/ /g, "").includes(artist.replace(/ /g, "")))) score += 25;
    if (/official (audio|music video|video)|audio/.test(vt)) score += 8;
    // Not the version you picked:
    if (!wantsVariant && /\b(cover|karaoke|instrumental|sped up|slowed|nightcore|8d|reaction|live|remix|tutorial|acoustic|lullaby)\b/.test(raw)) score -= 40;
    if (!best || score > best.score) best = { id: v.id, score };
  }
  return best && best.score > -40 ? best.id : null;
}
