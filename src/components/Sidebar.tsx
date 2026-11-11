import { memo, useEffect, useState } from "react";
import type { Me, Room, User } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatListTime } from "../lib/format";
import { roomTitle, type PresenceMap } from "./ChatLayout";
import { Avatar, LogoutIcon, Logo, SearchIcon, SettingsIcon, ShieldIcon, Spinner, XIcon } from "./ui";

interface Props {
  me: Me;
  rooms: Room[];
  loaded: boolean;
  activeId: string | null;
  presence: PresenceMap;
  connected: boolean;
  onSelect: (id: string) => void;
  onOpenDm: (username: string) => Promise<void>;
  onLogout: () => void;
  onOpenAdmin?: () => void;
  onOpenSettings: () => void;
}

const iconButton =
  "rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

export function Sidebar({
  me,
  rooms,
  loaded,
  activeId,
  presence,
  connected,
  onSelect,
  onOpenDm,
  onLogout,
  onOpenAdmin,
  onOpenSettings,
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
          {!connected && loaded && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" role="status">
              <Spinner className="size-3" /> Connecting
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {onOpenAdmin && (
            <button onClick={onOpenAdmin} className={iconButton} title="Admin panel" aria-label="Admin panel">
              <ShieldIcon className="size-5" />
            </button>
          )}
          <button onClick={onOpenSettings} className={iconButton} title="Settings" aria-label="Settings">
            <SettingsIcon className="size-5" />
          </button>
          <button onClick={onLogout} className={iconButton} title="Sign out" aria-label="Sign out">
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
            className="w-full rounded-xl bg-zinc-100 py-2.5 pr-9 pl-9 text-sm outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800 dark:focus:bg-zinc-800"
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
          <SearchResults results={results} searching={searching} opening={opening} onPick={startChat} />
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
                <RoomItem
                  room={room}
                  meId={me.id}
                  active={room.id === activeId}
                  online={!!(room.peer && presence[room.peer.id]?.online)}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <footer className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
          title="Profile & settings"
        >
          <Avatar name={me.displayName} seed={me.id} size="sm" user={me} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.displayName}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{me.username}</p>
          </div>
        </button>
      </footer>
    </aside>
  );
}

const RoomItem = memo(function RoomItem({
  room,
  meId,
  active,
  online,
  onSelect,
}: {
  room: Room;
  meId: string;
  active: boolean;
  online: boolean;
  onSelect: (id: string) => void;
}) {
  const title = roomTitle(room);
  const last = room.lastMessage;
  const unread = room.unreadCount > 0 && !active;
  const preview = last ? `${last.userId === meId ? "You: " : ""}${last.preview}` : "No messages yet";
  return (
    <button
      onClick={() => onSelect(room.id)}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
        active ? "bg-accent/10 dark:bg-accent/20" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
      }`}
    >
      <Avatar name={title} seed={room.peer?.id ?? room.id} user={room.peer} online={online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{title}</p>
          {last && (
            <span
              className={`shrink-0 text-xs tabular-nums ${unread ? "font-semibold text-accent-fg" : "text-zinc-400"}`}
            >
              {formatListTime(last.createdAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-sm ${
              unread
                ? "font-medium text-zinc-800 dark:text-zinc-200"
                : last
                  ? "text-zinc-500 dark:text-zinc-400"
                  : "text-zinc-400 italic"
            }`}
          >
            {preview}
          </p>
          {unread && (
            <span
              className="pop-in flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink tabular-nums"
              aria-label={`${room.unreadCount} unread`}
            >
              {room.unreadCount > 99 ? "99+" : room.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

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
              <Avatar name={u.displayName} seed={u.id} user={u} />
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
