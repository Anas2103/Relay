import { useCallback, useEffect, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell } from "./GameShell";
import { FIVE } from "../../../shared/words";

type Mark = "hit" | "near" | "miss";
const ROWS = 6;
const KEYS = ["qwertyuiop", "asdfghjkl", "⏎zxcvbnm⌫"];

/** Colours a guess: green = right place, yellow = in the word elsewhere (counting repeats correctly). */
function mark(guess: string, answer: string): Mark[] {
  const out: Mark[] = Array(5).fill("miss");
  const left: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) out[i] = "hit";
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === "hit") continue;
    if (left[guess[i]]) {
      out[i] = "near";
      left[guess[i]]--;
    }
  }
  return out;
}

const COLORS: Record<Mark, string> = {
  hit: "bg-emerald-500 text-white ring-emerald-500",
  near: "bg-amber-400 text-white ring-amber-400",
  miss: "bg-zinc-400 text-white ring-zinc-400 dark:bg-zinc-600 dark:ring-zinc-600",
};

const pick = () => FIVE[Math.floor(Math.random() * FIVE.length)];

/** Guess the 5-letter word in 6 tries. Your best win streak is kept. */
export function WordGuess({ onExit }: { onExit: () => void }) {
  const [answer, setAnswer] = useState(pick);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [shake, setShake] = useState(false);
  const [streak, setStreak] = useState(0);
  const [record, setRecord] = useState(false);
  const best = useBest().wordguess ?? 0;
  const won = guesses.includes(answer);
  const over = won || guesses.length >= ROWS;

  // Best colour per letter for the keyboard.
  const keyMarks: Record<string, Mark> = {};
  for (const g of guesses) {
    mark(g, answer).forEach((m, i) => {
      const k = g[i];
      if (m === "hit" || (m === "near" && keyMarks[k] !== "hit") || !keyMarks[k]) keyMarks[k] = m;
    });
  }

  const press = useCallback(
    (k: string) => {
      if (over) return;
      if (k === "⌫" || k === "Backspace") return setTyped((t) => t.slice(0, -1));
      if (k === "⏎" || k === "Enter") {
        if (typed.length !== 5) {
          setShake(true);
          window.setTimeout(() => setShake(false), 400);
          return;
        }
        const next = [...guesses, typed];
        setGuesses(next);
        setTyped("");
        if (typed === answer) {
          const s = streak + 1;
          setStreak(s);
          setRecord(submitScore("wordguess", s));
        } else if (next.length >= ROWS) setStreak(0);
        return;
      }
      if (/^[a-z]$/i.test(k)) setTyped((t) => (t.length < 5 ? t + k.toLowerCase() : t));
    },
    [over, typed, guesses, answer, streak],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[a-z]$/i.test(e.key) || e.key === "Enter" || e.key === "Backspace") {
        e.preventDefault();
        press(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const next = () => {
    setAnswer(pick());
    setGuesses([]);
    setTyped("");
    setRecord(false);
  };

  return (
    <GameShell title="Word Guess" onExit={onExit} stats={[["Streak", streak], ["Best", best]]} onRestart={next} hint="🟩 right place · 🟨 in the word · ⬜ not in it">
      <div className="mx-auto grid w-full max-w-[18rem] gap-1.5" aria-label="Guesses">
        {Array.from({ length: ROWS }, (_, r) => {
          const word = r < guesses.length ? guesses[r] : r === guesses.length ? typed : "";
          const marks = r < guesses.length ? mark(guesses[r], answer) : null;
          return (
            <div key={r} className={`grid grid-cols-5 gap-1.5 ${shake && r === guesses.length ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
              {Array.from({ length: 5 }, (_, c) => (
                <span
                  key={c}
                  className={`flex aspect-square items-center justify-center rounded-lg text-2xl font-bold uppercase ring-2 transition-colors duration-300 ${
                    marks ? COLORS[marks[c]] : word[c] ? "ring-zinc-400 dark:ring-zinc-500" : "ring-zinc-200 dark:ring-zinc-700"
                  }`}
                  style={marks ? { transitionDelay: `${c * 80}ms` } : undefined}
                >
                  {word[c] ?? ""}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {over ? (
        <div className="pop-in mt-4 rounded-2xl bg-accent/10 p-4 text-center">
          <p className="text-xl font-bold">{won ? (record ? "New record! 🎉" : `Got it in ${guesses.length}! 🎉`) : "So close!"}</p>
          <p className="text-sm text-zinc-500">
            The word was <b className="uppercase">{answer}</b>
          </p>
          <button onClick={next} className="mt-3 rounded-full bg-accent px-5 py-2 font-semibold text-accent-ink">
            Next word
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-1.5 select-none" aria-label="Keyboard">
          {KEYS.map((row) => (
            <div key={row} className="flex justify-center gap-1">
              {[...row].map((k) => {
                const m = keyMarks[k];
                const wideKey = k === "⏎" || k === "⌫";
                return (
                  <button
                    key={k}
                    onClick={() => press(k)}
                    aria-label={k === "⏎" ? "Enter" : k === "⌫" ? "Delete" : k}
                    className={`flex h-12 items-center justify-center rounded-lg text-sm font-semibold uppercase transition active:scale-95 ${wideKey ? "max-w-16 flex-[1.5]" : "max-w-10 flex-1"} ${
                      m ? COLORS[m] : "bg-black/10 hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                    }`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </GameShell>
  );
}
