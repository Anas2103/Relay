import { useEffect, useState } from "react";
import type { ChillEpisode, ChillPodcast, ChillTrack } from "../../../shared/types";
import { api, ApiError } from "../../lib/api";
import { formatTime, playList, resumeAt, toggle, useMusic } from "../../lib/music";
import { BackIcon, MicIcon, SearchIcon, Spinner, XIcon } from "../ui";
import { Chips } from "./Radio";

const TOPICS: [string, string][] = [
  ["", "Popular"],
  ["comedy", "Comedy"],
  ["true crime", "True crime"],
  ["history", "History"],
  ["science", "Science"],
  ["technology", "Tech"],
  ["football", "Football"],
  ["arabic", "Arabic"],
  ["français", "Français"],
  ["self improvement", "Self-improvement"],
  ["stories", "Stories"],
];

const art = (id: string) => `/api/chill/podcasts/${id}/art`;

const episodeTrack = (p: ChillPodcast, e: ChillEpisode): ChillTrack => ({
  id: `pod-${p.id}-${e.index}`,
  title: e.title,
  artist: p.title,
  duration: e.duration,
  art: true,
  artUrl: art(p.id),
  src: `/api/chill/podcasts/${p.id}/${e.index}/audio`,
  kind: "podcast",
});

/** Podcasts from Apple's directory; episodes from each show's own feed. Picks up where you stopped. */
export function PodcastsTab() {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [podcasts, setPodcasts] = useState<ChillPodcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ChillPodcast | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(draft.trim()), 450);
    return () => window.clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.podcasts(q).then(
      (r) => !cancelled && (setPodcasts(r.podcasts), setLoading(false)),
      (err) => !cancelled && (setError(err instanceof ApiError ? err.message : "Couldn't load podcasts."), setLoading(false)),
    );
    return () => {
      cancelled = true;
    };
  }, [q]);

  if (open) return <Episodes podcast={open} onBack={() => setOpen(null)} />;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-black/5 px-3 dark:bg-zinc-800">
          <SearchIcon className="size-4 shrink-0 text-zinc-400" />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search podcasts" aria-label="Search podcasts" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          {draft && (
            <button onClick={() => setDraft("")} aria-label="Clear search" className="text-zinc-400">
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <Chips items={TOPICS} value={q} onPick={(v) => setDraft(v)} label="Podcast topics" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner className="size-6" />
          </div>
        ) : error ? (
          <p className="p-8 text-center text-sm text-zinc-500">{error}</p>
        ) : podcasts.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No podcasts found.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Podcasts">
            {podcasts.map((p) => (
              <li key={p.id}>
                <button onClick={() => setOpen(p)} className="w-full text-left" aria-label={`Open ${p.title}`}>
                  <Cover id={p.id} className="aspect-square w-full rounded-2xl" />
                  <span className="mt-1.5 block truncate text-sm font-medium">{p.title}</span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{p.author}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Cover({ id, className }: { id: string; className: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`flex items-center justify-center overflow-hidden bg-zinc-200 text-zinc-400 dark:bg-zinc-700 ${className}`}>
      {!broken ? <img src={art(id)} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" /> : <MicIcon className="size-1/3" />}
    </span>
  );
}

function Episodes({ podcast, onBack }: { podcast: ChillPodcast; onBack: () => void }) {
  const [episodes, setEpisodes] = useState<ChillEpisode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = useMusic();
  const current = m.queue[m.index];

  useEffect(() => {
    api.episodes(podcast.id).then(
      (r) => setEpisodes(r.episodes),
      (err) => setError(err instanceof ApiError ? err.message : "Couldn't load the episodes."),
    );
  }, [podcast.id]);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 pb-3">
      <div className="flex items-center gap-3 py-2">
        <button onClick={onBack} aria-label="Back to podcasts" className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-zinc-800">
          <BackIcon className="size-5" />
        </button>
        <Cover id={podcast.id} className="size-16 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{podcast.title}</h3>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{podcast.author}</p>
        </div>
      </div>
      {error ? (
        <p className="p-8 text-center text-sm text-zinc-500">{error}</p>
      ) : !episodes ? (
        <div className="flex justify-center p-8">
          <Spinner className="size-6" />
        </div>
      ) : episodes.length === 0 ? (
        <p className="p-8 text-center text-sm text-zinc-500">No playable episodes.</p>
      ) : (
        <ul aria-label="Episodes">
          {episodes.map((e, i) => {
            const t = episodeTrack(podcast, e);
            const isCurrent = current?.id === t.id;
            const resume = resumeAt(t.id);
            return (
              <li key={e.index}>
                <button
                  onClick={() => (isCurrent ? toggle() : playList(episodes.map((x) => episodeTrack(podcast, x)), i))}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left ${isCurrent ? "bg-accent/10" : "hover:bg-black/5 dark:hover:bg-zinc-800/70"}`}
                  aria-label={`Play ${e.title}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`line-clamp-2 text-sm font-medium ${isCurrent ? "text-accent-fg" : ""}`}>{e.title}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {e.date ? new Date(e.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""}
                      {e.duration ? ` · ${formatTime(e.duration)}` : ""}
                      {resume > 0 && !isCurrent ? ` · stopped at ${formatTime(resume)}` : ""}
                    </span>
                    {resume > 0 && e.duration > 0 && (
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                        <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (resume / e.duration) * 100)}%` }} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
