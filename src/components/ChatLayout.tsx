import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isMuted, type CallInfo, type ClientEvent, type LobbyEvent, type Me, type Message, type Room, type Settings, type SiteSettings, type User } from "../../shared/types";
import { messagePreview } from "../../shared/types";
import { api, ApiError, UNAUTHORIZED_EVENT } from "../lib/api";
import { calls } from "../lib/calls";
import { adoptKey, createDeviceKey, e2eSupported, forgetKey } from "../lib/e2e";
import { plainText } from "../lib/richText";
import { playMessageSound } from "../lib/sound";
import { useLobbySocket } from "../lib/useRoomSocket";
import { CallPill, CallScreen, useCallMinimized } from "./CallScreen";
import { ChatPane } from "./ChatPane";
import { ConfirmDialog, NewGroupDialog } from "./Dialogs";
import { InviteDialog, readInviteFromUrl, readProfileFromUrl } from "./InviteDialog";
import { QuickSwitcher } from "./QuickSwitcher";
import { roomTitle } from "./RoomAvatar";
import { Sidebar } from "./Sidebar";
import { ChatIcon, KeyIcon, LockIcon, Logo, WrenchIcon, XIcon } from "./ui";

export { roomTitle };

// Loaded only when opened, so the chat starts faster on phones.
const AdminPanel = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminPanel })));
const SettingsDialog = lazy(() => import("./SettingsDialog").then((m) => ({ default: m.SettingsDialog })));

export interface Presence {
  online: boolean;
  lastSeenAt: number | null;
}
export type PresenceMap = Record<string, Presence>;

export function ChatLayout({
  me,
  onLogout,
  onMeUpdated,
}: {
  me: Me;
  onLogout: () => void;
  onMeUpdated: (me: Me) => void;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Room | null>(null);
  const [presence, setPresence] = useState<PresenceMap>({});
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** "New sign-in to your account" alerts from the server. */
  const [alert, setAlert] = useState<{ title: string; text: string } | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(readInviteFromUrl);
  const [profileLink, setProfileLink] = useState<string | null>(readProfileFromUrl);
  /** Message to scroll to when a chat opens from search. */
  const [jump, setJump] = useState<{ roomId: string; messageId: string } | null>(null);

  // Refs so the lobby handler always sees fresh values without reconnecting.
  const activeIdRef = useRef(activeId);
  const meRef = useRef(me);
  const roomsRef = useRef(rooms);
  useEffect(() => {
    activeIdRef.current = activeId;
    meRef.current = me;
    roomsRef.current = rooms;
  }, [activeId, me, rooms]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refreshSite = useCallback(() => {
    api
      .site()
      .then((r) => setSite(r.site))
      // Never let a failed request keep the app offline: assume normal operation.
      .catch(() => setSite((s) => s ?? { announcement: null, registrationOpen: true, maintenance: false }));
  }, []);
  useEffect(refreshSite, [refreshSite]);

  // Incoming requests we've already told the user about (null until the first load).
  const knownRequests = useRef<Set<string> | null>(null);

  const refreshRooms = useCallback(async () => {
    try {
      const { rooms } = await api.rooms();
      const incoming = rooms.filter((r) => r.status === "pending" && r.requestedBy !== meRef.current.id);
      if (knownRequests.current) {
        for (const r of incoming) {
          if (!knownRequests.current.has(r.id)) {
            notify(meRef.current, roomTitle(r), r.secret ? "Invited you to a secret chat 🔒" : "Sent you a friend request", () => setActiveId(r.id));
          }
        }
      }
      knownRequests.current = new Set(incoming.map((r) => r.id));
      // The open chat is being read right now, so it has no unread messages.
      setRooms(rooms.map((r) => (r.id === activeIdRef.current ? { ...r, unreadCount: 0 } : r)));
      // The open chat was deleted (or you were removed): close it.
      if (activeIdRef.current && !rooms.some((r) => r.id === activeIdRef.current)) setActiveId(null);
    } catch {
      // keep the current list; next refresh will retry
    } finally {
      setRoomsLoaded(true);
    }
  }, []);

  // Live app-wide events: presence, new messages in other chats, new chats.
  const onLobbyEvent = useCallback(
    (e: LobbyEvent | { type: "connected" }) => {
      switch (e.type) {
        case "connected":
        case "rooms-changed":
          refreshRooms();
          break;
        case "site-changed":
          refreshSite();
          break;
        case "hello":
          setPresence(Object.fromEntries(e.online.map((id) => [id, { online: true, lastSeenAt: null }])));
          break;
        case "presence":
          setPresence((p) => ({ ...p, [e.userId]: { online: e.online, lastSeenAt: e.lastSeenAt } }));
          break;
        case "activity": {
          const mine = e.fromUserId === meRef.current.id;
          const isOpen = e.roomId === activeIdRef.current;
          const away = document.visibilityState !== "visible";
          const room = roomsRef.current.find((r) => r.id === e.roomId);
          const mentioned = !!e.mentions?.includes(meRef.current.id);
          setRooms((prev) => {
            const r = prev.find((x) => x.id === e.roomId);
            if (!r) return prev;
            const updated: Room = {
              ...r,
              lastMessage: e.lastMessage,
              unreadCount: mine || isOpen ? r.unreadCount : r.unreadCount + 1,
              mentions: mentioned && !isOpen ? r.mentions + 1 : r.mentions,
            };
            return [updated, ...prev.filter((x) => x.id !== e.roomId)];
          });
          if (!room) refreshRooms();
          // Muted chats stay quiet, except when someone @mentions or replies to you (like Telegram).
          const quiet = e.silent || (room ? isMuted(room) && !mentioned : false);
          if (!mine && !quiet && (!isOpen || away)) {
            const title = room?.type === "group" ? `${e.fromName} · ${roomTitle(room)}` : e.fromName;
            notify(meRef.current, mentioned && room?.type === "group" ? `${title} mentioned you` : title, e.lastMessage.preview, () => setActiveId(e.roomId));
          }
          break;
        }
        case "signed-out":
          window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
          break;
        case "security":
          setAlert({ title: e.title, text: e.text });
          notify(meRef.current, e.title, e.text, () => setSettingsOpen(true), true);
          break;
        case "call":
          calls.handle(e);
          break;
      }
    },
    [refreshRooms, refreshSite],
  );
  const lockedOut = !!site?.maintenance && me.role !== "admin";
  // Wait for the site settings before connecting (no pointless connection during maintenance).
  const lobbyEnabled = site !== null && !lockedOut;
  const { status: lobbyStatus, send: lobbySend } = useLobbySocket(onLobbyEvent, lobbyEnabled);

  // Calls use your noise suppression / echo cancellation settings.
  useEffect(() => {
    void calls.setVoice(me.settings);
  }, [me.settings]);

  /** Voice settings changed from inside a call: save them like any other setting. */
  const onVoiceChange = useCallback(
    async (patch: Partial<Settings>) => {
      const before = meRef.current;
      onMeUpdated({ ...before, settings: { ...before.settings, ...patch } });
      try {
        const { user } = await api.account.update({ settings: patch });
        onMeUpdated(user);
      } catch {
        onMeUpdated(before);
      }
    },
    [onMeUpdated],
  );

  // Calls use the app-wide socket for signaling, and log a record into the chat when they end.
  useEffect(() => {
    calls.setTransport((env) => lobbySend(env));
    calls.onRecord = postCallRecord;
    calls.onIncoming = (name, video) => {
      const m = meRef.current;
      if (!m.settings.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
      if (document.visibilityState === "visible" && document.hasFocus()) return;
      try {
        const n = new Notification(name, { body: `Incoming ${video ? "video" : "voice"} call`, icon: "/icon-192.png", tag: "relay:call", requireInteraction: true });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // notifications unavailable
      }
    };
    return () => calls.setTransport(null);
  }, [lobbySend]);

  // Safety net in case a live event is ever missed.
  useEffect(() => {
    const interval = window.setInterval(refreshRooms, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshRooms]);

  // Unread count in the browser tab title and on the installed app's icon (muted chats don't count).
  const totalUnread = useMemo(() => rooms.reduce((n, r) => n + (isMuted(r) || r.archived ? 0 : r.unreadCount), 0), [rooms]);
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Relay` : "Relay";
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (totalUnread) nav.setAppBadge?.(totalUnread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [totalUnread]);

  const selectRoom = useCallback((id: string | null) => {
    setActiveId(id);
    if (id) setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, unreadCount: 0, mentions: 0 } : r)));
  }, []);

  // Keyboard shortcuts (like Discord): Ctrl/⌘+K jumps to any chat, Alt+↑/↓ moves between chats.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen((o) => !o);
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const list = roomsRef.current.filter((r) => !r.archived);
        if (!list.length) return;
        e.preventDefault();
        const i = list.findIndex((r) => r.id === activeIdRef.current);
        const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i <= 0 ? list.length : i) - 1;
        selectRoom(list[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectRoom]);

  /** Puts a room from the server into the list (new or updated) and opens it. */
  const upsertAndOpen = useCallback(
    (room: Room) => {
      setRooms((prev) => [room, ...prev.filter((r) => r.id !== room.id)]);
      selectRoom(room.id);
    },
    [selectRoom],
  );

  const openDm = useCallback(
    async (username: string) => {
      const { room } = await api.openDm(username);
      upsertAndOpen(room);
    },
    [upsertAndOpen],
  );

  const openSaved = useCallback(async () => {
    try {
      const { room } = await api.openSaved();
      upsertAndOpen(room);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "Couldn't open Saved Messages.");
    }
  }, [upsertAndOpen]);

  const updateRoom = useCallback((room: Room) => {
    setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...room, unreadCount: r.id === activeIdRef.current ? 0 : room.unreadCount } : r)));
  }, []);

  /** Pin / archive / mute: applied instantly, then confirmed by the server. */
  const onPrefs = useCallback(
    async (room: Room, patch: { pinned?: boolean; archived?: boolean; mutedUntil?: number | null }) => {
      const optimistic: Room = {
        ...room,
        ...(patch.pinned !== undefined && { pinned: patch.pinned }),
        ...(patch.archived !== undefined && { archived: patch.archived, pinned: patch.archived ? false : room.pinned }),
        ...(patch.mutedUntil !== undefined && { mutedUntil: patch.mutedUntil }),
      };
      updateRoom(optimistic);
      try {
        const { room: saved } = await api.updatePrefs(room.id, patch);
        updateRoom(saved);
        if (patch.archived && activeIdRef.current === room.id) setActiveId(null);
      } catch (err) {
        updateRoom(room);
        setToast(err instanceof ApiError ? err.message : "Couldn't change that.");
      }
    },
    [updateRoom],
  );

  const deleteRoom = useCallback(async (room: Room) => {
    if (room.type === "group" && room.role !== "admin") await api.removeMember(room.id, meRef.current.id);
    else await api.deleteChat(room.id);
    if (room.secret) await forgetKey(room.id);
    setRooms((prev) => prev.filter((r) => r.id !== room.id));
    setActiveId((id) => (id === room.id ? null : id));
  }, []);

  /** Starts a secret chat from a normal 1:1 chat (keys are made on this device). */
  const startSecret = useCallback(
    async (dm: Room) => {
      if (!e2eSupported()) throw new Error("This browser can't do secret chats.");
      const pending = `pending-${crypto.randomUUID()}`;
      const key = await createDeviceKey(pending);
      try {
        const { room, existing } = await api.startSecret(dm.id, key);
        if (existing) await forgetKey(pending);
        else await adoptKey(pending, room.id);
        upsertAndOpen(room);
        if (existing) setToast("You already have a secret chat with them.");
      } catch (err) {
        await forgetKey(pending);
        throw err;
      }
    },
    [upsertAndOpen],
  );

  // Keep the open chat's preview in sync (edits/deletes/own messages) and on top.
  const onActivity = useCallback((roomId: string, message: Message) => {
    setRooms((prev) => {
      const room = prev.find((r) => r.id === roomId);
      if (!room) return prev;
      const updated: Room = {
        ...room,
        unreadCount: 0,
        lastMessage: { preview: messagePreview(message), createdAt: message.createdAt, userId: message.userId },
      };
      return [updated, ...prev.filter((r) => r.id !== roomId)];
    });
  }, []);

  const active = rooms.find((r) => r.id === activeId) ?? null;

  const acceptRequest = useCallback(async (roomId: string) => {
    const { room } = await api.acceptRequest(roomId);
    setRooms((prev) => prev.map((r) => (r.id === roomId ? room : r)));
  }, []);

  const declineRequest = useCallback(async (roomId: string) => {
    await api.declineRequest(roomId);
    await forgetKey(roomId);
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
    setActiveId((id) => (id === roomId ? null : id));
  }, []);

  const blockUser = useCallback(async (user: User) => {
    await api.blockUser(user.id);
    setRooms((prev) => prev.map((r) => (r.peer?.id === user.id ? { ...r, blocked: true } : r)));
  }, []);

  const unblockUser = useCallback(async (user: User) => {
    await api.unblockUser(user.id);
    setRooms((prev) => prev.map((r) => (r.peer?.id === user.id ? { ...r, blocked: false } : r)));
  }, []);

  const startCall = useCallback((room: Room, video: boolean) => {
    if (!room.peer) return;
    void calls.start(room.id, { id: room.peer.id, name: room.peer.displayName }, video);
  }, []);

  const callMinimized = useCallMinimized();
  const [callPeerId, setCallPeerId] = useState<string | null>(null);
  useEffect(() => calls.subscribe(() => setCallPeerId(calls.getState().peerId)), []);
  const callPeer = rooms.find((r) => r.peer?.id === callPeerId)?.peer ?? null;
  const callScreen = <CallScreen peer={callPeer} voice={me.settings} onVoiceChange={onVoiceChange} />;

  // Maintenance mode: everyone but admins waits.
  if (lockedOut) {
    return <MaintenanceScreen onLogout={onLogout} onRetry={refreshSite} />;
  }

  if (adminOpen && me.role === "admin") {
    return (
      <>
        <Suspense fallback={<div className="flex h-dvh items-center justify-center"><Logo size={40} /></div>}>
          <AdminPanel me={me} onClose={() => setAdminOpen(false)} callPill={<CallPill peer={callPeer} />} />
        </Suspense>
        {callScreen}
      </>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden md:gap-2 md:p-2">
      <div
        className={`panel w-full shrink-0 md:block md:w-80 lg:w-96 ${active ? "hidden" : "block"}`}
      >
        <Sidebar
          me={me}
          rooms={rooms}
          loaded={roomsLoaded}
          activeId={activeId}
          presence={presence}
          connected={lobbyStatus === "open"}
          site={site}
          onSelect={(id) => {
            setJump(null);
            selectRoom(id);
          }}
          onJump={(roomId, messageId) => {
            setJump({ roomId, messageId });
            selectRoom(roomId);
          }}
          onOpenDm={openDm}
          onOpenSaved={openSaved}
          onNewGroup={() => setNewGroupOpen(true)}
          onOpenAdmin={me.role === "admin" ? () => setAdminOpen(true) : undefined}
          onOpenSettings={() => setSettingsOpen(true)}
          onPrefs={onPrefs}
          onDelete={setConfirmDelete}
          callPill={!active && callMinimized ? <CallPill peer={callPeer} /> : null}
        />
      </div>

      <div className={`min-w-0 flex-1 ${active ? "flex" : "hidden md:flex"}`}>
        {active ? (
          <ChatPane
            key={active.id}
            room={active}
            rooms={rooms}
            me={me}
            peerPresence={active.peer ? presence[active.peer.id] : undefined}
            onBack={() => selectRoom(null)}
            onActivity={onActivity}
            onStartCall={(video) => startCall(active, video)}
            callPeer={callPeer}
            onAcceptRequest={acceptRequest}
            onDeclineRequest={declineRequest}
            onBlock={blockUser}
            onUnblock={unblockUser}
            onPrefs={onPrefs}
            onDelete={setConfirmDelete}
            onRoomUpdated={updateRoom}
            onRoomsChanged={refreshRooms}
            onStartSecret={startSecret}
            onOpenRoom={selectRoom}
            initialJump={jump?.roomId === active.id ? jump.messageId : null}
          />
        ) : (
          <div className="panel chat-wall flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-accent/10 text-accent-fg">
              <ChatIcon className="size-8" />
            </div>
            <h2 className="mt-5 text-lg font-semibold">Your messages</h2>
            <p className="mt-1 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              Pick a conversation, or search for a friend's username to start a new one.
            </p>
            <p className="mt-6 flex items-center gap-1.5 text-xs text-zinc-400">
              <LockIcon className="size-3.5" /> Start a secret chat from any 1:1 chat for end-to-end encryption.
            </p>
          </div>
        )}
      </div>

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog me={me} onClose={() => setSettingsOpen(false)} onMeUpdated={onMeUpdated} onLogout={onLogout} />
        </Suspense>
      )}
      {newGroupOpen && <NewGroupDialog rooms={rooms} onCreated={upsertAndOpen} onClose={() => setNewGroupOpen(false)} />}
      {switcherOpen && <QuickSwitcher rooms={rooms} me={me} onPick={selectRoom} onClose={() => setSwitcherOpen(false)} />}
      {profileLink && (
        <ConfirmDialog
          title={profileLink.toLowerCase() === me.username.toLowerCase() ? "That's you!" : `Chat with @${profileLink}?`}
          message={
            profileLink.toLowerCase() === me.username.toLowerCase()
              ? "This is your own profile link. Share it so friends can find you."
              : "If you're not friends yet, they'll get a friend request from you."
          }
          confirmLabel={profileLink.toLowerCase() === me.username.toLowerCase() ? "OK" : "Open chat"}
          onConfirm={async () => {
            if (profileLink.toLowerCase() !== me.username.toLowerCase()) await openDm(profileLink);
          }}
          onClose={() => setProfileLink(null)}
        />
      )}
      {inviteCode && <InviteDialog code={inviteCode} onJoined={upsertAndOpen} onOpen={selectRoom} onClose={() => setInviteCode(null)} />}
      {alert && (
        <div role="alert" className="slide-up fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 flex w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 items-start gap-3 rounded-2xl bg-white p-3.5 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            <KeyIcon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{alert.title}</p>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{alert.text}</p>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Not you?{" "}
              <button
                onClick={() => {
                  setAlert(null);
                  setSettingsOpen(true);
                }}
                className="font-semibold text-accent-fg hover:underline"
              >
                Review your devices
              </button>
            </p>
          </div>
          <button onClick={() => setAlert(null)} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Dismiss">
            <XIcon className="size-4" />
          </button>
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={deleteTitle(confirmDelete)}
          message={deleteMessage(confirmDelete)}
          confirmLabel={deleteTitle(confirmDelete)}
          danger
          onConfirm={() => deleteRoom(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
      {toast && (
        <div role="status" className="fade-in fixed bottom-6 left-1/2 z-50 max-w-[90%] -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-white dark:text-zinc-900">
          {toast}
        </div>
      )}
      {callScreen}
    </div>
  );
}

function deleteTitle(room: Room): string {
  if (room.type === "group") return room.role === "admin" ? "Delete group" : "Leave group";
  if (room.secret) return "End secret chat";
  return room.saved ? "Clear Saved Messages" : "Delete chat";
}

function deleteMessage(room: Room): string {
  const name = roomTitle(room);
  if (room.type === "group") {
    return room.role === "admin"
      ? `"${name}" and all its messages will be deleted for everyone in it. This can't be undone.`
      : `You'll leave "${name}" and stop getting its messages.`;
  }
  if (room.secret) return `The secret chat with ${name} and its messages will be destroyed on both sides. This can't be undone.`;
  if (room.saved) return "Everything in Saved Messages will be deleted. This can't be undone.";
  return `The chat with ${name} and all its messages, photos and files will be deleted for both of you. You'll need to send a new friend request to talk again.`;
}

function MaintenanceScreen({ onLogout, onRetry }: { onLogout: () => void; onRetry: () => void }) {
  useEffect(() => {
    const t = window.setInterval(onRetry, 30_000);
    return () => window.clearInterval(t);
  }, [onRetry]);
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        <WrenchIcon className="size-8" />
      </span>
      <h1 className="text-xl font-semibold">Back soon</h1>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">Relay is getting some maintenance. Your chats are safe; this page will reload by itself when we're back.</p>
      <button onClick={onLogout} className="rounded-xl px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/10">
        Sign out
      </button>
    </div>
  );
}

/**
 * Writes a call record ("Missed video call", "Voice call · 3:20") into the chat.
 * Uses a short-lived connection to the room, so it works even if you've
 * navigated to another chat during the call.
 */
function postCallRecord(roomId: string, call: CallInfo) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${roomId}/ws`);
  const clientId = crypto.randomUUID();
  const timeout = window.setTimeout(() => ws.close(), 5000);
  ws.onopen = () => {
    const event: ClientEvent = { type: "send", clientId, kind: "call", body: "", meta: { call } };
    ws.send(JSON.stringify(event));
  };
  ws.onmessage = (e) => {
    if (typeof e.data === "string" && e.data.includes(clientId)) {
      window.clearTimeout(timeout);
      ws.close();
    }
  };
}

/** Sound + notification for a message in a chat you're not looking at. Do Not Disturb silences everything but security alerts. */
function notify(me: Me, from: string, body: string, onClick: () => void, important = false) {
  if (me.settings.presence === "dnd" && !important) return;
  if (me.settings.sounds) playMessageSound();
  if (!me.settings.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  const text = me.settings.notificationPreview ? plainText(body) : "New message";
  try {
    const n = new Notification(from, { body: text, icon: "/icon-192.png", tag: `relay:${from}` });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
    navigator.serviceWorker?.ready.then((reg) => reg.showNotification(from, { body: text, icon: "/icon-192.png", tag: `relay:${from}` })).catch(() => {});
  }
}
