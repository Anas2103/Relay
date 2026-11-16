import type { ReactNode } from "react";
import { isMuted, type Room } from "../../shared/types";
import type { ChillTab } from "./Chill";
import { RoomAvatar, roomTitle } from "./RoomAvatar";
import { GamepadIcon, Logo, MusicIcon, PlusIcon, SettingsIcon, ShieldIcon } from "./ui";

/** How many chats get a shortcut on the rail. */
const SHORTCUTS = 8;

/**
 * The narrow bar on the far left on desktop (like Discord's server list):
 * home, shortcuts to pinned and unread chats, then Chill, games and settings.
 */
export function Rail({
  rooms,
  activeId,
  chill,
  chillOn,
  onHome,
  onSelect,
  onNewGroup,
  onChill,
  onAdmin,
  onSettings,
}: {
  rooms: Room[];
  activeId: string | null;
  chill: ChillTab | null;
  chillOn: boolean;
  onHome: () => void;
  onSelect: (id: string) => void;
  onNewGroup?: () => void;
  onChill: (tab: ChillTab) => void;
  onAdmin?: () => void;
  onSettings: () => void;
}) {
  const shortcuts = rooms
    .filter((r) => !r.archived && r.status === "accepted" && (r.pinned || (r.unreadCount > 0 && !isMuted(r))))
    .sort((a, b) => Number(b.unreadCount > 0) - Number(a.unreadCount > 0) || Number(b.pinned) - Number(a.pinned))
    .slice(0, SHORTCUTS);
  const home = !chill && !shortcuts.some((r) => r.id === activeId);

  return (
    <nav className="rail flex h-full w-[72px] shrink-0 flex-col items-center gap-2 py-3" aria-label="Spaces">
      <RailItem label="All chats" active={home} onClick={onHome}>
        <span className="flex size-12 items-center justify-center">
          <Logo size={30} />
        </span>
      </RailItem>
      <span className="h-0.5 w-8 rounded-full bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto [scrollbar-width:none]">
        {shortcuts.map((r) => (
          <RailItem key={r.id} label={roomTitle(r)} active={r.id === activeId && !chill} unread={r.unreadCount} mentions={r.mentions} onClick={() => onSelect(r.id)}>
            <RoomAvatar room={r} size="lg" />
          </RailItem>
        ))}
        {onNewGroup && (
          <RailItem label="New group" onClick={onNewGroup}>
            <RailIcon tone="emerald">
              <PlusIcon className="size-6" />
            </RailIcon>
          </RailItem>
        )}
        {chillOn && (
          <>
            <RailItem label="Chill" active={!!chill && chill !== "games"} onClick={() => onChill("shorts")}>
              <RailIcon>
                <MusicIcon className="size-6" />
              </RailIcon>
            </RailItem>
            <RailItem label="Games" active={chill === "games"} onClick={() => onChill("games")}>
              <RailIcon>
                <GamepadIcon className="size-6" />
              </RailIcon>
            </RailItem>
          </>
        )}
      </div>

      {onAdmin && (
        <RailItem label="Admin panel" onClick={onAdmin}>
          <RailIcon tone="amber">
            <ShieldIcon className="size-6" />
          </RailIcon>
        </RailItem>
      )}
      <RailItem label="Settings" onClick={onSettings}>
        <RailIcon>
          <SettingsIcon className="size-6" />
        </RailIcon>
      </RailItem>
    </nav>
  );
}

/** One rail button: a pill on the left marks the open one (and unread ones), like Discord. */
function RailItem({
  label,
  active,
  unread = 0,
  mentions = 0,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  unread?: number;
  mentions?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group relative flex w-full justify-center">
      <span
        className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-zinc-900 transition-all dark:bg-white ${
          active ? "h-10" : unread ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5"
        }`}
        aria-hidden="true"
      />
      <button
        onClick={onClick}
        title={label}
        aria-label={unread ? `${label}, ${unread} unread` : label}
        aria-current={active ? "page" : undefined}
        className={`relative transition-[border-radius] ${active ? "rail-active" : ""}`}
      >
        {children}
        {unread > 0 && (
          <span className="absolute -right-1 -bottom-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white ring-4 ring-[var(--rail-bg)] tabular-nums">
            {mentions > 0 ? "@" : unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

function RailIcon({ tone, children }: { tone?: "emerald" | "amber"; children: ReactNode }) {
  const colors =
    tone === "emerald"
      ? "text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 group-hover:bg-amber-500 group-hover:text-white dark:text-amber-400"
        : "text-zinc-600 group-hover:bg-accent group-hover:text-accent-ink dark:text-zinc-300";
  return (
    <span
      className={`flex size-12 items-center justify-center rounded-3xl bg-white transition-all group-hover:rounded-2xl dark:bg-zinc-800 [.rail-active_&]:rounded-2xl [.rail-active_&]:bg-accent [.rail-active_&]:text-accent-ink ${colors}`}
    >
      {children}
    </span>
  );
}
