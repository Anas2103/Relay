import type { Room } from "../../shared/types";
import { groupPhotoUrl } from "../lib/api";
import { Avatar, BookmarkIcon, LockIcon, UsersIcon } from "./ui";

const SIZES = { xs: "size-6", sm: "size-8", md: "size-10", lg: "size-12", xl: "size-24" } as const;
const ICONS = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-6", xl: "size-11" } as const;

export function roomTitle(room: Room): string {
  if (room.saved) return "Saved Messages";
  return room.type === "dm" ? (room.peer?.displayName ?? "Deleted account") : (room.name ?? "Group");
}

/** Avatar for any chat: Saved Messages (bookmark), groups (initials), secret chats (with a lock badge). */
export function RoomAvatar({
  room,
  size = "md",
  online,
}: {
  room: Room;
  size?: keyof typeof SIZES;
  online?: boolean;
}) {
  if (room.saved) {
    return (
      <span className={`${SIZES[size]} avatar-shape inline-flex shrink-0 items-center justify-center bg-accent text-accent-ink`} aria-hidden="true">
        <BookmarkIcon className={ICONS[size]} />
      </span>
    );
  }
  if (room.type === "group" && room.avatarVersion) {
    return <Avatar name={roomTitle(room)} seed={room.id} src={groupPhotoUrl(room)} size={size} />;
  }
  if (room.type === "group" && size === "xl") {
    return (
      <span className={`${SIZES[size]} avatar-shape inline-flex shrink-0 items-center justify-center bg-accent/15 text-accent-fg`} aria-hidden="true">
        <UsersIcon className={ICONS[size]} />
      </span>
    );
  }
  const avatar = <Avatar name={roomTitle(room)} seed={room.peer?.id ?? room.id} user={room.peer} size={size} online={online} />;
  if (!room.secret) return avatar;
  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <span
        className="absolute -bottom-0.5 -left-0.5 flex size-[45%] max-h-6 max-w-6 min-h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 text-white ring-2 ring-white dark:ring-zinc-900"
        aria-label="Secret chat"
      >
        <LockIcon className="size-[65%]" />
      </span>
    </span>
  );
}
