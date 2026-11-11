import { useCallback, useEffect, useState } from "react";
import { formatBytes, type GalleryTab, type Me, type Message, type Profile, type Room } from "../../shared/types";
import { api, avatarUrl, mediaUrl } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/format";
import { formatDuration } from "../lib/media";
import type { Presence } from "./ChatLayout";
import { roomTitle } from "./ChatLayout";
import { ImageViewer } from "./ImageViewer";
import { Avatar, DownloadIcon, FileIcon, LinkIcon, PhoneIcon, PlayIcon, Spinner, VideoIcon, XIcon } from "./ui";
import { VoicePlayer } from "./VoicePlayer";

const TABS: [GalleryTab, string][] = [
  ["media", "Media"],
  ["files", "Files"],
  ["links", "Links"],
  ["voice", "Voice"],
];

const joinedFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const URL_RE = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;

/** Profile + "Media, links and docs" for a conversation (side panel on desktop, full screen on phones). */
export function ChatInfo({
  room,
  me,
  presence,
  onClose,
  onJump,
  onOpenImage,
  onCall,
}: {
  room: Room;
  me: Me;
  presence?: Presence;
  onClose: () => void;
  onJump: (messageId: string) => void;
  onOpenImage: (src: string, caption?: string) => void;
  onCall: (video: boolean) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<GalleryTab>("media");
  const [items, setItems] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [zoom, setZoom] = useState(false);
  const peer = room.peer;
  const title = roomTitle(room);

  useEffect(() => {
    if (peer) api.profile(peer.id).then((r) => setProfile(r.profile)).catch(() => {});
  }, [peer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    api
      .gallery(room.id, tab)
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
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.gallery(room.id, tab, { createdAt: last.createdAt, id: last.id });
      setItems((prev) => [...(prev ?? []), ...r.messages]);
      setHasMore(r.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, room.id, tab]);

  const status = presence?.online
    ? "Online"
    : (presence?.lastSeenAt ?? profile?.lastSeenAt)
      ? `Last seen ${formatRelative((presence?.lastSeenAt ?? profile?.lastSeenAt)!)}`
      : null;
  const picture = peer ? avatarUrl(peer) : null;

  return (
    <aside
      className="fade-in fixed inset-0 z-40 flex flex-col bg-white md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-zinc-200 dark:bg-zinc-900 md:dark:border-zinc-800"
      aria-label="Chat info"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="font-semibold">Contact info</h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Close contact info"
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Profile */}
        <div className="flex flex-col items-center px-6 pt-2 pb-5 text-center">
          <button
            onClick={() => picture && setZoom(true)}
            className={picture ? "cursor-zoom-in rounded-full" : "cursor-default rounded-full"}
            tabIndex={picture ? 0 : -1}
            aria-label={picture ? "View profile picture" : undefined}
          >
            <Avatar name={title} seed={peer?.id ?? room.id} user={peer} size="xl" online={presence?.online} />
          </button>
          <h3 className="mt-3 text-xl font-semibold tracking-tight">{title}</h3>
          {peer && <p className="text-sm text-zinc-500 dark:text-zinc-400">@{peer.username}</p>}
          {status && (
            <p className={`mt-1 text-sm ${presence?.online ? "text-accent-fg" : "text-zinc-500 dark:text-zinc-400"}`}>{status}</p>
          )}
          {peer && (
            <div className="mt-4 flex gap-3">
              <InfoAction icon={<PhoneIcon className="size-5" />} label="Voice" onClick={() => onCall(false)} />
              <InfoAction icon={<VideoIcon className="size-5" />} label="Video" onClick={() => onCall(true)} />
            </div>
          )}
          {profile && (
            <div className="mt-5 w-full space-y-3 rounded-2xl bg-zinc-50 p-4 text-left dark:bg-zinc-800/60">
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Bio</p>
                <p className={`mt-0.5 text-sm whitespace-pre-wrap ${profile.bio ? "" : "text-zinc-400 italic"}`}>
                  {profile.bio || "No bio yet."}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Joined</p>
                <p className="mt-0.5 text-sm">{joinedFmt.format(profile.createdAt)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Shared content */}
        <nav className="sticky top-0 z-10 flex border-b border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Shared content">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`flex-1 border-b-2 py-2.5 text-sm font-medium transition ${
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
                }[tab]
              }
            </p>
          ) : tab === "media" ? (
            <div className="grid grid-cols-3 gap-1">
              {items.map((m) => (
                <MediaTile
                  key={m.id}
                  message={m}
                  onOpen={() => (m.kind === "image" ? onOpenImage(mediaUrl(m.roomId, m.id), m.body) : onJump(m.id))}
                />
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
                  ) : (
                    <VoiceRow message={m} meId={me.id} onJump={() => onJump(m.id)} />
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
      </div>

      {zoom && picture && <ImageViewer src={picture} onClose={() => setZoom(false)} />}
    </aside>
  );
}

function InfoAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-20 flex-col items-center gap-1 rounded-2xl py-2.5 text-xs font-medium text-accent-fg ring-1 ring-zinc-200 transition hover:bg-accent/10 dark:ring-zinc-700"
    >
      {icon}
      {label}
    </button>
  );
}

function MediaTile({ message: m, onOpen }: { message: Message; onOpen: () => void }) {
  const src = mediaUrl(m.roomId, m.id);
  return (
    <button
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800"
      aria-label={m.kind === "video" ? "Play video" : "Open photo"}
    >
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
            <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white tabular-nums">
              {formatDuration(m.meta.duration)}
            </span>
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
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="flex items-center gap-3"
          >
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
