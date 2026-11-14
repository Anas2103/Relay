import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DISAPPEAR_OPTIONS,
  formatBytes,
  isMuted,
  LIMITS,
  MUTE_FOREVER,
  SLOW_MODE_OPTIONS,
  type GalleryTab,
  type GroupBan,
  type GroupMember,
  type Me,
  type Message,
  type Profile,
  type Room,
  type User,
} from "../../shared/types";
import { api, ApiError, avatarUrl, mediaUrl } from "../lib/api";
import type { SecretState } from "../lib/e2e";
import { formatDateTime, formatRelative } from "../lib/format";
import { formatDuration } from "../lib/media";
import type { Presence } from "./ChatLayout";
import { AddMembersDialog, PopMenu, type MenuItem } from "./Dialogs";
import { inviteLink } from "./InviteDialog";
import { ReportDialog } from "./ChatExtras";
import { prepareAvatar } from "../lib/media";
import { ImageViewer } from "./ImageViewer";
import { RoomAvatar, roomTitle } from "./RoomAvatar";
import {
  AlertIcon,
  ArchiveIcon,
  Avatar,
  CameraIcon,
  BellIcon,
  BellOffIcon,
  DownloadIcon,
  FileIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  MegaphoneIcon,
  MoreIcon,
  PencilIcon,
  PhoneIcon,
  PinIcon,
  PlayIcon,
  ShieldIcon,
  Spinner,
  StarIcon,
  TimerIcon,
  TrashIcon,
  UserPlusIcon,
  VideoIcon,
  XIcon,
} from "./ui";
import { VoicePlayer } from "./VoicePlayer";

type Tab = GalleryTab | "starred";

const TABS: [Tab, string][] = [
  ["media", "Media"],
  ["files", "Files"],
  ["links", "Links"],
  ["voice", "Voice"],
  ["starred", "Starred"],
];

const joinedFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const URL_RE = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;

interface Props {
  room: Room;
  me: Me;
  presence?: Presence;
  onClose: () => void;
  onJump: (messageId: string) => void;
  onOpenImage: (src: string, caption?: string) => void;
  onCall: (video: boolean) => void;
  onBlock: (user: User) => Promise<void>;
  onUnblock: (user: User) => Promise<void>;
  rooms: Room[];
  secretState: SecretState;
  pinned: Message[];
  onPrefs: (room: Room, patch: { pinned?: boolean; archived?: boolean; mutedUntil?: number | null }) => void;
  onDelete: (room: Room) => void;
  onRoomUpdated: (room: Room) => void;
  onRoomsChanged: () => void;
  onStartSecret: (dm: Room) => Promise<void>;
  onOpenRoom: (id: string) => void;
  readable: <M extends Message>(m: M) => M & { locked?: boolean };
}

/** Everything about a chat: profile / group, settings, secret-chat key, shared media. Side panel on desktop, full screen on phones. */
export function ChatInfo(props: Props) {
  const { room, me, presence, onClose, onCall, onBlock, onUnblock, onPrefs, onDelete, secretState } = props;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const peer = room.peer;
  const title = roomTitle(room);
  const isDm = room.type === "dm" && !room.saved;
  const accepted = room.status === "accepted";
  const canChange = room.type === "dm" || room.role === "admin";
  const muted = isMuted(room);

  useEffect(() => {
    if (peer && !room.saved) api.profile(peer.id).then((r) => setProfile(r.profile)).catch(() => {});
  }, [peer, room.saved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const status = room.saved
    ? "Only you can see this chat"
    : room.type === "group"
      ? `${room.memberCount} members`
      : profile?.dnd && presence?.online
        ? "Do not disturb"
      : presence?.online
        ? "Online"
        : (presence?.lastSeenAt ?? profile?.lastSeenAt)
          ? `Last seen ${formatRelative((presence?.lastSeenAt ?? profile?.lastSeenAt)!)}`
          : "Last seen recently";
  const picture = peer && !room.saved ? avatarUrl(peer) : null;
  const [reporting, setReporting] = useState(false);
  const heading = room.saved ? "Saved Messages" : room.secret ? "Secret chat" : room.type === "group" ? "Group info" : "Contact info";

  return (
    <>
    {/* Tablets and small laptops: the panel slides over the chat (there isn't room for three columns). */}
    <div className="fade-in fixed inset-0 z-30 hidden bg-zinc-950/30 backdrop-blur-[2px] md:block xl:hidden" onClick={onClose} aria-hidden="true" />
    <aside
      className="panel slide-up safe-top fixed inset-0 z-40 flex flex-col bg-white md:inset-y-2 md:right-2 md:left-auto md:w-[24rem] md:shadow-2xl xl:static xl:z-auto xl:w-96 xl:shrink-0 xl:shadow-none dark:bg-zinc-900"
      aria-label={heading}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="font-semibold">{heading}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* Profile */}
        <div className="flex flex-col items-center px-6 pt-2 pb-4 text-center">
          {room.type === "group" && room.role === "admin" ? (
            <GroupPhoto room={room} onChanged={props.onRoomsChanged} />
          ) : picture ? (
            <button onClick={() => setZoom(true)} className="avatar-shape cursor-zoom-in" aria-label="View profile picture">
              <RoomAvatar room={room} size="xl" online={isDm && !room.secret ? presence?.online : undefined} />
            </button>
          ) : (
            <RoomAvatar room={room} size="xl" online={isDm && !room.secret ? presence?.online : undefined} />
          )}
          {room.type === "group" && room.role === "admin" ? (
            <GroupName room={room} onSaved={props.onRoomUpdated} />
          ) : (
            <h3 className={`mt-3 flex max-w-full items-center justify-center gap-1.5 text-xl font-semibold tracking-tight break-words ${room.secret ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
              {room.secret && <LockIcon className="size-5" />}
              {title}
            </h3>
          )}
          {peer && isDm && <p className="text-sm text-zinc-500 dark:text-zinc-400">@{peer.username}</p>}
          <p className={`mt-1 text-sm ${presence?.online && isDm ? (profile?.dnd ? "text-red-600 dark:text-red-400" : "text-accent-fg") : "text-zinc-500 dark:text-zinc-400"}`}>{status}</p>
          {isDm && (profile?.statusText || peer?.statusText) && (
            <p className="mt-2 max-w-full rounded-full bg-zinc-100 px-3 py-1 text-sm break-words dark:bg-zinc-800">{profile?.statusText || peer?.statusText}</p>
          )}

          {/* Quick actions */}
          {accepted && (
            <div className="mt-4 flex w-full max-w-sm justify-center gap-2">
              {peer && isDm && !room.blocked && !room.blockedMe && (
                <>
                  <InfoAction icon={<PhoneIcon className="size-5" />} label="Voice" onClick={() => onCall(false)} />
                  <InfoAction icon={<VideoIcon className="size-5" />} label="Video" onClick={() => onCall(true)} />
                </>
              )}
              {!room.saved && (
                <InfoAction
                  icon={muted ? <BellIcon className="size-5" /> : <BellOffIcon className="size-5" />}
                  label={muted ? "Unmute" : "Mute"}
                  onClick={() => onPrefs(room, { mutedUntil: muted ? null : MUTE_FOREVER })}
                />
              )}
              {isDm && !room.secret && !room.blocked && !room.blockedMe && (
                <InfoAction
                  icon={busy === "secret" ? <Spinner className="size-5" /> : <LockIcon className="size-5" />}
                  label="Secret chat"
                  tone="emerald"
                  onClick={() => run("secret", () => props.onStartSecret(room))}
                />
              )}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {room.secret && <SecretKeyCard state={secretState} name={peer?.displayName ?? title} />}

          {profile && isDm && (
            <div className="mt-4 w-full space-y-3 rounded-2xl bg-zinc-50 p-4 text-left dark:bg-zinc-800/60">
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Bio</p>
                <p className={`mt-0.5 text-sm whitespace-pre-wrap ${profile.bio ? "" : "text-zinc-400 italic"}`}>{profile.bio || "No bio yet."}</p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Joined</p>
                <p className="mt-0.5 text-sm">{joinedFmt.format(profile.createdAt)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Chat settings */}
        {accepted && (
          <div className="mx-4 mb-4 divide-y divide-zinc-100 overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:divide-zinc-800 dark:ring-zinc-800">
            <DisappearRow room={room} canChange={canChange} onSaved={props.onRoomUpdated} />
            {!room.archived && (
              <ToggleItem icon={<PinIcon className="size-5" />} label="Pin to top of chat list" checked={room.pinned} onChange={() => onPrefs(room, { pinned: !room.pinned })} />
            )}
            <ToggleItem icon={<ArchiveIcon className="size-5" />} label="Archived" checked={room.archived} onChange={() => onPrefs(room, { archived: !room.archived })} />
          </div>
        )}

        {room.type === "group" && room.role === "admin" && <GroupAdminSettings room={room} onSaved={props.onRoomUpdated} />}

        {/* Pinned messages */}
        {props.pinned.length > 0 && (
          <Section title="Pinned messages">
            <ul className="space-y-1">
              {props.pinned.map((m) => (
                <li key={m.id}>
                  <button onClick={() => props.onJump(m.id)} className="w-full rounded-xl px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <span className="block text-xs font-semibold text-accent-fg">{m.userId === me.id ? "You" : m.displayName}</span>
                    <span className="block truncate text-sm">{(m as Message & { locked?: boolean }).locked ? "🔒 Encrypted message" : m.body || m.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {room.type === "group" && <Members {...props} />}

        {/* Shared content (secret chats are text-only and can't be searched by the server) */}
        {!room.secret && accepted && <SharedContent {...props} />}

        {/* Danger zone */}
        <div className="space-y-2 px-4 pt-2 pb-8">
          {peer && isDm && !room.blockedMe && !room.secret && (
            <DangerButton
              tone={room.blocked ? "accent" : "red"}
              onClick={() => {
                if (room.blocked) void onUnblock(peer);
                else if (confirm(`Block ${title}? They won't be able to message or call you, and you won't see each other's online status.`)) void onBlock(peer);
              }}
            >
              <span className="truncate">{room.blocked ? `Unblock ${title}` : `Block ${title}`}</span>
            </DangerButton>
          )}
          {peer && isDm && !room.saved && (
            <DangerButton tone="red" onClick={() => setReporting(true)}>
              <AlertIcon className="size-4" />
              <span className="truncate">Report {title}</span>
            </DangerButton>
          )}
          {accepted && (
            <DangerButton tone="red" onClick={() => onDelete(room)}>
              <TrashIcon className="size-4" />
              {room.type === "group"
                ? room.role === "admin"
                  ? "Delete group"
                  : "Leave group"
                : room.secret
                  ? "End secret chat"
                  : room.saved
                    ? "Clear Saved Messages"
                    : "Delete chat"}
            </DangerButton>
          )}
        </div>
      </div>

      {zoom && picture && <ImageViewer src={picture} onClose={() => setZoom(false)} />}
      {reporting && peer && <ReportDialog target={{ userId: peer.id, name: title }} onClose={() => setReporting(false)} />}
    </aside>
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-4 mb-4">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h4 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

function InfoAction({ icon, label, onClick, tone }: { icon: ReactNode; label: string; onClick: () => void; tone?: "emerald" }) {
  return (
    <button
      onClick={onClick}
      className={`flex max-w-28 min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-xs font-medium ring-1 ring-zinc-200 transition dark:ring-zinc-700 ${
        tone === "emerald" ? "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40" : "text-accent-fg hover:bg-accent/10"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ToggleItem({ icon, label, checked, onChange }: { icon: ReactNode; label: string; checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={checked} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <span className="text-zinc-500 dark:text-zinc-400">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-zinc-300 dark:bg-zinc-700"}`}>
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function DangerButton({ tone, onClick, children }: { tone: "red" | "accent"; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full min-w-0 items-center justify-center gap-2 truncate rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 transition ${
        tone === "accent"
          ? "text-accent-fg ring-accent/30 hover:bg-accent/10"
          : "text-red-600 ring-red-600/25 hover:bg-red-50 dark:text-red-400 dark:ring-red-400/25 dark:hover:bg-red-950/40"
      }`}
    >
      {children}
    </button>
  );
}

/** The encryption key, as emoji both people can compare. */
function SecretKeyCard({ state, name }: { state: SecretState; name: string }) {
  if (state.kind !== "ready") {
    return (
      <div className="mt-4 w-full rounded-2xl bg-emerald-50 p-4 text-left text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
        <p className="flex items-center gap-2 font-semibold">
          <LockIcon className="size-4" /> End-to-end encrypted
        </p>
        <p className="mt-1 text-xs">
          {state.kind === "waiting"
            ? `Waiting for ${name} to accept on one of their devices.`
            : state.kind === "invite"
              ? "Accept the invitation to create your keys on this device."
              : state.kind === "loading"
                ? "Checking keys…"
                : "This chat's keys are on another device."}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 w-full rounded-2xl bg-emerald-50 p-4 text-left text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <KeyIcon className="size-4" /> Encryption key
      </p>
      <p className="mx-auto mt-3 grid w-fit grid-cols-4 gap-x-4 gap-y-1 text-center text-2xl" aria-label="Key fingerprint">
        {state.fingerprint.map((e, i) => (
          <span key={i}>{e}</span>
        ))}
      </p>
      <p className="mt-3 text-xs leading-relaxed">
        Messages here are encrypted on your device and can only be decrypted on {name}'s. Not even the server or the admins can read them. If {name} sees the same emoji, nobody is listening in.
      </p>
    </div>
  );
}

function GroupName({ room, onSaved }: { room: Room; onSaved: (r: Room) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name ?? "");
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="group mt-3 max-w-full text-xl font-semibold tracking-tight break-words" title="Rename group">
        {room.name ?? "Group"}
        <PencilIcon className="ml-1.5 inline size-4 align-[-0.1em] text-zinc-400 opacity-60 group-hover:opacity-100" />
      </button>
    );
  }
  return (
    <form
      className="mt-3 flex w-full gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const { room: updated } = await api.updateRoom(room.id, { name });
          onSaved(updated);
          setEditing(false);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={LIMITS.groupNameMax}
        className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 dark:border-zinc-700 dark:bg-zinc-800"
      />
      <button disabled={busy || !name.trim()} className="rounded-xl bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-50">
        {busy ? <Spinner /> : "Save"}
      </button>
    </form>
  );
}

/** Group admins: invite link, announcement mode and slow mode (like Telegram / Discord). */
function GroupAdminSettings({ room, onSaved }: { room: Room; onSaved: (r: Room) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(label: string, fn: () => Promise<{ room: Room }>) {
    setBusy(label);
    setError(null);
    try {
      onSaved((await fn()).room);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change that.");
    } finally {
      setBusy(null);
    }
  }

  const link = room.inviteCode ? inviteLink(room.inviteCode) : null;
  return (
    <Section title="Group settings">
      <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:divide-zinc-800 dark:ring-zinc-800">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <LinkIcon className="size-5 text-zinc-500 dark:text-zinc-400" />
            <span className="flex-1">Invite link</span>
            {busy === "invite" && <Spinner className="size-4 text-zinc-400" />}
          </div>
          {link ? (
            <>
              <p className="mt-2 truncate rounded-lg bg-zinc-100 px-3 py-2 font-mono text-xs dark:bg-zinc-800" title={link}>
                {link}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:opacity-90"
                >
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
                <button onClick={() => run("invite", () => api.setInvite(room.id, true))} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800">
                  Reset link
                </button>
                <button onClick={() => run("invite", () => api.setInvite(room.id, false))} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-600/25 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
                  Turn off
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Anyone with the link can join. Resetting it stops the old link working.</p>
            </>
          ) : (
            <button onClick={() => run("invite", () => api.setInvite(room.id, true))} disabled={!!busy} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-fg ring-1 ring-accent/30 hover:bg-accent/10">
              Create invite link
            </button>
          )}
        </div>
        <ToggleItem
          icon={busy === "admins" ? <Spinner className="size-5" /> : <MegaphoneIcon className="size-5" />}
          label="Only admins can send messages"
          checked={room.adminsOnly}
          onChange={() => run("admins", () => api.updateRoom(room.id, { adminsOnly: !room.adminsOnly }))}
        />
        <label className="flex items-center gap-3 px-4 py-3 text-sm">
          <TimerIcon className="size-5 text-zinc-500 dark:text-zinc-400" />
          <span className="flex-1">
            Slow mode
            <span className="block text-xs text-zinc-500">Members wait between messages</span>
          </span>
          {busy === "slow" && <Spinner className="size-4 text-zinc-400" />}
          <select
            value={room.slowModeMs}
            disabled={!!busy}
            onChange={(e) => run("slow", () => api.updateRoom(room.id, { slowModeMs: Number(e.target.value) }))}
            className="rounded-lg bg-zinc-100 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800"
          >
            {SLOW_MODE_OPTIONS.map((o) => (
              <option key={o.ms} value={o.ms}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="mt-2 px-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <BannedList room={room} />
    </Section>
  );
}

function BannedList({ room }: { room: Room }) {
  const [bans, setBans] = useState<GroupBan[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    api.bans(room.id).then((r) => setBans(r.bans), () => setBans([]));
  }, [room.id]);
  useEffect(load, [load, room.memberCount]);
  if (!bans?.length) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60" aria-expanded={open}>
        <XIcon className="size-5 text-zinc-500 dark:text-zinc-400" />
        <span className="flex-1">Banned</span>
        <span className="text-xs text-zinc-500">{bans.length}</span>
      </button>
      {open && (
        <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
          {bans.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={b.displayName} seed={b.id} user={b} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm">{b.displayName}</span>
              <button onClick={() => api.unban(room.id, b.id).then(load, () => {})} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-accent-fg ring-1 ring-accent/30 hover:bg-accent/10">
                Unban
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Group admins tap the group's picture to change it. */
function GroupPhoto({ room, onChanged }: { room: Room; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      await api.setGroupPhoto(room.id, await prepareAvatar(file));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change the photo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-center">
      <button type="button" onClick={() => fileRef.current?.click()} className="group avatar-shape relative" aria-label="Change group photo" disabled={busy}>
        <RoomAvatar room={room} size="xl" />
        <span className="avatar-shape absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <Spinner className="size-6" /> : <CameraIcon className="size-6" />}
        </span>
      </button>
      {room.avatarVersion && (
        <button onClick={() => api.removeGroupPhoto(room.id).then(onChanged, () => {})} className="mt-1 text-xs text-zinc-500 hover:underline">
          Remove photo
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function DisappearRow({ room, canChange, onSaved }: { room: Room; canChange: boolean; onSaved: (r: Room) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex items-center gap-3 px-4 py-3 text-sm">
      <TimerIcon className="size-5 text-zinc-500 dark:text-zinc-400" />
      <span className="flex-1">
        Disappearing messages
        {!canChange && <span className="block text-xs text-zinc-500">Only group admins can change this</span>}
      </span>
      {busy && <Spinner className="size-4 text-zinc-400" />}
      <select
        value={room.disappearMs ?? ""}
        disabled={!canChange || busy}
        onChange={async (e) => {
          setBusy(true);
          try {
            const { room: updated } = await api.updateRoom(room.id, { disappearMs: e.target.value ? Number(e.target.value) : null });
            onSaved(updated);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg bg-zinc-100 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60 dark:bg-zinc-800"
      >
        {DISAPPEAR_OPTIONS.map((o) => (
          <option key={o.label} value={o.ms ?? ""}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Members({ room, me, rooms, onRoomsChanged }: Props) {
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[]; title: string } | null>(null);
  const isAdmin = room.role === "admin";

  const load = useCallback(() => {
    api.members(room.id).then((r) => setMembers(r.members)).catch(() => setMembers([]));
  }, [room.id]);
  useEffect(load, [load, room.memberCount]);

  function memberMenu(m: GroupMember, at: { x: number; y: number }) {
    setMenu({
      at,
      title: m.displayName,
      items: [
        {
          icon: <ShieldIcon />,
          label: m.groupRole === "admin" ? "Remove as admin" : "Make group admin",
          onClick: () => api.setMemberRole(room.id, m.id, m.groupRole === "admin" ? "member" : "admin").then(load, () => {}),
        },
        {
          icon: <TrashIcon />,
          label: "Remove from group",
          danger: true,
          onClick: () => {
            if (confirm(`Remove ${m.displayName} from the group?`)) api.removeMember(room.id, m.id).then(() => (load(), onRoomsChanged()), () => {});
          },
        },
        {
          icon: <XIcon />,
          label: "Remove and ban",
          hint: "Can't rejoin with an invite link",
          danger: true,
          onClick: () => {
            if (confirm(`Remove ${m.displayName} and ban them? Invite links won't let them back in.`))
              api.removeMember(room.id, m.id, true).then(() => (load(), onRoomsChanged()), () => {});
          },
        },
      ],
    });
  }

  return (
    <Section
      title={`${room.memberCount} members`}
      action={
        isAdmin && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent/10">
            <UserPlusIcon className="size-4" /> Add
          </button>
        )
      }
    >
      {!members ? (
        <div className="flex justify-center py-6 text-zinc-400">
          <Spinner />
        </div>
      ) : (
        <ul className="space-y-0.5">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
              <Avatar name={m.displayName} seed={m.id} user={m} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.id === me.id ? "You" : m.displayName}</span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">@{m.username}</span>
              </span>
              {m.groupRole === "admin" && <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg uppercase">Admin</span>}
              {isAdmin && m.id !== me.id && (
                <button
                  onClick={(e) => memberMenu(m, { x: e.clientX - 200, y: e.clientY })}
                  className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  aria-label={`Options for ${m.displayName}`}
                >
                  <MoreIcon className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && members && (
        <AddMembersDialog
          room={room}
          rooms={rooms}
          existing={members.map((m) => m.id)}
          onAdded={() => {
            load();
            onRoomsChanged();
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {menu && <PopMenu at={menu.at} title={menu.title} items={menu.items} onClose={() => setMenu(null)} />}
    </Section>
  );
}

function SharedContent({ room, me, onJump, onOpenImage }: Props) {
  const [tab, setTab] = useState<Tab>("media");
  const [items, setItems] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    const req = tab === "starred" ? api.starred(room.id).then((r) => ({ messages: r.messages, hasMore: false })) : api.gallery(room.id, tab);
    req
      .then((r) => {
        if (cancelled) return;
        setItems(r.messages);
        setHasMore(r.hasMore);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [room.id, tab]);

  const loadMore = useCallback(async () => {
    const last = items?.at(-1);
    if (!last || loadingMore || tab === "starred") return;
    setLoadingMore(true);
    try {
      const r = await api.gallery(room.id, tab, { createdAt: last.createdAt, id: last.id });
      setItems((prev) => [...(prev ?? []), ...r.messages]);
      setHasMore(r.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, room.id, tab]);

  return (
    <>
      <nav className="no-scrollbar divider-b sticky top-0 z-10 flex overflow-x-auto bg-white px-4 dark:bg-zinc-900" aria-label="Shared content">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`min-w-16 flex-1 shrink-0 border-b-2 py-2.5 text-sm font-medium transition ${
              tab === id
                ? "border-accent text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="p-3">
        {!items ? (
          <div className="flex justify-center py-10 text-zinc-400">
            <Spinner className="size-5" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {
              {
                media: "No photos or videos yet.",
                files: "No documents yet.",
                links: "No links yet.",
                voice: "No voice messages yet.",
                starred: "Long-press or right-click a message and tap Star to keep it here.",
              }[tab]
            }
          </p>
        ) : tab === "media" ? (
          <div className="grid grid-cols-3 gap-1">
            {items.map((m) => (
              <MediaTile key={m.id} message={m} onOpen={() => (m.kind === "image" ? onOpenImage(mediaUrl(m.roomId, m.id), m.body) : onJump(m.id))} />
            ))}
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((m) => (
              <li key={m.id}>
                {tab === "files" ? (
                  <FileRow message={m} meId={me.id} onJump={() => onJump(m.id)} />
                ) : tab === "links" ? (
                  <LinksRow message={m} meId={me.id} onJump={() => onJump(m.id)} />
                ) : tab === "voice" ? (
                  <VoiceRow message={m} meId={me.id} onJump={() => onJump(m.id)} />
                ) : (
                  <StarRow message={m} meId={me.id} onJump={() => onJump(m.id)} />
                )}
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="mx-auto mt-3 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/10"
          >
            {loadingMore && <Spinner className="size-4" />}
            Load more
          </button>
        )}
      </div>
    </>
  );
}

function MediaTile({ message: m, onOpen }: { message: Message; onOpen: () => void }) {
  const src = mediaUrl(m.roomId, m.id);
  return (
    <button onClick={onOpen} className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800" aria-label={m.kind === "video" ? "Play video" : "Open photo"}>
      {m.kind === "image" ? (
        <img src={src} alt={m.body || "Photo"} loading="lazy" decoding="async" className="size-full object-cover transition group-hover:scale-105" />
      ) : (
        <>
          <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-black/50 text-white">
              <PlayIcon className="size-4 translate-x-px" />
            </span>
          </span>
          {m.meta?.duration ? (
            <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white tabular-nums">{formatDuration(m.meta.duration)}</span>
          ) : null}
        </>
      )}
    </button>
  );
}

function RowMeta({ message: m, meId, onJump }: { message: Message; meId: string; onJump: () => void }) {
  return (
    <span className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="truncate">
        {m.userId === meId ? "You" : m.displayName} · {formatDateTime(m.createdAt)}
      </span>
      <button onClick={onJump} className="shrink-0 font-medium text-accent-fg hover:underline">
        Show in chat
      </button>
    </span>
  );
}

function FileRow({ message: m, meId, onJump }: { message: Message; meId: string; onJump: () => void }) {
  const name = m.meta?.name ?? "Document";
  return (
    <div className="flex items-center gap-3 rounded-xl p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-fg">
        <FileIcon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{formatBytes(m.meta?.size ?? 0)}</span>
        <RowMeta message={m} meId={meId} onJump={onJump} />
      </span>
      <a
        href={mediaUrl(m.roomId, m.id)}
        download={name}
        className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
        aria-label={`Download ${name}`}
      >
        <DownloadIcon className="size-5" />
      </a>
    </div>
  );
}

function LinksRow({ message: m, meId, onJump }: { message: Message; meId: string; onJump: () => void }) {
  const links = [...new Set(m.body.match(URL_RE) ?? [])];
  return (
    <div className="space-y-1 rounded-xl p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      {links.map((href) => {
        let host = href;
        try {
          host = new URL(href).hostname.replace(/^www\./, "");
        } catch {
          // keep raw
        }
        return (
          <a key={href} href={href} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <LinkIcon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{host}</span>
              <span className="block truncate text-xs text-accent-fg">{href}</span>
            </span>
          </a>
        );
      })}
      <div className="pl-13">
        <RowMeta message={m} meId={meId} onJump={onJump} />
      </div>
    </div>
  );
}

function VoiceRow({ message: m, meId, onJump }: { message: Message; meId: string; onJump: () => void }) {
  return (
    <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
      <VoicePlayer id={`gallery-${m.id}`} src={mediaUrl(m.roomId, m.id)} meta={m.meta} mine={false} />
      <div className="mt-1.5">
        <RowMeta message={m} meId={meId} onJump={onJump} />
      </div>
    </div>
  );
}

function StarRow({ message: m, meId, onJump }: { message: Message; meId: string; onJump: () => void }) {
  const text =
    m.kind === "text" ? m.body : m.kind === "image" ? `📷 ${m.body || "Photo"}` : m.kind === "video" ? `🎥 ${m.body || "Video"}` : m.kind === "voice" ? "🎤 Voice message" : m.kind === "file" ? `📄 ${m.meta?.name ?? "Document"}` : "Message";
  return (
    <div className="flex gap-3 rounded-xl p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <StarIcon filled className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-3 text-sm whitespace-pre-wrap">{text}</span>
        <RowMeta message={m} meId={meId} onJump={onJump} />
      </span>
    </div>
  );
}
