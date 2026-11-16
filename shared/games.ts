/*
 * Games you play with friends inside a chat, and "watch together".
 *
 * A game is a chat message (kind "game") whose state lives in its meta. The
 * server is the referee: every move goes through `applyMove` there, so nobody
 * can cheat by editing their app. The same rules run in the app for display.
 */

import { FIVE } from "./words";

export type ChatGameType =
  | "ttt" | "c4" | "rps" | "gomoku" | "checkers" | "dots" | "hangman" | "reversi" | "mancala"
  | "wordteam" | "code" | "pairs"
  | "watch";

/** Team games: everyone in the chat plays together against the puzzle. */
export const COOP_GAMES: ChatGameType[] = ["wordteam", "code", "pairs"];

export const CHAT_GAMES: [ChatGameType, string, string][] = [
  ["wordteam", "Word Team", "🟩🟨"],
  ["code", "Crack the Code", "🔐"],
  ["pairs", "Pair Up", "🃏"],
  ["ttt", "Tic-tac-toe", "❌⭕"],
  ["c4", "Connect Four", "🔴🟡"],
  ["checkers", "Checkers", "⚫⚪"],
  ["gomoku", "Five in a Row", "⚫⚫⚫"],
  ["reversi", "Reversi", "🟢"],
  ["mancala", "Mancala", "🫘"],
  ["dots", "Dots & Boxes", "⬜"],
  ["hangman", "Hangman Duel", "🔤"],
  ["rps", "Rock paper scissors", "✊✋✌️"],
  ["watch", "Watch together", "📺"],
];

/** Five in a Row board size. */
export const GOMOKU = 10;
/** Dots & Boxes: boxes per side. */
export const DOTS = 4;
export const HANGMAN_LIVES = 6;

export type RpsPick = "rock" | "paper" | "scissors";
export const RPS: RpsPick[] = ["rock", "paper", "scissors"];
export const RPS_EMOJI: Record<RpsPick, string> = { rock: "✊", paper: "✋", scissors: "✌️" };

interface Two {
  /** userIds; [0] started it, [1] is whoever joins first. */
  players: string[];
  /** userId who won, "draw", or null while playing. */
  winner: string | null;
}

export interface TttGame extends Two {
  type: "ttt";
  /** 9 cells: -1 empty, 0 = players[0] (❌), 1 = players[1] (⭕). */
  board: number[];
  turn: number;
  line: number[] | null;
}

export interface C4Game extends Two {
  type: "c4";
  /** 6 rows × 7 columns, row 0 at the top: -1 empty, 0 or 1. */
  board: number[];
  turn: number;
  line: number[] | null;
  last: number | null;
}

export interface RpsGame extends Two {
  type: "rps";
  /** This round's picks (hidden from others until both picked). */
  picks: Record<string, RpsPick | "hidden">;
  /** Finished rounds. */
  rounds: { picks: Record<string, RpsPick>; winner: string | null }[];
  /** First to this many round wins. */
  target: number;
}

export interface WatchGame {
  type: "watch";
  videoId: string;
  title: string;
  playing: boolean;
  /** Video position (seconds) at `at`. */
  pos: number;
  /** Server time of the last change. */
  at: number;
  /** Who did the last thing (play, pause, seek, change video). */
  by: string;
  players: string[];
  winner: null;
}

export interface GomokuGame extends Two {
  type: "gomoku";
  /** GOMOKU × GOMOKU cells: -1 empty, 0 or 1. */
  board: number[];
  turn: number;
  line: number[] | null;
  last: number | null;
}

/**
 * Checkers on the dark squares of 8×8: 0 empty, 1 = players[0] (dark, moves up),
 * 2 = their king, 3 = players[1] (light, moves down), 4 = their king.
 * Captures are compulsory; after a capture the same piece keeps jumping if it can.
 */
export interface CheckersGame extends Two {
  type: "checkers";
  board: number[];
  turn: number;
  /** In the middle of a multi-jump: the piece that must keep jumping. */
  chain: number | null;
  last: [number, number] | null;
}

/** Dots & Boxes: whoever closes a box scores it and goes again. */
export interface DotsGame extends Two {
  type: "dots";
  /** Horizontal lines, (DOTS+1) rows × DOTS: -1 or who drew it. */
  h: number[];
  /** Vertical lines, DOTS rows × (DOTS+1). */
  v: number[];
  /** Box owners: -1 or 0/1. */
  boxes: number[];
  turn: number;
}

/** Hangman Duel: players[0] picks a secret word, the other side guesses it. */
export interface HangmanGame extends Two {
  type: "hangman";
  /** The secret word: only the server knows it until the game ends ("" in what the app gets). */
  word: string;
  /** What everyone sees: the letters found so far, "" for the rest. */
  mask: string[];
  guessed: string[];
  wrong: number;
}

/** Reversi: place a disc to flip the other side's discs between yours. */
export interface ReversiGame extends Two {
  type: "reversi";
  /** 8×8: -1 empty, 0 = players[0] (dark, goes first), 1 = players[1]. */
  board: number[];
  turn: number;
  last: number | null;
  /** The other side had no move, so this turn was passed back. */
  passed: boolean;
}

/**
 * Mancala (Kalah, 4 seeds): pits 0–5 + store 6 belong to players[0], pits 7–12 +
 * store 13 to players[1]. A last seed in your store = another turn; in an empty pit
 * of yours = capture the pit across.
 */
export interface MancalaGame extends Two {
  type: "mancala";
  pits: number[];
  turn: number;
  last: number | null;
}

/** Team games end with the whole chat winning or losing together. */
interface Team {
  /** Everyone who has helped so far. */
  players: string[];
  winner: "team" | "lost" | null;
}

/** Word Team: guess a 5-letter word together in 6 tries. */
export interface WordTeamGame extends Team {
  type: "wordteam";
  /** Only the server knows it until the game ends ("" in what the app gets). */
  word: string;
  /** marks per letter: g = right spot, y = in the word, . = not in it. */
  guesses: { word: string; by: string; marks: string }[];
}

/** Crack the Code: find 4 hidden colors (from 6, repeats allowed) in 10 tries. */
export interface CodeGame extends Team {
  type: "code";
  /** Hidden until the game ends ([] in what the app gets). */
  code: number[];
  guesses: { code: number[]; by: string; exact: number; near: number }[];
}

/** Pair Up: flip cards two at a time and clear the board before running out of misses. */
export interface PairsGame extends Team {
  type: "pairs";
  /** Card faces; the app only gets the ones that are face up (-1 for the rest). */
  deck: number[];
  matched: boolean[];
  /** Face-up cards that aren't matched yet (0–2). */
  open: number[];
  misses: number;
  /** Who found each pair (card index → userId), for the scoreboard. */
  foundBy: Record<number, string>;
}

export type ChatGame =
  | TttGame | C4Game | RpsGame | GomokuGame | CheckersGame | DotsGame | HangmanGame | ReversiGame | MancalaGame
  | WordTeamGame | CodeGame | PairsGame
  | WatchGame;

export type GameMove =
  | { cell: number }
  | { col: number }
  | { pick: RpsPick }
  | { action: "play" | "pause" | "seek"; pos: number }
  | { action: "video"; videoId: string; title: string }
  | { from: number; to: number }
  | { line: "h" | "v"; index: number }
  | { letter: string }
  | { pit: number }
  | { guess: string }
  | { code: number[] }
  | { flip: number };

export const WORDTEAM_TRIES = 6;
export const CODE_TRIES = 10;
export const CODE_COLORS = 6;
export const CODE_LENGTH = 4;
export const PAIRS = 8;
export const PAIRS_MISSES = 12;

export const YT_ID = /^[\w-]{11}$/;

/** Pulls the video id out of any YouTube link (or a bare id). */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (YT_ID.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return YT_ID.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && YT_ID.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      return m ? m[1] : null;
    }
  } catch {
    // not a link
  }
  return null;
}

/** A secret word for Hangman Duel: letters only (spaces allowed between words), 3–24 long. */
export function cleanWord(raw: string): string | null {
  const w = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return /^[a-z]+( [a-z]+)*$/.test(w) && w.replace(/ /g, "").length >= 3 && w.length <= 24 ? w : null;
}

function checkersStart(): number[] {
  const b = Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8);
    const dark = (r + (i % 8)) % 2 === 1;
    if (!dark) continue;
    if (r < 3) b[i] = 3;
    if (r > 4) b[i] = 1;
  }
  return b;
}

export function newGame(
  type: ChatGameType,
  by: string,
  video?: { videoId: string; title: string },
  now = Date.now(),
  word?: string,
): ChatGame {
  switch (type) {
    case "reversi": {
      const board = Array(64).fill(-1);
      board[27] = board[36] = 1;
      board[28] = board[35] = 0;
      return { type, players: [by], winner: null, board, turn: 0, last: null, passed: false };
    }
    case "mancala":
      return { type, players: [by], winner: null, pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], turn: 0, last: null };
    case "wordteam":
      return { type, players: [by], winner: null, word: FIVE[randomInt(FIVE.length)], guesses: [] };
    case "code":
      return { type, players: [by], winner: null, code: Array.from({ length: CODE_LENGTH }, () => randomInt(CODE_COLORS)), guesses: [] };
    case "pairs": {
      const deck = [...Array(PAIRS).keys(), ...Array(PAIRS).keys()];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      return { type, players: [by], winner: null, deck, matched: deck.map(() => false), open: [], misses: 0, foundBy: {} };
    }
    case "gomoku":
      return { type, players: [by], winner: null, board: Array(GOMOKU * GOMOKU).fill(-1), turn: 0, line: null, last: null };
    case "checkers":
      return { type, players: [by], winner: null, board: checkersStart(), turn: 0, chain: null, last: null };
    case "dots":
      return {
        type,
        players: [by],
        winner: null,
        h: Array((DOTS + 1) * DOTS).fill(-1),
        v: Array(DOTS * (DOTS + 1)).fill(-1),
        boxes: Array(DOTS * DOTS).fill(-1),
        turn: 0,
      };
    case "hangman": {
      const w = cleanWord(word ?? "");
      if (!w) throw new GameError("Pick a word of 3 to 24 letters (a to z).");
      return { type, players: [by], winner: null, word: w, mask: [...w].map((c) => (c === " " ? " " : "")), guessed: [], wrong: 0 };
    }
    case "ttt":
      return { type, players: [by], winner: null, board: Array(9).fill(-1), turn: 0, line: null };
    case "c4":
      return { type, players: [by], winner: null, board: Array(42).fill(-1), turn: 0, line: null, last: null };
    case "rps":
      return { type, players: [by], winner: null, picks: {}, rounds: [], target: 2 };
    case "watch":
      if (!video) throw new GameError("Pick a video.");
      return { type, videoId: video.videoId, title: video.title, playing: false, pos: 0, at: now, by, players: [by], winner: null };
  }
}

export class GameError extends Error {}

/** Unbiased random integer in [0, n), from the platform's secure generator. */
function randomInt(n: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/** Discs that placing `side` at `at` would flip (empty = not a legal move). */
export function reversiFlips(board: number[], side: number, at: number): number[] {
  if (board[at] !== -1) return [];
  const flips: number[] = [];
  const r0 = Math.floor(at / 8);
  const c0 = at % 8;
  for (const [dr, dc] of DIRS8) {
    const run: number[] = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === 1 - side) {
      run.push(r * 8 + c);
      r += dr;
      c += dc;
    }
    if (run.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === side) flips.push(...run);
  }
  return flips;
}

export function reversiHasMove(board: number[], side: number): boolean {
  return board.some((_, i) => reversiFlips(board, side, i).length > 0);
}

/** Word Team marks: g = right spot, y = elsewhere in the word, . = not in it (repeats counted properly). */
export function wordMarks(answer: string, guess: string): string {
  const marks = Array(5).fill(".");
  const left: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) marks[i] = "g";
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (marks[i] === "g" || !left[guess[i]]) continue;
    marks[i] = "y";
    left[guess[i]]--;
  }
  return marks.join("");
}

/** Crack the Code feedback: right color in the right place, and right color in the wrong place. */
export function codeScore(code: number[], guess: number[]): { exact: number; near: number } {
  let exact = 0;
  const a: number[] = Array(CODE_COLORS).fill(0);
  const b: number[] = Array(CODE_COLORS).fill(0);
  for (let i = 0; i < code.length; i++) {
    if (code[i] === guess[i]) exact++;
    else {
      a[code[i]]++;
      b[guess[i]]++;
    }
  }
  return { exact, near: a.reduce((n, x, i) => n + Math.min(x, b[i]), 0) };
}

/** Joins a team game (anyone in the chat can help). */
function joinTeam(g: { players: string[] }, userId: string) {
  if (!g.players.includes(userId)) g.players.push(userId);
}

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Joins the second player on their first move; spectators can't move. */
function seat(g: Two, userId: string): number {
  let i = g.players.indexOf(userId);
  if (i === -1) {
    if (g.players.length >= 2) throw new GameError("Two people are already playing this one.");
    g.players.push(userId);
    i = 1;
  }
  return i;
}

function c4Line(board: number[], at: number): number[] | null {
  const who = board[at];
  const r0 = Math.floor(at / 7);
  const c0 = at % 7;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [at];
    for (const s of [1, -1]) {
      let r = r0 + dr * s;
      let c = c0 + dc * s;
      while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r * 7 + c] === who) {
        cells.push(r * 7 + c);
        r += dr * s;
        c += dc * s;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

function rpsBeats(a: RpsPick, b: RpsPick) {
  return (a === "rock" && b === "scissors") || (a === "paper" && b === "rock") || (a === "scissors" && b === "paper");
}

function lineOf(board: number[], size: number, at: number, need: number): number[] | null {
  const who = board[at];
  const r0 = Math.floor(at / size);
  const c0 = at % size;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [at];
    for (const s of [1, -1]) {
      let r = r0 + dr * s;
      let c = c0 + dc * s;
      while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === who) {
        cells.push(r * size + c);
        r += dr * s;
        c += dc * s;
      }
    }
    if (cells.length >= need) return cells;
  }
  return null;
}

/** Turn-based games: who may move, joining the second player on their first move. */
function turnSeat(g: Two & { turn: number }, userId: string, mark: string): number {
  const me = seat(g, userId);
  if (g.players.length < 2 && me === 0 && g.turn === 1) throw new GameError(`Waiting for someone to play ${mark}.`);
  if (g.turn !== me) throw new GameError("It's not your turn.");
  return me;
}

const ownerOf = (v: number) => (v === 1 || v === 2 ? 0 : v === 3 || v === 4 ? 1 : -1);

/** Every legal checkers move for `side` (captures only, if any capture exists). */
export function checkersMoves(board: number[], side: number, only: number | null = null): { from: number; to: number; jump: number | null }[] {
  const moves: { from: number; to: number; jump: number | null }[] = [];
  for (let i = 0; i < 64; i++) {
    if (ownerOf(board[i]) !== side || (only !== null && i !== only)) continue;
    const king = board[i] === 2 || board[i] === 4;
    const dirs = king ? [-1, 1] : side === 0 ? [-1] : [1];
    const r = Math.floor(i / 8);
    const c = i % 8;
    for (const dr of dirs)
      for (const dc of [-1, 1]) {
        const r1 = r + dr;
        const c1 = c + dc;
        if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) continue;
        const n = r1 * 8 + c1;
        if (board[n] === 0) moves.push({ from: i, to: n, jump: null });
        else if (ownerOf(board[n]) === 1 - side) {
          const r2 = r1 + dr;
          const c2 = c1 + dc;
          if (r2 >= 0 && r2 <= 7 && c2 >= 0 && c2 <= 7 && board[r2 * 8 + c2] === 0) moves.push({ from: i, to: r2 * 8 + c2, jump: n });
        }
      }
  }
  const jumps = moves.filter((m) => m.jump !== null);
  return jumps.length ? jumps : only !== null ? [] : moves;
}

/** Applies one move (server side). Returns the new state or throws GameError. */
export function applyMove(game: ChatGame, userId: string, move: GameMove, now = Date.now()): ChatGame {
  const g = structuredClone(game) as ChatGame;

  if (g.type === "watch") {
    if (!("action" in move)) throw new GameError("Not a watch-together action.");
    if (!g.players.includes(userId)) g.players.push(userId);
    g.by = userId;
    if (move.action === "video") {
      if (!YT_ID.test(move.videoId)) throw new GameError("That's not a YouTube video.");
      g.videoId = move.videoId;
      g.title = String(move.title ?? "").slice(0, 200);
      g.pos = 0;
      g.playing = true;
    } else {
      const pos = Number(move.pos);
      if (!Number.isFinite(pos) || pos < 0 || pos > 86_400) throw new GameError("Bad position.");
      g.pos = pos;
      if (move.action === "play") g.playing = true;
      if (move.action === "pause") g.playing = false;
    }
    g.at = now;
    return g;
  }

  if (g.winner) throw new GameError("This game is over. Start a rematch!");

  if (g.type === "ttt") {
    if (!("cell" in move) || !Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8) throw new GameError("Pick a square.");
    const me = seat(g, userId);
    if (g.players.length < 2 && me === 0 && g.turn === 1) throw new GameError("Waiting for someone to play ⭕.");
    if (g.turn !== me) throw new GameError("It's not your turn.");
    if (g.board[move.cell] !== -1) throw new GameError("That square is taken.");
    g.board[move.cell] = me;
    const line = TTT_LINES.find((l) => l.every((c) => g.board[c] === me));
    if (line) {
      g.winner = userId;
      g.line = line;
    } else if (g.board.every((c) => c !== -1)) g.winner = "draw";
    else g.turn = 1 - me;
    return g;
  }

  if (g.type === "c4") {
    if (!("col" in move) || !Number.isInteger(move.col) || move.col < 0 || move.col > 6) throw new GameError("Pick a column.");
    const me = seat(g, userId);
    if (g.players.length < 2 && me === 0 && g.turn === 1) throw new GameError("Waiting for someone to play 🟡.");
    if (g.turn !== me) throw new GameError("It's not your turn.");
    let at = -1;
    for (let r = 5; r >= 0; r--) {
      if (g.board[r * 7 + move.col] === -1) {
        at = r * 7 + move.col;
        break;
      }
    }
    if (at === -1) throw new GameError("That column is full.");
    g.board[at] = me;
    g.last = at;
    const line = c4Line(g.board, at);
    if (line) {
      g.winner = userId;
      g.line = line;
    } else if (g.board.every((c) => c !== -1)) g.winner = "draw";
    else g.turn = 1 - me;
    return g;
  }

  if (g.type === "gomoku") {
    const cell = (move as { cell?: number }).cell;
    if (!Number.isInteger(cell) || cell! < 0 || cell! >= GOMOKU * GOMOKU) throw new GameError("Pick a square.");
    const me = turnSeat(g, userId, "⚪");
    if (g.board[cell!] !== -1) throw new GameError("That square is taken.");
    g.board[cell!] = me;
    g.last = cell!;
    const line = lineOf(g.board, GOMOKU, cell!, 5);
    if (line) {
      g.winner = userId;
      g.line = line;
    } else if (g.board.every((c) => c !== -1)) g.winner = "draw";
    else g.turn = 1 - me;
    return g;
  }

  if (g.type === "checkers") {
    const { from, to } = move as { from?: number; to?: number };
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new GameError("Pick a piece and where to move it.");
    const me = turnSeat(g, userId, "⚪");
    const legal = checkersMoves(g.board, me, g.chain).find((m) => m.from === from && m.to === to);
    if (!legal) {
      const mustJump = checkersMoves(g.board, me, g.chain).some((m) => m.jump !== null);
      throw new GameError(g.chain !== null ? "Keep jumping with the same piece." : mustJump ? "You have to take a piece." : "That move isn't allowed.");
    }
    let piece = g.board[from!];
    g.board[from!] = 0;
    if (legal.jump !== null) g.board[legal.jump] = 0;
    const row = Math.floor(to! / 8);
    const crowned = (piece === 1 && row === 0) || (piece === 3 && row === 7);
    if (crowned) piece += 1;
    g.board[to!] = piece;
    g.last = [from!, to!];
    // Another jump with the same piece? Then it's still your turn (a new king stops there).
    if (legal.jump !== null && !crowned && checkersMoves(g.board, me, to!).some((m) => m.jump !== null)) {
      g.chain = to!;
      return g;
    }
    g.chain = null;
    g.turn = 1 - me;
    // Whoever can't move (or has no pieces left) loses.
    if (!checkersMoves(g.board, g.turn).length) g.winner = g.players[1 - g.turn] ?? userId;
    return g;
  }

  if (g.type === "dots") {
    const { line, index } = move as { line?: string; index?: number };
    const arr = line === "h" ? g.h : line === "v" ? g.v : null;
    if (!arr || !Number.isInteger(index) || index! < 0 || index! >= arr.length) throw new GameError("Pick a line.");
    const me = turnSeat(g, userId, "🟦");
    if (arr[index!] !== -1) throw new GameError("That line is already drawn.");
    arr[index!] = me;
    // Boxes this line touches: closed ones become yours, and you go again.
    const touched: number[] = [];
    if (line === "h") {
      const r = Math.floor(index! / DOTS);
      const c = index! % DOTS;
      if (r > 0) touched.push((r - 1) * DOTS + c);
      if (r < DOTS) touched.push(r * DOTS + c);
    } else {
      const r = Math.floor(index! / (DOTS + 1));
      const c = index! % (DOTS + 1);
      if (c > 0) touched.push(r * DOTS + c - 1);
      if (c < DOTS) touched.push(r * DOTS + c);
    }
    let scored = false;
    for (const b of touched) {
      const r = Math.floor(b / DOTS);
      const c = b % DOTS;
      const closed = g.h[r * DOTS + c] !== -1 && g.h[(r + 1) * DOTS + c] !== -1 && g.v[r * (DOTS + 1) + c] !== -1 && g.v[r * (DOTS + 1) + c + 1] !== -1;
      if (closed && g.boxes[b] === -1) {
        g.boxes[b] = me;
        scored = true;
      }
    }
    if (!scored) g.turn = 1 - me;
    if (g.boxes.every((b) => b !== -1)) {
      const mine = g.boxes.filter((b) => b === 0).length;
      const theirs = g.boxes.length - mine;
      g.winner = mine === theirs ? "draw" : (g.players[mine > theirs ? 0 : 1] ?? null);
    }
    return g;
  }

  if (g.type === "reversi") {
    const cell = (move as { cell?: number }).cell;
    if (!Number.isInteger(cell) || cell! < 0 || cell! >= 64) throw new GameError("Pick a square.");
    const me = turnSeat(g, userId, "⚪");
    const flips = reversiFlips(g.board, me, cell!);
    if (!flips.length) throw new GameError("That move has to flip at least one disc.");
    g.board[cell!] = me;
    for (const f of flips) g.board[f] = me;
    g.last = cell!;
    g.passed = false;
    if (reversiHasMove(g.board, 1 - me)) g.turn = 1 - me;
    else if (reversiHasMove(g.board, me)) g.passed = true; // they can't move: your turn again
    else {
      const mine = g.board.filter((v) => v === me).length;
      const theirs = g.board.filter((v) => v === 1 - me).length;
      g.winner = mine === theirs ? "draw" : mine > theirs ? userId : (g.players[1 - me] ?? null);
    }
    return g;
  }

  if (g.type === "mancala") {
    const pit = (move as { pit?: number }).pit;
    if (!Number.isInteger(pit) || pit! < 0 || pit! > 5) throw new GameError("Pick one of your pits.");
    const me = turnSeat(g, userId, "the top row");
    let at = me * 7 + pit!;
    let seeds = g.pits[at];
    if (!seeds) throw new GameError("That pit is empty.");
    g.pits[at] = 0;
    const theirStore = me === 0 ? 13 : 6;
    while (seeds > 0) {
      at = (at + 1) % 14;
      if (at === theirStore) continue;
      g.pits[at]++;
      seeds--;
    }
    g.last = at;
    const store = me * 7 + 6;
    const across = 12 - at;
    // Last seed in one of your empty pits: take it and everything across.
    if (at >= me * 7 && at < store && g.pits[at] === 1 && g.pits[across] > 0) {
      g.pits[store] += g.pits[across] + 1;
      g.pits[at] = 0;
      g.pits[across] = 0;
    }
    const empty = (side: number) => g.pits.slice(side * 7, side * 7 + 6).every((n) => n === 0);
    if (empty(0) || empty(1)) {
      // Whoever still has seeds keeps them.
      for (const side of [0, 1]) {
        for (let k = 0; k < 6; k++) {
          g.pits[side * 7 + 6] += g.pits[side * 7 + k];
          g.pits[side * 7 + k] = 0;
        }
      }
      const [a, b] = [g.pits[6], g.pits[13]];
      g.winner = a === b ? "draw" : (g.players[a > b ? 0 : 1] ?? null);
    } else if (at !== store) g.turn = 1 - me;
    return g;
  }

  if (g.type === "wordteam") {
    const guess = String((move as { guess?: unknown }).guess ?? "").trim().toLowerCase();
    if (!/^[a-z]{5}$/.test(guess)) throw new GameError("Guess a 5-letter word.");
    if (g.guesses.some((x) => x.word === guess)) throw new GameError("That word was already tried.");
    joinTeam(g, userId);
    const marks = wordMarks(g.word, guess);
    g.guesses.push({ word: guess, by: userId, marks });
    if (marks === "ggggg") g.winner = "team";
    else if (g.guesses.length >= WORDTEAM_TRIES) g.winner = "lost";
    return g;
  }

  if (g.type === "code") {
    const code = (move as { code?: unknown }).code;
    if (!Array.isArray(code) || code.length !== CODE_LENGTH || !code.every((c) => Number.isInteger(c) && c >= 0 && c < CODE_COLORS)) {
      throw new GameError(`Pick ${CODE_LENGTH} colors.`);
    }
    joinTeam(g, userId);
    const score = codeScore(g.code, code);
    g.guesses.push({ code: [...code], by: userId, ...score });
    if (score.exact === CODE_LENGTH) g.winner = "team";
    else if (g.guesses.length >= CODE_TRIES) g.winner = "lost";
    return g;
  }

  if (g.type === "pairs") {
    const i = (move as { flip?: number }).flip;
    if (!Number.isInteger(i) || i! < 0 || i! >= g.deck.length) throw new GameError("Pick a card.");
    joinTeam(g, userId);
    // A missed pair stays face up until the next flip.
    if (g.open.length === 2) g.open = [];
    if (g.matched[i!] || g.open.includes(i!)) throw new GameError("That card is already face up.");
    g.open.push(i!);
    if (g.open.length === 2) {
      const [a, b] = g.open;
      if (g.deck[a] === g.deck[b]) {
        g.matched[a] = g.matched[b] = true;
        g.foundBy[a] = userId;
        g.open = [];
        if (g.matched.every(Boolean)) g.winner = "team";
      } else if (++g.misses >= PAIRS_MISSES) g.winner = "lost";
    }
    return g;
  }

  if (g.type === "hangman") {
    const letter = String((move as { letter?: unknown }).letter ?? "").toLowerCase();
    if (!/^[a-z]$/.test(letter)) throw new GameError("Pick a letter.");
    if (userId === g.players[0]) throw new GameError("You chose the word — let them guess!");
    seat(g, userId);
    if (g.guessed.includes(letter)) throw new GameError("That letter was already tried.");
    g.guessed.push(letter);
    if (g.word.includes(letter)) g.mask = [...g.word].map((c, i) => (c === letter ? c : g.mask[i]));
    else g.wrong++;
    if (g.mask.every((c, i) => c === g.word[i])) g.winner = userId;
    else if (g.wrong >= HANGMAN_LIVES) g.winner = g.players[0];
    return g;
  }

  // Rock paper scissors: both pick, then the round is revealed.
  if (g.type !== "rps") throw new GameError("Unknown game.");
  if (!("pick" in move) || !RPS.includes(move.pick)) throw new GameError("Pick rock, paper or scissors.");
  seat(g, userId);
  if (g.picks[userId]) throw new GameError("You already picked — waiting for them.");
  g.picks[userId] = move.pick;
  if (g.players.length === 2 && g.players.every((p) => g.picks[p])) {
    const [a, b] = g.players;
    const pa = g.picks[a] as RpsPick;
    const pb = g.picks[b] as RpsPick;
    const winner = pa === pb ? null : rpsBeats(pa, pb) ? a : b;
    g.rounds.push({ picks: { [a]: pa, [b]: pb }, winner });
    g.picks = {};
    for (const p of g.players) {
      if (g.rounds.filter((r) => r.winner === p).length >= g.target) g.winner = p;
    }
  }
  return g;
}

/** What everyone may see: rock-paper-scissors picks stay hidden until the round is revealed. */
export function publicGame(g: ChatGame): ChatGame {
  // The Hangman word stays secret until the game ends.
  if (g.type === "hangman") return g.winner ? g : { ...g, word: "" };
  // Team games: the answer stays on the server until the game ends.
  if (g.type === "wordteam") return g.winner ? g : { ...g, word: "" };
  if (g.type === "code") return g.winner ? g : { ...g, code: [] };
  if (g.type === "pairs") return g.winner ? g : { ...g, deck: g.deck.map((s, i) => (g.matched[i] || g.open.includes(i) ? s : -1)) };
  if (g.type !== "rps") return g;
  return { ...g, picks: Object.fromEntries(Object.keys(g.picks).map((k) => [k, "hidden" as const])) };
}

export function isTeamGame(g: ChatGame): g is WordTeamGame | CodeGame | PairsGame {
  return g.type === "wordteam" || g.type === "code" || g.type === "pairs";
}

/** Short text for the chat list and notifications. */
export function gamePreview(g: ChatGame | undefined): string {
  if (!g) return "🎮 Game";
  if (g.type === "watch") return `📺 Watch together: ${g.title || "a video"}`;
  const name = CHAT_GAMES.find(([t]) => t === g.type)?.[1] ?? "Game";
  return `🎮 ${name}`;
}

/** Whose turn it is (userId), or null when anyone may move / it's over. */
export function whoseTurn(g: ChatGame): string | null {
  if (g.winner || g.type === "watch" || g.type === "rps" || g.type === "hangman" || isTeamGame(g)) return null;
  return g.players[g.turn] ?? null;
}

/** Where a watch-together video should be right now. */
export function watchPosition(g: WatchGame, now = Date.now()): number {
  return g.playing ? g.pos + Math.max(0, now - g.at) / 1000 : g.pos;
}
