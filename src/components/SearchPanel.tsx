import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Message } from "../../shared/types";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { BackIcon, FileIcon, ImageIcon, SearchIcon, Spinner, VideoIcon, XIcon } from "./ui";

/** Search inside a conversation; tapping a result jumps to it, loading old history if needed. */
export function SearchPanel({
  roomId,
  meId,
  onClose,
  onPick,
}: {
  roomId: string;
  meId: string;
  onClose: () => void;
  onPick: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const { messages } = await api.search(roomId, q);
        if (!cancelled) setResults(messages);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, roomId]);

  return (
    <div className="fade-in absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900" role="dialog" aria-label="Search messages">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-2 md:px-4 dark:border-zinc-800">
        <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close search">
          <BackIcon className="size-5" />
        </button>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, captions and files"
            aria-label="Search messages"
            className="w-full rounded-xl bg-zinc-100 py-2.5 pr-9 pl-9 text-sm outline-none focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Clear"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!q ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Find any message in this chat, even ones from months ago.
          </p>
        ) : loading && !results ? (
          <div className="flex justify-center py-12 text-zinc-400">
            <Spinner className="size-6" />
          </div>
        ) : results && results.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">No messages match “{q}”.</p>
        ) : (
          <ul className="mx-auto max-w-3xl divide-y divide-zinc-100 dark:divide-zinc-800">
            {results?.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => onPick(m.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                >
                  <span className="mt-0.5 shrink-0 text-zinc-400">
                    {m.kind === "file" ? (
                      <FileIcon className="size-4" />
                    ) : m.kind === "image" ? (
                      <ImageIcon className="size-4" />
                    ) : m.kind === "video" ? (
                      <VideoIcon className="size-4" />
                    ) : (
                      <SearchIcon className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{m.userId === meId ? "You" : m.displayName}</span>
                      <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{formatDateTime(m.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                      {highlight(m.kind === "file" ? (m.meta?.name ?? "") : m.body, q)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Wraps matches of `q` in <mark> (as React elements — never raw HTML). */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/40">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
