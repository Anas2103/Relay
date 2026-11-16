import { useEffect, useRef, useState } from "react";
import { KEY_DIRS, submitScore, swipeDir, useBest } from "../../lib/scores";
import { ChevronDownIcon, ChevronUpIcon } from "../ui";
import { BOARD, GameShell } from "./GameShell";

type Dir = "left" | "right" | "up" | "down";
type Pt = [number, number];

const N = 18;
const STEP: Record<Dir, Pt> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const OPPOSITE: Record<Dir, Dir> = { left: "right", right: "left", up: "down", down: "up" };

function freeCell(snake: Pt[]): Pt {
  for (;;) {
    const p: Pt = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)];
    if (!snake.some(([x, y]) => x === p[0] && y === p[1])) return p;
  }
}

/** Classic snake on a canvas: eat, grow, speed up; walls wrap around. */
export function Snake({ onExit }: { onExit: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef({ snake: [[8, 9], [7, 9], [6, 9]] as Pt[], dir: "right" as Dir, queue: [] as Dir[], food: [13, 9] as Pt, alive: true, score: 0 });
  const [score, setScore] = useState(0);
  const [state, setState] = useState<"ready" | "playing" | "paused" | "over">("ready");
  const [record, setRecord] = useState(false);
  const best = useBest().snake ?? 0;
  const touch = useRef<{ x: number; y: number } | null>(null);

  const turn = (d: Dir) => {
    const g = game.current;
    const last = g.queue[g.queue.length - 1] ?? g.dir;
    if (d !== last && d !== OPPOSITE[last] && g.queue.length < 3) g.queue.push(d);
    setState((s) => (s === "ready" || s === "paused" ? "playing" : s));
  };

  const reset = () => {
    game.current = { snake: [[8, 9], [7, 9], [6, 9]], dir: "right", queue: [], food: [13, 9], alive: true, score: 0 };
    setScore(0);
    setRecord(false);
    setState("ready");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = KEY_DIRS[e.key];
      if (d) {
        e.preventDefault();
        turn(d);
      } else if (e.key === " ") {
        e.preventDefault();
        setState((s) => (s === "playing" ? "paused" : s === "paused" || s === "ready" ? "playing" : s));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Draw (and tick while playing).
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#6366f1";
    const draw = () => {
      const g = game.current;
      const s = c.width / N;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc((g.food[0] + 0.5) * s, (g.food[1] + 0.5) * s, s * 0.38, 0, Math.PI * 2);
      ctx.fill();
      g.snake.forEach(([x, y], i) => {
        ctx.fillStyle = accent;
        ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - i / (g.snake.length + 6));
        ctx.beginPath();
        ctx.roundRect(x * s + 1, y * s + 1, s - 2, s - 2, s * 0.3);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };
    draw();
    if (state !== "playing") return;
    let timer = 0;
    const tick = () => {
      const g = game.current;
      if (g.queue.length) g.dir = g.queue.shift()!;
      const [dx, dy] = STEP[g.dir];
      const head: Pt = [(g.snake[0][0] + dx + N) % N, (g.snake[0][1] + dy + N) % N];
      const eats = head[0] === g.food[0] && head[1] === g.food[1];
      const body = eats ? g.snake : g.snake.slice(0, -1);
      if (body.some(([x, y]) => x === head[0] && y === head[1])) {
        g.alive = false;
        setRecord(submitScore("snake", g.score));
        setState("over");
        draw();
        return;
      }
      g.snake = [head, ...body];
      if (eats) {
        g.score += 1;
        setScore(g.score);
        g.food = freeCell(g.snake);
        navigator.vibrate?.(15);
      }
      draw();
      // Faster as you grow.
      timer = window.setTimeout(tick, Math.max(55, 130 - g.score * 3));
    };
    timer = window.setTimeout(tick, 130);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <GameShell title="Snake" onExit={onExit} stats={[["Score", score], ["Best", Math.max(best, score)]]} onRestart={reset} hint="Arrow keys / WASD or swipe. Space pauses. Walls wrap around.">
      <div
        className={`relative ${BOARD} touch-none overflow-hidden rounded-2xl bg-black/5 ring-1 ring-black/5 dark:bg-zinc-800 dark:ring-white/10`}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          if (!touch.current) return;
          const d = swipeDir(e.changedTouches[0].clientX - touch.current.x, e.changedTouches[0].clientY - touch.current.y);
          touch.current = null;
          if (d) turn(d);
          else setState((s) => (s === "ready" || s === "paused" ? "playing" : s === "playing" ? "paused" : s));
        }}
      >
        <canvas ref={canvas} width={540} height={540} className="size-full" aria-label="Snake board" />
        {state !== "playing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45 text-white">
            <p className="text-2xl font-bold">{state === "over" ? (record ? "New record! 🎉" : "Game over") : state === "paused" ? "Paused" : "Snake"}</p>
            {state === "over" && <p>Score: {score}</p>}
            <button
              onClick={() => (state === "over" ? (reset(), setState("playing")) : setState("playing"))}
              className="rounded-full bg-white px-5 py-2 font-semibold text-zinc-900"
            >
              {state === "over" ? "Play again" : state === "paused" ? "Resume" : "Start"}
            </button>
          </div>
        )}
      </div>
      {/* On-screen arrows for phones that prefer buttons. */}
      <div className="mx-auto mt-3 grid w-40 grid-cols-3 gap-1.5 md:hidden">
        <span />
        <ArrowPad label="Up" onPress={() => turn("up")}>
          <ChevronUpIcon className="size-5" />
        </ArrowPad>
        <span />
        <ArrowPad label="Left" onPress={() => turn("left")}>
          <ChevronUpIcon className="size-5 -rotate-90" />
        </ArrowPad>
        <span />
        <ArrowPad label="Right" onPress={() => turn("right")}>
          <ChevronUpIcon className="size-5 rotate-90" />
        </ArrowPad>
        <span />
        <ArrowPad label="Down" onPress={() => turn("down")}>
          <ChevronDownIcon className="size-5" />
        </ArrowPad>
      </div>
    </GameShell>
  );
}

function ArrowPad({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <button onPointerDown={onPress} aria-label={label} className="flex h-11 items-center justify-center rounded-xl bg-black/5 active:bg-black/10 dark:bg-zinc-800 dark:active:bg-zinc-700">
      {children}
    </button>
  );
}
