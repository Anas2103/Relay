import type { ReactNode } from "react";
import { BackIcon } from "../ui";

/**
 * The frame around every game: back button and title on one line, scores and
 * "New" on the next when the screen is narrow, the board centred and sized to
 * fit the screen (wide boards never push the buttons off a phone).
 */
export function GameShell({
  title,
  onExit,
  stats,
  onRestart,
  hint,
  wide,
  children,
}: {
  title: string;
  onExit: () => void;
  stats?: [string, string | number][];
  onRestart?: () => void;
  hint?: string;
  /** Let the game use more width (word games, puzzles with text). */
  wide?: boolean;
  children: ReactNode;
}) {
  const width = wide ? "max-w-xl" : "max-w-md";
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 pb-4">
      <div className={`mx-auto flex w-full ${width} flex-wrap items-center gap-x-2 gap-y-1.5 py-2`}>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button onClick={onExit} aria-label="Back to games" className="shrink-0 rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10">
            <BackIcon className="size-5" />
          </button>
          <h3 className="truncate text-lg font-semibold">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {stats?.map(([label, value]) => (
            <span key={label} className="min-w-12 rounded-xl bg-black/5 px-2.5 py-1 text-center dark:bg-white/10">
              <span className="block text-[10px] leading-tight font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{label}</span>
              <span className="block text-sm leading-tight font-bold tabular-nums">{value}</span>
            </span>
          ))}
          {onRestart && (
            <button onClick={onRestart} className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-accent-ink hover:opacity-90">
              New
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center py-2">
        <div className={`mx-auto w-full ${width}`}>{children}</div>
        {hint && <p className={`mx-auto mt-3 w-full ${width} text-center text-xs text-zinc-500 dark:text-zinc-400`}>{hint}</p>}
      </div>
    </div>
  );
}

/**
 * A square board that fits the screen both ways: as wide as it can be, but never
 * taller than the space under the header (so nothing scrolls off on a laptop).
 */
export const BOARD = "mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-15rem))]";

/** The "you won / game over" layer over a board. */
export function Overlay({ title, detail, action, onAction }: { title: string; detail?: ReactNode; action: string; onAction: () => void }) {
  return (
    <div className="pop-in absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-black/60 p-4 text-center text-white backdrop-blur-[2px]">
      <p className="text-2xl font-bold">{title}</p>
      {detail && <div className="text-sm text-white/85">{detail}</div>}
      <button onClick={onAction} className="mt-2 rounded-full bg-white px-5 py-2 font-semibold text-zinc-900 hover:bg-white/90">
        {action}
      </button>
    </div>
  );
}
