import { useEffect, useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell, Overlay } from "./GameShell";

const CW = 480;
const CH = 640;
const ROWS = 6;
const COLS = 8;
const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

interface Brick {
  x: number;
  y: number;
  hp: number;
  color: string;
}

function level(n: number): Brick[] {
  const bw = CW / COLS;
  const out: Brick[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      // Later levels: tougher bricks, and some gaps for variety.
      if (n > 1 && (r + c + n) % 7 === 0) continue;
      out.push({ x: c * bw, y: 60 + r * 26, hp: n > 2 && r < 2 ? 2 : 1, color: COLORS[r] });
    }
  return out;
}

/** Bounce the ball, break every brick. Move with the mouse, a finger or ← →. */
export function BrickBreaker({ onExit }: { onExit: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"ready" | "playing" | "over" | "won">("ready");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [lvl, setLvl] = useState(1);
  const [record, setRecord] = useState(false);
  const best = useBest().bricks ?? 0;
  const g = useRef({ px: CW / 2, bx: CW / 2, by: CH - 60, vx: 3.2, vy: -4.6, bricks: level(1), score: 0, lives: 3, level: 1, keys: { l: false, r: false }, stuck: true });

  const reset = () => {
    g.current = { px: CW / 2, bx: CW / 2, by: CH - 60, vx: 3.2, vy: -4.6, bricks: level(1), score: 0, lives: 3, level: 1, keys: { l: false, r: false }, stuck: true };
    setScore(0);
    setLives(3);
    setLvl(1);
    setRecord(false);
    setState("playing");
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") g.current.keys.l = true;
      if (e.key === "ArrowRight") g.current.keys.r = true;
      if (e.key === " ") {
        e.preventDefault();
        g.current.stuck = false;
        setState((s) => (s === "ready" ? "playing" : s));
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") g.current.keys.l = false;
      if (e.key === "ArrowRight") g.current.keys.r = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const PW = 90;
    let raf = 0;
    const frame = () => {
      const s = g.current;
      if (state === "playing") {
        if (s.keys.l) s.px -= 8;
        if (s.keys.r) s.px += 8;
        s.px = Math.max(PW / 2, Math.min(CW - PW / 2, s.px));
        if (s.stuck) {
          s.bx = s.px;
          s.by = CH - 48;
        } else {
          s.bx += s.vx;
          s.by += s.vy;
          if (s.bx < 8 || s.bx > CW - 8) s.vx *= -1;
          if (s.by < 8) s.vy = Math.abs(s.vy);
          // Paddle: where it hits decides the angle.
          if (s.vy > 0 && s.by > CH - 44 && s.by < CH - 28 && Math.abs(s.bx - s.px) < PW / 2 + 6) {
            const speed = Math.hypot(s.vx, s.vy);
            const angle = ((s.bx - s.px) / (PW / 2)) * 1.05;
            s.vx = speed * Math.sin(angle);
            s.vy = -Math.abs(speed * Math.cos(angle));
          }
          const bw = CW / COLS;
          for (const b of s.bricks) {
            if (b.hp > 0 && s.bx > b.x && s.bx < b.x + bw && s.by > b.y && s.by < b.y + 22) {
              b.hp--;
              s.vy *= -1;
              if (b.hp === 0) {
                s.score += 10 * s.level;
                setScore(s.score);
              }
              break;
            }
          }
          if (s.by > CH + 10) {
            s.lives--;
            setLives(s.lives);
            s.stuck = true;
            if (s.lives <= 0) {
              setRecord(submitScore("bricks", s.score));
              setState("over");
            }
          }
          if (s.bricks.every((b) => b.hp === 0)) {
            s.level++;
            setLvl(s.level);
            s.bricks = level(s.level);
            s.stuck = true;
            const speed = Math.min(9, Math.hypot(s.vx, s.vy) + 0.6);
            s.vx = speed * 0.55;
            s.vy = -speed * 0.83;
          }
        }
      }
      // Draw.
      ctx.clearRect(0, 0, CW, CH);
      const bw = CW / COLS;
      for (const b of s.bricks) {
        if (b.hp <= 0) continue;
        ctx.fillStyle = b.color;
        ctx.globalAlpha = b.hp > 1 ? 1 : 0.85;
        ctx.beginPath();
        ctx.roundRect(b.x + 2, b.y, bw - 4, 22, 5);
        ctx.fill();
        if (b.hp > 1) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#e4e4e7";
      ctx.beginPath();
      ctx.roundRect(s.px - PW / 2, CH - 36, PW, 12, 6);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.bx, s.by, 8, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const follow = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    g.current.px = ((clientX - r.left) / r.width) * CW;
  };

  return (
    <GameShell title="Brick Breaker" onExit={onExit} stats={[["Score", score], ["Lives", "❤️".repeat(Math.max(0, lives)) || "0"], ["Level", lvl], ["Best", Math.max(best, score)]]} onRestart={reset} hint="Move with the mouse or your finger (or ← →). Tap or Space to launch.">
      <div className="relative mx-auto aspect-[3/4] h-auto w-full max-w-[min(100%,calc((100dvh-15rem)*0.75))] touch-none overflow-hidden rounded-2xl bg-zinc-900">
        <canvas
          ref={canvas}
          width={CW}
          height={CH}
          className="size-full"
          aria-label="Brick Breaker"
          onPointerMove={(e) => follow(e.clientX)}
          onPointerDown={(e) => {
            follow(e.clientX);
            g.current.stuck = false;
          }}
        />
        {state !== "playing" && (
          <Overlay
            title={state === "over" ? (record ? "New record! 🎉" : "Game over") : "Brick Breaker"}
            detail={state === "over" ? `${score} points · level ${lvl}` : "Break every brick. Don't let the ball fall."}
            action={state === "over" ? "Play again" : "Start"}
            onAction={reset}
          />
        )}
      </div>
    </GameShell>
  );
}
