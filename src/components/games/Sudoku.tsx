import { useEffect, useMemo, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { BOARD, GameShell, Overlay } from "./GameShell";

type Level = "easy" | "medium" | "hard";
const BLANKS: Record<Level, number> = { easy: 36, medium: 46, hard: 54 };

const rowOf = (i: number) => Math.floor(i / 9);
const colOf = (i: number) => i % 9;
const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
const peers = (i: number, j: number) => i !== j && (rowOf(i) === rowOf(j) || colOf(i) === colOf(j) || boxOf(i) === boxOf(j));

/** A random full, valid grid (randomised backtracking). */
function solved(): number[] {
  const g = Array(81).fill(0);
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
    for (const n of nums) {
      if (g.some((v, j) => v === n && peers(i, j))) continue;
      g[i] = n;
      if (fill(i + 1)) return true;
    }
    g[i] = 0;
    return false;
  };
  fill(0);
  return g;
}

function puzzle(level: Level): { given: number[]; solution: number[] } {
  const solution = solved();
  const given = [...solution];
  const cells = [...Array(81).keys()].sort(() => Math.random() - 0.5).slice(0, BLANKS[level]);
  for (const c of cells) given[c] = 0;
  return { given, solution };
}

/** Sudoku: fill every row, column and 3×3 box with 1–9. Best time on Medium counts. */
export function Sudoku({ onExit }: { onExit: () => void }) {
  const [level, setLevel] = useState<Level>("medium");
  const [{ given }, setPuzzle] = useState(() => puzzle("medium"));
  const [grid, setGrid] = useState<number[]>(given);
  const [sel, setSel] = useState<number | null>(null);
  const [start, setStart] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState<number | null>(null);
  const [record, setRecord] = useState(false);
  const best = useBest().sudoku;

  const conflicts = useMemo(() => {
    const bad = new Set<number>();
    grid.forEach((v, i) => {
      if (v && grid.some((w, j) => w === v && peers(i, j))) bad.add(i);
    });
    return bad;
  }, [grid]);

  useEffect(() => {
    if (done !== null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [done]);

  const newGame = (l: Level = level) => {
    const p = puzzle(l);
    setLevel(l);
    setPuzzle(p);
    setGrid(p.given);
    setSel(null);
    setStart(Date.now());
    setNow(Date.now());
    setDone(null);
    setRecord(false);
  };

  const put = (n: number) => {
    if (sel === null || given[sel] || done !== null) return;
    const next = [...grid];
    next[sel] = n;
    setGrid(next);
    // Solved: everything filled and nothing clashes (any valid answer counts).
    if (next.every((v, i) => v && !next.some((w, j) => w === v && peers(i, j)))) {
      const secs = Math.round((Date.now() - start) / 1000);
      setDone(secs);
      if (level === "medium") setRecord(submitScore("sudoku", secs));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key)) put(Number(e.key));
      else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") put(0);
      else if (sel !== null && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[e.key] ?? 0;
        setSel((s) => ((s ?? 0) + d + 81) % 81);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const secs = done ?? Math.floor((now - start) / 1000);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const selVal = sel !== null ? grid[sel] : 0;

  return (
    <GameShell
      title="Sudoku"
      onExit={onExit}
      stats={[
        ["Time", time],
        ["Best", best !== undefined ? `${Math.floor(best / 60)}:${String(best % 60).padStart(2, "0")}` : "—"],
      ]}
      onRestart={() => newGame()}
      hint="Tap a square, then a number. Red = clashes with another one. Best time counts on Medium."
    >
      <div className="mb-2 flex justify-center rounded-xl bg-black/5 p-1 dark:bg-white/10">
        {(["easy", "medium", "hard"] as Level[]).map((l) => (
          <button
            key={l}
            onClick={() => newGame(l)}
            className={`flex-1 rounded-lg py-1 text-sm font-medium capitalize ${level === l ? "bg-white shadow-sm dark:bg-zinc-600" : "text-zinc-500"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className={`relative ${BOARD} max-w-[min(100%,calc(100dvh-21rem))]`}>
        <div
          className="grid size-full grid-cols-9 overflow-hidden rounded-xl border-2 border-zinc-800 bg-white select-none dark:border-zinc-300 dark:bg-zinc-900"
          aria-label="Sudoku grid"
        >
          {grid.map((v, i) => {
            const fixed = !!given[i];
            const isSel = sel === i;
            const related = sel !== null && (peers(i, sel) || isSel);
            const same = !!v && v === selVal;
            return (
              <button
                key={i}
                onClick={() => setSel(i)}
                aria-label={`Row ${rowOf(i) + 1} column ${colOf(i) + 1}${v ? `, ${v}` : ", empty"}`}
                className={`flex items-center justify-center text-[clamp(0.9rem,3.6vw,1.4rem)] tabular-nums ${colOf(i) % 3 === 2 && colOf(i) < 8 ? "border-r-2 border-r-zinc-800 dark:border-r-zinc-300" : "border-r border-r-zinc-200 dark:border-r-zinc-700"} ${
                  rowOf(i) % 3 === 2 && rowOf(i) < 8
                    ? "border-b-2 border-b-zinc-800 dark:border-b-zinc-300"
                    : "border-b border-b-zinc-200 dark:border-b-zinc-700"
                } ${isSel ? "bg-accent/30" : same ? "bg-accent/15" : related ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""} ${
                  conflicts.has(i) && !fixed ? "text-red-500" : fixed ? "font-bold" : "font-medium text-accent-fg"
                }`}
              >
                {v || ""}
              </button>
            );
          })}
        </div>
        {done !== null && <Overlay title={record ? "New record! 🎉" : "Solved! 🧩"} detail={`in ${time}`} action="New puzzle" onAction={() => newGame()} />}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
          const used = grid.filter((v) => v === n).length >= 9;
          return (
            <button
              key={n}
              onClick={() => put(n)}
              disabled={used}
              className="h-11 rounded-xl bg-black/5 text-lg font-semibold hover:bg-black/10 disabled:opacity-30 dark:bg-white/10"
            >
              {n}
            </button>
          );
        })}
        <button onClick={() => put(0)} className="h-11 rounded-xl bg-black/5 text-sm font-semibold hover:bg-black/10 dark:bg-white/10" aria-label="Erase">
          ⌫
        </button>
      </div>
    </GameShell>
  );
}
