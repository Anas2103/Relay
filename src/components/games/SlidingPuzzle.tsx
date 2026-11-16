import { useEffect, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { BOARD, GameShell, Overlay } from "./GameShell";

/** Shuffles by making random legal moves from the solved board, so it's always solvable. */
function shuffled(n: number): number[] {
  const t = [...Array(n * n).keys()].map((i) => (i + 1) % (n * n)); // 1..n²-1, then 0 (the gap)
  let gap = n * n - 1;
  let prev = -1;
  for (let k = 0; k < n * n * 40; k++) {
    const opts = neighbours(gap, n).filter((x) => x !== prev);
    const pick = opts[Math.floor(Math.random() * opts.length)];
    [t[gap], t[pick]] = [t[pick], t[gap]];
    prev = gap;
    gap = pick;
  }
  return t;
}

function neighbours(i: number, n: number): number[] {
  const x = i % n;
  const y = Math.floor(i / n);
  return [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ]
    .filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n)
    .map(([a, b]) => b * n + a);
}

const isSolved = (t: number[]) => t.every((v, i) => v === (i + 1) % t.length);

/** Slide the tiles back into order. Fewest moves on 4×4 is your record. */
export function SlidingPuzzle({ onExit }: { onExit: () => void }) {
  const [n, setN] = useState(4);
  const [tiles, setTiles] = useState(() => shuffled(4));
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);
  const [record, setRecord] = useState(false);
  const best = useBest().slide;

  const reset = (size = n) => {
    setN(size);
    setTiles(shuffled(size));
    setMoves(0);
    setDone(false);
    setRecord(false);
  };

  const move = (i: number) => {
    if (done) return;
    const gap = tiles.indexOf(0);
    if (!neighbours(gap, n).includes(i)) return;
    const next = [...tiles];
    [next[gap], next[i]] = [next[i], next[gap]];
    setTiles(next);
    setMoves(moves + 1);
    if (isSolved(next)) {
      setDone(true);
      if (n === 4) setRecord(submitScore("slide", moves + 1));
    }
  };

  // Arrow keys slide the tile next to the gap into it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const gap = tiles.indexOf(0);
      const d = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: n, ArrowDown: -n }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      const i = gap + d;
      if (i >= 0 && i < n * n && (Math.abs(d) === n || Math.floor(i / n) === Math.floor(gap / n))) move(i);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <GameShell title="Sliding Puzzle" onExit={onExit} stats={[["Moves", moves], ["Best", best ?? "—"]]} onRestart={() => reset()} hint="Tap a tile next to the gap (or use the arrow keys). Put them back in order 1, 2, 3…">
      <div className="mb-2 flex rounded-xl bg-black/5 p-1 dark:bg-white/10">
        {[3, 4, 5].map((s) => (
          <button key={s} onClick={() => reset(s)} className={`flex-1 rounded-lg py-1 text-sm font-medium ${n === s ? "bg-white shadow-sm dark:bg-zinc-600" : "text-zinc-500"}`}>
            {s}×{s}
          </button>
        ))}
      </div>
      <div className={`relative ${BOARD} rounded-2xl bg-black/10 p-1.5 dark:bg-white/10`}>
        <div className="grid size-full gap-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-label="Puzzle">
          {tiles.map((v, i) =>
            v === 0 ? (
              <span key="gap" />
            ) : (
              <button
                key={v}
                onClick={() => move(i)}
                aria-label={`Tile ${v}`}
                className={`flex items-center justify-center rounded-xl font-bold shadow-sm transition active:scale-95 ${n === 5 ? "text-lg" : "text-2xl"} ${
                  v === i + 1 ? "bg-accent text-accent-ink" : "bg-white text-zinc-900 dark:bg-zinc-700 dark:text-white"
                }`}
              >
                {v}
              </button>
            ),
          )}
        </div>
        {done && <Overlay title={record ? "New record! 🎉" : "Solved! 🧩"} detail={`${moves} moves`} action="Again" onAction={() => reset()} />}
      </div>
    </GameShell>
  );
}
