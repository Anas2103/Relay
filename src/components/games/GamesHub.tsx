import { lazy, Suspense, useState, type ComponentType } from "react";
import { CHAT_GAMES } from "../../../shared/games";
import { useBest, type GameId } from "../../lib/scores";
import { Spinner } from "../ui";

type Game = { id: GameId; name: string; emoji: string; blurb: string; best: (v: number) => string; load: () => Promise<ComponentType<{ onExit: () => void }>> };

const mins = (v: number) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;

// Each game loads only when you open it.
const SECTIONS: [string, Game[]][] = [
  [
    "Puzzles & words",
    [
      {
        id: "wordguess",
        name: "Word Guess",
        emoji: "🟩",
        blurb: "Find the 5-letter word in 6 tries",
        best: (v) => `streak ${v}`,
        load: () => import("./WordGuess").then((m) => m.WordGuess),
      },
      { id: "sudoku", name: "Sudoku", emoji: "🔢", blurb: "Classic 9×9, three levels", best: mins, load: () => import("./Sudoku").then((m) => m.Sudoku) },
      {
        id: "2048",
        name: "2048",
        emoji: "🧮",
        blurb: "Slide and merge the tiles",
        best: (v) => `${v}`,
        load: () => import("./Game2048").then((m) => m.Game2048),
      },
      {
        id: "mines",
        name: "Minesweeper",
        emoji: "💣",
        blurb: "Clear the field without a boom",
        best: (v) => `${v}s`,
        load: () => import("./Minesweeper").then((m) => m.Minesweeper),
      },
      {
        id: "slide",
        name: "Sliding Puzzle",
        emoji: "🧩",
        blurb: "Put the tiles back in order",
        best: (v) => `${v} moves`,
        load: () => import("./SlidingPuzzle").then((m) => m.SlidingPuzzle),
      },
      {
        id: "hangman",
        name: "Hangman",
        emoji: "🔤",
        blurb: "Guess the word, letter by letter",
        best: (v) => `streak ${v}`,
        load: () => import("./Hangman").then((m) => m.Hangman),
      },
      {
        id: "memory",
        name: "Memory",
        emoji: "🃏",
        blurb: "Find all the pairs",
        best: (v) => `${v} moves`,
        load: () => import("./Memory").then((m) => m.Memory),
      },
    ],
  ],
  [
    "Arcade",
    [
      {
        id: "blocks",
        name: "Block Drop",
        emoji: "🟪",
        blurb: "Clear lines of falling blocks",
        best: (v) => `${v}`,
        load: () => import("./BlockDrop").then((m) => m.BlockDrop),
      },
      {
        id: "snake",
        name: "Snake",
        emoji: "🐍",
        blurb: "Eat, grow, don't bite yourself",
        best: (v) => `${v}`,
        load: () => import("./Snake").then((m) => m.Snake),
      },
      {
        id: "bricks",
        name: "Brick Breaker",
        emoji: "🧱",
        blurb: "Bounce the ball, break the wall",
        best: (v) => `${v}`,
        load: () => import("./BrickBreaker").then((m) => m.BrickBreaker),
      },
      {
        id: "skyhop",
        name: "Sky Hop",
        emoji: "🐤",
        blurb: "Tap to hop through the towers",
        best: (v) => `${v}`,
        load: () => import("./SkyHop").then((m) => m.SkyHop),
      },
    ],
  ],
  [
    "Brain & reflexes",
    [
      {
        id: "trivia",
        name: "Trivia",
        emoji: "🧠",
        blurb: "10 quick questions, any topic",
        best: (v) => `${v} pts`,
        load: () => import("./Trivia").then((m) => m.Trivia),
      },
      {
        id: "math",
        name: "Math Sprint",
        emoji: "➗",
        blurb: "Sums against the clock",
        best: (v) => `${v}`,
        load: () => import("./MathSprint").then((m) => m.MathSprint),
      },
      {
        id: "echo",
        name: "Color Echo",
        emoji: "🎨",
        blurb: "Repeat the growing pattern",
        best: (v) => `level ${v}`,
        load: () => import("./ColorEcho").then((m) => m.ColorEcho),
      },
      {
        id: "reaction",
        name: "Reaction time",
        emoji: "⚡",
        blurb: "How fast are your reflexes?",
        best: (v) => `${v} ms`,
        load: () => import("./Reaction").then((m) => m.Reaction),
      },
      {
        id: "typing",
        name: "Typing speed",
        emoji: "⌨️",
        blurb: "Words per minute in 30 s",
        best: (v) => `${v} wpm`,
        load: () => import("./Typing").then((m) => m.Typing),
      },
    ],
  ],
];

const ALL = SECTIONS.flatMap(([, g]) => g);
const LAZY = Object.fromEntries(ALL.map((g) => [g.id, lazy(() => g.load().then((c) => ({ default: c })))])) as unknown as Record<
  GameId,
  ComponentType<{ onExit: () => void }>
>;

/** The arcade: pick a game. Your best scores stay on this device. */
export function GamesHub() {
  const [open, setOpen] = useState<GameId | null>(null);
  const best = useBest();

  if (open) {
    const Game = LAZY[open];
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-6" />
          </div>
        }
      >
        <Game onExit={() => setOpen(null)} />
      </Suspense>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3 pb-6">
      {SECTIONS.map(([title, games]) => (
        <section key={title} className="mb-5">
          <h3 className="mb-2 px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{title}</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label={title}>
            {games.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => setOpen(g.id)}
                  className="flex h-full w-full items-start gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-zinc-200 transition hover:ring-accent active:scale-[0.98] dark:bg-zinc-800 dark:ring-zinc-700"
                  aria-label={`Play ${g.name}`}
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-black/5 text-2xl dark:bg-white/10">{g.emoji}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{g.name}</span>
                    <span className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{g.blurb}</span>
                    {best[g.id] !== undefined && <span className="mt-0.5 block text-xs font-semibold text-accent-fg">Best: {g.best(best[g.id]!)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="rounded-2xl bg-accent/10 p-4">
        <h3 className="text-sm font-semibold">Play with friends</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Open a chat, tap 📎 → <b>Game / Watch</b>: {CHAT_GAMES.map(([, name]) => name).join(", ")}.
        </p>
      </section>
    </div>
  );
}
