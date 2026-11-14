import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { bubbleLook, disappearLabel, SLOW_MODE_OPTIONS, type MediaKind, type MediaMeta, type Me, type Message, type MessageKind, type PollInfo, type Room, type ScheduledMessage, type User } from "../../shared/types";
import { api, ApiError, fetchMedia, mediaUrl } from "../lib/api";
import { formatDayDivider, formatRelative, sameDay } from "../lib/format";
import type { PreparedImage, PreparedVideo, Recording } from "../lib/media";
import { sendToRoom } from "../lib/sendToRoom";
import { useRoomSocket, type SocketEvent } from "../lib/useRoomSocket";
import { useSecret } from "../lib/useSecret";
import type { SecretState } from "../lib/e2e";
import { type Presence } from "./ChatLayout";
import { CallPill, useCallMinimized } from "./CallScreen";
import { ChatInfo } from "./ChatInfo";
import { Composer, type ComposerHandle } from "./Composer";
import { ConfirmDialog, ForwardDialog } from "./Dialogs";
import { PollDialog } from "./PollDialog";
import { ReportDialog, ScheduleDialog, ScheduledSheet, SeenBySheet } from "./ChatExtras";
import { ImageViewer } from "./ImageViewer";
import { MessageBubble, type BubbleAction, type UiMessage } from "./MessageBubble";
import { MessageMenu, type MenuAction } from "./MessageMenu";
import { RoomAvatar, roomTitle } from "./RoomAvatar";
import { SearchPanel } from "./SearchPanel";
import {
  AlertIcon,
  ArrowDownIcon,
  BackIcon,
  ClockIcon,
  CopyIcon,
  ForwardIcon,
  MegaphoneIcon,
  TrashIcon,
  ImageIcon,
  LockIcon,
  PhoneIcon,
  SearchIcon,
  Spinner,
  TimerIcon,
  VideoIcon,
  XIcon,
} from "./ui";

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

/** Replaces the visible window (after a jump), keeping messages still being sent. */
function replaceWindow(prev: UiMessage[], incoming: Message[]): UiMessage[] {
  return merge(
    prev.filter((m) => m.status),
    incoming,
  );
}

interface Outgoing {
  kind: MessageKind;
  body: string;
  replyToId?: string;
  blob?: Blob;
  name?: string;
  meta?: Pick<MediaMeta, "width" | "height" | "duration" | "waveform" | "viewOnce" | "poll">;
  mediaId?: string;
  /** No alerts or sounds for the people receiving it. */
  silent?: boolean;
  /** Upload in flight (don't start a second one on reconnect). */
  uploading?: boolean;
  /** Actually handed to an open socket (never re-sent automatically, to avoid duplicates). */
  sent?: boolean;
  /** Gives up and shows "Not sent" if the connection doesn't come back in time. */
  giveUp?: number;
}

const OFFLINE_GRACE_MS = 20_000;

interface Props {
  room: Room;
  me: Me;
  peerPresence?: Presence;
  onBack: () => void;
  onActivity: (roomId: string, message: Message) => void;
  onStartCall: (video: boolean) => void;
  /** The person in the current call (for the minimized call pill). */
  callPeer: User | null;
  onAcceptRequest: (roomId: string) => Promise<void>;
  onDeclineRequest: (roomId: string) => Promise<void>;
  onBlock: (user: User) => Promise<void>;
  onUnblock: (user: User) => Promise<void>;
  /** All chats (for forwarding and adding group members). */
  rooms: Room[];
  onPrefs: (room: Room, patch: { pinned?: boolean; archived?: boolean; mutedUntil?: number | null }) => void;
  onDelete: (room: Room) => void;
  onRoomUpdated: (room: Room) => void;
  onRoomsChanged: () => void;
  onStartSecret: (dm: Room) => Promise<void>;
  onOpenRoom: (id: string) => void;
  /** Jump to this message once the chat has loaded (from search everywhere). */
  initialJump?: string | null;
}

export function ChatPane({
  room,
  me,
  peerPresence,
  onBack,
  onActivity,
  onStartCall,
  callPeer,
  onAcceptRequest,
  onDeclineRequest,
  onBlock,
  onUnblock,
  rooms,
  onPrefs,
  onDelete,
  onRoomUpdated,
  onRoomsChanged,
  onStartSecret,
  onOpenRoom,
  initialJump,
}: Props) {
  const callMinimized = useCallMinimized();
  const secret = useSecret(room, me.id);
  const { readable, decryptAll } = secret;
  const secretReady = !room.secret || secret.state.kind === "ready";
  // Friend requests: nothing can be sent until the other person accepts.
  const accepted = room.status === "accepted";
  const incomingRequest = !accepted && room.requestedBy !== me.id;
  // Blocking: either side can stop the chat.
  const blocked = room.blocked;
  const blockedMe = room.blockedMe;
  const canChat = accepted && !blocked && !blockedMe && secretReady;
  const [forwarding, setForwarding] = useState<UiMessage[] | null>(null);
  /** Multi-select mode (null = off). */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [members, setMembers] = useState<User[]>([]);
  const [reporting, setReporting] = useState<UiMessage | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [scheduleText, setScheduleText] = useState<string | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [seenBy, setSeenBy] = useState<UiMessage | null>(null);
  /** "Unread messages" divider: where you'd stopped reading when you opened the chat. */
  const [unreadFrom, setUnreadFrom] = useState<number | null>(null);
  const openedAt = useRef(Date.now());
  const [pins, setPins] = useState<Message[]>([]);
  const [pinIndex, setPinIndex] = useState(0);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [requestBusy, setRequestBusy] = useState<"accept" | "decline" | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [readState, setReadState] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<UiMessage | null>(null);
  const [editing, setEditing] = useState<UiMessage | null>(null);
  const [menu, setMenu] = useState<{ message: UiMessage; rect: DOMRect } | null>(null);
  const [viewer, setViewer] = useState<{ src: string; caption?: string; viewOnce?: boolean; video?: boolean } | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const pendingJump = useRef<string | null>(null);
  const outgoing = useRef(new Map<string, Outgoing>());
  const lastReadSent = useRef(0);
  const hasNewerRef = useRef(false);
  /** Only messages that arrive after the chat opened get the slide-in animation. */
  const animateFrom = useRef(Number.POSITIVE_INFINITY);

  const title = roomTitle(room);
  const peer = room.peer;

  useEffect(() => {
    hasNewerRef.current = hasNewer;
  }, [hasNewer]);

  // ---- Loading ----
  const loadLatest = useCallback(
    async (replace = false) => {
      try {
        const res = await api.messages(room.id);
        setMessages((prev) => (replace ? replaceWindow(prev, res.messages) : merge(prev, res.messages)));
        setReadState(res.readState);
        setUnreadFrom((u) => u ?? res.readState[me.id] ?? 0);
        setHasMore((h) => (replace ? res.hasMore : h || res.hasMore));
        // Updated synchronously so the scroll logic sees it on the very next render.
        hasNewerRef.current = false;
        setHasNewer(false);
        setLoadError(false);
        if (animateFrom.current === Number.POSITIVE_INFINITY) animateFrom.current = Date.now();
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [room.id, me.id],
  );

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  // Pinned messages (shared by everyone) and your starred ones.
  const loadPins = useCallback(() => {
    api.pinned(room.id).then((r) => setPins(r.messages)).catch(() => {});
  }, [room.id]);
  useEffect(() => {
    if (room.status !== "accepted") return;
    loadPins();
    api.starred(room.id).then((r) => setStarred(new Set(r.messages.map((m) => m.id)))).catch(() => {});
  }, [loadPins, room.id, room.status]);

  // Secret chats: decrypt whatever is on screen (each message once).
  useEffect(() => {
    if (room.secret) void decryptAll([...messages, ...pins]);
  }, [messages, pins, room.secret, decryptAll]);

  // Disappearing messages vanish on time, even between the server's clean-up runs.
  const nextExpiry = useMemo(
    () => messages.reduce((min, m) => (m.expiresAt && m.expiresAt < min ? m.expiresAt : min), Number.POSITIVE_INFINITY),
    [messages],
  );
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const t = window.setTimeout(() => setNow(Date.now()), Math.max(250, nextExpiry - Date.now() + 50));
    return () => window.clearTimeout(t);
  }, [nextExpiry, now]);

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
          if (!hasNewerRef.current) loadLatest(); // catch up on anything missed while disconnected
          // Send everything that was written while the connection was down.
          for (const [clientId, out] of outgoing.current) {
            if (!out.sent && !out.uploading) void deliverRef.current(clientId);
          }
          break;
        case "message": {
          const mine = e.message.userId === me.id;
          if (e.message.clientId) outgoing.current.delete(e.message.clientId);
          // Reading old history: don't splice new messages into the middle; offer a jump instead.
          if (hasNewerRef.current && !mine) {
            setNewBelow((n) => n + 1);
          } else {
            setMessages((prev) => merge(prev, [e.message]));
            if (!mine && !stickToBottom.current) setNewBelow((n) => n + 1);
          }
          setTyping((t) => {
            if (!t[e.message.userId]) return t;
            const { [e.message.userId]: _, ...rest } = t;
            return rest;
          });
          onActivity(room.id, e.message);
          break;
        }
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
        case "pin":
          patch(e.messageId, (m) => ({ ...m, pinnedAt: e.pinnedAt }));
          loadPins();
          break;
        case "votes":
          patch(e.messageId, (m) => ({ ...m, votes: e.votes }));
          break;
        case "scheduled":
          setScheduled(e.items);
          break;
        case "expired": {
          const gone = new Set(e.messageIds);
          setMessages((prev) => prev.filter((m) => !gone.has(m.id)));
          setPins((prev) => prev.filter((m) => !gone.has(m.id)));
          break;
        }
        case "error":
          if (e.clientId) patch(e.clientId, (m) => ({ ...m, status: "failed", progress: undefined }));
          setNotice(e.message);
          break;
      }
    },
    [loadLatest, loadPins, me.id, onActivity, patch, room.id],
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
    if (document.visibilityState !== "visible" || !stickToBottom.current || hasNewerRef.current) return;
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
    if (pendingJump.current) {
      const target = document.getElementById(`msg-${pendingJump.current}`);
      pendingJump.current = null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        highlight(target);
      }
    } else if (restoreScroll.current) {
      el.scrollTop = el.scrollHeight - restoreScroll.current.height + restoreScroll.current.top;
      restoreScroll.current = null;
    } else if (stickToBottom.current && !hasNewerRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, typing]);

  const jumpToLatest = useCallback(async () => {
    setNewBelow(0);
    stickToBottom.current = true;
    if (hasNewerRef.current) {
      // New window renders, then the layout effect pins it to the bottom.
      await loadLatest(true);
      return;
    }
    const el = listRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [loadLatest]);

  /** Scrolls to any message, loading the history around it if it isn't on screen yet. */
  const jumpTo = useCallback(
    async (messageId: string) => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        highlight(el);
        return;
      }
      try {
        const res = await api.messages(room.id, { around: messageId });
        stickToBottom.current = false;
        pendingJump.current = messageId;
        hasNewerRef.current = res.hasNewer;
        setMessages((prev) => replaceWindow(prev, res.messages));
        setHasMore(res.hasMore);
        setHasNewer(res.hasNewer);
      } catch (err) {
        setNotice(err instanceof ApiError ? err.message : "Couldn't find that message.");
      }
    },
    [room.id],
  );

  async function loadOlder() {
    const el = listRef.current;
    const oldest = messages.find((m) => !m.status);
    if (!el || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.messages(room.id, { before: { createdAt: oldest.createdAt, id: oldest.id } });
      restoreScroll.current = { height: el.scrollHeight, top: el.scrollTop };
      setMessages((prev) => merge(prev, res.messages));
      setHasMore(res.hasMore);
    } catch {
      setNotice("Couldn't load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function loadNewer() {
    const newest = messages.findLast((m) => !m.status);
    if (!newest || loadingNewer) return;
    setLoadingNewer(true);
    try {
      const res = await api.messages(room.id, { after: { createdAt: newest.createdAt, id: newest.id } });
      hasNewerRef.current = res.hasNewer;
      setMessages((prev) => merge(prev, res.messages));
      setHasNewer(res.hasNewer);
      if (!res.hasNewer) setNewBelow(0);
    } catch {
      setNotice("Couldn't load newer messages.");
    } finally {
      setLoadingNewer(false);
    }
  }

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (hasNewer) {
      stickToBottom.current = false;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 300 && !loadingNewer) loadNewer();
    } else {
      if (nearBottom && !stickToBottom.current) {
        setNewBelow(0);
        stickToBottom.current = true;
        markRead();
      }
      stickToBottom.current = nearBottom;
    }
    if (el.scrollTop < 120 && hasMore && !loadingOlder) loadOlder();
  }

  // ---- Sending ----
  const deliver = useCallback(
    async (clientId: string) => {
      const out = outgoing.current.get(clientId);
      if (!out || out.sent || out.uploading) return;
      try {
        if (out.blob && !out.mediaId) {
          out.uploading = true;
          try {
            const { mediaId } = await api.uploadMedia(room.id, out.kind as MediaKind, out.blob, {
              name: out.name,
              onProgress: (p) => patch(clientId, (m) => ({ ...m, progress: p })),
            });
            out.mediaId = mediaId;
          } finally {
            out.uploading = false;
          }
        }
        const ok = send({
          type: "send",
          clientId,
          kind: out.kind,
          body: out.body,
          mediaId: out.mediaId,
          meta: out.meta,
          replyToId: out.replyToId,
          ...(out.silent ? { silent: true } : {}),
        });
        if (ok) {
          out.sent = true;
          window.clearTimeout(out.giveUp);
          return;
        }
        // Still connecting: keep it as "Sending…" and send it as soon as we're connected.
        window.clearTimeout(out.giveUp);
        out.giveUp = window.setTimeout(() => {
          const still = outgoing.current.get(clientId);
          if (still && !still.sent) patch(clientId, (m) => ({ ...m, status: "failed", progress: undefined }));
        }, OFFLINE_GRACE_MS);
      } catch (err) {
        patch(clientId, (m) => ({ ...m, status: "failed", progress: undefined }));
        if (err instanceof ApiError) setNotice(err.message);
      }
    },
    [patch, room.id, send],
  );
  const deliverRef = useRef(deliver);
  useEffect(() => {
    deliverRef.current = deliver;
  }, [deliver]);

  const queue = useCallback(
    (out: Outgoing, localUrl?: string) => {
      if (hasNewerRef.current) void jumpToLatest(); // sending from old history: go back to the present
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
        meta: out.blob
          ? { mime: out.blob.type, size: out.blob.size, name: out.name, ...out.meta }
          : out.meta?.poll
            ? { mime: "", size: 0, poll: out.meta.poll }
            : null,
        ...(out.kind === "poll" ? { votes: {} } : {}),
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
        pinnedAt: null,
        expiresAt: room.disappearMs ? Date.now() + room.disappearMs : null,
        status: "pending",
        progress: out.blob ? 0 : undefined,
        localUrl,
      };
      outgoing.current.set(clientId, out);
      stickToBottom.current = true;
      setNewBelow(0);
      setMessages((prev) => [...prev, optimistic]);
      setReplyTo(null);
      deliver(clientId);
    },
    [deliver, jumpToLatest, me, messages, room.id, room.disappearMs],
  );

  const sendText = (body: string, opts?: { silent?: boolean }) => {
    const replyToId = replyTo?.id;
    if (!room.secret) return queue({ kind: "text", body, replyToId, silent: opts?.silent });
    // Secret chat: encrypted on this device before it goes anywhere.
    secret.encrypt(body).then(
      (cipher) => queue({ kind: "text", body: cipher, replyToId }),
      (err: Error) => setNotice(err.message),
    );
  };

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

  const sendVideo = (video: PreparedVideo, caption: string, viewOnce = false) =>
    queue(
      {
        kind: "video",
        body: viewOnce ? "" : caption,
        replyToId: replyTo?.id,
        blob: video.blob,
        meta: { width: video.width, height: video.height, duration: video.duration, viewOnce: viewOnce || undefined },
      },
      URL.createObjectURL(video.blob),
    );

  const sendPoll = (question: string, poll: PollInfo) => queue({ kind: "poll", body: question, meta: { poll } });

  const sendFile = (file: File) =>
    queue({ kind: "file", body: "", replyToId: replyTo?.id, blob: file, name: file.name }, URL.createObjectURL(file));

  const sendVoice = (rec: Recording) =>
    queue(
      { kind: "voice", body: "", replyToId: replyTo?.id, blob: rec.blob, meta: { duration: rec.duration, waveform: rec.waveform } },
      URL.createObjectURL(rec.blob),
    );

  const saveEdit = async (text: string) => {
    if (!editing) return;
    const id = editing.id;
    setEditing(null);
    let body = text;
    if (room.secret) {
      try {
        body = await secret.encrypt(text);
      } catch (err) {
        return setNotice((err as Error).message);
      }
    }
    if (send({ type: "edit", messageId: id, body })) {
      patch(id, (m) => ({ ...m, body, editedAt: Date.now() }));
    } else {
      setNotice("You're offline. Try again in a moment.");
    }
  };

  /** Forwards messages into another chat, oldest first (text is re-sent; files are copied server-side). */
  const forwardTo = async (target: Room) => {
    const list = forwarding;
    if (!list?.length) return;
    for (const m of list) {
      if (m.kind === "text") {
        await sendToRoom(target.id, { kind: "text", body: m.body, meta: { forwarded: true } });
      } else {
        const copy = await api.forwardMedia(target.id, room.id, m.id);
        await sendToRoom(target.id, { kind: copy.kind, body: copy.body, mediaId: copy.mediaId, meta: copy.meta });
      }
    }
    setSelected(null);
    setNotice(`Forwarded ${list.length > 1 ? `${list.length} messages ` : ""}to ${roomTitle(target)}`);
  };

  // ---- Bubble actions (stable callback so bubbles don't re-render) ----
  const stateRef = useRef({ send, deliver, jumpTo, onStartCall });
  useEffect(() => {
    stateRef.current = { send, deliver, jumpTo, onStartCall };
  });

  const react = useCallback(
    (message: UiMessage, emoji: string) => {
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
    },
    [me.id],
  );

  const openViewOnce = useCallback(
    async (message: UiMessage) => {
      try {
        const blob = await fetchMedia(mediaUrl(message.roomId, message.id));
        setViewer({ src: URL.createObjectURL(blob), viewOnce: true, video: message.kind === "video" });
      } catch (err) {
        setNotice(err instanceof ApiError ? err.message : "Couldn't open this.");
      } finally {
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id && !m.viewedBy.includes(me.id) ? { ...m, viewedBy: [...m.viewedBy, me.id] } : m)),
        );
      }
    },
    [me.id],
  );

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
          {
            const out = outgoing.current.get(a.message.id);
            if (out) out.sent = false; // the server rejected it (or it never left): try again
          }
          stateRef.current.deliver(a.message.id);
          break;
        case "open-image":
          setViewer({ src: a.src, caption: a.message.body });
          break;
        case "open-view-once":
          openViewOnce(a.message);
          break;
        case "jump":
          stateRef.current.jumpTo(a.messageId);
          break;
        case "call-back":
          stateRef.current.onStartCall(a.video);
          break;
        case "select":
          setSelected((s) => {
            const next = new Set(s ?? []);
            if (next.has(a.message.id)) next.delete(a.message.id);
            else next.add(a.message.id);
            return next.size ? next : null;
          });
          break;
        case "vote": {
          if (!stateRef.current.send({ type: "vote", messageId: a.message.id, options: a.options })) {
            setNotice("You're offline. Try again in a moment.");
            break;
          }
          // Show it right away; the server's totals replace this a moment later.
          patch(a.message.id, (m) => {
            const votes = { ...(m.votes ?? {}) };
            if (a.options.length) votes[me.id] = a.options;
            else delete votes[me.id];
            return { ...m, votes };
          });
          break;
        }
      }
    },
    [me.id, openViewOnce, patch, react],
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
        navigator.clipboard?.writeText(m.body).then(
          () => setNotice("Copied"),
          () => setNotice("Couldn't copy."),
        );
        break;
      case "edit":
        setReplyTo(null);
        setEditing(m);
        break;
      case "delete":
        if (!send({ type: "delete", messageId: m.id })) setNotice("You're offline. Try again in a moment.");
        break;
      case "pin":
        if (!send({ type: "pin", messageId: m.id, pinned: !m.pinnedAt })) setNotice("You're offline. Try again in a moment.");
        break;
      case "star": {
        const on = !starred.has(m.id);
        setStarred((s) => {
          const n = new Set(s);
          if (on) n.add(m.id);
          else n.delete(m.id);
          return n;
        });
        api.star(room.id, m.id, on).then(
          () => setNotice(on ? "Starred · find it in chat info" : "Unstarred"),
          () => setNotice("Couldn't change that. Try again."),
        );
        break;
      }
      case "forward":
        setForwarding([m]);
        break;
      case "select":
        setSelected(new Set([m.id]));
        break;
      case "report":
        setReporting(m);
        break;
      case "seen":
        setSeenBy(m);
        break;
    }
  };

  // ---- Drag & drop ----
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) composerRef.current?.addFile(file);
  };

  // ---- Derived ----
  const othersRead = useMemo(
    () =>
      Math.max(
        0,
        ...Object.entries(readState)
          .filter(([id]) => id !== me.id)
          .map(([, at]) => at),
      ),
    [readState, me.id],
  );
  // The other person's chosen bubble style, unless you've turned that off in Settings.
  // Same color as yours? Then theirs stays neutral, so you can always tell the two sides apart.
  const peerBubble =
    me.settings.showOthersBubbles && peer?.bubbleColor && peer.bubbleColor !== me.settings.bubbleColor ? peer.bubbleColor : undefined;
  const peerTint = useMemo(() => (peerBubble ? bubbleLook(peerBubble) : undefined), [peerBubble]);
  const typingNames = Object.values(typing).map((t) => t.name);
  const statusText =
    typingNames.length > 0
      ? room.type === "group"
        ? `${typingNames.slice(0, 2).join(", ")}${typingNames.length > 2 ? " and others" : ""} ${typingNames.length > 1 ? "are" : "is"} typing…`
        : "typing…"
      : room.saved
        ? "Your private notes"
        : room.type === "group"
          ? `${room.memberCount} members`
          : peer?.statusText
            ? `${peer.statusText}${peerPresence?.online ? " · online" : ""}`
          : peerPresence?.online
            ? "Online"
            : peerPresence?.lastSeenAt
              ? `Last seen ${formatRelative(peerPresence.lastSeenAt)}`
              : peer
                ? `@${peer.username}`
                : "";

  // What's on screen: decrypted (secret chats), without anything that has disappeared.
  const view = useMemo(
    () => messages.filter((m) => !m.expiresAt || m.expiresAt > now).map((m) => readable(m)),
    [messages, now, readable],
  );
  const pinView = useMemo(() => pins.map((m) => readable(m)), [pins, readable]);
  const currentPin = pinView.length ? pinView[pinIndex % pinView.length] : null;

  // Your scheduled messages for this chat (the server keeps them and sends them on time).
  useEffect(() => {
    if (status === "open") send({ type: "list-scheduled" });
  }, [status, send]);
  const scheduleMessage = (body: string) => setScheduleText(body);
  const confirmSchedule = async (sendAt: number) => {
    const text = scheduleText;
    if (!text) return;
    let body = text;
    if (room.secret) {
      try {
        body = await secret.encrypt(text);
      } catch (err) {
        return setNotice((err as Error).message);
      }
    }
    if (send({ type: "schedule", clientId: crypto.randomUUID(), body, sendAt, replyToId: replyTo?.id })) {
      setReplyTo(null);
      setNotice("Message scheduled");
    } else setNotice("You're offline. Try again in a moment.");
  };

  // Opened from "search everywhere": jump to that message once loaded.
  const jumpedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!initialJump || loading || jumpedTo.current === initialJump) return;
    jumpedTo.current = initialJump;
    void jumpTo(initialJump);
  }, [initialJump, loading, jumpTo]);

  // Where the "Unread messages" divider goes (only for messages that were already there when you opened the chat).
  const firstUnreadId = useMemo(() => {
    if (unreadFrom === null || !unreadFrom) return null;
    return view.find((m) => m.userId !== me.id && m.createdAt > unreadFrom && m.createdAt <= openedAt.current)?.id ?? null;
  }, [view, unreadFrom, me.id]);

  // Groups: load the member list for @mention suggestions.
  useEffect(() => {
    if (room.type !== "group" || room.secret) return;
    let cancelled = false;
    api.members(room.id).then(
      (r) => !cancelled && setMembers(r.members),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [room.id, room.type, room.secret, room.memberCount]);

  // Multi-select
  const selectedList = selected ? view.filter((m) => selected.has(m.id)) : [];
  const allMine = selectedList.length > 0 && selectedList.every((m) => m.userId === me.id);
  const canForwardSelected =
    !room.secret && selectedList.length > 0 && selectedList.every((m) => !m.locked && m.kind !== "call" && m.kind !== "poll" && !m.meta?.viewOnce);
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);
  const copySelected = () => {
    const text = selectedList
      .filter((m) => m.body && !m.locked)
      .map((m) => (selectedList.length > 1 && room.type === "group" ? `${m.displayName}: ${m.body}` : m.body))
      .join("\n\n");
    navigator.clipboard?.writeText(text).then(
      () => setNotice(`Copied ${selectedList.length > 1 ? `${selectedList.length} messages` : "message"}`),
      () => setNotice("Couldn't copy."),
    );
    setSelected(null);
  };
  const deleteSelected = () => {
    let failed = false;
    for (const m of selectedList) if (!send({ type: "delete", messageId: m.id })) failed = true;
    if (failed) setNotice("You're offline. Try again in a moment.");
    setSelected(null);
  };

  // Announcement channels and slow mode (admins are exempt).
  const readOnly = room.type === "group" && room.adminsOnly && room.role !== "admin";
  const slowLabel = room.type === "group" && room.slowModeMs && room.role !== "admin" ? SLOW_MODE_OPTIONS.find((o) => o.ms === room.slowModeMs)?.label : null;

  const headerButton =
    "flex size-10 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

  return (
    <div className="flex min-w-0 flex-1 md:gap-2">
      <section
        className={`panel chat-wall wall-${me.settings.wallpaper} relative flex min-w-0 flex-1 flex-col`}
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
        {/* Selection bar (replaces the header while selecting) */}
        {selected && (
          <div className="divider-b absolute inset-x-0 top-0 z-20 flex items-center gap-1 bg-white px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:px-4 dark:bg-zinc-900">
            <button onClick={() => setSelected(null)} className="flex size-10 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Cancel selection">
              <XIcon className="size-5" />
            </button>
            <p className="min-w-0 flex-1 truncate pl-1 font-semibold tabular-nums">
              {selected.size} selected
            </p>
            <button onClick={copySelected} disabled={!selectedList.some((m) => m.body && !m.locked)} className={`${"flex size-10 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800"}`} aria-label="Copy" title="Copy">
              <CopyIcon className="size-5" />
            </button>
            <button onClick={() => setForwarding(selectedList)} disabled={!canForwardSelected} className="flex size-10 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800" aria-label="Forward" title="Forward">
              <ForwardIcon className="size-5" />
            </button>
            <button onClick={() => setConfirmBulkDelete(true)} disabled={!allMine} className="flex size-10 items-center justify-center rounded-full text-red-600 transition hover:bg-red-50 disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-950/40" aria-label="Delete for everyone" title={allMine ? "Delete for everyone" : "You can only delete your own messages"}>
              <TrashIcon className="size-5" />
            </button>
          </div>
        )}

        {/* Header */}
        <header className="divider-b flex items-center gap-2 bg-white/85 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur-md md:px-4 dark:bg-zinc-900/85">
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
            aria-label="Back to conversations"
          >
            <BackIcon className="size-5" />
          </button>
          <button
            onClick={() => setInfoOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-0.5 pr-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
            aria-label={`View ${title}'s info and shared media`}
          >
            <RoomAvatar room={room} online={room.type === "dm" && !room.saved ? peerPresence?.online : undefined} />
            <div className="min-w-0">
              <h2 className={`flex items-center gap-1.5 truncate font-semibold ${room.secret ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                {room.secret && <LockIcon className="size-4 shrink-0" />}
                <span className="truncate">{title}</span>
              </h2>
              <p
                className={`flex items-center gap-1 truncate text-xs ${
                  typingNames.length || (peerPresence?.online && room.type === "dm" && !room.saved) ? "text-accent-fg" : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {room.disappearMs && <TimerIcon className="size-3 shrink-0" aria-label={`Disappearing messages: ${disappearLabel(room.disappearMs)}`} />}
                <span className="truncate">{statusText}</span>
              </p>
            </div>
          </button>
          {callMinimized ? (
            // A minimized call lives here, in place of the header buttons.
            <CallPill peer={callPeer} />
          ) : (
            <div className="flex shrink-0 items-center">
              {peer && canChat && (
                <>
                  <button onClick={() => onStartCall(true)} className={`${headerButton} max-[380px]:hidden`} aria-label="Video call" title="Video call">
                    <VideoIcon className="size-5" />
                  </button>
                  <button onClick={() => onStartCall(false)} className={headerButton} aria-label="Voice call" title="Voice call">
                    <PhoneIcon className="size-5" />
                  </button>
                </>
              )}
              {!room.secret && (
                <button
                  onClick={() => setSearchOpen(true)}
                  className={headerButton}
                  aria-label="Search messages"
                  title="Search messages"
                >
                  <SearchIcon className="size-5" />
                </button>
              )}
            </div>
          )}
        </header>

        {searchOpen && (
          <SearchPanel
            roomId={room.id}
            meId={me.id}
            onClose={() => setSearchOpen(false)}
            onPick={(id) => {
              setSearchOpen(false);
              jumpTo(id);
            }}
          />
        )}

        {currentPin && (
          <div className="divider-b flex items-center gap-2 bg-white/90 px-3 py-1.5 backdrop-blur-md md:px-4 dark:bg-zinc-900/90">
            <button
              onClick={() => {
                jumpTo(currentPin.id);
                setPinIndex((i) => i + 1);
              }}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 text-left"
              aria-label="Go to pinned message"
            >
              <span className="flex h-8 w-0.5 shrink-0 flex-col gap-0.5" aria-hidden="true">
                {pinView.map((p, i) => (
                  <span key={p.id} className={`flex-1 rounded-full ${i === pinIndex % pinView.length ? "bg-accent" : "bg-accent/30"}`} />
                ))}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-accent-fg">
                  Pinned message{pinView.length > 1 ? ` ${(pinIndex % pinView.length) + 1} of ${pinView.length}` : ""}
                </span>
                <span className="block truncate text-sm text-zinc-600 dark:text-zinc-300">
                  {currentPin.locked ? "🔒 Encrypted message" : currentPin.body || pinLabel(currentPin)}
                </span>
              </span>
            </button>
            <button
              onClick={() => send({ type: "pin", messageId: currentPin.id, pinned: false })}
              className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="Unpin"
              title="Unpin"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        )}

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
              <button onClick={() => loadLatest()} className="font-medium text-accent-fg hover:underline">
                Try again
              </button>
            </div>
          ) : view.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <RoomAvatar room={room} size="xl" />
              <p className="mt-3 font-medium">{title}</p>
              {peer && !room.saved && <p className="text-sm text-zinc-500 dark:text-zinc-400">@{peer.username}</p>}
              {room.secret ? (
                <SecretIntro state={secret.state} name={peer?.displayName ?? title} />
              ) : (
                <p className="mt-2 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
                  {room.saved
                    ? "Keep notes, links, photos and files here. Only you can see them, on all your devices."
                    : room.type === "group"
                      ? "Your group is ready. Say hi 👋"
                      : accepted
                        ? "Say hi 👋 — this is the start of your chat."
                        : incomingRequest
                          ? "Accept to start chatting."
                          : "Waiting for them to accept your request."}
                </p>
              )}
            </div>
          ) : (
            <div className="chat-column mx-auto flex flex-col" role="log" aria-live="polite">
              {room.secret && secret.state.kind === "ready" && (
                <div className="mx-auto mb-2 flex max-w-sm items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <LockIcon className="size-3.5 shrink-0" />
                  End-to-end encrypted. Only you two can read these messages, on these two devices.
                </div>
              )}
              {hasMore && (
                <div className="flex justify-center py-2 text-zinc-400">
                  {loadingOlder ? <Spinner /> : <span className="text-xs">Scroll up for older messages</span>}
                </div>
              )}
              {view.map((m, i) => {
                const prev = view[i - 1];
                const next = view[i + 1];
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
                    {m.id === firstUnreadId && (
                      <div className="my-3 flex items-center gap-3 text-xs font-semibold text-accent-fg" role="separator">
                        <span className="h-px flex-1 bg-accent/30" />
                        Unread messages
                        <span className="h-px flex-1 bg-accent/30" />
                      </div>
                    )}
                    <MessageBubble
                      message={m}
                      meId={me.id}
                      meUsername={me.username}
                      selecting={selected !== null}
                      selected={selected?.has(m.id) ?? false}
                      mine={m.userId === me.id}
                      showName={room.type === "group" && startsGroup && m.userId !== me.id}
                      startsGroup={startsGroup}
                      endsGroup={endsGroup}
                      read={othersRead >= m.createdAt}
                      tint={m.userId === me.id ? undefined : room.type === "dm" ? peerTint : undefined}
                      showTicks={!room.saved}
                      bigEmoji={me.settings.bigEmoji}
                      linkPreviews={me.settings.linkPreviews && !room.secret}
                      onAction={onBubbleAction}
                    />
                  </div>
                );
              })}
              {hasNewer && (
                <div className="flex justify-center py-3 text-zinc-400">
                  {loadingNewer ? <Spinner /> : <span className="text-xs">Scroll down for newer messages</span>}
                </div>
              )}
              {!hasNewer && typingNames.length > 0 && <TypingBubble />}
            </div>
          )}
        </div>

        {(newBelow > 0 || hasNewer) && (
          <button
            onClick={() => jumpToLatest()}
            className="pop-in absolute right-4 bottom-24 z-10 flex items-center gap-1.5 rounded-full bg-accent px-3 py-2 text-sm font-medium text-accent-ink shadow-lg md:right-8"
          >
            <ArrowDownIcon className="size-4" />
            {newBelow > 0 ? `${newBelow} new` : "Latest"}
          </button>
        )}

        {notice && (
          <div
            role="status"
            className="fade-in pointer-events-none absolute bottom-24 left-1/2 z-20 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-xl bg-zinc-900 px-3.5 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-zinc-900"
          >
            <AlertIcon className="size-4 shrink-0" />
            {notice}
          </div>
        )}

        {blocked || blockedMe ? (
          <BlockPanel
            blockedByMe={blocked}
            name={title}
            onUnblock={peer ? () => onUnblock(peer).catch(() => setNotice("Couldn't unblock. Try again.")) : undefined}
          />
        ) : room.secret && secret.state.kind !== "ready" ? (
          <SecretPanel
            state={secret.state}
            name={title}
            busy={requestBusy}
            onAccept={async () => {
              setRequestBusy("accept");
              try {
                await secret.accept();
                onRoomsChanged();
              } catch (err) {
                setNotice(err instanceof Error ? err.message : "Couldn't accept. Try again.");
              }
              setRequestBusy(null);
            }}
            onDecline={async () => {
              setRequestBusy("decline");
              await onDeclineRequest(room.id).catch(() => setNotice("Couldn't do that. Try again."));
              setRequestBusy(null);
            }}
            onEnd={() => onDelete(room)}
          />
        ) : !accepted ? (
          <RequestPanel
            incoming={incomingRequest}
            name={title}
            busy={requestBusy}
            onAccept={async () => {
              setRequestBusy("accept");
              await onAcceptRequest(room.id).catch(() => setNotice("Couldn't accept. Try again."));
              setRequestBusy(null);
            }}
            onDecline={async () => {
              setRequestBusy("decline");
              await onDeclineRequest(room.id).catch(() => setNotice("Couldn't do that. Try again."));
              setRequestBusy(null);
            }}
          />
        ) : null}
        {scheduled.length > 0 && accepted && !blocked && !blockedMe && (
          <button
            onClick={() => setScheduledOpen(true)}
            className="divider-t flex items-center justify-center gap-2 bg-white/85 py-2 text-xs font-medium text-accent-fg backdrop-blur-md hover:bg-accent/5 dark:bg-zinc-900/85"
          >
            <ClockIcon className="size-3.5" />
            {scheduled.length} scheduled {scheduled.length === 1 ? "message" : "messages"}
          </button>
        )}
        {blocked || blockedMe || (room.secret && secret.state.kind !== "ready") || !accepted ? null : readOnly ? (
          <div className="divider-t flex items-center justify-center gap-2 bg-white/85 px-4 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] text-sm text-zinc-500 backdrop-blur-md dark:bg-zinc-900/85 dark:text-zinc-400">
            <MegaphoneIcon className="size-4 shrink-0" />
            Only admins can send messages in this group.
          </div>
        ) : (
        <Composer
          ref={composerRef}
          title={title}
          draftKey={room.secret ? undefined : room.id}
          mentionables={room.type === "group" ? members : undefined}
          onCreatePoll={room.secret || room.saved ? undefined : () => setPollOpen(true)}
          onSchedule={scheduleMessage}
          meId={me.id}
          replyTo={replyTo}
          editing={editing}
          onCancelContext={() => {
            setReplyTo(null);
            setEditing(null);
          }}
          onSendText={sendText}
          onSaveEdit={saveEdit}
          onSendImage={sendImage}
          onSendVideo={sendVideo}
          onSendFile={sendFile}
          onSendVoice={sendVoice}
          onTyping={(isTyping) => {
            if (me.settings.sendTyping && !room.saved) send({ type: "typing", isTyping });
          }}
          onError={setNotice}
          voice={me.settings}
          textOnly={room.secret}
          enterToSend={me.settings.enterToSend}
          placeholder={
            room.saved ? "Write a note to yourself" : room.secret ? "Encrypted message" : slowLabel ? `Slow mode · 1 message every ${slowLabel}` : undefined
          }
        />
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-white/80 text-accent-fg backdrop-blur-sm dark:bg-zinc-900/80">
            <ImageIcon className="size-10" />
            <p className="font-medium">Drop a photo, video or file to send</p>
          </div>
        )}

        {menu && (
          <MessageMenu
            message={menu.message}
            rect={menu.rect}
            mine={menu.message.userId === me.id}
            myReaction={menu.message.reactions[me.id] ?? null}
            starred={starred.has(menu.message.id)}
            seenCount={
              room.type === "group" && menu.message.userId === me.id
                ? members.filter((u) => u.id !== me.id && (readState[u.id] ?? 0) >= menu.message.createdAt).length
                : undefined
            }
            canForward={
              !room.secret && !menu.message.locked && menu.message.kind !== "call" && !menu.message.meta?.viewOnce && !menu.message.deletedAt
            }
            onAction={onMenuAction}
            onClose={() => setMenu(null)}
          />
        )}

        {forwarding && <ForwardDialog rooms={rooms} fromRoomId={room.id} onPick={forwardTo} onClose={() => setForwarding(null)} />}
        {pollOpen && <PollDialog onCreate={sendPoll} onClose={() => setPollOpen(false)} />}
        {reporting && (
          <ReportDialog
            target={{
              userId: reporting.userId,
              name: reporting.displayName,
              roomId: room.id,
              messageId: reporting.id,
              preview: reporting.locked ? undefined : reporting.body || pinLabel(reporting),
              evidence: room.secret && !reporting.locked ? reporting.body : undefined,
            }}
            onClose={() => setReporting(null)}
          />
        )}
        {scheduleText !== null && <ScheduleDialog text={scheduleText} onSchedule={confirmSchedule} onClose={() => setScheduleText(null)} />}
        {scheduledOpen && (
          <ScheduledSheet
            items={scheduled}
            onSendNow={(id) => send({ type: "send-now", id })}
            onDelete={(id) => send({ type: "unschedule", id })}
            onClose={() => setScheduledOpen(false)}
          />
        )}
        {seenBy && (
          <SeenBySheet
            readers={members.filter((u) => u.id !== me.id && (readState[u.id] ?? 0) >= seenBy.createdAt)}
            unread={members.filter((u) => u.id !== me.id && (readState[u.id] ?? 0) < seenBy.createdAt)}
            onClose={() => setSeenBy(null)}
          />
        )}
        {confirmBulkDelete && (
          <ConfirmDialog
            title={`Delete ${selectedList.length} ${selectedList.length === 1 ? "message" : "messages"}?`}
            message="They'll be deleted for everyone in this chat."
            confirmLabel="Delete for everyone"
            danger
            onConfirm={deleteSelected}
            onClose={() => setConfirmBulkDelete(false)}
          />
        )}

        {viewer && (
          <ImageViewer
            src={viewer.src}
            caption={viewer.caption}
            viewOnce={viewer.viewOnce}
            video={viewer.video}
            onClose={() => {
              if (viewer.viewOnce) URL.revokeObjectURL(viewer.src);
              setViewer(null);
            }}
          />
        )}
      </section>

      {infoOpen && (
        <ChatInfo
          room={room}
          me={me}
          presence={peerPresence}
          onClose={() => setInfoOpen(false)}
          onJump={(id) => {
            setInfoOpen(false);
            jumpTo(id);
          }}
          onOpenImage={(src, caption) => setViewer({ src, caption })}
          onCall={onStartCall}
          onBlock={onBlock}
          onUnblock={onUnblock}
          rooms={rooms}
          secretState={secret.state}
          pinned={pinView}
          onPrefs={onPrefs}
          onDelete={onDelete}
          onRoomUpdated={onRoomUpdated}
          onRoomsChanged={onRoomsChanged}
          onStartSecret={onStartSecret}
          onOpenRoom={onOpenRoom}
          readable={readable}
        />
      )}
    </div>
  );
}

function highlight(el: HTMLElement) {
  el.animate([{ backgroundColor: "rgb(250 204 21 / 0.3)" }, { backgroundColor: "transparent" }], {
    duration: 1600,
    easing: "ease-out",
  });
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

/** Shown instead of the message box until a message request is accepted. */
function RequestPanel({
  incoming,
  name,
  busy,
  onAccept,
  onDecline,
}: {
  incoming: boolean;
  name: string;
  busy: "accept" | "decline" | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-md text-center">
        {incoming ? (
          <>
            <p className="font-semibold">{name} wants to connect</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              They can't message, call or see when you're online until you accept.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={onDecline}
                disabled={busy !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-zinc-200 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:ring-zinc-700 dark:hover:bg-red-950/40"
              >
                {busy === "decline" && <Spinner />}
                Decline
              </button>
              <button
                onClick={onAccept}
                disabled={busy !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-50"
              >
                {busy === "accept" && <Spinner />}
                Accept
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="font-semibold">Request sent</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              You can chat with {name} once they accept your request.
            </p>
            <button
              onClick={onDecline}
              disabled={busy !== null}
              className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              {busy === "decline" && <Spinner />}
              Cancel request
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Shown instead of the message box when either person has blocked the other. */
function BlockPanel({ blockedByMe, name, onUnblock }: { blockedByMe: boolean; name: string; onUnblock?: () => void }) {
  return (
    <div
      className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-md text-center">
        {blockedByMe ? (
          <>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              You blocked <span className="font-medium text-zinc-700 dark:text-zinc-200">{name}</span>. They can't message
              or call you.
            </p>
            {onUnblock && (
              <button
                onClick={onUnblock}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
              >
                Unblock
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">You can no longer message {name}.</p>
        )}
      </div>
    </div>
  );
}

function pinLabel(m: Message): string {
  switch (m.kind) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎥 Video";
    case "voice":
      return "🎤 Voice message";
    case "file":
      return `📄 ${m.meta?.name ?? "Document"}`;
    default:
      return "Message";
  }
}

/** Empty secret chat: explains what's special about it. */
function SecretIntro({ state, name }: { state: SecretState; name: string }) {
  return (
    <div className="mt-4 max-w-xs rounded-2xl bg-emerald-50 p-4 text-left text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
      <p className="flex items-center gap-2 font-semibold">
        <LockIcon className="size-4" /> Secret chat
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed">
        <li>End-to-end encrypted: only you and {name} can read it. Not the server, not the admins.</li>
        <li>Lives only on the two devices that set it up.</li>
        <li>Text only. Can't be forwarded. Supports disappearing messages.</li>
      </ul>
      {state.kind === "ready" && (
        <p className="mx-auto mt-3 grid w-fit grid-cols-4 gap-x-3 text-center text-lg" title="Encryption key: compare it with theirs">
          {state.fingerprint.map((e, i) => (
            <span key={i}>{e}</span>
          ))}
        </p>
      )}
    </div>
  );
}

/** Shown instead of the message box while a secret chat isn't usable on this device. */
function SecretPanel({
  state,
  name,
  busy,
  onAccept,
  onDecline,
  onEnd,
}: {
  state: SecretState;
  name: string;
  busy: "accept" | "decline" | null;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
}) {
  const shell = (children: React.ReactNode) => (
    <div
      className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-md text-center">{children}</div>
    </div>
  );
  switch (state.kind) {
    case "loading":
      return shell(
        <div className="flex justify-center text-zinc-400">
          <Spinner />
        </div>,
      );
    case "invite":
      return shell(
        <>
          <p className="flex items-center justify-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
            <LockIcon className="size-4" /> {name} invited you to a secret chat
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Accepting creates encryption keys on <strong>this device</strong>. The chat will only be readable here.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={onDecline}
              disabled={busy !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-zinc-200 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:ring-zinc-700 dark:hover:bg-red-950/40"
            >
              {busy === "decline" && <Spinner />}
              Decline
            </button>
            <button
              onClick={onAccept}
              disabled={busy !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === "accept" && <Spinner />}
              Accept here
            </button>
          </div>
        </>,
      );
    case "waiting":
      return shell(
        <>
          <p className="font-semibold">Waiting for {name}</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            They need to open Relay and accept. You'll be able to write as soon as they do.
          </p>
          <button
            onClick={onDecline}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {busy === "decline" && <Spinner />}
            Cancel invitation
          </button>
        </>,
      );
    case "unsupported":
      return shell(<p className="text-sm text-zinc-500 dark:text-zinc-400">This browser can't do secret chats. Try an up-to-date Chrome, Edge, Firefox or Safari.</p>);
    default:
      return shell(
        <>
          <p className="font-semibold">This secret chat lives on another device</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Secret chats can only be read on the device where they were set up (signing out also removes them). Open it there, or end it and start a new one here.
          </p>
          <button
            onClick={onEnd}
            className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 ring-1 ring-red-600/25 transition hover:bg-red-50 dark:text-red-400 dark:ring-red-400/25 dark:hover:bg-red-950/40"
          >
            End secret chat
          </button>
        </>,
      );
  }
}
