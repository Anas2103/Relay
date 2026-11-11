import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LobbyEvent, Me, Message, Room } from "../../shared/types";
import { messagePreview } from "../../shared/types";
import { api } from "../lib/api";
import { playMessageSound } from "../lib/sound";
import { useLobbySocket } from "../lib/useRoomSocket";
import { AdminPanel } from "./AdminPanel";
import { ChatPane } from "./ChatPane";
import { ProfileSheet } from "./ProfileSheet";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { ChatIcon } from "./ui";

export function roomTitle(room: Room): string {
  return room.type === "dm" ? (room.peer?.displayName ?? "Unknown") : (room.name ?? "Group");
}

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
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMap>({});

  // Refs so the lobby handler always sees fresh values without reconnecting.
  const activeIdRef = useRef(activeId);
  const meRef = useRef(me);
  useEffect(() => {
    activeIdRef.current = activeId;
    meRef.current = me;
  }, [activeId, me]);

  const refreshRooms = useCallback(async () => {
    try {
      const { rooms } = await api.rooms();
      // The open chat is being read right now, so it has no unread messages.
      setRooms(rooms.map((r) => (r.id === activeIdRef.current ? { ...r, unreadCount: 0 } : r)));
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
          let known = false;
          setRooms((prev) => {
            const room = prev.find((r) => r.id === e.roomId);
            if (!room) return prev;
            known = true;
            const updated: Room = {
              ...room,
              lastMessage: e.lastMessage,
              unreadCount: mine || isOpen ? room.unreadCount : room.unreadCount + 1,
            };
            return [updated, ...prev.filter((r) => r.id !== e.roomId)];
          });
          if (!known) refreshRooms();
          if (!mine && (!isOpen || away)) notify(meRef.current, e.fromName, e.lastMessage.preview, () => setActiveId(e.roomId));
          break;
        }
      }
    },
    [refreshRooms],
  );
  const lobbyStatus = useLobbySocket(onLobbyEvent);

  // Safety net in case a live event is ever missed.
  useEffect(() => {
    const interval = window.setInterval(refreshRooms, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshRooms]);

  // Unread count in the browser tab title.
  const totalUnread = useMemo(() => rooms.reduce((n, r) => n + r.unreadCount, 0), [rooms]);
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Relay` : "Relay";
  }, [totalUnread]);

  const selectRoom = useCallback((id: string | null) => {
    setActiveId(id);
    if (id) setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, unreadCount: 0 } : r)));
  }, []);

  const openDm = useCallback(
    async (username: string) => {
      const { room } = await api.openDm(username);
      setRooms((prev) => [room, ...prev.filter((r) => r.id !== room.id)]);
      selectRoom(room.id);
    },
    [selectRoom],
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

  if (adminOpen && me.role === "admin") {
    return <AdminPanel me={me} onClose={() => setAdminOpen(false)} />;
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <div
        className={`w-full shrink-0 border-r border-zinc-200 md:block md:w-80 lg:w-96 dark:border-zinc-800 ${
          active ? "hidden" : "block"
        }`}
      >
        <Sidebar
          me={me}
          rooms={rooms}
          loaded={roomsLoaded}
          activeId={activeId}
          presence={presence}
          connected={lobbyStatus === "open"}
          onSelect={selectRoom}
          onOpenDm={openDm}
          onLogout={onLogout}
          onOpenAdmin={me.role === "admin" ? () => setAdminOpen(true) : undefined}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      <div className={`min-w-0 flex-1 ${active ? "flex" : "hidden md:flex"}`}>
        {active ? (
          <ChatPane
            key={active.id}
            room={active}
            me={me}
            peerPresence={active.peer ? presence[active.peer.id] : undefined}
            onBack={() => selectRoom(null)}
            onActivity={onActivity}
            onOpenProfile={setProfileUserId}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-white p-8 text-center dark:bg-zinc-900">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-bubble/10 text-bubble-fg">
              <ChatIcon className="size-8" />
            </div>
            <h2 className="mt-5 text-lg font-semibold">Your messages</h2>
            <p className="mt-1 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              Pick a conversation, or search for a friend's username to start a new one.
            </p>
          </div>
        )}
      </div>

      {settingsOpen && <SettingsDialog me={me} onClose={() => setSettingsOpen(false)} onMeUpdated={onMeUpdated} />}
      {profileUserId && (
        <ProfileSheet
          userId={profileUserId}
          me={me}
          presence={presence[profileUserId]}
          onClose={() => setProfileUserId(null)}
          onEditProfile={() => {
            setProfileUserId(null);
            setSettingsOpen(true);
          }}
        />
      )}
    </div>
  );
}

/** Sound + desktop notification for a message in a chat you're not looking at. */
function notify(me: Me, from: string, body: string, onClick: () => void) {
  if (me.settings.sounds) playMessageSound();
  if (!me.settings.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification(from, { body, icon: "/favicon.svg", tag: `relay:${from}` });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}
