import { useEffect, useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell } from "./GameShell";

interface Cell {
  mine: boolean;
  open: boolean;
  flag: boolean;
  around: number;
}

const LEVELS = {
  easy: { w: 9, h: 9, mines: 10 },
  medium: { w: 12, h: 14, mines: 30 },
} as const;
type Level = keyof typeof LEVELS;

const NUM_COLORS = ["", "text-blue-600", "text-emerald-600", "text-red-600", "text-indigo-700", "text-amber-700", "text-cyan-600", "text-zinc-900 dark:text-white", "text-zinc-500"];

function neighbours(i: number, w: number, h: number): number[] {
  const x = i % w;
  const y = Math.floor(i / w);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
    }
  return out;
}

/** Mines go in after the first tap, so the first tap is never a mine. */
function build(w: number, h: number, mines: number, safe: number): Cell[] {
  const cells: Cell[] = Array.from({ length: w * h }, () => ({ mine: false, open: false, flag: false, around: 0 }));
  const keepClear = new Set([safe, ...neighbours(safe, w, h)]);
  let placed = 0;
  while (placed < mines) {
    const i = Math.floor(Math.random() * cells.length);
    if (cells[i].mine || keepClear.has(i)) continue;
    cells[i].mine = true;
    placed++;
  }
  cells.forEach((c, i) => (c.around = neighbours(i, w, h).filter((n) => cells[n].mine).length));
  return cells;
}

/** Minesweeper: tap to open, long-press (or right-click, or flag mode) to flag. Best time wins. */
export function Minesweeper({ onExit }: { onExit: () => void }) {
  const [level, setLevel] = useState<Level>("easy");
  const { w, h, mines } = LEVELS[level];
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [state, setState] = useState<"playing" | "won" | "lost">("playing");
  const [flagMode, setFlagMode] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [record, setRecord] = useState(false);
  const best = useBest().mines;
  const press = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  useEffect(() => {
    if (!started || state !== "playing") return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [started, state]);

  const reset = (l: Level = level) => {
    setLevel(l);
    setCells(null);
    setState("playing");
    setStarted(null);
    setRecord(false);
  };

  const open = (i: number) => {
    if (state !== "playing") return;
    let board = cells;
    if (!board) {
      board = build(w, h, mines, i);
      setStarted(Date.now());
    }
    const next = board.map((c) => ({ ...c }));
    if (next[i].flag || next[i].open) return;
    if (next[i].mine) {
      next.forEach((c) => c.mine && (c.open = true));
      setCells(next);
      setState("lost");
      navigator.vibrate?.(200);
      return;
    }
    // Flood-open empty areas.
    const stack = [i];
    while (stack.length) {
      const j = stack.pop()!;
      if (next[j].open || next[j].flag) continue;
      next[j].open = true;
      if (next[j].around === 0) stack.push(...neighbours(j, w, h));
    }
    setCells(next);
    if (next.every((c) => c.mine || c.open)) {
      const secs = Math.round((Date.now() - (started ?? Date.now())) / 100) / 10;
      setState("won");
      // Only the standard (easy) board counts for the record.
      if (level === "easy") setRecord(submitScore("mines", secs));
    }
  };

  const flag = (i: number) => {
    if (state !== "playing" || !cells || cells[i].open) return;
    setCells(cells.map((c, j) => (j === i ? { ...c, flag: !c.flag } : c)));
    navigator.vibrate?.(20);
  };

  const flags = cells?.filter((c) => c.flag).length ?? 0;
  const secs = started ? Math.floor(((state === "playing" ? now : now) - started) / 1000) : 0;

  return (
    <GameShell
      title="Minesweeper"
      onExit={onExit}
      stats={[["Mines", mines - flags], ["Time", secs], ["Best", best !== undefined ? `${best}s` : "—"]]}
      onRestart={() => reset()}
      hint="Tap to open. Long-press, right-click or use 🚩 mode to flag. The first tap is always safe."
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex rounded-xl bg-black/5 p-1 dark:bg-zinc-800">
          {(Object.keys(LEVELS) as Level[]).map((l) => (
            <button key={l} onClick={() => reset(l)} className={`rounded-lg px-3 py-1 text-sm font-medium capitalize ${level === l ? "bg-white shadow-sm dark:bg-zinc-600" : "text-zinc-500"}`}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={() => setFlagMode((f) => !f)} aria-pressed={flagMode} className={`rounded-xl px-3 py-1.5 text-sm font-medium ${flagMode ? "bg-accent text-accent-ink" : "bg-black/5 dark:bg-zinc-800"}`}>
          🚩 {flagMode ? "Flagging" : "Flag mode"}
        </button>
      </div>
      <div className="relative mx-auto" style={{ maxWidth: `min(100%, calc((100dvh - 17rem) * ${w / h}))` }}>
        <div className="grid gap-0.5 rounded-xl bg-zinc-300 p-0.5 select-none dark:bg-zinc-700" style={{ gridTemplateColumns: `repeat(${w}, minmax(0, 1fr))` }} aria-label="Minefield">
          {Array.from({ length: w * h }, (_, i) => {
            const c = cells?.[i];
            return (
              <button
                key={i}
                onContextMenu={(e) => {
                  e.preventDefault();
                  flag(i);
                }}
                onPointerDown={() => {
                  longPressed.current = false;
                  press.current = window.setTimeout(() => {
                    longPressed.current = true;
                    flag(i);
                  }, 380);
                }}
                onPointerUp={() => window.clearTimeout(press.current)}
                onPointerLeave={() => window.clearTimeout(press.current)}
                onClick={() => {
                  if (longPressed.current) return;
                  if (flagMode) flag(i);
                  else open(i);
                }}
                aria-label={c?.open ? (c.mine ? "Mine" : `${c.around} mines around`) : c?.flag ? "Flagged" : "Hidden"}
                className={`flex aspect-square items-center justify-center rounded-[3px] text-xs font-bold sm:text-sm ${
                  c?.open ? (c.mine ? "bg-red-500" : "bg-zinc-50 dark:bg-zinc-900") : "bg-zinc-200 hover:bg-black/5 active:bg-zinc-50 dark:bg-zinc-600 dark:hover:bg-zinc-500"
                } ${c?.open ? NUM_COLORS[c.around] : ""}`}
              >
                {c?.open ? (c.mine ? "💣" : c.around || "") : c?.flag ? "🚩" : ""}
              </button>
            );
          })}
        </div>
        {state !== "playing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/55 text-white">
            <p className="text-2xl font-bold">{state === "won" ? (record ? "New record! 🎉" : "You won! 😎") : "Boom 💥"}</p>
            {state === "won" && <p>{secs} seconds</p>}
            <button onClick={() => reset()} className="rounded-full bg-white px-5 py-2 font-semibold text-zinc-900">
              Play again
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
