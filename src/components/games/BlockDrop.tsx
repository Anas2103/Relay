import { useCallback, useEffect, useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell, Overlay } from "./GameShell";

const W = 10;
const H = 20;
const SHAPES: { cells: [number, number][]; color: string }[] = [
  { cells: [[0, 1], [1, 1], [2, 1], [3, 1]], color: "#06b6d4" },
  { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: "#eab308" },
  { cells: [[1, 0], [0, 1], [1, 1], [2, 1]], color: "#a855f7" },
  { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: "#22c55e" },
  { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: "#ef4444" },
  { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: "#3b82f6" },
  { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: "#f97316" },
];

interface Piece {
  cells: [number, number][];
  color: string;
  x: number;
  y: number;
}

const spawn = (i = Math.floor(Math.random() * SHAPES.length)): Piece => ({ ...SHAPES[i], cells: SHAPES[i].cells.map((c) => [...c] as [number, number]), x: 3, y: 0 });
const rotate = (cells: [number, number][]): [number, number][] => {
  // Turn clockwise around the piece's own box.
  const size = Math.max(...cells.flat()) + 1;
  return cells.map(([x, y]) => [size - 1 - y, x]);
};

/** Falling blocks: fill full lines to clear them. Faster every 10 lines. */
export function BlockDrop({ onExit }: { onExit: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const g = useRef({ board: Array.from({ length: H }, () => Array<string | null>(W).fill(null)), piece: spawn(), next: spawn(), score: 0, lines: 0 });
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [state, setState] = useState<"ready" | "playing" | "paused" | "over">("ready");
  const [record, setRecord] = useState(false);
  const best = useBest().blocks ?? 0;

  const fits = (p: Piece, cells = p.cells, dx = 0, dy = 0) =>
    cells.every(([cx, cy]) => {
      const x = p.x + cx + dx;
      const y = p.y + cy + dy;
      return x >= 0 && x < W && y < H && (y < 0 || !g.current.board[y][x]);
    });

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const s = c.width / W;
    ctx.clearRect(0, 0, c.width, c.height);
    const cell = (x: number, y: number, color: string, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x * s + 1, y * s + 1, s - 2, s - 2, s * 0.18);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const { board, piece } = g.current;
    board.forEach((row, y) => row.forEach((col, x) => col && cell(x, y, col)));
    // Where it will land.
    let drop = 0;
    while (fits(piece, piece.cells, 0, drop + 1)) drop++;
    piece.cells.forEach(([cx, cy]) => cell(piece.x + cx, piece.y + cy + drop, piece.color, 0.25));
    piece.cells.forEach(([cx, cy]) => cell(piece.x + cx, piece.y + cy, piece.color));
    // Next piece.
    const p = preview.current;
    if (p) {
      const pc = p.getContext("2d")!;
      pc.clearRect(0, 0, p.width, p.height);
      const ps = p.width / 4;
      pc.fillStyle = g.current.next.color;
      g.current.next.cells.forEach(([x, y]) => {
        pc.beginPath();
        pc.roundRect(x * ps + 1, (y + 1) * ps + 1, ps - 2, ps - 2, 3);
        pc.fill();
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lock = useCallback(() => {
    const st = g.current;
    for (const [cx, cy] of st.piece.cells) {
      const y = st.piece.y + cy;
      if (y < 0) {
        setState("over");
        setRecord(submitScore("blocks", st.score));
        return;
      }
      st.board[y][st.piece.x + cx] = st.piece.color;
    }
    const kept = st.board.filter((row) => row.some((c) => !c));
    const cleared = H - kept.length;
    if (cleared) {
      st.board = [...Array.from({ length: cleared }, () => Array<string | null>(W).fill(null)), ...kept];
      st.lines += cleared;
      st.score += [0, 100, 300, 500, 800][cleared] * (1 + Math.floor(st.lines / 10));
      setLines(st.lines);
      setScore(st.score);
      navigator.vibrate?.(30);
    }
    st.piece = st.next;
    st.next = spawn();
    if (!fits(st.piece)) {
      setState("over");
      setRecord(submitScore("blocks", st.score));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(
    (a: "left" | "right" | "down" | "rotate" | "drop") => {
      if (state !== "playing") return;
      const p = g.current.piece;
      if (a === "left" && fits(p, p.cells, -1)) p.x--;
      if (a === "right" && fits(p, p.cells, 1)) p.x++;
      if (a === "down") {
        if (fits(p, p.cells, 0, 1)) p.y++;
        else lock();
      }
      if (a === "rotate") {
        const r = rotate(p.cells);
        // Nudge off a wall if the turn would poke through it.
        for (const kick of [0, -1, 1, -2, 2]) {
          if (fits(p, r, kick)) {
            p.cells = r;
            p.x += kick;
            break;
          }
        }
      }
      if (a === "drop") {
        while (fits(p, p.cells, 0, 1)) {
          p.y++;
          g.current.score += 2;
        }
        setScore(g.current.score);
        lock();
      }
      draw();
    },
    [state, draw, lock], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    draw();
    if (state !== "playing") return;
    const speed = Math.max(90, 650 - Math.floor(g.current.lines / 10) * 60);
    const t = window.setInterval(() => act("down"), speed);
    return () => window.clearInterval(t);
  }, [state, lines, act, draw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, "left" | "right" | "down" | "rotate" | "drop"> = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", ArrowUp: "rotate", x: "rotate", " ": "drop" };
      if (e.key === "p" || e.key === "Escape") return setState((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s));
      const a = map[e.key];
      if (!a) return;
      e.preventDefault();
      if (state === "ready") setState("playing");
      act(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, state]);

  const reset = () => {
    g.current = { board: Array.from({ length: H }, () => Array<string | null>(W).fill(null)), piece: spawn(), next: spawn(), score: 0, lines: 0 };
    setScore(0);
    setLines(0);
    setRecord(false);
    setState("playing");
  };

  const Pad = ({ a, label, children }: { a: Parameters<typeof act>[0]; label: string; children: React.ReactNode }) => (
    <button onPointerDown={() => act(a)} aria-label={label} className="flex h-12 flex-1 items-center justify-center rounded-xl bg-black/10 text-lg font-bold active:bg-black/20 dark:bg-white/10">
      {children}
    </button>
  );

  return (
    <GameShell title="Block Drop" onExit={onExit} stats={[["Score", score], ["Lines", lines], ["Best", Math.max(best, score)]]} onRestart={reset} hint="← → move · ↑ turn · ↓ faster · Space drops · P pauses">
      <div className="flex justify-center gap-3">
        <div className="relative h-[min(60dvh,32rem)] aspect-[1/2] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-black/10">
          <canvas ref={canvas} width={300} height={600} className="size-full" aria-label="Block Drop board" />
          {state !== "playing" && (
            <Overlay
              title={state === "over" ? (record ? "New record! 🎉" : "Game over") : state === "paused" ? "Paused" : "Block Drop"}
              detail={state === "over" ? `${score} points · ${lines} lines` : undefined}
              action={state === "over" ? "Play again" : state === "paused" ? "Resume" : "Start"}
              onAction={() => (state === "over" ? reset() : setState("playing"))}
            />
          )}
        </div>
        <div className="w-16 shrink-0">
          <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Next</p>
          <canvas ref={preview} width={64} height={64} className="mt-1 rounded-lg bg-zinc-900" />
          <button onClick={() => setState((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s))} className="mt-2 w-full rounded-lg bg-black/5 py-1 text-xs font-semibold dark:bg-white/10">
            {state === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      </div>
      <div className="mt-3 flex gap-1.5 md:hidden">
        <Pad a="left" label="Move left">←</Pad>
        <Pad a="rotate" label="Turn">⟳</Pad>
        <Pad a="right" label="Move right">→</Pad>
        <Pad a="down" label="Down">↓</Pad>
        <Pad a="drop" label="Drop">⤓</Pad>
      </div>
    </GameShell>
  );
}
