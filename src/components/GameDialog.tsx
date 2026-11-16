import { useState, type FormEvent } from "react";
import { CHAT_GAMES, COOP_GAMES, cleanWord, youtubeId, type ChatGameType } from "../../shared/games";
import type { ChillVideo } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { SearchIcon, Spinner, XIcon } from "./ui";

const BLURBS: Record<ChatGameType, string> = {
  ttt: "Classic 3 in a row. You're ❌.",
  c4: "Drop discs, connect 4. You're 🔴.",
  rps: "Best of 3. Picks stay secret until both chose.",
  checkers: "Jump to take pieces, reach the end for a crown 👑.",
  gomoku: "Get five in a row on a 10×10 board.",
  dots: "Draw lines; close a box to score and go again.",
  hangman: "You pick a secret word, they guess it.",
  reversi: "Trap discs between yours to flip them.",
  mancala: "Sow seeds around the board; the fullest store wins.",
  wordteam: "Everyone guesses one hidden word in 6 tries.",
  code: "Find 4 hidden colors together in 10 tries.",
  pairs: "Flip cards and match all pairs as a team.",
  watch: "A YouTube video, in sync for everyone in the chat.",
};

const VERSUS = CHAT_GAMES.map(([t]) => t).filter((t) => t !== "watch" && !COOP_GAMES.includes(t));
const SECTIONS: [string, string, ChatGameType[]][] = [
  ["Team up", "Everyone in the chat plays together.", COOP_GAMES],
  ["Head to head", "You against whoever moves first.", VERSUS],
  ["Watch", "In sync for everyone.", ["watch"]],
];

/** Start a game (or watch-together) in this chat. */
export function GameDialog({ onStart, onClose }: { onStart: (type: ChatGameType, video?: string, word?: string) => void; onClose: () => void }) {
  const [watch, setWatch] = useState(false);
  const [hangman, setHangman] = useState(false);
  const [word, setWord] = useState("");
  const okWord = cleanWord(word);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ChillVideo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pasted = youtubeId(q);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (pasted) {
      onStart("watch", q.trim());
      return onClose();
    }
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults((await api.videos(q.trim())).videos);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't search.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Play together"
        className="slide-up max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-w-xl sm:rounded-3xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{watch ? "Watch together" : hangman ? "Hangman Duel" : "Play together"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <XIcon className="size-5" />
          </button>
        </div>
        {hangman ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!okWord) return;
              onStart("hangman", undefined, okWord);
              onClose();
            }}
          >
            <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Pick a secret word or short phrase. Only you see it; the chat sees blanks to guess.</p>
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoFocus
              autoComplete="off"
              placeholder="e.g. couscous"
              aria-label="Secret word"
              className="h-11 w-full rounded-xl bg-zinc-100 px-3 text-base outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800"
            />
            <p className="mt-1 text-xs text-zinc-500">{word && !okWord ? "Letters a–z only, 3 to 24 long." : " "}</p>
            <div className="mt-2 flex justify-between">
              <button type="button" onClick={() => setHangman(false)} className="text-sm font-medium text-accent-fg">
                ← Back to games
              </button>
              <button disabled={!okWord} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50">
                Start
              </button>
            </div>
          </form>
        ) : !watch ? (
          <div className="space-y-4">
            {SECTIONS.map(([title, hint, types]) => (
              <section key={title} aria-label={title}>
                <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{title}</h3>
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
                <ul className="grid gap-2 sm:grid-cols-2">
            {CHAT_GAMES.filter(([t]) => types.includes(t)).map(([type, name, emoji]) => (
              <li key={type}>
                <button
                  onClick={() => {
                    if (type === "watch") return setWatch(true);
                    if (type === "hangman") return setHangman(true);
                    onStart(type);
                    onClose();
                  }}
                  className="flex h-full w-full items-center gap-3 rounded-2xl bg-zinc-100 p-3 text-left transition hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-xl shadow-sm dark:bg-zinc-900" aria-hidden="true">{emoji}</span>
                  <span>
                    <span className="block font-semibold">{name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{BLURBS[type]}</span>
                  </span>
                </button>
              </li>
            ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <>
            <form onSubmit={search} className="flex gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-zinc-100 px-3 dark:bg-zinc-800">
                <SearchIcon className="size-4 shrink-0 text-zinc-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoFocus
                  placeholder="Paste a YouTube link or search"
                  aria-label="YouTube link or search"
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              <button className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">{pasted ? "Start" : "Search"}</button>
            </form>
            {loading && (
              <div className="flex justify-center p-6">
                <Spinner className="size-5" />
              </div>
            )}
            {error && <p className="p-4 text-center text-sm text-zinc-500">{error}</p>}
            {results && (
              <ul className="mt-3 grid gap-2" aria-label="Videos">
                {results.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => {
                        onStart("watch", v.id);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <img src={v.thumb} alt="" className="aspect-video w-28 shrink-0 rounded-lg object-cover" />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-sm font-medium">{v.title}</span>
                        <span className="block truncate text-xs text-zinc-500">{v.channel}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setWatch(false)} className="mt-3 text-sm font-medium text-accent-fg">
              ← Back to games
            </button>
          </>
        )}
      </div>
    </div>
  );
}
