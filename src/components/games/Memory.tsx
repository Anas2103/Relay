import { useEffect, useState } from "react";
import { submitScore, useBest } from "../../lib/scores";
import { BOARD, GameShell } from "./GameShell";

const EMOJI = ["🐶", "🦊", "🐼", "🐸", "🦁", "🐙", "🦄", "🐝", "🍕", "🍩", "🌵", "🚀", "⚽", "🎸", "🌈", "💎"];

function deal(pairs: number): string[] {
  const picked = [...EMOJI].sort(() => Math.random() - 0.5).slice(0, pairs);
  return [...picked, ...picked].sort(() => Math.random() - 0.5);
}

/** Flip two cards, find the pairs. Fewest moves wins. */
export function Memory({ onExit }: { onExit: () => void }) {
  const [cards, setCards] = useState(() => deal(8));
  const [open, setOpen] = useState<number[]>([]);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState(0);
  const [record, setRecord] = useState(false);
  const best = useBest().memory;
  const done = found.size === cards.length / 2;

  useEffect(() => {
    if (open.length !== 2) return;
    const [a, b] = open;
    if (cards[a] === cards[b]) {
      const next = new Set(found).add(cards[a]);
      setFound(next);
      setOpen([]);
      if (next.size === cards.length / 2) setRecord(submitScore("memory", moves));
      return;
    }
    const t = window.setTimeout(() => setOpen([]), 750);
    return () => window.clearTimeout(t);
  }, [open, cards, found, moves]);

  const flip = (i: number) => {
    if (open.length === 2 || open.includes(i) || found.has(cards[i])) return;
    if (open.length === 1) setMoves((m) => m + 1);
    setOpen([...open, i]);
  };

  const reset = () => {
    setCards(deal(8));
    setOpen([]);
    setFound(new Set());
    setMoves(0);
    setRecord(false);
  };

  return (
    <GameShell
      title="Memory"
      onExit={onExit}
      stats={[
        ["Moves", moves],
        ["Best", best ?? "—"],
      ]}
      onRestart={reset}
      hint="Find all 8 pairs in as few moves as you can."
    >
      <div className={`relative ${BOARD} grid grid-cols-4 gap-2`}>
        {cards.map((c, i) => {
          const shown = open.includes(i) || found.has(c);
          return (
            <button
              key={i}
              onClick={() => flip(i)}
              aria-label={shown ? c : "Hidden card"}
              className={`flex aspect-square items-center justify-center rounded-2xl text-4xl transition-all duration-300 ${
                shown
                  ? found.has(c)
                    ? "bg-emerald-100 ring-2 ring-emerald-400 dark:bg-emerald-900/40"
                    : "bg-white shadow ring-2 ring-accent dark:bg-zinc-700"
                  : "bg-gradient-to-br from-accent to-accent/70 text-accent-ink shadow-sm hover:brightness-110"
              }`}
              style={{ transform: shown ? "rotateY(0deg)" : "rotateY(180deg)" }}
            >
              {shown ? c : <span className="text-2xl opacity-60">✦</span>}
            </button>
          );
        })}
        {done && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/55 text-white">
            <p className="text-2xl font-bold">{record ? "New record! 🎉" : "All found! 🧠"}</p>
            <p>{moves} moves</p>
            <button onClick={reset} className="rounded-full bg-white px-5 py-2 font-semibold text-zinc-900">
              Play again
            </button>
          </div>
        )}
      </div>
    </GameShell>
  );
}
