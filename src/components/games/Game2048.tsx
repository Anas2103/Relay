import { useCallback, useEffect, useRef, useState } from "react";
import { KEY_DIRS, submitScore, swipeDir, useBest } from "../../lib/scores";
import { BOARD, GameShell } from "./GameShell";

type Grid = number[][];
type Dir = "left" | "right" | "up" | "down";

const SIZE = 4;
const empty = (): Grid => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

function addTile(g: Grid): Grid {
  const free: [number, number][] = [];
  g.forEach((row, r) => row.forEach((v, c) => !v && free.push([r, c])));
  if (!free.length) return g;
  const [r, c] = free[Math.floor(Math.random() * free.length)];
  const next = g.map((row) => [...row]);
  next[r][c] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

/** Slides one row to the left, merging equal neighbours once. */
function slideRow(row: number[]): { row: number[]; gained: number } {
  const tiles = row.filter(Boolean);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] * 2);
      gained += tiles[i] * 2;
      i++;
    } else out.push(tiles[i]);
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained };
}

const transpose = (g: Grid): Grid => g[0].map((_, c) => g.map((row) => row[c]));
const flip = (g: Grid): Grid => g.map((row) => [...row].reverse());

function move(g: Grid, dir: Dir): { grid: Grid; gained: number; moved: boolean } {
  let work = dir === "up" || dir === "down" ? transpose(g) : g.map((r) => [...r]);
  if (dir === "right" || dir === "down") work = flip(work);
  let gained = 0;
  work = work.map((row) => {
    const s = slideRow(row);
    gained += s.gained;
    return s.row;
  });
  if (dir === "right" || dir === "down") work = flip(work);
  if (dir === "up" || dir === "down") work = transpose(work);
  const moved = work.some((row, r) => row.some((v, c) => v !== g[r][c]));
  return { grid: work, gained, moved };
}

const canMove = (g: Grid) => (["left", "right", "up", "down"] as Dir[]).some((d) => move(g, d).moved);

const COLORS: Record<number, string> = {
  2: "bg-black/5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100",
  4: "bg-amber-100 text-amber-900",
  8: "bg-orange-300 text-white",
  16: "bg-orange-400 text-white",
  32: "bg-orange-500 text-white",
  64: "bg-red-500 text-white",
  128: "bg-yellow-400 text-white",
  256: "bg-yellow-500 text-white",
  512: "bg-lime-500 text-white",
  1024: "bg-emerald-500 text-white",
  2048: "bg-accent text-accent-ink",
};

export function Game2048({ onExit }: { onExit: () => void }) {
  const [grid, setGrid] = useState<Grid>(() => addTile(addTile(empty())));
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [record, setRecord] = useState(false);
  const best = useBest()["2048"] ?? 0;
  const touch = useRef<{ x: number; y: number } | null>(null);

  const play = useCallback(
    (dir: Dir) => {
      if (over) return;
      const r = move(grid, dir);
      if (!r.moved) return;
      const next = addTile(r.grid);
      const total = score + r.gained;
      setGrid(next);
      setScore(total);
      if (!canMove(next)) {
        setOver(true);
        setRecord(submitScore("2048", total));
      }
    },
    [grid, score, over],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = KEY_DIRS[e.key];
      if (d) {
        e.preventDefault();
        play(d);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play]);

  const restart = () => {
    if (!over && score > 0) submitScore("2048", score);
    setGrid(addTile(addTile(empty())));
    setScore(0);
    setOver(false);
    setRecord(false);
  };

  return (
    <GameShell
      title="2048"
      onExit={onExit}
      stats={[
        ["Score", score],
        ["Best", Math.max(best, score)],
      ]}
      onRestart={restart}
      hint="Arrow keys or swipe. Join equal tiles to reach 2048."
    >
      <div
        className={`relative ${BOARD} grid touch-none grid-cols-4 gap-2 rounded-2xl bg-black/10 p-2 select-none dark:bg-zinc-800`}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          if (!touch.current) return;
          const d = swipeDir(e.changedTouches[0].clientX - touch.current.x, e.changedTouches[0].clientY - touch.current.y);
          touch.current = null;
          if (d) play(d);
        }}
        aria-label="2048 board"
      >
        {grid.flat().map((v, i) => (
          <div
            key={i}
            className={`flex items-center justify-center rounded-xl font-bold transition-colors ${v ? (COLORS[v] ?? "bg-zinc-900 text-white") : "bg-zinc-300/60 dark:bg-zinc-700/50"} ${
              v >= 1024 ? "text-xl" : v >= 128 ? "text-2xl" : "text-3xl"
            }`}
          >
            {v || ""}
          </div>
        ))}
        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/60 text-white">
            <p className="text-2xl font-bold">{record ? "New record! 🎉" : "Game over"}</p>
            <p>Score: {score}</p>
            <button onClick={restart} className="rounded-full bg-white px-5 py-2 font-semibold text-zinc-900">
              Play again
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
