import { useEffect, useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { GameShell, Overlay } from "./GameShell";

const CW = 400;
const CH = 600;
const GAP = 170;
const PIPE_W = 64;

/** Tap to hop through the gaps between the towers. One point per tower. */
export function SkyHop({ onExit }: { onExit: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"ready" | "playing" | "over">("ready");
  const [score, setScore] = useState(0);
  const [record, setRecord] = useState(false);
  const best = useBest().skyhop ?? 0;
  const g = useRef({ y: CH / 2, vy: 0, pipes: [] as { x: number; gap: number; passed: boolean }[], score: 0, t: 0 });

  const start = () => {
    g.current = { y: CH / 2, vy: -7.4, pipes: [], score: 0, t: 0 };
    setScore(0);
    setRecord(false);
    setState("playing");
  };
  const hop = () => {
    if (state === "playing") g.current.vy = -7.4;
    else start();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w") {
        e.preventDefault();
        hop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6366f1";
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      // Same speed on 60 Hz and 120 Hz screens.
      const dt = Math.min(2, (now - last) / 16.67);
      last = now;
      const s = g.current;
      if (state === "playing") {
        s.t += dt;
        s.vy += 0.42 * dt;
        s.y += s.vy * dt;
        const speed = 2.6 + Math.min(2, s.score * 0.05);
        if (!s.pipes.length || s.pipes[s.pipes.length - 1].x < CW - 230) {
          s.pipes.push({ x: CW + 20, gap: 90 + Math.random() * (CH - 260), passed: false });
        }
        for (const p of s.pipes) {
          p.x -= speed * dt;
          if (!p.passed && p.x + PIPE_W < 90) {
            p.passed = true;
            s.score++;
            setScore(s.score);
          }
        }
        s.pipes = s.pipes.filter((p) => p.x > -PIPE_W);
        const hit = s.y > CH - 30 || s.y < 0 || s.pipes.some((p) => 90 + 16 > p.x && 90 - 16 < p.x + PIPE_W && (s.y - 14 < p.gap || s.y + 14 > p.gap + GAP));
        if (hit) {
          setRecord(submitScore("skyhop", s.score));
          setState("over");
          navigator.vibrate?.(120);
        }
      }
      // Sky.
      const sky = ctx.createLinearGradient(0, 0, 0, CH);
      sky.addColorStop(0, "#38bdf8");
      sky.addColorStop(1, "#bae6fd");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, CW, CH);
      // Towers.
      for (const p of s.pipes) {
        ctx.fillStyle = "#16a34a";
        ctx.beginPath();
        ctx.roundRect(p.x, -10, PIPE_W, p.gap + 10, 10);
        ctx.roundRect(p.x, p.gap + GAP, PIPE_W, CH, 10);
        ctx.fill();
      }
      // Ground.
      ctx.fillStyle = "#a16207";
      ctx.fillRect(0, CH - 24, CW, 24);
      // The hopper.
      ctx.save();
      ctx.translate(90, s.y);
      ctx.rotate(Math.max(-0.5, Math.min(1.1, s.vy * 0.07)));
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(6, -5, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(7.5, -5, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Score.
      if (state === "playing") {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 44px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(String(s.score), CW / 2, 70);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  return (
    <GameShell
      title="Sky Hop"
      onExit={onExit}
      stats={[
        ["Score", score],
        ["Best", Math.max(best, score)],
      ]}
      hint="Tap, click or press Space to hop."
    >
      <div
        className="relative mx-auto aspect-[2/3] w-full max-w-[min(100%,calc((100dvh-15rem)*0.667))] touch-none overflow-hidden rounded-2xl select-none"
        onPointerDown={() => state === "playing" && hop()}
      >
        <canvas ref={canvas} width={CW} height={CH} className="size-full" aria-label="Sky Hop" />
        {state !== "playing" && (
          <Overlay
            title={state === "over" ? (record ? "New record! 🎉" : "Ouch!") : "Sky Hop"}
            detail={state === "over" ? `${score} towers` : "Tap to hop through the gaps"}
            action={state === "over" ? "Play again" : "Start"}
            onAction={start}
          />
        )}
      </div>
    </GameShell>
  );
}
