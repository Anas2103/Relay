import { useState, type FormEvent, type ReactNode } from "react";
import {
  CODE_COLORS,
  CODE_LENGTH,
  CODE_TRIES,
  PAIRS_MISSES,
  reversiFlips,
  WORDTEAM_TRIES,
  whoseTurn,
  type CodeGame,
  type GameMove,
  type MancalaGame,
  type PairsGame,
  type ReversiGame,
  type WordTeamGame,
} from "../../shared/games";
import { useGameName } from "./gameNames";

/*
 * Chat games added later: three team games (the whole chat plays together
 * against the puzzle) and two head-to-head board games.
 */

type Move = (m: GameMove) => void;

const useName = useGameName;

/** Who's helping, for team games. */
function Team({ players }: { players: string[] }) {
  const name = useName();
  return <p className="mt-2 truncate text-center text-xs opacity-70">Team: {players.map((p) => name(p)).join(", ")}</p>;
}

function TeamResult({ won, children }: { won: boolean; children?: ReactNode }) {
  return (
    <p className={`mb-2 rounded-lg px-2 py-1.5 text-center text-sm font-semibold ${won ? "bg-emerald-500/20" : "bg-red-500/15"}`} role="status">
      {won ? "Solved together! 🎉" : "Out of tries"} {children}
    </p>
  );
}

// ---------- Word Team ----------

const MARK_BG: Record<string, string> = { g: "bg-emerald-500 text-white", y: "bg-amber-400 text-amber-950", ".": "bg-zinc-500/60 text-white" };

export function WordTeam({ game, onMove }: { game: WordTeamGame; onMove: Move }) {
  const name = useName();
  const [guess, setGuess] = useState("");
  const left = WORDTEAM_TRIES - game.guesses.length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^[a-z]{5}$/i.test(guess)) {
      onMove({ guess: guess.toLowerCase() });
      setGuess("");
    }
  };
  // Letters tried that are not in the word at all.
  const found = new Set(game.guesses.flatMap((g) => [...g.word].filter((_, i) => g.marks[i] !== ".")));
  const out = [...new Set(game.guesses.flatMap((g) => [...g.word]))].filter((c) => !found.has(c)).sort();
  return (
    <>
      {game.winner ? (
        <TeamResult won={game.winner === "team"}>
          <span className="uppercase">· {game.word}</span>
        </TeamResult>
      ) : (
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold">Guess the word together</span>
          <span className="text-xs opacity-70">{left} left</span>
        </div>
      )}
      <div className="grid gap-1" aria-label="Guesses">
        {Array.from({ length: WORDTEAM_TRIES }, (_, row) => {
          const g = game.guesses[row];
          return (
            <div key={row} className="flex items-center gap-1">
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className={`flex aspect-square flex-1 items-center justify-center rounded-md text-base font-bold uppercase ${g ? MARK_BG[g.marks[i]] : "bg-black/10 dark:bg-white/10"}`}
                >
                  {g?.word[i]}
                </span>
              ))}
              <span className="w-12 truncate text-[10px] opacity-60">{g ? name(g.by) : ""}</span>
            </div>
          );
        })}
      </div>
      {!game.winner && (
        <form onSubmit={submit} className="mt-2 flex gap-1.5">
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value.replace(/[^a-z]/gi, "").slice(0, 5))}
            placeholder="5-letter word"
            aria-label="Your guess"
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg bg-black/10 px-2.5 text-sm tracking-widest uppercase outline-none placeholder:tracking-normal placeholder:normal-case placeholder:text-current/50 dark:bg-white/10"
          />
          <button disabled={guess.length !== 5} className="rounded-lg bg-black/15 px-3 text-sm font-semibold disabled:opacity-40 dark:bg-white/15">
            Guess
          </button>
        </form>
      )}
      {!game.winner && out.length > 0 && (
        <p className="mt-1.5 text-center text-[11px] opacity-70">
          Not in it: <span className="tracking-wider uppercase">{out.join(" ")}</span>
        </p>
      )}
      <Team players={game.players} />
    </>
  );
}

// ---------- Crack the Code ----------

const PEGS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];
const PEG_NAMES = ["red", "blue", "green", "yellow", "purple", "orange"];

function Peg({ color, size = "size-6" }: { color: number | null; size?: string }) {
  return (
    <span
      className={`${size} inline-block rounded-full ${color === null ? "bg-black/15 dark:bg-white/15" : "ring-1 ring-black/20"}`}
      style={color !== null ? { background: PEGS[color] } : undefined}
    />
  );
}

export function CrackTheCode({ game, onMove }: { game: CodeGame; onMove: Move }) {
  const name = useName();
  const [draft, setDraft] = useState<number[]>([]);
  const left = CODE_TRIES - game.guesses.length;
  return (
    <>
      {game.winner ? (
        <TeamResult won={game.winner === "team"}>
          <span className="ml-1 inline-flex gap-0.5 align-middle">
            {game.code.map((c, i) => (
              <Peg key={i} color={c} size="size-3.5" />
            ))}
          </span>
        </TeamResult>
      ) : (
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold">Find the 4 hidden colors</span>
          <span className="text-xs opacity-70">{left} tries left</span>
        </div>
      )}
      <ol className="max-h-56 space-y-1 overflow-y-auto" aria-label="Guesses">
        {game.guesses.map((g, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-black/5 px-2 py-1 dark:bg-white/5">
            <span className="flex gap-1">
              {g.code.map((c, j) => (
                <Peg key={j} color={c} size="size-5" />
              ))}
            </span>
            <span className="flex flex-1 gap-0.5" aria-label={`${g.exact} right place, ${g.near} wrong place`} title={`${g.exact} right place, ${g.near} wrong place`}>
              {Array.from({ length: g.exact }, (_, k) => (
                <span key={`e${k}`} className="size-2.5 rounded-full bg-current" />
              ))}
              {Array.from({ length: g.near }, (_, k) => (
                <span key={`n${k}`} className="size-2.5 rounded-full ring-2 ring-current ring-inset" />
              ))}
            </span>
            <span className="max-w-16 truncate text-[10px] opacity-60">{name(g.by)}</span>
          </li>
        ))}
      </ol>
      {!game.winner && (
        <>
          <div className="mt-2 flex items-center justify-center gap-1.5" aria-label="Your guess">
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <button key={i} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} aria-label={draft[i] !== undefined ? `Remove ${PEG_NAMES[draft[i]]}` : "Empty"}>
                <Peg color={draft[i] ?? null} size="size-7" />
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-center gap-1.5">
            {Array.from({ length: CODE_COLORS }, (_, c) => (
              <button
                key={c}
                onClick={() => setDraft((d) => (d.length < CODE_LENGTH ? [...d, c] : d))}
                aria-label={`Add ${PEG_NAMES[c]}`}
                className="rounded-full transition active:scale-90"
              >
                <Peg color={c} size="size-8" />
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              onMove({ code: draft });
              setDraft([]);
            }}
            disabled={draft.length !== CODE_LENGTH}
            className="mt-2 w-full rounded-lg bg-black/15 py-1.5 text-sm font-semibold disabled:opacity-40 dark:bg-white/15"
          >
            Try this code
          </button>
          <p className="mt-1 text-center text-[11px] opacity-70">● right color, right place · ○ right color, wrong place</p>
        </>
      )}
      <Team players={game.players} />
    </>
  );
}

// ---------- Pair Up ----------

const FACES = ["🍕", "🚀", "🐙", "🎸", "🌵", "🦊", "🍩", "⚽"];

export function PairUp({ game, onMove }: { game: PairsGame; onMove: Move }) {
  const name = useName();
  const pairs = game.matched.filter(Boolean).length / 2;
  const scores: Record<string, number> = {};
  for (const by of Object.values(game.foundBy)) scores[by] = (scores[by] ?? 0) + 1;
  return (
    <>
      {game.winner ? (
        <TeamResult won={game.winner === "team"}>· {game.misses} misses</TeamResult>
      ) : (
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold">Find all {game.deck.length / 2} pairs</span>
          <span className="text-xs opacity-70">
            {pairs} found · {PAIRS_MISSES - game.misses} misses left
          </span>
        </div>
      )}
      <div className="grid grid-cols-4 gap-1.5" aria-label="Cards">
        {game.deck.map((face, i) => {
          const up = face !== -1;
          const done = game.matched[i];
          return (
            <button
              key={i}
              onClick={() => onMove({ flip: i })}
              disabled={!!game.winner || done || (game.open.includes(i) && game.open.length < 2)}
              aria-label={up ? `Card ${i + 1}: ${face}` : `Card ${i + 1}, face down`}
              className={`flex aspect-square items-center justify-center rounded-xl text-2xl transition ${
                done ? "bg-emerald-500/25 opacity-70" : up ? "bg-white/80 shadow-sm dark:bg-white/20" : "bg-black/15 hover:bg-black/25 dark:bg-white/10 dark:hover:bg-white/20"
              }`}
            >
              {up ? FACES[face] : ""}
            </button>
          );
        })}
      </div>
      {Object.keys(scores).length > 0 && (
        <p className="mt-2 truncate text-center text-xs opacity-80">
          {Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .map(([id, n]) => `${name(id)} ${n}`)
            .join(" · ")}
        </p>
      )}
      <Team players={game.players} />
    </>
  );
}

// ---------- Head to head ----------

function Header({ game, meId, marks }: { game: ReversiGame | MancalaGame; meId: string; marks?: [string, string] }) {
  const name = useName();
  const turn = whoseTurn(game);
  const mark = (i: number) => (marks ? ` (${marks[i]})` : "");
  let text: string;
  if (game.winner === "draw") text = "It's a draw 🤝";
  else if (game.winner) text = game.winner === meId ? "You won! 🎉" : `${name(game.winner)} won 🏆`;
  else if (game.players.length < 2)
    text = game.players[0] === meId ? (game.turn === 0 ? `Your move${mark(0)}` : "Waiting for someone to join…") : "Make a move to join";
  else text = turn === meId ? `Your turn${mark(game.players.indexOf(meId))}` : `${name(turn)}'s turn`;
  return <p className="mb-2 text-sm font-semibold">{text}</p>;
}

function canMove(game: ReversiGame | MancalaGame, meId: string) {
  if (game.winner) return false;
  if (game.players.length < 2) return game.players[0] === meId ? game.turn === 0 : game.turn === 1;
  return game.players[game.turn] === meId;
}

/** My side (0 or 1) in a two-player game, guessing 1 for someone who hasn't joined yet. */
function mySide(game: ReversiGame | MancalaGame, meId: string) {
  const i = game.players.indexOf(meId);
  return i === -1 ? 1 : i;
}

export function Reversi({ game, meId, onMove }: { game: ReversiGame; meId: string; onMove: Move }) {
  const name = useName();
  const can = canMove(game, meId);
  const side = mySide(game, meId);
  const count = (s: number) => game.board.filter((v) => v === s).length;
  return (
    <>
      <Header game={game} meId={meId} marks={["⚫", "⚪"]} />
      {game.passed && !game.winner && <p className="-mt-1 mb-1.5 text-xs opacity-80">No move for the other side, so it's the same player again.</p>}
      <div className="grid grid-cols-8 gap-0.5 rounded-lg bg-emerald-700 p-1" aria-label="Reversi board">
        {game.board.map((v, i) => {
          const legal = can && v === -1 && reversiFlips(game.board, side, i).length > 0;
          return (
            <button
              key={i}
              onClick={() => onMove({ cell: i })}
              disabled={!legal}
              aria-label={v === -1 ? `Square ${i + 1}${legal ? ", you can play here" : ""}` : `Square ${i + 1}, ${v === 0 ? "dark" : "light"}`}
              className="flex aspect-square items-center justify-center rounded-sm bg-emerald-600"
            >
              {v !== -1 ? (
                <span className={`size-[80%] rounded-full shadow ${v === 0 ? "bg-zinc-900" : "bg-zinc-50"} ${game.last === i ? "ring-2 ring-amber-300" : ""}`} />
              ) : legal ? (
                <span className="size-2 rounded-full bg-black/25" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-center text-sm font-semibold tabular-nums">
        ⚫ {name(game.players[0])} {count(0)} – {count(1)} {game.players[1] ? name(game.players[1]) : "?"} ⚪
      </p>
    </>
  );
}

export function Mancala({ game, meId, onMove }: { game: MancalaGame; meId: string; onMove: Move }) {
  const name = useName();
  const can = canMove(game, meId);
  const side = mySide(game, meId);
  // You always see your own row at the bottom, playing left to right.
  const theirs = 1 - side;
  const pit = (i: number, mine: boolean) => {
    const n = game.pits[i];
    const playable = mine && can && n > 0;
    return (
      <button
        key={i}
        onClick={() => onMove({ pit: i % 7 })}
        disabled={!playable}
        aria-label={`${mine ? "Your" : "Their"} pit with ${n} seeds`}
        className={`flex aspect-square flex-col items-center justify-center rounded-full text-sm font-bold tabular-nums ${
          game.last === i ? "ring-2 ring-amber-300" : ""
        } ${playable ? "bg-amber-900/40 hover:bg-amber-900/60" : "bg-amber-900/25"}`}
      >
        {n}
      </button>
    );
  };
  const row = (s: number, mine: boolean) => {
    const idx = Array.from({ length: 6 }, (_, k) => s * 7 + k);
    return (mine ? idx : idx.reverse()).map((i) => pit(i, mine));
  };
  return (
    <>
      <Header game={game} meId={meId} />
      <div className="flex items-stretch gap-1.5 rounded-2xl bg-amber-700/70 p-2 text-amber-50">
        <div className="flex w-9 flex-col items-center justify-center rounded-full bg-amber-900/40 text-base font-bold tabular-nums" aria-label={`Their store: ${game.pits[theirs * 7 + 6]}`}>
          {game.pits[theirs * 7 + 6]}
        </div>
        <div className="grid flex-1 grid-cols-6 gap-1">
          {row(theirs, false)}
          {row(side, true)}
        </div>
        <div className="flex w-9 flex-col items-center justify-center rounded-full bg-amber-900/40 text-base font-bold tabular-nums" aria-label={`Your store: ${game.pits[side * 7 + 6]}`}>
          {game.pits[side * 7 + 6]}
        </div>
      </div>
      <p className="mt-1.5 text-center text-xs opacity-80">
        {game.players[theirs] ? `${name(game.players[theirs])} on top · ` : ""}Seeds move right, then around. Land in your store to go again.
      </p>
    </>
  );
}
