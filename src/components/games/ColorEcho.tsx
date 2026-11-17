import { useEffect, useRef, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { BOARD, GameShell, Overlay } from "./GameShell";

const PADS = [
  { color: "bg-emerald-500", lit: "bg-emerald-300", freq: 392 },
  { color: "bg-red-500", lit: "bg-red-300", freq: 330 },
  { color: "bg-amber-400", lit: "bg-amber-200", freq: 262 },
  { color: "bg-blue-500", lit: "bg-blue-300", freq: 196 },
];

let ctx: AudioContext | null = null;
function tone(freq: number, ms: number) {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + ms / 1000 + 0.05);
  } catch {
    // no sound available
  }
}

/** Watch the pattern, repeat it. One more step every round. */
export function ColorEcho({ onExit }: { onExit: () => void }) {
  const [seq, setSeq] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [lit, setLit] = useState<number | null>(null);
  const [phase, setPhase] = useState<"ready" | "showing" | "input" | "over">("ready");
  const [record, setRecord] = useState(false);
  const [sound, setSound] = useState(true);
  const best = useBest().echo ?? 0;
  const timers = useRef<number[]>([]);
  const level = Math.max(0, seq.length - (phase === "over" ? 1 : 0));

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const flash = (i: number, ms: number) => {
    setLit(i);
    if (sound) tone(PADS[i].freq, ms);
    timers.current.push(window.setTimeout(() => setLit(null), ms));
  };

  const show = (s: number[]) => {
    setPhase("showing");
    const speed = Math.max(260, 620 - s.length * 25);
    s.forEach((p, k) => timers.current.push(window.setTimeout(() => flash(p, speed * 0.75), 500 + k * speed)));
    timers.current.push(
      window.setTimeout(
        () => {
          setPhase("input");
          setStep(0);
        },
        500 + s.length * speed,
      ),
    );
  };

  const start = () => {
    const s = [Math.floor(Math.random() * 4)];
    setSeq(s);
    setRecord(false);
    show(s);
  };

  const press = (i: number) => {
    if (phase !== "input") return;
    flash(i, 220);
    if (seq[step] !== i) {
      setPhase("over");
      setRecord(submitScore("echo", seq.length - 1));
      navigator.vibrate?.(150);
      return;
    }
    if (step + 1 === seq.length) {
      const s = [...seq, Math.floor(Math.random() * 4)];
      setSeq(s);
      timers.current.push(window.setTimeout(() => show(s), 500));
      setPhase("showing");
    } else setStep(step + 1);
  };

  return (
    <GameShell
      title="Color Echo"
      onExit={onExit}
      stats={[
        ["Level", level],
        ["Best", best],
      ]}
      hint="Watch the colours light up, then tap them in the same order."
    >
      <div className="mb-2 text-center text-sm font-semibold">
        {phase === "showing" ? "Watch…" : phase === "input" ? `Your turn (${step}/${seq.length})` : " "}
      </div>
      <div className={`relative ${BOARD} grid grid-cols-2 gap-3 rounded-full bg-zinc-900 p-3`}>
        {PADS.map((p, i) => (
          <button
            key={i}
            onPointerDown={() => press(i)}
            disabled={phase !== "input"}
            aria-label={["Green", "Red", "Yellow", "Blue"][i]}
            className={`transition-all duration-100 ${lit === i ? `${p.lit} scale-[0.97] brightness-125` : p.color} ${
              ["rounded-tl-full", "rounded-tr-full", "rounded-bl-full", "rounded-br-full"][i]
            } ${phase === "input" ? "cursor-pointer" : ""}`}
          />
        ))}
        {(phase === "ready" || phase === "over") && (
          <Overlay
            title={phase === "over" ? (record ? "New record! 🎉" : "Oops!") : "Color Echo"}
            detail={phase === "over" ? `You reached level ${level}` : undefined}
            action={phase === "over" ? "Play again" : "Start"}
            onAction={start}
          />
        )}
      </div>
      <label className="mt-3 flex items-center justify-center gap-2 text-sm text-zinc-500">
        <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="accent-[var(--accent)]" /> Sounds
      </label>
    </GameShell>
  );
}
