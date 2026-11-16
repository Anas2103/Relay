import { useEffect, useState } from "react";
import type { ChillStation, ChillTrack } from "../../../shared/types";
import { api, ApiError } from "../../lib/api";
import { playList, toggle, useMusic } from "../../lib/music";
import { SearchIcon, Spinner, StarIcon, XIcon } from "../ui";

const COUNTRIES: [string, string][] = [
  ["MA", "🇲🇦 Morocco"],
  ["", "🌍 World"],
  ["FR", "🇫🇷 France"],
  ["ES", "🇪🇸 Spain"],
  ["US", "🇺🇸 USA"],
  ["GB", "🇬🇧 UK"],
  ["EG", "🇪🇬 Egypt"],
  ["SA", "🇸🇦 Saudi Arabia"],
  ["DZ", "🇩🇿 Algeria"],
  ["TN", "🇹🇳 Tunisia"],
];
const GENRES = ["", "pop", "hits", "rap", "lofi", "chill", "jazz", "rock", "classical", "quran", "news", "sport", "dance"];
const FAV_KEY = "relay:radio-favs";

const flag = (cc: string) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "📻");

export const stationTrack = (s: ChillStation): ChillTrack => ({
  id: `radio-${s.id}`,
  title: s.name,
  artist: [s.country, ...s.tags.slice(0, 2)].filter(Boolean).join(" · "),
  duration: 0,
  art: false,
  src: `/api/chill/radio/${s.id}/stream`,
  live: true,
  kind: "radio",
});

function loadFavs(): ChillStation[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, 100) : [];
  } catch {
    return [];
  }
}

/** Live radio from all over the world (Moroccan stations first), with favourites. */
export function RadioTab() {
  const [country, setCountry] = useState("MA");
  const [genre, setGenre] = useState("");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [showFavs, setShowFavs] = useState(false);
  const [favs, setFavs] = useState<ChillStation[]>(loadFavs);
  const [stations, setStations] = useState<ChillStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const m = useMusic();
  const current = m.queue[m.index];

  useEffect(() => {
    const t = window.setTimeout(() => setQ(draft.trim()), 450);
    return () => window.clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    if (showFavs) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Searching by name looks everywhere, not just the chosen country.
    api.radio({ q, country: q ? "" : country, tag: genre }).then(
      (r) => !cancelled && (setStations(r.stations), setLoading(false)),
      (err) => !cancelled && (setError(err instanceof ApiError ? err.message : "Couldn't load stations."), setLoading(false)),
    );
    return () => {
      cancelled = true;
    };
  }, [q, country, genre, showFavs]);

  const toggleFav = (s: ChillStation) => {
    const next = favs.some((f) => f.id === s.id) ? favs.filter((f) => f.id !== s.id) : [s, ...favs];
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      // private mode
    }
  };

  const list = showFavs ? favs : stations;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-black/5 px-3 dark:bg-zinc-800">
          <SearchIcon className="size-4 shrink-0 text-zinc-400" />
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setShowFavs(false);
            }}
            placeholder="Search any station in the world"
            aria-label="Search radio stations"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {draft && (
            <button onClick={() => setDraft("")} aria-label="Clear search" className="text-zinc-400">
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <Chips
          items={[["favs", `⭐ Favorites${favs.length ? ` (${favs.length})` : ""}`], ...COUNTRIES]}
          value={showFavs ? "favs" : q ? "-" : country}
          onPick={(v) => {
            if (v === "favs") return setShowFavs(true);
            setShowFavs(false);
            setDraft("");
            setCountry(v);
          }}
          label="Countries"
        />
        {!showFavs && <Chips items={GENRES.map((g) => [g, g ? g[0].toUpperCase() + g.slice(1) : "All genres"])} value={genre} onPick={setGenre} label="Genres" small />}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Stations">
        {loading && !showFavs ? (
          <li className="flex justify-center p-8">
            <Spinner className="size-6" />
          </li>
        ) : error && !showFavs ? (
          <li className="p-8 text-center text-sm text-zinc-500">{error}</li>
        ) : list.length === 0 ? (
          <li className="p-8 text-center text-sm text-zinc-500">{showFavs ? "Tap the ☆ on a station to keep it here." : "No stations found."}</li>
        ) : (
          list.map((s, i) => {
            const isCurrent = current?.id === `radio-${s.id}`;
            const fav = favs.some((f) => f.id === s.id);
            return (
              <li key={s.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${isCurrent ? "bg-accent/10" : "hover:bg-black/5 dark:hover:bg-zinc-800/70"}`}>
                <button
                  onClick={() => (isCurrent ? toggle() : playList(list.map(stationTrack), i))}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-label={`Play ${s.name}`}
                >
                  <span className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent/30 to-accent/10 text-xl">
                    {flag(s.countryCode)}
                    {isCurrent && m.playing && <span className="absolute -right-1 -bottom-1 rounded bg-red-500 px-1 text-[9px] font-bold text-white">LIVE</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${isCurrent ? "text-accent-fg" : ""}`}>{s.name}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {[s.country, ...s.tags].filter(Boolean).join(" · ")}
                      {s.bitrate ? ` · ${s.bitrate} kbps` : ""}
                    </span>
                  </span>
                </button>
                <button onClick={() => toggleFav(s)} aria-label={fav ? `Remove ${s.name} from favorites` : `Add ${s.name} to favorites`} aria-pressed={fav} className={`rounded-full p-1.5 ${fav ? "text-amber-500" : "text-zinc-400 hover:text-zinc-600"}`}>
                  <StarIcon className="size-4" fill={fav ? "currentColor" : "none"} />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

export function Chips({ items, value, onPick, label, small }: { items: [string, string][]; value: string; onPick: (v: string) => void; label: string; small?: boolean }) {
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="tablist" aria-label={label}>
      {items.map(([id, text]) => (
        <button
          key={id || "all"}
          role="tab"
          aria-selected={value === id}
          onClick={() => onPick(id)}
          className={`shrink-0 rounded-full font-medium transition ${small ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"} ${
            value === id ? "bg-accent text-accent-ink" : "bg-black/5 text-zinc-600 hover:bg-black/10 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
