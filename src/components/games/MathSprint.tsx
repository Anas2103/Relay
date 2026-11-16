import { useEffect, useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell } from "./GameShell";

const SECONDS = 60;

function question(level: number): { text: string; answer: number } {
  const r = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const big = Math.min(12 + level * 4, 99);
  switch (r(0, level > 3 ? 3 : 2)) {
    case 0: {
      const a = r(2, big);
      const b = r(2, big);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    case 1: {
      const a = r(5, big);
      const b = r(1, a);
      return { text: `${a} − ${b}`, answer: a - b };
    }
    case 2: {
      const a = r(2, Math.min(12, 4 + level));
      const b = r(2, 12);
      return { text: `${a} × ${b}`, answer: a * b };
    }
    default: {
      const b = r(2, 12);
      const ans = r(2, 12);
      return { text: `${b * ans} ÷ ${b}`, answer: ans };
    }
  }
}

/** As many sums as you can in 60 seconds. Harder as you go; a wrong answer costs 3 seconds. */
export function MathSprint({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<"ready" | "playing" | "over">("ready");
  const [score, setScore] = useState(0);
  const [q, setQ] = useState(() => question(0));
  const [typed, setTyped] = useState("");
  const [left, setLeft] = useState(SECONDS);
  const [flash, setFlash] = useState<"good" | "bad" | null>(null);
  const [record, setRecord] = useState(false);
  const best = useBest().math ?? 0;
  const endAt = useRef(0);
  const scoreRef = useRef(0);
  scoreRef.current = score;

  useEffect(() => {
    if (state !== "playing") return;
    const t = window.setInterval(() => {
      const l = Math.ceil((endAt.current - Date.now()) / 1000);
      setLeft(Math.max(0, l));
      if (l <= 0) {
        setState("over");
        setRecord(submitScore("math", scoreRef.current));
      }
    }, 200);
    return () => window.clearInterval(t);
  }, [state]);

  const start = () => {
    endAt.current = Date.now() + SECONDS * 1000;
    setScore(0);
    setLeft(SECONDS);
    setQ(question(0));
    setTyped("");
    setRecord(false);
    setState("playing");
  };

  const submit = (value: string) => {
    if (state !== "playing" || value === "" || value === "-") return;
    if (Number(value) === q.answer) {
      setScore((s) => s + 1);
      setQ(question(Math.floor((score + 1) / 5)));
      setFlash("good");
    } else {
      endAt.current -= 3000;
      setFlash("bad");
      navigator.vibrate?.(60);
    }
    setTyped("");
    window.setTimeout(() => setFlash(null), 250);
  };

  // Typing the right number answers straight away (no Enter needed).
  const type = (v: string) => {
    if (state !== "playing") return;
    const next = (typed + v).slice(0, 4);
    if (Number(next) === q.answer) return submit(next);
    setTyped(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) type(e.key);
      else if (e.key === "Backspace") setTyped((t) => t.slice(0, -1));
      else if (e.key === "Enter") state === "playing" ? submit(typed) : start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <GameShell title="Math Sprint" onExit={onExit} stats={[["Time", left], ["Score", score], ["Best", Math.max(best, score)]]} hint="Type the answer — it counts as soon as it's right. Wrong + Enter = −3 s.">
      {state === "playing" ? (
        <>
          <div
            className={`flex h-36 flex-col items-center justify-center rounded-3xl text-5xl font-bold tabular-nums transition-colors ${
              flash === "good" ? "bg-emerald-500/20" : flash === "bad" ? "bg-red-500/20" : "bg-black/5 dark:bg-white/10"
            }`}
          >
            <span>{q.text}</span>
            <span className="mt-1 h-10 text-3xl text-accent-fg">{typed || "?"}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map((k) => (
              <button
                key={k}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (k === "⌫") setTyped((t) => t.slice(0, -1));
                  else if (k === "✓") submit(typed);
                  else type(k);
                }}
                className={`h-14 rounded-2xl text-2xl font-semibold active:scale-95 ${k === "✓" ? "bg-accent text-accent-ink" : "bg-black/10 dark:bg-white/10"}`}
              >
                {k}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-3xl bg-accent/10 p-8 text-center">
          <p className="text-5xl">🧮</p>
          <p className="mt-2 text-2xl font-bold">{state === "over" ? (record ? "New record! 🎉" : `${score} right!`) : "Math Sprint"}</p>
          <p className="mt-1 text-sm text-zinc-500">{state === "over" ? "Can you beat it?" : "60 seconds. Go as fast as you can."}</p>
          <button onClick={start} className="mt-4 rounded-full bg-accent px-6 py-2.5 font-semibold text-accent-ink">
            {state === "over" ? "Play again" : "Start"}
          </button>
        </div>
      )}
    </GameShell>
  );
}
