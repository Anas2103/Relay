import { useSyncExternalStore } from "react";

/** Best scores for the Chill games, saved on this device. */

export type GameId =
  | "2048" | "snake" | "mines" | "memory" | "trivia" | "reaction" | "typing"
  | "wordguess" | "sudoku" | "blocks" | "bricks" | "skyhop" | "slide" | "echo" | "hangman" | "math";

const KEY = "relay:scores";
/** For these, lower is better (a time). */
const LOWER_IS_BETTER: GameId[] = ["mines", "memory", "reaction", "sudoku", "slide"];

function load(): Partial<Record<GameId, number>> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

let best = load();
const listeners = new Set<() => void>();

/** Saves `score` if it beats the best; returns true when it's a new record. */
export function submitScore(game: GameId, score: number): boolean {
  const old = best[game];
  const better = old === undefined || (LOWER_IS_BETTER.includes(game) ? score < old : score > old);
  if (!better) return false;
  best = { ...best, [game]: score };
  try {
    localStorage.setItem(KEY, JSON.stringify(best));
  } catch {
    // private mode
  }
  listeners.forEach((fn) => fn());
  return true;
}

export function useBest(): Partial<Record<GameId, number>> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => best,
  );
}

/** Swipe direction from a touch gesture (for 2048 and Snake on phones). */
export function swipeDir(dx: number, dy: number): "left" | "right" | "up" | "down" | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

export const KEY_DIRS: Record<string, "left" | "right" | "up" | "down"> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
};
