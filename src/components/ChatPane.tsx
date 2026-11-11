import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { LIMITS, type Message, type Room, type User } from "../../shared/types";
import { api } from "../lib/api";
import { formatDayDivider, formatTime, sameDay } from "../lib/format";
import { useRoomSocket, type SocketEvent } from "../lib/useRoomSocket";
import { roomTitle } from "./ChatLayout";
import { AlertIcon, Avatar, BackIcon, SendIcon, Spinner } from "./ui";

type UiMessage = Message & { status?: "pending" | "failed" };

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const TYPING_SEND_INTERVAL = 2500;
const TYPING_IDLE_MS = 3000;
const TYPING_EXPIRE_MS = 5000;

function byTime(a: Message, b: Message) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Merge server messages into the list by id, keeping unsent local ones. */
function merge(prev: UiMessage[], incoming: Message[]): UiMessage[] {
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (m.clientId) map.delete(m.clientId); // replace the optimistic copy
    map.set(m.id, m);
  }
  return [...map.values()].sort(byTime);
}

interface Props {
  room: Room;
  me: User;
  onBack: () => void;
  onActivity: (roomId: string, message: Message) => void;
}

export function ChatPane({ room, me, onBack, onActivity }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [online, setOnline] = useState<string[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);

  const title = roomTitle(room);
  const peerOnline = room.peer ? online.includes(room.peer.id) : false;

  // ---- Initial load ----
  const loadLatest = useCallback(async () => {
    try {
      const res = await api.messages(room.id);
      setMessages((prev) => merge(prev, res.messages));
      setHasMore((h) => h || res.hasMore);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [room.id]);

  useEffect(() => {
    loadLatest();
    inputRef.current?.focus();
  }, [loadLatest]);

  // ---- Live events ----
  const handleEvent = useCallback(
    (e: SocketEvent) => {
      switch (e.type) {
        case "connected":
          // Catch up on anything sent while we were disconnected.
          loadLatest();
          break;
        case "message":
          setMessages((prev) => merge(prev, [e.message]));
          setTyping((t) => {
            if (!t[e.message.userId]) return t;
            const { [e.message.userId]: _, ...rest } = t;
            return rest;
          });
          onActivity(room.id, e.message);
          break;
        case "typing":
          setTyping((t) => {
            if (!e.isTyping) {
              const { [e.userId]: _, ...rest } = t;
              return rest;
            }
            return { ...t, [e.userId]: { name: e.displayName, until: Date.now() + TYPING_EXPIRE_MS } };
          });
          break;
        case "presence":
          setOnline(e.online);
          break;
        case "error":
          if (e.clientId) {
            setMessages((prev) => prev.map((m) => (m.id === e.clientId ? { ...m, status: "failed" } : m)));
          }
          setNotice(e.message);
          break;
      }
    },
    [loadLatest, onActivity, room.id],
  );

  const { status, send } = useRoomSocket(room.id, handleEvent);

  // Expire stale typing indicators (e.g. if someone closed their tab mid-sentence).
  useEffect(() => {
    const t = window.setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // ---- Scrolling ----
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (restoreScroll.current) {
      el.scrollTop = el.scrollHeight - restoreScroll.current.height + restoreScroll.current.top;
      restoreScroll.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, typing]);

  async function loadOlder() {
    const el = listRef.current;
    const oldest = messages.find((m) => !m.status);
    if (!el || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.messages(room.id, { createdAt: oldest.createdAt, id: oldest.id });
      restoreScroll.current = { height: el.scrollHeight, top: el.scrollTop };
      setMessages((prev) => merge(prev, res.messages));
      setHasMore(res.hasMore);
    } catch {
      setNotice("Couldn't load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 80 && hasMore && !loadingOlder) loadOlder();
  }

  // ---- Sending ----
  function stopTyping() {
    window.clearTimeout(typingTimer.current);
    if (lastTypingSent.current) {
      send({ type: "typing", isTyping: false });
      lastTypingSent.current = 0;
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    if (value.trim() && now - lastTypingSent.current > TYPING_SEND_INTERVAL) {
      if (send({ type: "typing", isTyping: true })) lastTypingSent.current = now;
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  function deliver(msg: UiMessage) {
    const ok = send({ type: "send", body: msg.body, clientId: msg.id });
    if (!ok) {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: "failed" } : m)));
    }
  }

  function submit() {
    const body = draft.trim();
    if (!body || body.length > LIMITS.messageMax) return;
    const clientId = crypto.randomUUID();
    const optimistic: UiMessage = {
      id: clientId,
      clientId,
      roomId: room.id,
      userId: me.id,
      username: me.username,
      displayName: me.displayName,
      body,
      createdAt: Date.now(),
      status: "pending",
    };
    stickToBottom.current = true;
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    stopTyping();
    deliver(optimistic);
    inputRef.current?.focus();
  }

  function retry(msg: UiMessage) {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: "pending" } : m)));
    deliver(msg);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  // Auto-grow the textarea up to ~6 lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const typingNames = Object.values(typing).map((t) => t.name);
  const tooLong = draft.length > LIMITS.messageMax;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-zinc-50 dark:bg-zinc-950" aria-label={`Chat with ${title}`}>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white/80 px-3 py-3 backdrop-blur md:px-5 dark:border-zinc-800 dark:bg-zinc-900/80">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
          aria-label="Back to conversations"
        >
          <BackIcon className="size-5" />
        </button>
        <Avatar name={title} seed={room.peer?.id ?? room.id} online={room.peer ? peerOnline : undefined} />
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {typingNames.length > 0 ? (
              <span className="text-indigo-600 dark:text-indigo-400">typing…</span>
            ) : room.peer ? (
              peerOnline ? (
                "Active now"
              ) : (
                `@${room.peer.username}`
              )
            ) : null}
          </p>
        </div>
      </header>

      {status !== "open" && !loading && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <Spinner className="size-3" />
          {status === "connecting" ? "Connecting…" : "Reconnecting…"}
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-4 md:px-6" aria-live="polite">
        {loading ? (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <Spinner className="size-6" />
          </div>
        ) : loadError && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500">
            Couldn't load messages.
            <button onClick={loadLatest} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Avatar name={title} seed={room.peer?.id ?? room.id} size="lg" />
            <p className="mt-3 font-medium">{title}</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Say hi 👋 — this is the start of your chat.</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col">
            {hasMore && (
              <div className="flex justify-center py-2 text-zinc-400">
                {loadingOlder ? <Spinner /> : <span className="text-xs">Scroll up for older messages</span>}
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
              const startsGroup =
                newDay || prev.userId !== m.userId || m.createdAt - prev.createdAt > GROUP_WINDOW_MS;
              const endsGroup =
                !next ||
                next.userId !== m.userId ||
                next.createdAt - m.createdAt > GROUP_WINDOW_MS ||
                !sameDay(next.createdAt, m.createdAt);
              return (
                <div key={m.id}>
                  {newDay && <DayDivider ts={m.createdAt} />}
                  <MessageBubble
                    message={m}
                    mine={m.userId === me.id}
                    showName={room.type === "group" && startsGroup && m.userId !== me.id}
                    startsGroup={startsGroup}
                    endsGroup={endsGroup}
                    onRetry={() => retry(m)}
                  />
                </div>
              );
            })}
            {typingNames.length > 0 && <TypingBubble />}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-zinc-200 bg-white px-3 py-3 md:px-6 dark:border-zinc-800 dark:bg-zinc-900">
        {notice && (
          <div
            role="status"
            className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300"
          >
            <AlertIcon className="size-4 shrink-0" />
            {notice}
          </div>
        )}
        <form
          className="mx-auto flex max-w-3xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={stopTyping}
              rows={1}
              placeholder={`Message ${title}`}
              aria-label="Message"
              className={`block w-full resize-none rounded-2xl border bg-zinc-50 px-4 py-2.5 text-[15px] leading-6 outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-4 dark:bg-zinc-800 dark:focus:bg-zinc-800 ${
                tooLong
                  ? "border-red-400 focus:ring-red-500/15"
                  : "border-zinc-200 focus:border-indigo-500 focus:ring-indigo-500/15 dark:border-zinc-700"
              }`}
            />
            {draft.length > LIMITS.messageMax - 200 && (
              <span
                className={`absolute right-3 -top-5 text-xs tabular-nums ${tooLong ? "text-red-500" : "text-zinc-400"}`}
              >
                {draft.length}/{LIMITS.messageMax}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={!draft.trim() || tooLong}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-500 focus-visible:ring-4 focus-visible:ring-indigo-500/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            aria-label="Send message"
          >
            <SendIcon className="size-5 -translate-x-px translate-y-px" />
          </button>
        </form>
      </div>
    </section>
  );
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="my-4 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      <span className="text-xs font-medium text-zinc-400">{formatDayDivider(ts)}</span>
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  showName,
  startsGroup,
  endsGroup,
  onRetry,
}: {
  message: UiMessage;
  mine: boolean;
  showName: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  onRetry: () => void;
}) {
  // Rounded corners that "join" consecutive bubbles from the same person.
  const corners = mine
    ? `rounded-2xl ${startsGroup ? "" : "rounded-tr-md"} ${endsGroup ? "" : "rounded-br-md"}`
    : `rounded-2xl ${startsGroup ? "" : "rounded-tl-md"} ${endsGroup ? "" : "rounded-bl-md"}`;

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"} ${startsGroup ? "mt-3" : "mt-0.5"}`}>
      {showName && <span className="mb-1 ml-3 text-xs font-medium text-zinc-500">{message.displayName}</span>}
      <div
        title={formatTime(message.createdAt)}
        className={`max-w-[85%] px-3.5 py-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap md:max-w-[70%] ${corners} ${
          mine
            ? "bg-indigo-600 text-white"
            : "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/5"
        } ${message.status === "pending" ? "opacity-70" : ""} ${
          message.status === "failed" ? "bg-red-500/90 dark:bg-red-600/90" : ""
        }`}
      >
        {message.body}
      </div>
      {message.status === "failed" ? (
        <button onClick={onRetry} className="mt-1 mr-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400">
          Not sent · Tap to retry
        </button>
      ) : (
        endsGroup && (
          <span className={`mt-1 text-[11px] text-zinc-400 tabular-nums ${mine ? "mr-1" : "ml-1"}`}>
            {message.status === "pending" ? "Sending…" : formatTime(message.createdAt)}
          </span>
        )
      )}
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="mt-3 flex items-start" aria-label="Someone is typing">
      <div className="flex gap-1 rounded-2xl bg-white px-4 py-3.5 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/5">
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
      </div>
    </div>
  );
}
