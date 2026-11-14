import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isMuted, MUTE_FOREVER, type Me, type Message, type Room, type SiteSettings, type User } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { useDrafts } from "../lib/drafts";
import { plainText } from "../lib/richText";
import { formatListTime } from "../lib/format";
import type { PresenceMap } from "./ChatLayout";
import { PopMenu, type MenuItem } from "./Dialogs";
import { RoomAvatar, roomTitle } from "./RoomAvatar";
import {
  ArchiveIcon,
  Avatar,
  BackIcon,
  BellIcon,
  BellOffIcon,
  BookmarkIcon,
  ChatIcon,
  LockIcon,
  Logo,
  MegaphoneIcon,
  PencilIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  Spinner,
  TrashIcon,
  UsersIcon,
  XIcon,
} from "./ui";

export interface ChatActions {
  onPrefs: (room: Room, patch: { pinned?: boolean; archived?: boolean; mutedUntil?: number | null }) => void;
  onDelete: (room: Room) => void;
}

interface Props extends ChatActions {
  me: Me;
  rooms: Room[];
  loaded: boolean;
  activeId: string | null;
  presence: PresenceMap;
  connected: boolean;
  site: SiteSettings | null;
  onSelect: (id: string) => void;
  /** Open a chat at a specific message (search everywhere). */
  onJump: (roomId: string, messageId: string) => void;
  onOpenDm: (username: string) => Promise<void>;
  onOpenSaved: () => void;
  onNewGroup: () => void;
  onOpenAdmin?: () => void;
  onOpenSettings: () => void;
  /** A minimized call, shown in the header when no chat is open. */
  callPill?: ReactNode;
}

type Folder = "all" | "unread" | "personal" | "groups" | "secret";

const iconButton =
  "rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

const MUTE_OPTIONS: [string, number][] = [
  ["For 1 hour", 60 * 60 * 1000],
  ["For 8 hours", 8 * 60 * 60 * 1000],
  ["For 1 day", 24 * 60 * 60 * 1000],
  ["For 1 week", 7 * 24 * 60 * 60 * 1000],
];

function isIncomingRequest(r: Room, meId: string) {
  return r.status === "pending" && r.requestedBy !== meId && !r.secret;
}

/** Pinned chats first, then most recent activity. */
function byListOrder(a: Room, b: Room) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return (b.lastMessage?.createdAt ?? b.createdAt) - (a.lastMessage?.createdAt ?? a.createdAt);
}

export function Sidebar({
  me,
  rooms,
  loaded,
  activeId,
  presence,
  connected,
  site,
  onSelect,
  onOpenDm,
  onOpenSaved,
  onNewGroup,
  onOpenAdmin,
  onOpenSettings,
  onPrefs,
  onDelete,
  callPill,
  onJump,
}: Props) {
  const [showRequests, setShowRequests] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [messageHits, setMessageHits] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<Folder>("all");
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; title?: string; items: MenuItem[] } | null>(null);
  const [hiddenBanner, setHiddenBanner] = useState(() => {
    try {
      return Number(localStorage.getItem("relay:banner-dismissed")) || 0;
    } catch {
      return 0;
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const s = me.settings;
  const drafts = useDrafts();

  const requests = rooms.filter((r) => isIncomingRequest(r, me.id));
  const visible = rooms.filter((r) => !isIncomingRequest(r, me.id));
  const archived = visible.filter((r) => r.archived).sort(byListOrder);
  const main = visible.filter((r) => !r.archived).sort(byListOrder);
  const hasSecret = main.some((r) => r.secret);
  const unreadCount = main.filter((r) => r.unreadCount > 0).length;

  const folderRooms = useMemo(() => {
    switch (folder) {
      case "unread":
        return main.filter((r) => r.unreadCount > 0);
      case "personal":
        return main.filter((r) => r.type === "dm");
      case "groups":
        return main.filter((r) => r.type === "group");
      case "secret":
        return main.filter((r) => r.secret);
      default:
        return main;
    }
  }, [folder, main]);
  const listed = showArchive ? archived : folderRooms;

  const q = query.trim();
  const chatMatches = q ? visible.filter((r) => roomTitle(r).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const onlineNow = main.filter((r) => r.status === "accepted" && !r.secret && r.peer && presence[r.peer.id]?.online);
  const banner = site?.announcement && site.announcement.createdAt !== hiddenBanner ? site.announcement : null;

  // Ctrl/Cmd+K jumps to the search box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Messages in all your chats (never secret chats, which the server can't read).
  useEffect(() => {
    if (q.length < 2) return setMessageHits([]);
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      api.searchEverywhere(q, ctrl.signal).then(
        (r) => setMessageHits(r.messages),
        () => {},
      );
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [q]);

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

  function clearSearch() {
    setQuery("");
    setResults([]);
  }

  /** Right-click / long-press menu for a chat. */
  function openChatMenu(room: Room, at: { x: number; y: number }) {
    const muted = isMuted(room);
    const items: MenuItem[] = [];
    if (!room.archived) {
      items.push({
        icon: <PinIcon />,
        label: room.pinned ? "Unpin" : "Pin to top",
        onClick: () => onPrefs(room, { pinned: !room.pinned }),
      });
    }
    if (!room.saved) {
      items.push({
        icon: muted ? <BellIcon /> : <BellOffIcon />,
        label: muted ? "Unmute" : "Mute…",
        onClick: () =>
          muted
            ? onPrefs(room, { mutedUntil: null })
            : setMenu({
                at,
                title: `Mute ${roomTitle(room)}`,
                items: [
                  ...MUTE_OPTIONS.map(([label, ms]) => ({ label, onClick: () => onPrefs(room, { mutedUntil: Date.now() + ms }) })),
                  { label: "Until I turn it back on", onClick: () => onPrefs(room, { mutedUntil: MUTE_FOREVER }) },
                ],
              }),
      });
    }
    items.push({
      icon: <ArchiveIcon />,
      label: room.archived ? "Unarchive" : "Archive",
      onClick: () => onPrefs(room, { archived: !room.archived }),
    });
    if (room.status === "accepted") {
      items.push({
        icon: <TrashIcon />,
        label: room.type === "group" ? (room.role === "admin" ? "Delete group" : "Leave group") : room.secret ? "End secret chat" : "Delete chat",
        danger: true,
        onClick: () => onDelete(room),
      });
    }
    setMenu({ at, title: roomTitle(room), items });
  }

  const folders: [Folder, string, number?][] = [
    ["all", "All"],
    ["unread", "Unread", unreadCount],
    ["personal", "Personal"],
    ["groups", "Groups"],
    ...(hasSecret ? ([["secret", "Secret"]] as [Folder, string][]) : []),
  ];

  return (
    <aside className="safe-top flex h-full flex-col bg-white dark:bg-zinc-900">
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 md:px-4 md:pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo size={28} />
          <span className="text-lg font-semibold tracking-tight">Relay</span>
          {!connected && loaded && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" role="status">
              <Spinner className="size-3" /> Connecting
            </span>
          )}
        </div>
        {callPill}
        <div className={`flex items-center ${callPill ? "max-sm:hidden" : ""}`}>
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({
                at: { x: r.left - 180, y: r.bottom + 6 },
                items: [
                  { icon: <UsersIcon />, label: "New group", hint: "Chat with several friends", onClick: onNewGroup },
                  { icon: <BookmarkIcon />, label: "Saved Messages", hint: "Notes, links and files for yourself", onClick: onOpenSaved },
                  { icon: <SearchIcon />, label: "Find a friend", hint: "Search by username", onClick: () => searchRef.current?.focus() },
                ],
              });
            }}
            className={iconButton}
            title="New chat"
            aria-label="New chat"
          >
            <PencilIcon className="size-5" />
          </button>
          {onOpenAdmin && (
            <button onClick={onOpenAdmin} className={iconButton} title="Admin panel" aria-label="Admin panel">
              <ShieldIcon className="size-5" />
            </button>
          )}
          <button onClick={onOpenSettings} className={iconButton} title="Settings" aria-label="Settings">
            <SettingsIcon className="size-5" />
          </button>
        </div>
      </header>

      {banner && (
        <div className="fade-in mx-3 mb-2 flex items-start gap-2.5 rounded-xl bg-accent/10 px-3 py-2.5 text-sm md:mx-4" role="status">
          <MegaphoneIcon className="mt-0.5 size-4 shrink-0 text-accent-fg" />
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{banner.text}</p>
          <button
            onClick={() => {
              setHiddenBanner(banner.createdAt);
              try {
                localStorage.setItem("relay:banner-dismissed", String(banner.createdAt));
              } catch {
                // fine
              }
            }}
            className="-m-1.5 shrink-0 rounded-full p-1.5 text-zinc-500 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
            aria-label="Dismiss announcement"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      <div className="px-3 pb-2 md:px-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                clearSearch();
                e.currentTarget.blur();
              }
            }}
            title="Search (Ctrl+K)"
            placeholder="Search chats and people"
            aria-label="Search chats and people"
            className="w-full rounded-full bg-zinc-100 py-2.5 pr-10 pl-10 text-sm outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800 dark:focus:bg-zinc-800"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Clear search"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {!q && !showArchive && loaded && main.length > 0 && (
        <div className="no-scrollbar fade-x flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-2 md:px-4" role="tablist" aria-label="Chat folders">
          {folders.map(([f, label, count]) => (
            <button
              key={f}
              role="tab"
              aria-selected={folder === f}
              onClick={() => setFolder(f)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                folder === f
                  ? "bg-accent text-accent-ink"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
              {count ? <span className="ml-1 opacity-80">{count}</span> : null}
            </button>
          ))}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {q ? (
          <>
            {chatMatches.length > 0 && (
              <>
                <p className="px-3 pt-1 pb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">Chats</p>
                <ul className="mb-2 space-y-0.5">
                  {chatMatches.map((room) => (
                    <li key={room.id}>
                      <RoomItem
                        room={room}
                        meId={me.id}
                        active={room.id === activeId}
                        online={!!(room.peer && presence[room.peer.id]?.online)}
                        previews={s.listPreviews}
                        draft={drafts[room.id]}
                        onSelect={(id) => {
                          clearSearch();
                          onSelect(id);
                        }}
                        onMenu={openChatMenu}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <SearchResults results={results} searching={searching} opening={opening} onPick={startChat} />
            {messageHits.length > 0 && (
              <>
                <p className="px-3 pt-3 pb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">Messages</p>
                <ul className="space-y-0.5">
                  {messageHits.map((m) => {
                    const room = rooms.find((r) => r.id === m.roomId);
                    if (!room) return null;
                    return (
                      <li key={m.id}>
                        <button
                          onClick={() => {
                            clearSearch();
                            onJump(m.roomId, m.id);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
                        >
                          <RoomAvatar room={room} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium">{roomTitle(room)}</span>
                              <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{formatListTime(m.createdAt)}</span>
                            </span>
                            <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                              {room.type === "group" ? `${m.userId === me.id ? "You" : m.displayName}: ` : m.userId === me.id ? "You: " : ""}
                              <Highlight text={plainText(m.body)} q={q} />
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        ) : !loaded ? (
          <RoomSkeleton />
        ) : showArchive ? (
          <>
            <button
              onClick={() => setShowArchive(false)}
              className="mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
            >
              <BackIcon className="size-4" /> Archived chats
            </button>
            <RoomList rooms={listed} me={me} activeId={activeId} presence={presence} onSelect={onSelect} onMenu={openChatMenu} empty="No archived chats." />
          </>
        ) : rooms.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent-fg">
              <ChatIcon className="size-7" />
            </span>
            <p className="mt-4 font-medium">No conversations yet</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Search for a friend's username above to send a friend request.</p>
            <button onClick={onOpenSaved} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent/10 px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/15">
              <BookmarkIcon className="size-4" /> Open Saved Messages
            </button>
          </div>
        ) : (
          <>
            {s.showOnlineRow && onlineNow.length > 0 && folder === "all" && (
              <div className="mb-2 px-2">
                <p className="mb-1.5 px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Online now</p>
                <ul className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                  {onlineNow.map((room) => (
                    <li key={room.id}>
                      <button
                        onClick={() => onSelect(room.id)}
                        title={`Open chat with ${roomTitle(room)}`}
                        className="flex w-14 flex-col items-center gap-1 rounded-xl py-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
                      >
                        <Avatar name={roomTitle(room)} seed={room.peer!.id} user={room.peer} online />
                        <span className="w-full truncate text-center text-[11px] text-zinc-600 dark:text-zinc-300">{roomTitle(room).split(" ")[0]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {folder === "all" && archived.length > 0 && (
              <button
                onClick={() => setShowArchive(true)}
                className="row-pad flex w-full items-center gap-3 rounded-xl px-3 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
              >
                <span className="avatar-shape flex size-10 items-center justify-center bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <ArchiveIcon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Archived chats</span>
                  <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">{archived.map(roomTitle).join(", ")}</span>
                </span>
                {archived.some((r) => r.unreadCount > 0) && <span className="size-2.5 rounded-full bg-zinc-400" aria-label="Unread" />}
              </button>
            )}
            {requests.length > 0 && folder === "all" && (
              <div className="mb-1">
                <button
                  onClick={() => setShowRequests((v) => !v)}
                  aria-expanded={showRequests}
                  className="row-pad flex w-full items-center gap-3 rounded-xl px-3 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
                >
                  <span className="avatar-shape flex size-10 items-center justify-center bg-accent/15 text-accent-fg">
                    <ChatIcon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">Friend requests</span>
                    <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                      {requests.length} {requests.length === 1 ? "person wants" : "people want"} to connect
                    </span>
                  </span>
                  <span className="pop-in flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">
                    {requests.length}
                  </span>
                </button>
                {showRequests && (
                  <ul className="fade-in mt-0.5 space-y-0.5 border-l-2 border-accent/30 pl-2">
                    {requests.map((room) => (
                      <li key={room.id}>
                        <RoomItem room={room} meId={me.id} active={room.id === activeId} online={false} previews onSelect={onSelect} onMenu={openChatMenu} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <RoomList
              rooms={listed}
              me={me}
              activeId={activeId}
              presence={presence}
              onSelect={onSelect}
              onMenu={openChatMenu}
              empty={
                folder === "unread"
                  ? "You're all caught up ✨"
                  : folder === "groups"
                    ? "No groups yet. Tap the pencil to make one."
                    : "Nothing here yet."
              }
            />
          </>
        )}
      </nav>

      <footer className="divider-t px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
          title="Profile & settings"
        >
          <Avatar name={me.displayName} seed={me.id} size="sm" user={me} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.displayName}</p>
            <p className="flex items-center gap-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {s.presence !== "online" && (
                <span className={`size-2 shrink-0 rounded-full ${s.presence === "dnd" ? "bg-red-500" : "bg-zinc-400 ring-2 ring-inset ring-zinc-200 dark:ring-zinc-700"}`} aria-hidden="true" />
              )}
              <span className="truncate">{me.statusText || (s.presence === "dnd" ? "Do not disturb" : s.presence === "invisible" ? "Invisible" : `@${me.username}`)}</span>
            </p>
          </div>
          {me.superAdmin ? (
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 uppercase dark:bg-amber-900/50 dark:text-amber-300">Owner</span>
          ) : me.role === "admin" ? (
            <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg uppercase">Admin</span>
          ) : null}
        </button>
      </footer>

      {menu && <PopMenu at={menu.at} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

function RoomList({
  rooms,
  me,
  activeId,
  presence,
  onSelect,
  onMenu,
  empty,
}: {
  rooms: Room[];
  me: Me;
  activeId: string | null;
  presence: PresenceMap;
  onSelect: (id: string) => void;
  onMenu: (room: Room, at: { x: number; y: number }) => void;
  empty: string;
}) {
  const drafts = useDrafts();
  if (rooms.length === 0) return <p className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {rooms.map((room) => (
        <li key={room.id}>
          <RoomItem
            room={room}
            meId={me.id}
            active={room.id === activeId}
            online={!!(room.peer && !room.secret && presence[room.peer.id]?.online)}
            previews={me.settings.listPreviews}
            draft={drafts[room.id]}
            onSelect={onSelect}
            onMenu={onMenu}
          />
        </li>
      ))}
    </ul>
  );
}

const LONG_PRESS_MS = 450;

const RoomItem = memo(function RoomItem({
  room,
  meId,
  active,
  online,
  previews,
  draft,
  onSelect,
  onMenu,
}: {
  room: Room;
  meId: string;
  active: boolean;
  online: boolean;
  previews: boolean;
  draft?: string;
  onSelect: (id: string) => void;
  onMenu: (room: Room, at: { x: number; y: number }) => void;
}) {
  const press = useRef<{ timer: number; fired: boolean }>({ timer: 0, fired: false });
  const title = roomTitle(room);
  const last = room.lastMessage;
  const muted = isMuted(room);
  const unread = room.unreadCount > 0 && !active;
  const preview =
    room.status === "pending"
      ? room.secret
        ? room.requestedBy === meId
          ? "Waiting for them to join the secret chat"
          : "🔒 Invited you to a secret chat"
        : room.requestedBy === meId
          ? "Request sent · waiting for them to accept"
          : "Sent you a friend request"
      : last
        ? `${last.userId === meId && !room.saved ? "You: " : ""}${plainText(last.preview)}`
        : room.saved
          ? "Save messages, links and files here"
          : room.secret
            ? "End-to-end encrypted"
            : "No messages yet";

  return (
    <button
      onClick={() => {
        if (press.current.fired) {
          press.current.fired = false;
          return;
        }
        onSelect(room.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(room, { x: e.clientX, y: e.clientY });
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        press.current.fired = false;
        press.current.timer = window.setTimeout(() => {
          press.current.fired = true;
          navigator.vibrate?.(10);
          onMenu(room, { x: t.clientX, y: t.clientY });
        }, LONG_PRESS_MS);
      }}
      onTouchEnd={() => window.clearTimeout(press.current.timer)}
      onTouchMove={() => window.clearTimeout(press.current.timer)}
      aria-current={active ? "page" : undefined}
      className={`no-callout row-pad flex w-full items-center gap-3 rounded-xl px-3 text-left transition-colors ${
        active ? "bg-accent/10 dark:bg-accent/20" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
      }`}
    >
      <RoomAvatar room={room} online={online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={`flex min-w-0 items-center gap-1 truncate text-sm ${unread ? "font-semibold" : "font-medium"} ${
              room.secret ? "text-emerald-700 dark:text-emerald-400" : ""
            }`}
          >
            {room.secret && <LockIcon className="size-3.5 shrink-0" />}
            {room.type === "group" && <UsersIcon className="size-3.5 shrink-0 text-zinc-400" />}
            <span className="truncate">{title}</span>
            {muted && <BellOffIcon className="size-3.5 shrink-0 text-zinc-400" aria-label="Muted" />}
          </p>
          {last && (
            <span className={`shrink-0 text-xs tabular-nums ${unread && !muted ? "font-semibold text-accent-fg" : "text-zinc-400"}`}>
              {formatListTime(last.createdAt)}
            </span>
          )}
        </div>
        {previews && (
          <div className="flex items-center gap-2">
            <p
              className={`min-w-0 flex-1 truncate text-sm ${
                unread ? "font-medium text-zinc-800 dark:text-zinc-200" : last ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400 italic"
              }`}
            >
              {draft && !active && room.status === "accepted" ? (
                <>
                  <span className="font-medium text-red-600 dark:text-red-400">Draft: </span>
                  {draft.replace(/\s+/g, " ")}
                </>
              ) : (
                preview
              )}
            </p>
            {room.mentions > 0 && !active && (
              <span className="pop-in flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-accent-ink" aria-label={`${room.mentions} mentions`} title="You were mentioned">
                @
              </span>
            )}
            {unread ? (
              <span
                className={`pop-in flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                  muted ? "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" : "bg-accent text-accent-ink"
                }`}
                aria-label={`${room.unreadCount} unread`}
              >
                {room.unreadCount > 99 ? "99+" : room.unreadCount}
              </span>
            ) : (
              room.pinned && <PinIcon className="size-3.5 shrink-0 rotate-45 text-zinc-400" aria-label="Pinned" />
            )}
          </div>
        )}
      </div>
      {!previews && unread && (
        <span className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${muted ? "bg-zinc-300 dark:bg-zinc-700" : "bg-accent text-accent-ink"}`}>
          {room.unreadCount > 99 ? "99+" : room.unreadCount}
        </span>
      )}
    </button>
  );
});

/** Shows the part of a message around the search term, with the term in bold. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  const start = Math.max(0, i - 20);
  return (
    <>
      {start > 0 ? "…" : ""}
      {text.slice(start, i)}
      <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{text.slice(i, i + q.length)}</strong>
      {text.slice(i + q.length)}
    </>
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
  return (
    <>
      <p className="px-3 pt-1 pb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">People</p>
      {searching && results.length === 0 ? (
        <div className="flex justify-center py-8 text-zinc-400">
          <Spinner className="size-5" />
        </div>
      ) : results.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No users found.</p>
      ) : (
        <ul className="space-y-0.5">
          {results.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => onPick(u)}
                disabled={opening !== null}
                className="row-pad flex w-full items-center gap-3 rounded-xl px-3 text-left transition hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800/70"
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
      )}
    </>
  );
}

function RoomSkeleton() {
  return (
    <ul className="space-y-1 px-1" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2.5">
          <span className="avatar-shape size-10 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <span className="block h-3 w-3/4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
          </span>
        </li>
      ))}
    </ul>
  );
}
