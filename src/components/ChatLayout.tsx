import { useCallback, useEffect, useState } from "react";
import type { Message, Room, User } from "../../shared/types";
import { api } from "../lib/api";
import { AccountDialog } from "./AccountDialog";
import { AdminPanel } from "./AdminPanel";
import { ChatPane } from "./ChatPane";
import { Sidebar } from "./Sidebar";
import { ChatIcon } from "./ui";

export function roomTitle(room: Room): string {
  return room.type === "dm" ? (room.peer?.displayName ?? "Unknown") : (room.name ?? "Group");
}

export function ChatLayout({
  me,
  onLogout,
  onUserUpdated,
}: {
  me: User;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const refreshRooms = useCallback(async () => {
    try {
      const { rooms } = await api.rooms();
      setRooms(rooms);
    } catch {
      // keep the current list; next refresh will retry
    } finally {
      setRoomsLoaded(true);
    }
  }, []);

  // Keep the list fresh (new chats started by friends, messages in other rooms).
  useEffect(() => {
    refreshRooms();
    const interval = window.setInterval(refreshRooms, 15_000);
    window.addEventListener("focus", refreshRooms);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshRooms);
    };
  }, [refreshRooms]);

  const openDm = useCallback(async (username: string) => {
    const { room } = await api.openDm(username);
    setRooms((prev) => [room, ...prev.filter((r) => r.id !== room.id)]);
    setActiveId(room.id);
  }, []);

  // Live-update the active room's preview and move it to the top.
  const onActivity = useCallback((roomId: string, message: Message) => {
    setRooms((prev) => {
      const room = prev.find((r) => r.id === roomId);
      if (!room) return prev;
      const updated: Room = {
        ...room,
        lastMessage: { body: message.body, createdAt: message.createdAt, userId: message.userId },
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
          onSelect={setActiveId}
          onOpenDm={openDm}
          onLogout={onLogout}
          onOpenAdmin={me.role === "admin" ? () => setAdminOpen(true) : undefined}
          onOpenAccount={() => setAccountOpen(true)}
        />
        {accountOpen && (
          <AccountDialog me={me} onClose={() => setAccountOpen(false)} onUserUpdated={onUserUpdated} />
        )}
      </div>

      <div className={`min-w-0 flex-1 ${active ? "flex" : "hidden md:flex"}`}>
        {active ? (
          <ChatPane
            key={active.id}
            room={active}
            me={me}
            onBack={() => setActiveId(null)}
            onActivity={onActivity}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-white p-8 text-center dark:bg-zinc-900">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <ChatIcon className="size-8" />
            </div>
            <h2 className="mt-5 text-lg font-semibold">Your messages</h2>
            <p className="mt-1 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              Pick a conversation, or search for a friend's username to start a new one.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
