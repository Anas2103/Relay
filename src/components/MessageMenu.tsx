import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UiMessage } from "./MessageBubble";
import { AlertIcon, CopyIcon, EditIcon, EyeIcon, ForwardIcon, PinIcon, ReplyIcon, SelectIcon, StarIcon, TrashIcon } from "./ui";

export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "👍"];

export type MenuAction = "reply" | "copy" | "edit" | "delete" | "pin" | "star" | "forward" | "select" | "report" | "seen" | { react: string };

/** Reaction bar + actions, anchored next to the long-pressed / right-clicked bubble. */
export function MessageMenu({
  message,
  rect,
  mine,
  myReaction,
  starred,
  canForward,
  seenCount,
  onAction,
  onClose,
}: {
  /** Groups, your own messages: how many people have read it. */
  seenCount?: number;
  message: UiMessage;
  rect: DOMRect;
  mine: boolean;
  myReaction: string | null;
  starred: boolean;
  canForward: boolean;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Place below the bubble if there's room, otherwise above; keep inside the screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height ignore the pop-in animation's scale, so the menu never lands half off-screen.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const margin = 8;
    const below = rect.bottom + margin + height < window.innerHeight;
    const top = below ? rect.bottom + margin : Math.max(margin, rect.top - height - margin);
    const preferred = mine ? rect.right - width : rect.left;
    const left = Math.min(Math.max(margin, preferred), window.innerWidth - width - margin);
    setPos({ top, left });
  }, [rect, mine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const locked = (message as UiMessage & { locked?: boolean }).locked === true;
  const canCopy = !locked && (message.kind === "text" || !!message.body);
  const canEdit = mine && message.kind === "text" && !locked;
  const canPin = message.kind !== "call";

  return (
    <div
      className="fade-in fixed inset-0 z-40 bg-zinc-950/20 backdrop-blur-[2px] dark:bg-black/50"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={ref}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        className="pop-in fixed w-[min(16rem,calc(100vw-1rem))] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      >
        <div className="flex justify-between border-b border-zinc-100 px-2 py-2 dark:border-zinc-700">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onAction({ react: emoji })}
              className={`flex size-9 items-center justify-center rounded-full text-xl transition hover:scale-110 hover:bg-zinc-100 active:scale-95 dark:hover:bg-zinc-700 ${
                myReaction === emoji ? "bg-accent/15 ring-2 ring-accent/40" : ""
              }`}
              aria-label={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="p-1 text-sm">
          <MenuItem icon={<ReplyIcon className="size-4" />} label="Reply" onClick={() => onAction("reply")} />
          {canCopy && <MenuItem icon={<CopyIcon className="size-4" />} label="Copy text" onClick={() => onAction("copy")} />}
          {canForward && <MenuItem icon={<ForwardIcon className="size-4" />} label="Forward" onClick={() => onAction("forward")} />}
          {canPin && (
            <MenuItem icon={<PinIcon className="size-4" />} label={message.pinnedAt ? "Unpin" : "Pin for everyone"} onClick={() => onAction("pin")} />
          )}
          <MenuItem icon={<StarIcon className="size-4" filled={starred} />} label={starred ? "Unstar" : "Star"} onClick={() => onAction("star")} />
          {canEdit && <MenuItem icon={<EditIcon className="size-4" />} label="Edit" onClick={() => onAction("edit")} />}
          <MenuItem icon={<SelectIcon className="size-4" />} label="Select" onClick={() => onAction("select")} />
          {seenCount !== undefined && <MenuItem icon={<EyeIcon className="size-4" />} label={seenCount ? `Seen by ${seenCount}` : "Not seen yet"} onClick={() => onAction("seen")} />}
          {!mine && message.kind !== "call" && <MenuItem icon={<AlertIcon className="size-4" />} label="Report" danger onClick={() => onAction("report")} />}
          {mine && (
            <MenuItem
              icon={<TrashIcon className="size-4" />}
              label={confirmDelete ? "Tap again to delete for everyone" : "Delete for everyone"}
              danger
              onClick={() => (confirmDelete ? onAction("delete") : setConfirmDelete(true))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-700/60 ${
        danger ? "text-red-600 dark:text-red-400" : ""
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
