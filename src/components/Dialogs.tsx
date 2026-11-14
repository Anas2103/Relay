import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LIMITS, type Room, type User } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { RoomAvatar, roomTitle } from "./RoomAvatar";
import { Avatar, CheckIcon, SearchIcon, Spinner, XIcon } from "./ui";

/** Phones (or narrow windows) get bottom sheets; bigger screens get centered dialogs and popovers. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setCompact(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return compact;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** A modal panel: bottom sheet on phones, centered card on desktop. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEscape(onClose);
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`slide-up flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:rounded-3xl dark:bg-zinc-900 ${
          wide ? "md:max-w-2xl" : "md:max-w-md"
        }`}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300 md:hidden dark:bg-zinc-700" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2 md:pt-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Close">
            <XIcon className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-zinc-200 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}

export interface MenuItem {
  icon?: ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}

/** Context menu: a popover at the pointer on desktop, a bottom sheet on phones. */
export function PopMenu({
  at,
  title,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  title?: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  const compact = useCompact();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEscape(onClose);

  useLayoutEffect(() => {
    if (compact || !ref.current) return;
    const width = ref.current.offsetWidth;
    const height = ref.current.offsetHeight;
    const m = 8;
    setPos({
      top: Math.min(Math.max(m, Number.isFinite(at.y) ? at.y : m), window.innerHeight - height - m),
      left: Math.min(Math.max(m, Number.isFinite(at.x) ? at.x : m), window.innerWidth - width - m),
    });
  }, [at, compact]);

  const list = (
    <ul className="py-1 text-sm" role="menu">
      {items.map((item) => (
        <li key={item.label}>
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-zinc-100 md:px-3 md:py-2.5 dark:hover:bg-zinc-700/60 ${
              item.danger ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {item.icon && <span className="shrink-0 opacity-80 [&>svg]:size-[1.15rem]">{item.icon}</span>}
            <span className="min-w-0 flex-1">
              {item.label}
              {item.hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{item.hint}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <div className="fade-in fixed inset-0 z-50 flex items-end bg-zinc-950/40" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
        <div className="slide-up w-full rounded-t-3xl bg-white pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-zinc-800" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" aria-hidden="true" />
          {title && <p className="truncate px-4 pt-3 pb-1 text-sm font-semibold text-zinc-500 dark:text-zinc-400">{title}</p>}
          {list}
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        className="pop-in fixed w-64 overflow-hidden rounded-2xl bg-white p-1 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10"
        style={pos ?? { visibility: "hidden", top: 0, left: 0 }}
      >
        {list}
      </div>
    </div>
  );
}

/** The people you can add to groups: friends from accepted 1:1 chats (no blocks). */
export function friendsFrom(rooms: Room[]): User[] {
  const seen = new Map<string, User>();
  for (const r of rooms) {
    if (r.type === "dm" && !r.saved && r.status === "accepted" && r.peer && !r.blocked && !r.blockedMe) seen.set(r.peer.id, r.peer);
  }
  return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-zinc-100 py-2.5 pr-3 pl-9 text-sm outline-none focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800"
      />
    </div>
  );
}

/** Pick several people (with search and removable chips). */
export function PeoplePicker({
  people,
  selected,
  onToggle,
  empty,
}: {
  people: User[];
  selected: Set<string>;
  onToggle: (u: User) => void;
  empty: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? people.filter((p) => p.displayName.toLowerCase().includes(s) || p.username.toLowerCase().includes(s)) : people;
  }, [people, q]);
  const chosen = people.filter((p) => selected.has(p.id));

  return (
    <div className="space-y-3">
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((u) => (
            <button
              key={u.id}
              onClick={() => onToggle(u)}
              className="pop-in flex items-center gap-1.5 rounded-full bg-accent/15 py-0.5 pr-2 pl-0.5 text-sm font-medium text-accent-fg"
              aria-label={`Remove ${u.displayName}`}
            >
              <Avatar name={u.displayName} seed={u.id} user={u} size="xs" />
              {u.displayName.split(" ")[0]}
              <XIcon className="size-3.5" />
            </button>
          ))}
        </div>
      )}
      {people.length > 6 && <SearchBox value={q} onChange={setQ} placeholder="Search friends" />}
      {people.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((u) => {
            const on = selected.has(u.id);
            return (
              <li key={u.id}>
                <button
                  onClick={() => onToggle(u)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Avatar name={u.displayName} seed={u.id} user={u} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.displayName}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">@{u.username}</span>
                  </span>
                  <span
                    className={`flex size-6 items-center justify-center rounded-full ring-2 transition ${
                      on ? "bg-accent text-accent-ink ring-accent" : "ring-zinc-300 dark:ring-zinc-600"
                    }`}
                  >
                    {on && <CheckIcon className="size-3.5" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const primary =
  "flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-50";

export function NewGroupDialog({ rooms, onCreated, onClose }: { rooms: Room[]; onCreated: (room: Room) => void; onClose: () => void }) {
  const people = useMemo(() => friendsFrom(rooms), [rooms]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { room } = await api.createGroup(name, [...selected]);
      onCreated(room);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="New group"
      onClose={onClose}
      footer={
        <>
          {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button className={primary} disabled={busy || !name.trim() || selected.size === 0} onClick={create}>
            {busy && <Spinner />}
            Create group{selected.size ? ` · ${selected.size + 1} people` : ""}
          </button>
        </>
      }
    >
      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm font-medium">Group name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.groupNameMax}
          placeholder="Weekend plans 🌴"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>
      <p className="mb-2 text-sm font-medium">Add friends</p>
      <PeoplePicker
        people={people}
        selected={selected}
        onToggle={(u) =>
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(u.id)) n.delete(u.id);
            else n.add(u.id);
            return n;
          })
        }
        empty="Groups are made from friends. Add a friend first, then come back."
      />
    </Sheet>
  );
}

export function AddMembersDialog({
  room,
  rooms,
  existing,
  onAdded,
  onClose,
}: {
  room: Room;
  rooms: Room[];
  existing: string[];
  onAdded: () => void;
  onClose: () => void;
}) {
  const people = useMemo(() => friendsFrom(rooms).filter((u) => !existing.includes(u.id)), [rooms, existing]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.addMembers(room.id, [...selected]);
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add them.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Add to ${roomTitle(room)}`}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button className={primary} disabled={busy || selected.size === 0} onClick={add}>
            {busy && <Spinner />}
            Add{selected.size ? ` ${selected.size}` : ""}
          </button>
        </>
      }
    >
      <PeoplePicker
        people={people}
        selected={selected}
        onToggle={(u) =>
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(u.id)) n.delete(u.id);
            else n.add(u.id);
            return n;
          })
        }
        empty="All your friends are already in this group."
      />
    </Sheet>
  );
}

/** Pick a chat to forward to. Secret chats are left out (their messages never leave them). */
export function ForwardDialog({
  rooms,
  fromRoomId,
  onPick,
  onClose,
}: {
  rooms: Room[];
  fromRoomId: string;
  onPick: (room: Room) => Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targets = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rooms
      .filter((r) => r.status === "accepted" && !r.secret && !r.blocked && !r.blockedMe)
      .filter((r) => !s || roomTitle(r).toLowerCase().includes(s))
      .sort((a, b) => Number(b.saved) - Number(a.saved) || Number(b.id === fromRoomId) - Number(a.id === fromRoomId));
  }, [rooms, q, fromRoomId]);

  async function pick(r: Room) {
    setBusy(r.id);
    setError(null);
    try {
      await onPick(r);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't forward.");
      setBusy(null);
    }
  }

  return (
    <Sheet title="Forward to…" onClose={onClose}>
      <div className="sticky top-0 z-10 bg-white pb-2 dark:bg-zinc-900">
        <SearchBox value={q} onChange={setQ} placeholder="Search chats" />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
      <ul className="-mx-2 space-y-0.5">
        {targets.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => pick(r)}
              disabled={busy !== null}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
            >
              <RoomAvatar room={r} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{roomTitle(r)}</span>
              {busy === r.id && <Spinner className="size-4 text-zinc-400" />}
            </button>
          </li>
        ))}
        {targets.length === 0 && <li className="py-8 text-center text-sm text-zinc-500">No chats found.</li>}
      </ul>
    </Sheet>
  );
}

/** Small confirm dialog with a clear danger action (instead of the browser's confirm()). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800">
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong.");
                setBusy(false);
              }
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ${
              danger ? "bg-red-600 text-white hover:bg-red-500" : "bg-accent text-accent-ink hover:opacity-90"
            }`}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="text-sm text-zinc-600 dark:text-zinc-300">{message}</div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Sheet>
  );
}
