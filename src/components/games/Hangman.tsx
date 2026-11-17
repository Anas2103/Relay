import { useEffect, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell } from "./GameShell";
import { HANGMAN } from "../../../shared/words";

const LIVES = 6;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function pick(category: string) {
  const list = category === "Any" ? Object.values(HANGMAN).flat() : HANGMAN[category];
  return list[Math.floor(Math.random() * list.length)];
}

/** The little figure, drawn one stroke per wrong letter. */
export function Gallows({ wrong }: { wrong: number }) {
  const parts = [
    <circle key="h" cx="140" cy="62" r="16" />,
    <line key="b" x1="140" y1="78" x2="140" y2="130" />,
    <line key="la" x1="140" y1="92" x2="118" y2="112" />,
    <line key="ra" x1="140" y1="92" x2="162" y2="112" />,
    <line key="ll" x1="140" y1="130" x2="122" y2="158" />,
    <line key="rl" x1="140" y1="130" x2="158" y2="158" />,
  ];
  return (
    <svg
      viewBox="0 0 200 180"
      className="mx-auto h-36 w-auto"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      aria-label={`${wrong} of ${LIVES} mistakes`}
    >
      <path d="M30 170h90M60 170V20h80v26" className="opacity-40" />
      {parts.slice(0, wrong)}
    </svg>
  );
}

/** Guess the word one letter at a time, 6 mistakes allowed. Your best streak is kept. */
export function Hangman({ onExit }: { onExit: () => void }) {
  const [category, setCategory] = useState("Any");
  const [word, setWord] = useState(() => pick("Any"));
  const [tried, setTried] = useState<Set<string>>(new Set());
  const [streak, setStreak] = useState(0);
  const [record, setRecord] = useState(false);
  const best = useBest().hangman ?? 0;
  const wrong = [...tried].filter((l) => !word.includes(l)).length;
  const won = [...word].every((l) => tried.has(l));
  const lost = wrong >= LIVES;

  const guess = (l: string) => {
    if (won || lost || tried.has(l)) return;
    const next = new Set(tried).add(l);
    setTried(next);
    const nowWon = [...word].every((c) => next.has(c));
    const nowLost = [...next].filter((c) => !word.includes(c)).length >= LIVES;
    if (nowWon) {
      setStreak(streak + 1);
      setRecord(submitScore("hangman", streak + 1));
    } else if (nowLost) setStreak(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey) guess(e.key.toLowerCase());
      if (e.key === "Enter" && (won || lost)) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const next = (cat = category) => {
    setCategory(cat);
    setWord(pick(cat));
    setTried(new Set());
    setRecord(false);
  };

  return (
    <GameShell
      title="Hangman"
      onExit={onExit}
      stats={[
        ["Streak", streak],
        ["Best", best],
      ]}
      onRestart={() => next()}
      wide
    >
      <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto">
        {["Any", ...Object.keys(HANGMAN)].map((c) => (
          <button
            key={c}
            onClick={() => next(c)}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${category === c ? "bg-accent text-accent-ink" : "bg-black/5 dark:bg-white/10"}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className={lost ? "text-red-500" : won ? "text-emerald-500" : ""}>
        <Gallows wrong={wrong} />
      </div>
      <p className="mt-1 text-center text-xs text-zinc-500">{LIVES - wrong} mistakes left</p>
      <div className="my-4 flex flex-wrap justify-center gap-1.5" aria-label="The word">
        {[...word].map((l, i) => (
          <span
            key={i}
            className={`flex h-11 w-8 items-end justify-center border-b-4 pb-1 text-2xl font-bold uppercase ${lost && !tried.has(l) ? "text-red-500" : ""}`}
          >
            {tried.has(l) || lost ? l : ""}
          </span>
        ))}
      </div>
      {won || lost ? (
        <div className="pop-in rounded-2xl bg-accent/10 p-4 text-center">
          <p className="text-xl font-bold">{won ? (record ? "New record! 🎉" : "You got it! 🎉") : "Out of tries 😵"}</p>
          <button onClick={() => next()} className="mt-3 rounded-full bg-accent px-5 py-2 font-semibold text-accent-ink">
            Next word
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9" aria-label="Letters">
          {[...LETTERS].map((l) => {
            const used = tried.has(l);
            const good = used && word.includes(l);
            return (
              <button
                key={l}
                onClick={() => guess(l)}
                disabled={used}
                className={`h-11 rounded-lg text-base font-semibold uppercase transition active:scale-95 ${
                  good
                    ? "bg-emerald-500 text-white"
                    : used
                      ? "bg-black/5 text-zinc-400 line-through dark:bg-white/5"
                      : "bg-black/10 hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      )}
    </GameShell>
  );
}
