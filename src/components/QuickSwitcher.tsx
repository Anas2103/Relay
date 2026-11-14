import { useEffect, useMemo, useRef, useState } from "react";
import type { Me, Room } from "../../shared/types";
import { RoomAvatar, roomTitle } from "./RoomAvatar";
import { SearchIcon } from "./ui";

/** Discord-style quick switcher (Ctrl/⌘+K): type a few letters, press Enter. */
export function QuickSwitcher({ rooms, me, onPick, onClose }: { rooms: Room[]; me: Me; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const scored = rooms
      .filter((r) => r.status === "accepted" || r.requestedBy !== me.id)
      .map((r) => {
        const title = roomTitle(r).toLowerCase();
        const user = r.peer?.username.toLowerCase() ?? "";
        const score = !s ? 1 : title.startsWith(s) || user.startsWith(s) ? 3 : title.includes(s) || user.includes(s) ? 2 : fuzzy(title, s) ? 1 : 0;
        return { r, score };
      })
      .filter((x) => x.score > 0);
    // With no query: unread first, then most recent (rooms are already newest first).
    scored.sort((a, b) => b.score - a.score || (s ? 0 : Number(b.r.unreadCount > 0) - Number(a.r.unreadCount > 0)));
    return scored.slice(0, 30).map((x) => x.r);
  }, [rooms, q, me.id]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  function choose(r: Room | undefined) {
    if (!r) return;
    onPick(r.id);
    onClose();
  }

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/50 px-3 pt-[max(4rem,12vh)] backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a chat"
        onClick={(e) => e.stopPropagation()}
        className="pop-in flex max-h-[70dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-zinc-900/10 dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="relative border-b border-zinc-200 dark:border-zinc-800">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-zinc-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[index]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Where do you want to go?"
            className="w-full bg-transparent py-4 pr-5 pl-13 text-base outline-none"
            aria-label="Search chats"
            role="combobox"
            aria-expanded="true"
            aria-controls="switcher-list"
          />
        </div>
        <ul id="switcher-list" ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === index}>
              <button
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(r)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === index ? "bg-accent/10 dark:bg-accent/20" : ""}`}
              >
                <RoomAvatar room={r} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{roomTitle(r)}</span>
                  {r.peer && !r.saved && <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">@{r.peer.username}</span>}
                </span>
                {r.unreadCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">{r.unreadCount}</span>
                )}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-10 text-center text-sm text-zinc-500">No chats match “{q}”.</li>}
        </ul>
        <div className="hidden items-center gap-4 border-t border-zinc-200 px-5 py-2.5 text-[11px] text-zinc-500 sm:flex dark:border-zinc-800 dark:text-zinc-400">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>Enter</Kbd> to open
          </span>
          <span>
            <Kbd>Alt</Kbd> + <Kbd>↑</Kbd>/<Kbd>↓</Kbd> next chat
          </span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-sans font-medium text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">{children}</kbd>;
}

/** Letters appear in order ("gmr" matches "Grimm"). */
function fuzzy(text: string, q: string): boolean {
  let i = 0;
  for (const c of text) if (c === q[i] && ++i === q.length) return true;
  return false;
}
