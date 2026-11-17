import { useEffect, useRef, useState } from "react";
import { useGameName } from "./gameNames";
import { CrackTheCode, Mancala, PairUp, Reversi, WordTeam } from "./TeamGames";
import {
  checkersMoves,
  isTeamGame,
  cleanWord,
  DOTS,
  GOMOKU,
  HANGMAN_LIVES,
  RPS,
  RPS_EMOJI,
  watchPosition,
  whoseTurn,
  youtubeId,
  type C4Game,
  type ChatGame,
  type CheckersGame,
  type DotsGame,
  type GomokuGame,
  type HangmanGame,
  type ChatGameType,
  type GameMove,
  type RpsGame,
  type TttGame,
  type WatchGame,
} from "../../shared/games";
import { embedUrl, useYouTube } from "../lib/youtube";
import { MaximizeIcon, PauseIcon, PlayIcon, Spinner, VolumeIcon, VolumeOffIcon } from "./ui";

const useName = useGameName;

/** A game (or watch-together) inside a chat message. */
export function GameCard({
  game,
  meId,
  onMove,
  onRematch,
}: {
  game: ChatGame | undefined;
  meId: string;
  onMove: (move: GameMove) => void;
  onRematch: (type: ChatGameType, word?: string) => void;
}) {
  if (!game) {
    return (
      <div className="flex w-64 items-center gap-2 p-3 text-sm">
        <Spinner className="size-4" /> Setting up…
      </div>
    );
  }
  if (game.type === "watch") return <WatchCard game={game} meId={meId} onMove={onMove} />;
  return (
    <div className="w-72 max-w-full p-2.5 select-none">
      {game.type === "ttt" ? (
        <Ttt game={game} meId={meId} onMove={onMove} />
      ) : game.type === "c4" ? (
        <ConnectFour game={game} meId={meId} onMove={onMove} />
      ) : game.type === "gomoku" ? (
        <Gomoku game={game} meId={meId} onMove={onMove} />
      ) : game.type === "checkers" ? (
        <Checkers game={game} meId={meId} onMove={onMove} />
      ) : game.type === "dots" ? (
        <Dots game={game} meId={meId} onMove={onMove} />
      ) : game.type === "hangman" ? (
        <HangmanDuel game={game} meId={meId} onMove={onMove} />
      ) : game.type === "reversi" ? (
        <Reversi game={game} meId={meId} onMove={onMove} />
      ) : game.type === "mancala" ? (
        <Mancala game={game} meId={meId} onMove={onMove} />
      ) : game.type === "wordteam" ? (
        <WordTeam game={game} onMove={onMove} />
      ) : game.type === "code" ? (
        <CrackTheCode game={game} onMove={onMove} />
      ) : game.type === "pairs" ? (
        <PairUp game={game} onMove={onMove} />
      ) : (
        <Rps game={game} meId={meId} onMove={onMove} />
      )}
      {game.winner &&
        (game.type === "hangman" ? (
          <WordRematch onStart={(w) => onRematch("hangman", w)} />
        ) : (
          <button
            onClick={() => onRematch(game.type)}
            className="mt-2 w-full rounded-xl bg-black/10 py-2 text-sm font-semibold hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
          >
            🔁 {isTeamGame(game) ? "Play again" : "Rematch"}
          </button>
        ))}
    </div>
  );
}

type TurnGame = TttGame | C4Game | GomokuGame | CheckersGame | DotsGame;

/** Can I make a move right now? (The server checks too.) */
function myTurn(game: TurnGame, meId: string): boolean {
  if (game.winner) return false;
  if (game.players.length < 2) return game.players[0] === meId ? game.turn === 0 : game.turn === 1;
  return game.players[game.turn] === meId;
}

function Status({ game, meId, marks }: { game: TurnGame; meId: string; marks: [string, string] }) {
  const name = useName();
  const turn = whoseTurn(game);
  let text: string;
  if (game.winner === "draw") text = "It's a draw 🤝";
  else if (game.winner) text = game.winner === meId ? "You won! 🎉" : `${name(game.winner)} won 🏆`;
  else if (game.players.length < 2)
    text =
      game.players[0] === meId
        ? game.turn === 0
          ? `Your move (${marks[0]})`
          : `Waiting for someone to play ${marks[1]}…`
        : `Make a move to play as ${marks[1]}`;
  else text = turn === meId ? `Your turn (${marks[game.players.indexOf(meId)]})` : `${name(turn)}'s turn`;
  return (
    <div className="mb-2 flex items-center justify-between gap-2 text-sm">
      <span className="font-semibold">{text}</span>
      <span className="truncate text-xs opacity-70">
        {name(game.players[0])} {marks[0]} · {game.players[1] ? `${name(game.players[1])} ${marks[1]}` : "?"}
      </span>
    </div>
  );
}

function Ttt({ game, meId, onMove }: { game: TttGame; meId: string; onMove: (m: GameMove) => void }) {
  return (
    <>
      <Status game={game} meId={meId} marks={["❌", "⭕"]} />
      <div className="grid grid-cols-3 gap-1.5" role="grid" aria-label="Tic-tac-toe board">
        {game.board.map((v, i) => (
          <button
            key={i}
            onClick={() => onMove({ cell: i })}
            disabled={v !== -1 || !myTurn(game, meId)}
            aria-label={v === -1 ? `Square ${i + 1}, empty` : `Square ${i + 1}, ${v === 0 ? "X" : "O"}`}
            className={`flex aspect-square items-center justify-center rounded-xl text-3xl transition ${
              game.line?.includes(i) ? "bg-emerald-400/40" : "bg-black/10 dark:bg-white/10"
            } ${v === -1 && myTurn(game, meId) ? "hover:bg-black/15 dark:hover:bg-white/15" : ""}`}
          >
            {v === 0 ? "❌" : v === 1 ? "⭕" : ""}
          </button>
        ))}
      </div>
    </>
  );
}

function ConnectFour({ game, meId, onMove }: { game: C4Game; meId: string; onMove: (m: GameMove) => void }) {
  return (
    <>
      <Status game={game} meId={meId} marks={["🔴", "🟡"]} />
      <div className="grid grid-cols-7 gap-1 rounded-xl bg-blue-600 p-1.5" aria-label="Connect Four board">
        {game.board.map((v, i) => (
          <button
            key={i}
            onClick={() => onMove({ col: i % 7 })}
            disabled={!myTurn(game, meId)}
            aria-label={`Column ${(i % 7) + 1}`}
            className={`aspect-square rounded-full transition ${v === 0 ? "bg-red-500" : v === 1 ? "bg-yellow-400" : "bg-white/90 dark:bg-zinc-900"} ${
              game.line?.includes(i) ? "ring-4 ring-white" : game.last === i ? "ring-2 ring-white/70" : ""
            }`}
          />
        ))}
      </div>
    </>
  );
}

function Rps({ game, meId, onMove }: { game: RpsGame; meId: string; onMove: (m: GameMove) => void }) {
  const name = useName();
  const [a, b] = game.players;
  const wins = (p: string | undefined) => (p ? game.rounds.filter((r) => r.winner === p).length : 0);
  const iPlay = game.players.includes(meId) || game.players.length < 2;
  const iPicked = !!game.picks[meId];
  const last = game.rounds[game.rounds.length - 1];
  return (
    <>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">
          {game.winner ? (game.winner === meId ? "You won! 🎉" : `${name(game.winner)} won 🏆`) : `First to ${game.target} wins`}
        </span>
        <span className="text-xs font-semibold tabular-nums">
          {name(a)} {wins(a)} – {wins(b)} {b ? name(b) : "?"}
        </span>
      </div>
      {last && (
        <p className="mb-2 rounded-xl bg-black/10 px-3 py-1.5 text-center text-sm dark:bg-white/10">
          {game.players.map((p) => `${name(p)} ${RPS_EMOJI[last.picks[p]]}`).join("  vs  ")} →{" "}
          {last.winner ? (last.winner === meId ? "You take it" : `${name(last.winner)} takes it`) : "tie"}
        </p>
      )}
      {!game.winner &&
        (iPlay ? (
          iPicked ? (
            <p className="py-3 text-center text-sm">You picked ✓ — waiting for {game.players.length < 2 ? "someone to join" : "them"}…</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {RPS.map((p) => (
                <button
                  key={p}
                  onClick={() => onMove({ pick: p })}
                  aria-label={p}
                  className="flex aspect-square items-center justify-center rounded-2xl bg-black/10 text-4xl transition hover:scale-105 hover:bg-black/15 dark:bg-white/10"
                >
                  {RPS_EMOJI[p]}
                </button>
              ))}
            </div>
          )
        ) : (
          <p className="py-3 text-center text-sm opacity-80">{Object.keys(game.picks).length ? "Someone picked… 👀" : "Waiting for picks…"}</p>
        ))}
    </>
  );
}

function Gomoku({ game, meId, onMove }: { game: GomokuGame; meId: string; onMove: (m: GameMove) => void }) {
  const can = myTurn(game, meId);
  return (
    <>
      <Status game={game} meId={meId} marks={["⚫", "⚪"]} />
      <div
        className="grid gap-px overflow-hidden rounded-lg bg-amber-800/60 p-px"
        style={{ gridTemplateColumns: `repeat(${GOMOKU}, minmax(0, 1fr))` }}
        aria-label="Five in a Row board"
      >
        {game.board.map((v, i) => (
          <button
            key={i}
            onClick={() => onMove({ cell: i })}
            disabled={v !== -1 || !can}
            aria-label={`Square ${i + 1}${v === -1 ? ", empty" : v === 0 ? ", black" : ", white"}`}
            className={`flex aspect-square items-center justify-center bg-amber-200 dark:bg-amber-300 ${v === -1 && can ? "hover:bg-amber-100" : ""}`}
          >
            {v !== -1 && (
              <span
                className={`size-[80%] rounded-full shadow ${v === 0 ? "bg-zinc-900" : "bg-white ring-1 ring-zinc-400"} ${
                  game.line?.includes(i) ? "ring-2 ring-emerald-500" : game.last === i ? "ring-2 ring-red-500" : ""
                }`}
              />
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function Checkers({ game, meId, onMove }: { game: CheckersGame; meId: string; onMove: (m: GameMove) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const can = myTurn(game, meId);
  // Who you are on this board (a newcomer plays the light side).
  const side = game.players.indexOf(meId) === -1 ? (game.players.length < 2 ? 1 : -1) : game.players.indexOf(meId);
  const moves = can && side >= 0 ? checkersMoves(game.board, side, game.chain) : [];
  const from = game.chain ?? sel;
  const targets = new Set(moves.filter((m) => m.from === from).map((m) => m.to));
  const movable = new Set(moves.map((m) => m.from));
  // Light plays from the top: turn the board so your pieces are at the bottom.
  const flip = side === 1;
  const order = [...Array(64).keys()].map((i) => (flip ? 63 - i : i));
  const left = (who: number) => game.board.filter((v) => (who === 0 ? v === 1 || v === 2 : v === 3 || v === 4)).length;

  const tap = (i: number) => {
    if (!can) return;
    if (targets.has(i) && from !== null) {
      onMove({ from, to: i });
      setSel(null);
    } else if (movable.has(i) && game.chain === null) setSel(i === sel ? null : i);
  };

  return (
    <>
      <Status game={game} meId={meId} marks={["⚫", "⚪"]} />
      {can && moves.some((m) => m.jump !== null) && (
        <p className="-mt-1 mb-1 text-xs font-semibold">You must take a piece{game.chain !== null ? " — keep jumping" : ""}!</p>
      )}
      <div className="grid grid-cols-8 overflow-hidden rounded-lg ring-2 ring-amber-900/70" aria-label="Checkers board">
        {order.map((i) => {
          const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
          const v = game.board[i];
          const isTarget = targets.has(i);
          const isSel = from === i;
          const wasLast = game.last?.includes(i);
          return (
            <button
              key={i}
              onClick={() => tap(i)}
              aria-label={`Square ${i}${v ? (v <= 2 ? ", dark piece" : ", light piece") : isTarget ? ", move here" : ""}`}
              className={`relative flex aspect-square items-center justify-center ${dark ? (wasLast ? "bg-amber-700" : "bg-amber-800") : "bg-amber-100"} ${isTarget ? "cursor-pointer" : ""}`}
            >
              {v > 0 && (
                <span
                  className={`flex size-[78%] items-center justify-center rounded-full text-[10px] shadow-md ${v <= 2 ? "bg-zinc-900 text-amber-300 ring-1 ring-zinc-600" : "bg-zinc-50 text-amber-600 ring-1 ring-zinc-300"} ${
                    isSel ? "ring-4 ring-emerald-400" : movable.has(i) && can ? "ring-2 ring-emerald-400/60" : ""
                  }`}
                >
                  {v === 2 || v === 4 ? "👑" : ""}
                </span>
              )}
              {isTarget && <span className="absolute size-1/3 rounded-full bg-emerald-400/80" />}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-center text-xs opacity-70">
        ⚫ {left(0)} · ⚪ {left(1)} pieces left
      </p>
    </>
  );
}

function Dots({ game, meId, onMove }: { game: DotsGame; meId: string; onMove: (m: GameMove) => void }) {
  const name = useName();
  const can = myTurn(game, meId);
  const colors = ["bg-blue-500", "bg-rose-500"];
  const fills = ["bg-blue-500/35", "bg-rose-500/35"];
  const score = (p: number) => game.boxes.filter((b) => b === p).length;
  const N = DOTS * 2 + 1;
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const key = `${r}-${c}`;
      if (r % 2 === 0 && c % 2 === 0) cells.push(<span key={key} className="m-auto size-2.5 rounded-full bg-current" />);
      else if (r % 2 === 0) {
        const idx = (r / 2) * DOTS + (c - 1) / 2;
        const who = game.h[idx];
        cells.push(
          <button
            key={key}
            onClick={() => onMove({ line: "h", index: idx })}
            disabled={who !== -1 || !can}
            aria-label={`Line ${key}`}
            className="group flex items-center"
          >
            <span className={`h-1.5 w-full rounded-full ${who !== -1 ? colors[who] : can ? "bg-current/10 group-hover:bg-current/40" : "bg-current/10"}`} />
          </button>,
        );
      } else if (c % 2 === 0) {
        const idx = ((r - 1) / 2) * (DOTS + 1) + c / 2;
        const who = game.v[idx];
        cells.push(
          <button
            key={key}
            onClick={() => onMove({ line: "v", index: idx })}
            disabled={who !== -1 || !can}
            aria-label={`Line ${key}`}
            className="group flex justify-center"
          >
            <span className={`h-full w-1.5 rounded-full ${who !== -1 ? colors[who] : can ? "bg-current/10 group-hover:bg-current/40" : "bg-current/10"}`} />
          </button>,
        );
      } else {
        const owner = game.boxes[((r - 1) / 2) * DOTS + (c - 1) / 2];
        cells.push(<span key={key} className={`m-0.5 rounded ${owner !== -1 ? fills[owner] : ""}`} />);
      }
    }
  return (
    <>
      <Status game={game} meId={meId} marks={["🟦", "🟥"]} />
      <div
        className="mx-auto grid aspect-square w-full"
        style={{ gridTemplateColumns: `repeat(${DOTS}, 0.6rem 1fr) 0.6rem`, gridTemplateRows: `repeat(${DOTS}, 0.6rem 1fr) 0.6rem` }}
        aria-label="Dots and boxes board"
      >
        {cells}
      </div>
      <p className="mt-1 text-center text-sm font-semibold tabular-nums">
        🟦 {name(game.players[0])} {score(0)} – {score(1)} {game.players[1] ? name(game.players[1]) : "?"} 🟥
      </p>
    </>
  );
}

function HangmanDuel({ game, meId, onMove }: { game: HangmanGame; meId: string; onMove: (m: GameMove) => void }) {
  const name = useName();
  const setter = game.players[0];
  const iSet = setter === meId;
  const shown = game.winner ? game.word : null;
  return (
    <>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-semibold">
          {game.winner
            ? game.winner === meId
              ? "You won! 🎉"
              : `${name(game.winner)} won 🏆`
            : iSet
              ? "They're guessing your word…"
              : `Guess ${name(setter)}'s word`}
        </span>
        <span className="text-xs opacity-70">{HANGMAN_LIVES - game.wrong} tries left</span>
      </div>
      <div className="flex justify-center gap-1 text-current">
        {Array.from({ length: HANGMAN_LIVES }, (_, i) => (
          <span key={i} className={i < game.wrong ? "opacity-25" : ""}>
            ❤️
          </span>
        ))}
      </div>
      <div className="my-3 flex flex-wrap justify-center gap-1" aria-label="The word">
        {game.mask.map((c, i) =>
          c === " " ? (
            <span key={i} className="w-3" />
          ) : (
            <span
              key={i}
              className={`flex h-9 w-6 items-end justify-center border-b-[3px] border-current pb-0.5 text-xl font-bold uppercase ${shown && !c ? "text-red-400" : ""}`}
            >
              {c || (shown ? shown[i] : "")}
            </span>
          ),
        )}
      </div>
      {!game.winner && !iSet && (
        <div className="grid grid-cols-7 gap-1" aria-label="Letters">
          {[..."abcdefghijklmnopqrstuvwxyz"].map((l) => {
            const used = game.guessed.includes(l);
            const hit = used && game.mask.includes(l);
            return (
              <button
                key={l}
                onClick={() => onMove({ letter: l })}
                disabled={used}
                className={`h-8 rounded-md text-sm font-semibold uppercase ${hit ? "bg-emerald-500 text-white" : used ? "opacity-30 line-through" : "bg-black/10 hover:bg-black/20 dark:bg-white/10"}`}
              >
                {l}
              </button>
            );
          })}
        </div>
      )}
      {iSet && !game.winner && game.guessed.length > 0 && <p className="text-center text-xs opacity-80">Tried: {game.guessed.join(" ").toUpperCase()}</p>}
    </>
  );
}

/** Hangman rematch: pick a new secret word. */
function WordRematch({ onStart }: { onStart: (word: string) => void }) {
  const [w, setW] = useState("");
  const ok = cleanWord(w);
  return (
    <form
      className="mt-2 flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onStart(ok);
      }}
    >
      <input
        value={w}
        onChange={(e) => setW(e.target.value)}
        placeholder="Your secret word"
        aria-label="Secret word for a rematch"
        autoComplete="off"
        className="h-9 min-w-0 flex-1 rounded-lg bg-black/10 px-2.5 text-sm outline-none placeholder:text-current/50 dark:bg-white/10"
      />
      <button disabled={!ok} className="rounded-lg bg-black/15 px-3 text-sm font-semibold disabled:opacity-40 dark:bg-white/15">
        🔁 Rematch
      </button>
    </form>
  );
}

// ---------- Watch together ----------

function WatchCard({ game, meId, onMove }: { game: WatchGame; meId: string; onMove: (m: GameMove) => void }) {
  const name = useName();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { yt, command, timeRef } = useYouTube(frame, game.videoId);
  const [muted, setMuted] = useState(false);
  const [autoMuted, setAutoMuted] = useState(false);
  const [link, setLink] = useState("");
  const [changing, setChanging] = useState(false);
  const [src] = useState(() => new Map<string, string>());
  // One URL per video (so re-renders don't reload the player).
  if (!src.has(game.videoId)) src.set(game.videoId, embedUrl(game.videoId, { controls: 0, disablekb: 1, start: Math.floor(watchPosition(game)) }));

  // Follow the shared state: play/pause/seek whenever it changes (and once the player is ready).
  useEffect(() => {
    if (!yt.ready) return;
    command("seekTo", [watchPosition(game), true]);
    command(game.playing ? "playVideo" : "pauseVideo");
  }, [game.playing, game.pos, game.at, game.videoId, yt.ready, command]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stay in sync: if this player drifts more than 2 s, jump back in line.
  useEffect(() => {
    if (!game.playing || !yt.ready) return;
    const t = window.setInterval(() => {
      const want = watchPosition(game);
      if (Math.abs(timeRef.current - want) > 2) command("seekTo", [want, true]);
    }, 2500);
    return () => window.clearInterval(t);
  }, [game, yt.ready, command, timeRef]);

  // The browser may block playing with sound when someone else pressed play: play muted instead.
  useEffect(() => {
    if (!game.playing || !yt.ready || muted) return;
    const t = window.setTimeout(() => {
      if (yt.state !== 1 && yt.state !== 3) {
        command("mute");
        command("playVideo");
        setMuted(true);
        setAutoMuted(true);
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, [game.playing, game.at, yt.ready, yt.state, muted, command]);

  const toggleMute = () => {
    command(muted ? "unMute" : "mute");
    setMuted(!muted);
    setAutoMuted(false);
  };

  const now = timeRef.current || watchPosition(game);
  const duration = yt.duration;
  const lastAction = game.by === meId ? "You" : name(game.by);

  return (
    <div className="w-[min(26rem,72vw)] max-w-full p-2">
      <div ref={box} className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <iframe
          key={game.videoId}
          ref={frame}
          src={src.get(game.videoId)}
          title={game.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          className="pointer-events-none size-full border-0"
        />
        {yt.error !== null && (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">This video can't play here. Change it below.</p>
        )}
        {autoMuted && (
          <button
            onClick={toggleMute}
            className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink"
          >
            <VolumeOffIcon className="size-4" /> Tap for sound
          </button>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-semibold">📺 {game.title}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => onMove({ action: game.playing ? "pause" : "play", pos: now })}
          aria-label={game.playing ? "Pause for everyone" : "Play for everyone"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/15 hover:bg-black/25 dark:bg-white/15"
        >
          {game.playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 translate-x-px" />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(duration))}
          value={Math.min(Math.round(now), Math.round(duration) || 0)}
          onChange={(e) => onMove({ action: "seek", pos: Number(e.target.value) })}
          aria-label="Seek for everyone"
          className="min-w-0 flex-1 accent-current"
          disabled={!duration}
        />
        <span className="shrink-0 text-xs tabular-nums opacity-80">
          {fmt(now)}/{fmt(duration)}
        </span>
        <button
          onClick={toggleMute}
          aria-label={muted ? "Unmute (just you)" : "Mute (just you)"}
          className="rounded-full p-1.5 hover:bg-black/10 dark:hover:bg-white/10"
        >
          {muted ? <VolumeOffIcon className="size-4" /> : <VolumeIcon className="size-4" />}
        </button>
        <button
          onClick={() => void box.current?.requestFullscreen?.().catch(() => {})}
          aria-label="Full screen"
          className="rounded-full p-1.5 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <MaximizeIcon className="size-4" />
        </button>
      </div>
      <p className="mt-1 text-xs opacity-70">
        {lastAction} {game.playing ? "pressed play" : "paused"} · everyone in the chat sees the same moment
      </p>
      {changing ? (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const id = youtubeId(link);
            if (!id) return;
            onMove({ action: "video", videoId: id, title: "" });
            setLink("");
            setChanging(false);
          }}
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a YouTube link"
            aria-label="YouTube link"
            className="h-9 min-w-0 flex-1 rounded-lg bg-black/10 px-2.5 text-sm outline-none dark:bg-white/10"
          />
          <button disabled={!youtubeId(link)} className="rounded-lg bg-black/20 px-3 text-sm font-semibold disabled:opacity-50 dark:bg-white/20">
            Play
          </button>
        </form>
      ) : (
        <button onClick={() => setChanging(true)} className="mt-1 text-xs font-semibold underline-offset-2 hover:underline">
          Change video
        </button>
      )}
    </div>
  );
}

function fmt(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
