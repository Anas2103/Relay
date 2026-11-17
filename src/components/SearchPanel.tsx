import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GalleryTab, Message } from "../../shared/types";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { BackIcon, FileIcon, ImageIcon, SearchIcon, Spinner, VideoIcon, XIcon } from "./ui";

/** Search inside a conversation; tapping a result jumps to it, loading old history if needed. */
export function SearchPanel({
  roomId,
  meId,
  people,
  onClose,
  onPick,
}: {
  roomId: string;
  meId: string;
  /** Who can be picked in the "From" filter. */
  people: { id: string; name: string }[];
  onClose: () => void;
  onPick: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<GalleryTab | "all">("all");
  const [from, setFrom] = useState("");
  const [when, setWhen] = useState<keyof typeof WHEN>("any");
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim();
  const filtered = type !== "all" || from !== "";
  const active = !!q || filtered;

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!active) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const days = WHEN[when][1];
        const { messages } = await api.search(roomId, q, { type, from, since: days ? Date.now() - days * 86_400_000 : 0 });
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
  }, [q, roomId, type, from, when, active]);

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

      <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-zinc-200 px-3 py-2 md:px-4 dark:border-zinc-800">
        <FilterSelect label="Type" value={type} onChange={(v) => setType(v as GalleryTab | "all")} options={TYPES} />
        <FilterSelect
          label="From"
          value={from}
          onChange={setFrom}
          options={[["", "Anyone"], ...people.map((p): [string, string] => [p.id, p.id === meId ? "Me" : p.name])]}
        />
        <FilterSelect label="When" value={when} onChange={(v) => setWhen(v as keyof typeof WHEN)} options={Object.entries(WHEN).map(([k, [l]]) => [k, l])} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {!active ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Find any message in this chat, even ones from months ago. Use the filters to see only photos, files, links or voice messages, from one person or a
            time.
          </p>
        ) : loading && !results ? (
          <div className="flex justify-center py-12 text-zinc-400">
            <Spinner className="size-6" />
          </div>
        ) : results && results.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {q ? `No messages match “${q}”.` : "Nothing matches these filters."}
          </p>
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
                      {highlight(
                        m.kind === "file"
                          ? (m.meta?.name ?? "")
                          : m.kind === "voice"
                            ? `Voice message · ${Math.round(m.meta?.duration ?? 0)}s`
                            : m.body || (m.kind === "image" ? "Photo" : m.kind === "video" ? "Video" : ""),
                        q,
                      )}
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

const TYPES: [string, string][] = [
  ["all", "Everything"],
  ["media", "Photos & videos"],
  ["files", "Files"],
  ["links", "Links"],
  ["voice", "Voice messages"],
];

/** Label and how many days back. */
const WHEN = {
  any: ["Any time", 0],
  week: ["Past week", 7],
  month: ["Past month", 30],
  year: ["Past year", 365],
} as const;

/** A compact filter: looks like a chip, works as a native picker (great on phones). */
function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const on = value !== options[0][0];
  return (
    <label
      className={`relative flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
        on ? "bg-accent/15 text-accent-fg ring-accent/40" : "text-zinc-600 ring-zinc-200 dark:text-zinc-300 dark:ring-zinc-700"
      }`}
    >
      <span className="text-zinc-400">{label}:</span>
      {options.find(([v]) => v === value)?.[1] ?? options[0][1]}
      <span aria-hidden="true">▾</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
