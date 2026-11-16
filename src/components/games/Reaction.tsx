import { useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { BOARD, GameShell } from "./GameShell";

/** Wait for green, then tap as fast as you can. Best of 5 rounds is your score. */
export function Reaction({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "go" | "early" | "result">("idle");
  const [times, setTimes] = useState<number[]>([]);
  const [last, setLast] = useState(0);
  const [record, setRecord] = useState(false);
  const best = useBest().reaction;
  const goAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const start = () => {
    setPhase("waiting");
    timer.current = window.setTimeout(() => {
      goAt.current = performance.now();
      setPhase("go");
    }, 1200 + Math.random() * 2800);
  };

  const tap = () => {
    if (phase === "idle" || phase === "early" || phase === "result") {
      if (times.length >= 5) {
        setTimes([]);
        setRecord(false);
      }
      return start();
    }
    if (phase === "waiting") {
      window.clearTimeout(timer.current);
      return setPhase("early");
    }
    const ms = Math.round(performance.now() - goAt.current);
    const all = [...times, ms];
    setLast(ms);
    setTimes(all);
    setPhase("result");
    if (all.length === 5) setRecord(submitScore("reaction", Math.round(all.reduce((a, b) => a + b) / 5)));
  };

  const avg = times.length ? Math.round(times.reduce((a, b) => a + b) / times.length) : 0;
  const color = phase === "waiting" ? "bg-red-500" : phase === "go" ? "bg-emerald-500" : phase === "early" ? "bg-amber-500" : "bg-accent";

  return (
    <GameShell title="Reaction time" onExit={onExit} stats={[["Round", `${Math.min(times.length + (phase === "waiting" || phase === "go" ? 1 : 0), 5)}/5`], ["Best avg", best ? `${best} ms` : "—"]]}>
      <button onPointerDown={tap} className={`${BOARD} flex flex-col items-center justify-center gap-2 rounded-3xl text-white transition-colors select-none ${color}`}>
        <span className="text-3xl font-bold">
          {phase === "idle" && "Tap to start"}
          {phase === "waiting" && "Wait for green…"}
          {phase === "go" && "TAP!"}
          {phase === "early" && "Too soon! 😅"}
          {phase === "result" && `${last} ms`}
        </span>
        <span className="text-sm opacity-90">
          {phase === "result" && (times.length < 5 ? "Tap for the next round" : `Average ${avg} ms${record ? " — new record! 🎉" : ""} · tap to go again`)}
          {phase === "early" && "Tap to try that round again"}
        </span>
      </button>
      {times.length > 0 && <p className="mt-3 text-center text-sm text-zinc-500 tabular-nums">{times.map((t) => `${t} ms`).join(" · ")}</p>}
    </GameShell>
  );
}
