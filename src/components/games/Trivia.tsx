import { useEffect, useState } from "react";
import type { TriviaQuestion } from "../../../shared/types";
import { api, ApiError } from "../../lib/api";
import { submitScore, useBest } from "../../lib/scores";
import { Spinner } from "../ui";
import { GameShell } from "./GameShell";

const CATEGORIES: [string, string][] = [
  ["", "🎲 Anything"],
  ["9", "🧠 General"],
  ["11", "🎬 Movies"],
  ["12", "🎵 Music"],
  ["15", "🎮 Video games"],
  ["21", "⚽ Sports"],
  ["22", "🗺️ Geography"],
  ["23", "🏛️ History"],
  ["17", "🔬 Science"],
  ["31", "🍥 Anime"],
  ["27", "🐾 Animals"],
  ["18", "💻 Computers"],
];
const SECONDS = 15;

/** 10 questions, 15 seconds each; faster right answers score more. */
export function Trivia({ onExit }: { onExit: () => void }) {
  const [category, setCategory] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState("");
  const [questions, setQuestions] = useState<TriviaQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [left, setLeft] = useState(SECONDS);
  const [score, setScore] = useState(0);
  const [right, setRight] = useState(0);
  const [record, setRecord] = useState(false);
  const best = useBest().trivia;
  const done = questions !== null && i >= questions.length;
  const q = questions?.[i];

  const start = (cat: string) => {
    setCategory(cat);
    setQuestions(null);
    setError(null);
    setI(0);
    setPicked(null);
    setScore(0);
    setRight(0);
    setRecord(false);
    setLeft(SECONDS);
    api.trivia(cat, difficulty).then(
      (r) => setQuestions(r.questions),
      (err) => setError(err instanceof ApiError ? err.message : "Couldn't get questions."),
    );
  };

  // The clock.
  useEffect(() => {
    if (!q || picked !== null) return;
    if (left <= 0) {
      setPicked(-1); // time's up
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [q, picked, left]);

  // Next question shortly after answering.
  useEffect(() => {
    if (picked === null || !questions) return;
    const t = window.setTimeout(() => {
      const next = i + 1;
      setI(next);
      setPicked(null);
      setLeft(SECONDS);
      if (next >= questions.length) setRecord(submitScore("trivia", score));
    }, 1400);
    return () => window.clearTimeout(t);
  }, [picked, questions, i, score]);

  const answer = (n: number) => {
    if (picked !== null || !q) return;
    setPicked(n);
    if (n === q.correct) {
      setRight((r) => r + 1);
      setScore((s) => s + 100 + left * 10);
      navigator.vibrate?.(20);
    } else navigator.vibrate?.([40, 40, 40]);
  };

  if (category === null) {
    return (
      <GameShell title="Trivia" onExit={onExit} stats={[["Best", best ?? "—"]]}>
        <div className="mb-3 flex rounded-xl bg-black/5 p-1 dark:bg-zinc-800">
          {[
            ["", "Any level"],
            ["easy", "Easy"],
            ["medium", "Medium"],
            ["hard", "Hard"],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setDifficulty(v)} className={`flex-1 rounded-lg py-1.5 text-sm font-medium ${difficulty === v ? "bg-white shadow-sm dark:bg-zinc-600" : "text-zinc-500"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map(([id, label]) => (
            <button key={id} onClick={() => start(id)} className="rounded-2xl bg-black/5 px-3 py-4 text-left text-sm font-semibold hover:bg-black/10 dark:bg-zinc-800 dark:hover:bg-zinc-700">
              {label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-zinc-500">Questions from Open Trivia DB (English).</p>
      </GameShell>
    );
  }

  return (
    <GameShell title="Trivia" onExit={() => setCategory(null)} stats={[["Score", score], ["Best", best ?? "—"]]}>
      {error ? (
        <div className="p-8 text-center text-sm text-zinc-500">
          <p>{error}</p>
          <button onClick={() => start(category)} className="mt-3 rounded-full bg-accent px-4 py-1.5 font-semibold text-accent-ink">
            Try again
          </button>
        </div>
      ) : !questions ? (
        <div className="flex justify-center p-10">
          <Spinner className="size-6" />
        </div>
      ) : done ? (
        <div className="rounded-3xl bg-accent/10 p-6 text-center">
          <p className="text-4xl">{right >= 8 ? "🏆" : right >= 5 ? "🎉" : "🙂"}</p>
          <p className="mt-2 text-2xl font-bold">{score} points</p>
          <p className="text-sm text-zinc-500">
            {right} / {questions.length} right{record ? " · new record! 🎉" : ""}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => start(category)} className="rounded-full bg-accent px-5 py-2 font-semibold text-accent-ink">
              Play again
            </button>
            <button onClick={() => setCategory(null)} className="rounded-full bg-zinc-200 px-5 py-2 font-semibold dark:bg-zinc-700">
              Other topic
            </button>
          </div>
        </div>
      ) : (
        q && (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
              <span>
                {i + 1} / {questions.length} · {q.category} · {q.difficulty}
              </span>
              <span className={`font-bold tabular-nums ${left <= 5 ? "text-red-500" : ""}`}>{left}s</span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div className="h-full bg-accent transition-all duration-1000 ease-linear" style={{ width: `${(left / SECONDS) * 100}%` }} />
            </div>
            <p className="mb-4 text-lg font-semibold">{q.question}</p>
            <div className="grid gap-2">
              {q.answers.map((a, n) => {
                const state = picked === null ? "" : n === q.correct ? "bg-emerald-500 text-white" : n === picked ? "bg-red-500 text-white" : "opacity-50";
                return (
                  <button
                    key={n}
                    onClick={() => answer(n)}
                    disabled={picked !== null}
                    className={`rounded-2xl px-4 py-3 text-left font-medium transition ${state || "bg-black/5 hover:bg-black/10 dark:bg-zinc-800 dark:hover:bg-zinc-700"}`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
            {picked === -1 && <p className="mt-3 text-center text-sm font-medium text-red-500">Time's up!</p>}
          </div>
        )
      )}
    </GameShell>
  );
}
