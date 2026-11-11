import { useEffect, useState } from "react";
import type { Room, User } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatListTime } from "../lib/format";
import { roomTitle } from "./ChatLayout";
import { Avatar, LogoutIcon, Logo, SearchIcon, SettingsIcon, ShieldIcon, Spinner, XIcon } from "./ui";

interface Props {
  me: User;
  rooms: Room[];
  loaded: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenDm: (username: string) => Promise<void>;
  onLogout: () => void;
  onOpenAdmin?: () => void;
  onOpenAccount: () => void;
}

export function Sidebar({
  me,
  rooms,
  loaded,
  activeId,
  onSelect,
  onOpenDm,
  onLogout,
  onOpenAdmin,
  onOpenAccount,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim();

  // Debounced user search.
  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const { users } = await api.searchUsers(q);
        if (!cancelled) setResults(users);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q]);

  async function startChat(user: User) {
    setOpening(user.id);
    setError(null);
    try {
      await onOpenDm(user.username);
      setQuery("");
      setResults([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't open that chat.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <aside className="flex h-full flex-col bg-white dark:bg-zinc-900">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="text-lg font-semibold tracking-tight">Relay</span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenAdmin && (
            <button
              onClick={onOpenAdmin}
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-indigo-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
              title="Admin panel"
              aria-label="Admin panel"
            >
              <ShieldIcon className="size-5" />
            </button>
          )}
          <button
            onClick={onLogout}
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogoutIcon className="size-5" />
          </button>
        </div>
      </header>

      <div className="px-4 pb-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a friend by username"
            aria-label="Search users"
            className="w-full rounded-xl bg-zinc-100 py-2.5 pr-9 pl-9 text-sm outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/40 dark:bg-zinc-800 dark:focus:bg-zinc-800"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setResults([]);
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Clear search"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {q ? (
          <SearchResults
            results={results}
            searching={searching}
            opening={opening}
            onPick={startChat}
          />
        ) : !loaded ? (
          <RoomSkeleton />
        ) : rooms.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No conversations yet.
            <br />
            Search for a friend above to say hi.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rooms.map((room) => (
              <li key={room.id}>
                <RoomItem room={room} me={me} active={room.id === activeId} onClick={() => onSelect(room.id)} />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <footer className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <button
          onClick={onOpenAccount}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
          title="Account settings"
        >
          <Avatar name={me.displayName} seed={me.id} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.displayName}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{me.username}</p>
          </div>
          <SettingsIcon className="size-4.5 shrink-0 text-zinc-400" />
        </button>
      </footer>
    </aside>
  );
}

function RoomItem({ room, me, active, onClick }: { room: Room; me: User; active: boolean; onClick: () => void }) {
  const title = roomTitle(room);
  const last = room.lastMessage;
  const preview = last ? `${last.userId === me.id ? "You: " : ""}${last.body}` : "No messages yet";
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
      }`}
    >
      <Avatar name={title} seed={room.peer?.id ?? room.id} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          {last && (
            <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{formatListTime(last.createdAt)}</span>
          )}
        </div>
        <p className={`truncate text-sm ${last ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400 italic"}`}>
          {preview}
        </p>
      </div>
    </button>
  );
}

function SearchResults({
  results,
  searching,
  opening,
  onPick,
}: {
  results: User[];
  searching: boolean;
  opening: string | null;
  onPick: (u: User) => void;
}) {
  if (searching && results.length === 0) {
    return (
      <div className="flex justify-center py-8 text-zinc-400">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (results.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No users found.</p>;
  }
  return (
    <>
      <p className="px-3 pt-1 pb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">People</p>
      <ul className="space-y-0.5">
        {results.map((u) => (
          <li key={u.id}>
            <button
              onClick={() => onPick(u)}
              disabled={opening !== null}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800/70"
            >
              <Avatar name={u.displayName} seed={u.id} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.displayName}</p>
                <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">@{u.username}</p>
              </div>
              {opening === u.id && <Spinner className="size-4 text-zinc-400" />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function RoomSkeleton() {
  return (
    <ul className="space-y-1 px-1" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2.5">
          <span className="size-10 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <span className="block h-3 w-3/4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
          </span>
        </li>
      ))}
    </ul>
  );
}
