import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { Me, Message, MessageKind, Room } from "../../shared/types";
import { api, ApiError, fetchMedia, mediaUrl } from "../lib/api";
import { formatDayDivider, formatRelative, sameDay } from "../lib/format";
import type { PreparedImage, Recording } from "../lib/media";
import { useRoomSocket, type SocketEvent } from "../lib/useRoomSocket";
import { roomTitle, type Presence } from "./ChatLayout";
import { Composer, type ComposerHandle } from "./Composer";
import { ImageViewer } from "./ImageViewer";
import { MessageBubble, type BubbleAction, type UiMessage } from "./MessageBubble";
import { MessageMenu, type MenuAction } from "./MessageMenu";
import { AlertIcon, ArrowDownIcon, Avatar, BackIcon, ImageIcon, Spinner } from "./ui";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const TYPING_EXPIRE_MS = 5000;

function byTime(a: Message, b: Message) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Merge server messages into the list by id, replacing optimistic copies and keeping their local previews. */
function merge(prev: UiMessage[], incoming: Message[]): UiMessage[] {
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) {
    const optimistic = m.clientId ? map.get(m.clientId) : undefined;
    if (m.clientId) map.delete(m.clientId);
    const existing = map.get(m.id);
    map.set(m.id, {
      ...m,
      // Keep the original client id so the React key (and the rendered bubble) stays the same.
      clientId: m.clientId ?? existing?.clientId,
      localUrl: optimistic?.localUrl ?? existing?.localUrl,
    });
  }
  return [...map.values()].sort(byTime);
}

interface Outgoing {
  kind: MessageKind;
  body: string;
  replyToId?: string;
  blob?: Blob;
  meta?: { width?: number; height?: number; duration?: number; waveform?: number[]; viewOnce?: boolean };
  mediaId?: string;
}

interface Props {
  room: Room;
  me: Me;
  peerPresence?: Presence;
  onBack: () => void;
  onActivity: (roomId: string, message: Message) => void;
  onOpenProfile: (userId: string) => void;
}

export function ChatPane({ room, me, peerPresence, onBack, onActivity, onOpenProfile }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [readState, setReadState] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<UiMessage | null>(null);
  const [editing, setEditing] = useState<UiMessage | null>(null);
  const [menu, setMenu] = useState<{ message: UiMessage; rect: DOMRect } | null>(null);
  const [viewer, setViewer] = useState<{ src: string; caption?: string; viewOnce?: boolean } | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [dragging, setDragging] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const outgoing = useRef(new Map<string, Outgoing>());
  const lastReadSent = useRef(0);
  /** Only messages that arrive after the chat opened get the slide-in animation. */
  const animateFrom = useRef(Number.POSITIVE_INFINITY);

  const title = roomTitle(room);
  const peer = room.peer;

  // ---- Loading ----
  const loadLatest = useCallback(async () => {
    try {
      const res = await api.messages(room.id);
      setMessages((prev) => merge(prev, res.messages));
      setReadState(res.readState);
      setHasMore((h) => h || res.hasMore);
      setLoadError(false);
      if (animateFrom.current === Number.POSITIVE_INFINITY) animateFrom.current = Date.now();
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [room.id]);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  // Free local previews when leaving the chat.
  useEffect(
    () => () => {
      setMessages((prev) => {
        prev.forEach((m) => m.localUrl && URL.revokeObjectURL(m.localUrl));
        return prev;
      });
    },
    [],
  );

  // ---- Live events ----
  const patch = useCallback((id: string, fn: (m: UiMessage) => UiMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const handleEvent = useCallback(
    (e: SocketEvent) => {
      switch (e.type) {
        case "connected":
          loadLatest(); // catch up on anything missed while disconnected
          break;
        case "message":
          if (e.message.clientId) outgoing.current.delete(e.message.clientId);
          setMessages((prev) => merge(prev, [e.message]));
          setTyping((t) => {
            if (!t[e.message.userId]) return t;
            const { [e.message.userId]: _, ...rest } = t;
            return rest;
          });
          if (e.message.userId !== me.id && !stickToBottom.current) setNewBelow((n) => n + 1);
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
        case "read":
          setReadState((s) => ({ ...s, [e.userId]: Math.max(s[e.userId] ?? 0, e.at) }));
          break;
        case "reaction":
          patch(e.messageId, (m) => {
            const reactions = { ...m.reactions };
            if (e.emoji) reactions[e.userId] = e.emoji;
            else delete reactions[e.userId];
            return { ...m, reactions };
          });
          break;
        case "edit":
          patch(e.messageId, (m) => ({ ...m, body: e.body, editedAt: e.editedAt }));
          break;
        case "delete":
          patch(e.messageId, (m) => ({ ...m, deletedAt: e.deletedAt, body: "", meta: null, mediaId: null, reactions: {} }));
          setMessages((prev) =>
            prev.map((m) => (m.replyTo?.id === e.messageId ? { ...m, replyTo: { ...m.replyTo, deleted: true, body: "" } } : m)),
          );
          break;
        case "viewed":
          patch(e.messageId, (m) => (m.viewedBy.includes(e.userId) ? m : { ...m, viewedBy: [...m.viewedBy, e.userId] }));
          break;
        case "error":
          if (e.clientId) patch(e.clientId, (m) => ({ ...m, status: "failed" }));
          setNotice(e.message);
          break;
      }
    },
    [loadLatest, me.id, onActivity, patch, room.id],
  );

  const { status, send } = useRoomSocket(room.id, handleEvent);

  // Expire stale typing indicators.
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

  // ---- Read receipts ----
  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible" || !stickToBottom.current) return;
    const latest = messages.findLast((m) => m.userId !== me.id && !m.status);
    if (!latest || latest.createdAt <= lastReadSent.current) return;
    if (send({ type: "read", at: latest.createdAt })) lastReadSent.current = latest.createdAt;
  }, [messages, me.id, send]);

  useEffect(() => {
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [markRead, status]);

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

  const scrollToBottom = (smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = true;
    setNewBelow(0);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

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
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom && !stickToBottom.current) {
      setNewBelow(0);
      stickToBottom.current = true;
      markRead();
    }
    stickToBottom.current = atBottom;
    if (el.scrollTop < 120 && hasMore && !loadingOlder) loadOlder();
  }

  // ---- Sending ----
  const deliver = useCallback(
    async (clientId: string) => {
      const out = outgoing.current.get(clientId);
      if (!out) return;
      try {
        if (out.blob && !out.mediaId) {
          const { mediaId } = await api.uploadMedia(room.id, out.kind === "voice" ? "voice" : "image", out.blob);
          out.mediaId = mediaId;
        }
        const ok = send({
          type: "send",
          clientId,
          kind: out.kind,
          body: out.body,
          mediaId: out.mediaId,
          meta: out.meta,
          replyToId: out.replyToId,
        });
        if (!ok) throw new Error("offline");
      } catch (err) {
        patch(clientId, (m) => ({ ...m, status: "failed" }));
        if (err instanceof ApiError) setNotice(err.message);
      }
    },
    [patch, room.id, send],
  );

  const queue = useCallback(
    (out: Outgoing, localUrl?: string) => {
      const clientId = crypto.randomUUID();
      const reply = out.replyToId ? messages.find((m) => m.id === out.replyToId) : undefined;
      const optimistic: UiMessage = {
        id: clientId,
        clientId,
        roomId: room.id,
        userId: me.id,
        username: me.username,
        displayName: me.displayName,
        kind: out.kind,
        body: out.body,
        mediaId: null,
        meta: out.meta ? { mime: out.blob?.type ?? "", size: out.blob?.size ?? 0, ...out.meta } : null,
        replyTo: reply
          ? {
              id: reply.id,
              userId: reply.userId,
              displayName: reply.displayName,
              kind: reply.kind,
              body: reply.meta?.viewOnce ? "" : reply.body.slice(0, 200),
              deleted: reply.deletedAt !== null,
            }
          : null,
        reactions: {},
        viewedBy: [],
        editedAt: null,
        deletedAt: null,
        createdAt: Date.now(),
        status: "pending",
        localUrl,
      };
      outgoing.current.set(clientId, out);
      stickToBottom.current = true;
      setNewBelow(0);
      setMessages((prev) => [...prev, optimistic]);
      setReplyTo(null);
      deliver(clientId);
    },
    [deliver, me, messages, room.id],
  );

  const sendText = (body: string) => queue({ kind: "text", body, replyToId: replyTo?.id });

  const sendImage = (image: PreparedImage, caption: string, viewOnce: boolean) =>
    queue(
      {
        kind: "image",
        body: viewOnce ? "" : caption,
        replyToId: replyTo?.id,
        blob: image.blob,
        meta: { width: image.width, height: image.height, viewOnce: viewOnce || undefined },
      },
      URL.createObjectURL(image.blob),
    );

  const sendVoice = (rec: Recording) =>
    queue(
      { kind: "voice", body: "", replyToId: replyTo?.id, blob: rec.blob, meta: { duration: rec.duration, waveform: rec.waveform } },
      URL.createObjectURL(rec.blob),
    );

  const saveEdit = (body: string) => {
    if (!editing) return;
    if (send({ type: "edit", messageId: editing.id, body })) {
      patch(editing.id, (m) => ({ ...m, body, editedAt: Date.now() }));
    } else {
      setNotice("You're offline. Try again in a moment.");
    }
    setEditing(null);
  };

  // ---- Bubble actions (stable callback so bubbles don't re-render) ----
  const stateRef = useRef({ messages, send, deliver });
  useEffect(() => {
    stateRef.current = { messages, send, deliver };
  });

  const react = useCallback((message: UiMessage, emoji: string) => {
    const current = message.reactions[me.id] ?? null;
    const next = current === emoji ? null : emoji;
    if (!stateRef.current.send({ type: "react", messageId: message.id, emoji: next })) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== message.id) return m;
        const reactions = { ...m.reactions };
        if (next) reactions[me.id] = next;
        else delete reactions[me.id];
        return { ...m, reactions };
      }),
    );
  }, [me.id]);

  const openViewOnce = useCallback(async (message: UiMessage) => {
    try {
      const blob = await fetchMedia(mediaUrl(message.roomId, message.id));
      setViewer({ src: URL.createObjectURL(blob), viewOnce: true });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Couldn't open this photo.");
    } finally {
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id && !m.viewedBy.includes(me.id) ? { ...m, viewedBy: [...m.viewedBy, me.id] } : m)),
      );
    }
  }, [me.id]);

  const onBubbleAction = useCallback(
    (a: BubbleAction) => {
      switch (a.type) {
        case "menu":
          setMenu({ message: a.message, rect: a.rect });
          break;
        case "react":
          react(a.message, a.emoji);
          break;
        case "reply":
          setEditing(null);
          setReplyTo(a.message);
          break;
        case "retry":
          patch(a.message.id, (m) => ({ ...m, status: "pending" }));
          stateRef.current.deliver(a.message.id);
          break;
        case "open-image":
          setViewer({ src: a.src, caption: a.message.body });
          break;
        case "open-view-once":
          openViewOnce(a.message);
          break;
        case "jump": {
          const el = document.getElementById(`msg-${a.messageId}`);
          if (!el) {
            setNotice("That message is further up — scroll to load it.");
            return;
          }
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.animate([{ backgroundColor: "rgb(250 204 21 / 0.25)" }, { backgroundColor: "transparent" }], {
            duration: 1400,
            easing: "ease-out",
          });
          break;
        }
      }
    },
    [openViewOnce, patch, react],
  );

  const onMenuAction = (action: MenuAction) => {
    const m = menu?.message;
    setMenu(null);
    if (!m) return;
    if (typeof action === "object") return react(m, action.react);
    switch (action) {
      case "reply":
        setEditing(null);
        setReplyTo(m);
        break;
      case "copy":
        navigator.clipboard?.writeText(m.body).then(() => setNotice("Copied"), () => setNotice("Couldn't copy."));
        break;
      case "edit":
        setReplyTo(null);
        setEditing(m);
        break;
      case "delete":
        if (!send({ type: "delete", messageId: m.id })) setNotice("You're offline. Try again in a moment.");
        break;
    }
  };

  // ---- Drag & drop photos ----
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file) composerRef.current?.addImage(file);
  };

  // ---- Derived ----
  const othersRead = useMemo(
    () => Math.max(0, ...Object.entries(readState).filter(([id]) => id !== me.id).map(([, at]) => at)),
    [readState, me.id],
  );
  const typingNames = Object.values(typing).map((t) => t.name);
  const status_ =
    typingNames.length > 0
      ? "typing…"
      : peerPresence?.online
        ? "Online"
        : peerPresence?.lastSeenAt
          ? `Last seen ${formatRelative(peerPresence.lastSeenAt)}`
          : peer
            ? `@${peer.username}`
            : "";

  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col bg-zinc-50 dark:bg-zinc-950"
      aria-label={`Chat with ${title}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white/85 px-3 py-2.5 backdrop-blur md:px-5 dark:border-zinc-800 dark:bg-zinc-900/85">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
          aria-label="Back to conversations"
        >
          <BackIcon className="size-5" />
        </button>
        <button
          onClick={() => peer && onOpenProfile(peer.id)}
          className="flex min-w-0 items-center gap-3 rounded-xl py-0.5 pr-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
          aria-label={`View ${title}'s profile`}
        >
          <Avatar name={title} seed={peer?.id ?? room.id} user={peer} online={peerPresence?.online} />
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{title}</h2>
            <p
              className={`truncate text-xs ${
                typingNames.length || peerPresence?.online ? "text-bubble-fg" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {status_}
            </p>
          </div>
        </button>
      </header>

      {status !== "open" && !loading && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <Spinner className="size-3" />
          {status === "connecting" ? "Connecting…" : "Reconnecting…"}
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-6">
        {loading ? (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <Spinner className="size-6" />
          </div>
        ) : loadError && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500">
            Couldn't load messages.
            <button onClick={loadLatest} className="font-medium text-bubble-fg hover:underline">
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Avatar name={title} seed={peer?.id ?? room.id} user={peer} size="xl" />
            <p className="mt-3 font-medium">{title}</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Say hi 👋 — this is the start of your chat.</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col" role="log" aria-live="polite">
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
                newDay || prev.userId !== m.userId || m.createdAt - prev.createdAt > GROUP_WINDOW_MS || !!m.replyTo;
              const endsGroup =
                !next ||
                next.userId !== m.userId ||
                next.createdAt - m.createdAt > GROUP_WINDOW_MS ||
                !sameDay(next.createdAt, m.createdAt) ||
                !!next.replyTo ||
                Object.keys(m.reactions).length > 0;
              return (
                <div key={m.clientId ?? m.id} className={m.createdAt >= animateFrom.current ? "message-in" : undefined}>
                  {newDay && <DayDivider ts={m.createdAt} />}
                  <MessageBubble
                    message={m}
                    meId={me.id}
                    mine={m.userId === me.id}
                    showName={room.type === "group" && startsGroup && m.userId !== me.id}
                    startsGroup={startsGroup}
                    endsGroup={endsGroup}
                    read={othersRead >= m.createdAt}
                    onAction={onBubbleAction}
                  />
                </div>
              );
            })}
            {typingNames.length > 0 && <TypingBubble />}
          </div>
        )}
      </div>

      {newBelow > 0 && (
        <button
          onClick={() => scrollToBottom()}
          className="pop-in absolute right-4 bottom-24 z-10 flex items-center gap-1.5 rounded-full bg-bubble px-3 py-2 text-sm font-medium text-white shadow-lg md:right-8"
        >
          <ArrowDownIcon className="size-4" />
          {newBelow} new
        </button>
      )}

      {notice && (
        <div
          role="status"
          className="fade-in pointer-events-none absolute bottom-24 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-zinc-900 px-3.5 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-zinc-900"
        >
          <AlertIcon className="size-4 shrink-0" />
          {notice}
        </div>
      )}

      <Composer
        ref={composerRef}
        title={title}
        meId={me.id}
        connected={status === "open"}
        replyTo={replyTo}
        editing={editing}
        onCancelContext={() => {
          setReplyTo(null);
          setEditing(null);
        }}
        onSendText={sendText}
        onSaveEdit={saveEdit}
        onSendImage={sendImage}
        onSendVoice={sendVoice}
        onTyping={(isTyping) => send({ type: "typing", isTyping })}
        onError={setNotice}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-bubble bg-white/80 text-bubble-fg backdrop-blur-sm dark:bg-zinc-900/80">
          <ImageIcon className="size-10" />
          <p className="font-medium">Drop a photo to send</p>
        </div>
      )}

      {menu && (
        <MessageMenu
          message={menu.message}
          rect={menu.rect}
          mine={menu.message.userId === me.id}
          myReaction={menu.message.reactions[me.id] ?? null}
          onAction={onMenuAction}
          onClose={() => setMenu(null)}
        />
      )}

      {viewer && (
        <ImageViewer
          src={viewer.src}
          caption={viewer.caption}
          viewOnce={viewer.viewOnce}
          onClose={() => {
            if (viewer.viewOnce) URL.revokeObjectURL(viewer.src);
            setViewer(null);
          }}
        />
      )}
    </section>
  );
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="my-4 flex justify-center" role="separator">
      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-500 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-white/5">
        {formatDayDivider(ts)}
      </span>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="fade-in mt-3 flex items-start" aria-label="Someone is typing">
      <div className="flex gap-1 rounded-2xl bg-white px-4 py-3.5 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/5">
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
        <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
      </div>
    </div>
  );
}
