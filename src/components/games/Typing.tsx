import { useEffect, useMemo, useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell } from "./GameShell";

const WORDS =
  "the quick brown fox jumps over lazy dog chat with friends music radio game play time night sun moon star river ocean mountain coffee tea pizza dream happy smile laugh light dark fast slow open close send message voice video call story photo code build world simple clean bright quiet loud green blue red yellow summer winter rain snow wind fire water earth city road home phone screen window door table chair book page word letter number key".split(
    " ",
  );
const SECONDS = 30;

/** How fast can you type? 30 seconds, words per minute. */
export function Typing({ onExit }: { onExit: () => void }) {
  const [seed, setSeed] = useState(0);
  // A new random word list whenever `seed` changes ("Play again").
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => Array.from({ length: 80 }, () => WORDS[Math.floor(Math.random() * WORDS.length)]), [seed]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [left, setLeft] = useState(SECONDS);
  const [record, setRecord] = useState(false);
  const best = useBest().typing;
  const input = useRef<HTMLInputElement>(null);
  const done = left <= 0;

  useEffect(() => {
    if (!startedAt || done) return;
    const t = window.setInterval(() => {
      const l = SECONDS - Math.floor((Date.now() - startedAt) / 1000);
      setLeft(l);
      if (l <= 0) setRecord(submitScore("typing", Math.round((correctChars.current / 5) * (60 / SECONDS))));
    }, 200);
    return () => window.clearInterval(t);
  }, [startedAt, done]);

  // Characters of correctly typed words (+ spaces), for words per minute.
  const correctChars = useRef(0);

  const onChange = (v: string) => {
    if (done) return;
    if (!startedAt) setStartedAt(Date.now());
    if (v.endsWith(" ")) {
      const word = v.trim();
      if (!word) return setTyped("");
      if (word === words[index]) {
        setCorrect((c) => c + 1);
        correctChars.current += word.length + 1;
      } else setMistakes((m) => m + 1);
      setIndex((i) => i + 1);
      setTyped("");
    } else setTyped(v);
  };

  const reset = () => {
    setSeed((s) => s + 1);
    setIndex(0);
    setTyped("");
    setCorrect(0);
    setMistakes(0);
    setStartedAt(null);
    setLeft(SECONDS);
    setRecord(false);
    correctChars.current = 0;
    input.current?.focus();
  };

  const wpm = Math.round((correctChars.current / 5) * (60 / SECONDS));
  const visible = words.slice(index, index + 14);

  return (
    <GameShell
      title="Typing speed"
      onExit={onExit}
      stats={[
        ["Time", Math.max(0, left)],
        ["Best", best ? `${best} wpm` : "—"],
      ]}
      onRestart={reset}
      hint="Type each word and press space. Timer starts on your first key."
    >
      <div className="rounded-2xl bg-black/5 p-4 text-lg leading-relaxed dark:bg-zinc-800">
        {visible.map((w, i) => (
          <span
            key={index + i}
            className={
              i === 0
                ? w.startsWith(typed)
                  ? "rounded bg-accent/20 px-0.5 font-semibold"
                  : "rounded bg-red-500/20 px-0.5 font-semibold"
                : "text-zinc-500 dark:text-zinc-400"
            }
          >
            {w}{" "}
          </span>
        ))}
      </div>
      <input
        ref={input}
        value={typed}
        onChange={(e) => onChange(e.target.value)}
        disabled={done}
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Type here"
        placeholder={startedAt ? "" : "Start typing…"}
        className="mt-3 h-12 w-full rounded-xl bg-white px-4 text-lg ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-900 dark:ring-zinc-700"
      />
      {done && (
        <div className="mt-4 rounded-2xl bg-accent/10 p-4 text-center">
          <p className="text-3xl font-bold">{wpm} wpm</p>
          <p className="text-sm text-zinc-500">
            {correct} words right · {mistakes} mistakes{record ? " · new record! 🎉" : ""}
          </p>
          <button onClick={reset} className="mt-3 rounded-full bg-accent px-5 py-2 font-semibold text-accent-ink">
            Try again
          </button>
        </div>
      )}
    </GameShell>
  );
}
