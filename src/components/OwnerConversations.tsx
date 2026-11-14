import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { callLabel, formatBytes, isEncrypted, type AdminRoom, type Message } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatDayDivider, formatListTime, formatRelative, formatTime, sameDay } from "../lib/format";
import { AlertIcon, Avatar, BackIcon, DownloadIcon, EyeIcon, FileIcon, LockIcon, OnceIcon, PhoneIcon, SearchIcon, Spinner, VideoIcon } from "./ui";

type Member = AdminRoom["members"][number];

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong.");

/** Members in a stable order, so the same person is always on the same side. */
function sortedMembers(room: AdminRoom): Member[] {
  return [...room.members].sort((a, b) => a.username.localeCompare(b.username));
}

function roomName(room: AdminRoom): string {
  if (room.type === "group") return room.name ?? "Group";
  const names = sortedMembers(room).map((m) => m.displayName);
  return names.length ? names.join(" & ") : "Deleted users";
}

/**
 * Owner-only (Grimm): browse every conversation, read-only. Opening a conversation
 * is written to the audit log by the server. View-once media is never shown.
 */
export function OwnerConversations() {
  const [query, setQuery] = useState("");
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(
      () =>
        api.admin
          .rooms(query.trim())
          .then((r) => {
            setRooms(r.rooms);
            setError(null);
          })
          .catch((e) => setError(errorMessage(e))),
      query ? 250 : 0,
    );
    return () => window.clearTimeout(t);
  }, [query]);

  const open = rooms?.find((r) => r.id === openId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* List */}
      <aside
        className={`w-full shrink-0 flex-col border-r border-zinc-200 bg-white md:flex md:w-80 lg:w-96 dark:border-zinc-800 dark:bg-zinc-900 ${
          open ? "hidden" : "flex"
        }`}
      >
        <div className="p-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find by person"
              aria-label="Find conversations by person"
              className="w-full rounded-xl bg-zinc-100 py-2.5 pr-3 pl-9 text-sm outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800 dark:focus:bg-zinc-900"
            />
          </div>
          <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-zinc-500 dark:text-zinc-400">
            <EyeIcon className="size-3.5" />
            Opening a conversation is recorded in the audit log.
          </p>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="All conversations">
          {error ? (
            <p className="m-2 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              <AlertIcon className="size-4 shrink-0" />
              {error}
            </p>
          ) : !rooms ? (
            <div className="flex justify-center py-12 text-zinc-400">
              <Spinner className="size-5" />
            </div>
          ) : rooms.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">No conversations found.</p>
          ) : (
            <ul className="space-y-0.5">
              {rooms.map((r) => {
                const [a, b] = sortedMembers(r);
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setOpenId(r.id)}
                      aria-current={r.id === openId ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        r.id === openId ? "bg-accent/10" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
                      }`}
                    >
                      {/* Two people: small avatars that only overlap at the corner, so both stay readable */}
                      <span className="relative size-10 shrink-0">
                        {a && (
                          <span className="absolute top-0 left-0">
                            <Avatar name={a.displayName} seed={a.id} user={a} size={b ? "xs" : "md"} />
                          </span>
                        )}
                        {b && (
                          <span className="avatar-shape absolute right-0 bottom-0 flex ring-2 ring-white dark:ring-zinc-900">
                            <Avatar name={b.displayName} seed={b.id} user={b} size="xs" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`flex min-w-0 items-center gap-1 truncate text-sm font-semibold ${r.secret ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                            {r.secret && <LockIcon className="size-3.5 shrink-0" />}
                            <span className="truncate">{r.secret ? `Secret: ${roomName(r)}` : r.type === "group" ? `👥 ${roomName(r)}` : roomName(r)}</span>
                          </span>
                          <span className="shrink-0 text-xs text-zinc-400">{formatListTime(r.lastActivity)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                            {r.status === "pending" ? "Message request (not accepted)" : (r.lastPreview ?? "No messages")}
                          </span>
                          <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums">{r.messageCount.toLocaleString()}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      {/* Viewer */}
      <section className={`min-w-0 flex-1 flex-col bg-zinc-50 dark:bg-zinc-950 ${open ? "flex" : "hidden md:flex"}`}>
        {open ? (
          <ConversationViewer key={open.id} room={open} onBack={() => setOpenId(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              <EyeIcon className="size-7" />
            </div>
            <h2 className="mt-4 font-semibold">Conversations</h2>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Pick a conversation to review it. It's read-only: nothing you do here is visible to its members, and
              view-once media stays sealed.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationViewer({ room, onBack }: { room: AdminRoom; onBack: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  /** Keeps the view still when older messages are added above. */
  const keepFromBottom = useRef<number | null>(null);

  const members = useMemo(() => sortedMembers(room), [room]);
  const leftId = members[0]?.id;

  useEffect(() => {
    api.admin
      .roomMessages(room.id)
      .then((r) => {
        setMessages(r.messages);
        setHasMore(r.hasMore);
        keepFromBottom.current = 0;
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [room.id]);

  const loadOlder = useCallback(async () => {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroller.current;
    try {
      const r = await api.admin.roomMessages(room.id, { createdAt: first.createdAt, id: first.id });
      keepFromBottom.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((prev) => [...r.messages, ...prev]);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, loadingOlder, room.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || keepFromBottom.current === null) return;
    el.scrollTop = el.scrollHeight - keepFromBottom.current;
    keepFromBottom.current = null;
  }, [messages]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? messages.filter((m) => m.body.toLowerCase().includes(q) || (m.meta?.name ?? "").toLowerCase().includes(q))
    : messages;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-3 py-2.5 md:px-4 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
          aria-label="Back to conversations"
        >
          <BackIcon className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{roomName(room)}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {members.map((m) => `@${m.username}`).join(" · ")} · {room.messageCount.toLocaleString()} messages · started{" "}
            {formatRelative(room.createdAt)}
          </p>
        </div>
        <div className="relative hidden w-48 sm:block">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter loaded messages"
            aria-label="Filter loaded messages"
            className="w-full rounded-lg bg-zinc-100 py-1.5 pr-2 pl-8 text-sm outline-none focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800"
          />
        </div>
      </header>

      <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <EyeIcon className="size-3.5 shrink-0" />
        Read-only. This visit has been recorded in the audit log.
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        {loading ? (
          <div className="flex justify-center py-16 text-zinc-400">
            <Spinner className="size-6" />
          </div>
        ) : error ? (
          <p className="mx-auto flex max-w-md items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <AlertIcon className="size-4 shrink-0" />
            {error}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-500">
            {room.status === "pending" ? "A message request that hasn't been accepted. No messages." : "No messages."}
          </p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-1">
            {hasMore && !q && (
              <div className="flex justify-center pb-3">
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-medium shadow-sm ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:opacity-60 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:bg-zinc-800"
                >
                  {loadingOlder && <Spinner className="size-3.5" />}
                  Load older messages
                </button>
              </div>
            )}
            {q && shown.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">No loaded messages match.</p>}
            {shown.map((m, i) => {
              const prev = shown[i - 1];
              const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
              const grouped = !newDay && prev.userId === m.userId && m.createdAt - prev.createdAt < 5 * 60_000;
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="flex justify-center py-3">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-500 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
                        {formatDayDivider(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <ReadOnlyBubble message={m} roomId={room.id} right={m.userId !== leftId} showName={!grouped} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ReadOnlyBubble({ message: m, roomId, right, showName }: { message: Message; roomId: string; right: boolean; showName: boolean }) {
  const src = m.mediaId ? api.admin.mediaUrl(roomId, m.id) : null;
  const reactions = Object.values(m.reactions);
  const bubble = right
    ? "bg-accent text-accent-ink"
    : "bg-white text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800";

  let content: ReactNode;
  if (m.deletedAt) {
    content = <p className="italic opacity-70">Message deleted</p>;
  } else if (isEncrypted(m.body)) {
    content = (
      <p className="flex items-center gap-2 italic opacity-80">
        <LockIcon className="size-4" /> End-to-end encrypted (unreadable by design)
      </p>
    );
  } else if (m.meta?.viewOnce) {
    content = (
      <p className="flex items-center gap-2 opacity-80">
        <OnceIcon className="size-4" /> View-once {m.kind === "video" ? "video" : "photo"} (sealed)
      </p>
    );
  } else if (m.kind === "call") {
    content = (
      <p className="flex items-center gap-2">
        {m.meta?.call?.video ? <VideoIcon className="size-4" /> : <PhoneIcon className="size-4" />}
        {callLabel(m.meta?.call)}
      </p>
    );
  } else if (m.kind === "image" && src) {
    content = (
      <>
        <a href={src} target="_blank" rel="noreferrer" className="block">
          <img
            src={src}
            alt={m.body || "Photo"}
            loading="lazy"
            className="max-h-80 w-full rounded-xl object-cover"
            style={m.meta?.width && m.meta?.height ? { aspectRatio: `${m.meta.width} / ${m.meta.height}` } : undefined}
          />
        </a>
        {m.body && <p className="mt-1.5 px-1 break-words whitespace-pre-wrap">{m.body}</p>}
      </>
    );
  } else if (m.kind === "video" && src) {
    content = (
      <>
        <video src={src} controls preload="metadata" playsInline className="max-h-80 w-full rounded-xl bg-black" />
        {m.body && <p className="mt-1.5 px-1 break-words whitespace-pre-wrap">{m.body}</p>}
      </>
    );
  } else if (m.kind === "voice" && src) {
    content = <audio src={src} controls preload="none" className="h-10 w-64 max-w-full" />;
  } else if (m.kind === "file" && src) {
    content = (
      <a href={src} className="flex items-center gap-3" download>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-black/10 dark:bg-white/10">
          <FileIcon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{m.meta?.name ?? "Document"}</span>
          <span className="block text-xs opacity-70">{m.meta ? formatBytes(m.meta.size) : ""}</span>
        </span>
        <DownloadIcon className="size-4 shrink-0 opacity-70" />
      </a>
    );
  } else {
    content = <p className="break-words whitespace-pre-wrap">{m.body}</p>;
  }

  const media = !m.deletedAt && !m.meta?.viewOnce && (m.kind === "image" || m.kind === "video");

  return (
    <div className={`flex flex-col ${right ? "items-end" : "items-start"} ${showName ? "pt-2" : ""}`}>
      {showName && <span className="mb-0.5 px-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">{m.displayName}</span>}
      <div className={`max-w-[85%] rounded-2xl text-sm shadow-sm sm:max-w-[70%] ${bubble} ${media ? "w-72 p-1" : "px-3.5 py-2"}`}>
        {m.replyTo && (
          <div className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs ${right ? "border-white/60 bg-white/15" : "border-accent bg-zinc-100 dark:bg-zinc-800"}`}>
            <span className="font-medium">{m.replyTo.displayName}</span>
            <span className="block truncate opacity-80">{m.replyTo.deleted ? "Deleted message" : m.replyTo.body || "Attachment"}</span>
          </div>
        )}
        {content}
      </div>
      <span className="mt-0.5 flex items-center gap-1.5 px-2 text-[11px] text-zinc-400">
        {reactions.length > 0 && <span className="text-sm">{reactions.join("")}</span>}
        {formatTime(m.createdAt)}
        {m.editedAt && !m.deletedAt && " · edited"}
      </span>
    </div>
  );
}
