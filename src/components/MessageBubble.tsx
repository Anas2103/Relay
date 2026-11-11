import { memo, useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import { callLabel, fileExtension, formatBytes, type Message, type ReplyPreview } from "../../shared/types";
import { mediaUrl } from "../lib/api";
import { formatTime } from "../lib/format";
import { formatDuration } from "../lib/media";
import {
  DownloadIcon,
  EyeIcon,
  FileIcon,
  ImageIcon,
  MicIcon,
  OnceIcon,
  PhoneIcon,
  ReplyIcon,
  SmileIcon,
  Spinner,
  Ticks,
  VideoIcon,
} from "./ui";
import { VoicePlayer } from "./VoicePlayer";

export type UiMessage = Message & {
  status?: "pending" | "failed";
  /** Local blob URL for media we just sent, so it shows instantly and doesn't reload. */
  localUrl?: string;
  /** Upload progress 0–1 while sending a file. */
  progress?: number;
};

export type BubbleAction =
  | { type: "menu"; message: UiMessage; rect: DOMRect }
  | { type: "react"; message: UiMessage; emoji: string }
  | { type: "reply"; message: UiMessage }
  | { type: "retry"; message: UiMessage }
  | { type: "open-image"; message: UiMessage; src: string }
  | { type: "open-view-once"; message: UiMessage }
  | { type: "jump"; messageId: string }
  | { type: "call-back"; video: boolean };

interface Props {
  message: UiMessage;
  meId: string;
  mine: boolean;
  showName: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  read: boolean;
  /** The other person's chosen bubble style (when you allow showing it). */
  tint?: { background: string; ink: string };
  onAction: (action: BubbleAction) => void;
}

const LONG_PRESS_MS = 420;

export const MessageBubble = memo(function MessageBubble({
  message: m,
  meId,
  mine,
  showName,
  startsGroup,
  endsGroup,
  read,
  tint,
  onAction,
}: Props) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const deleted = m.deletedAt !== null;
  const isMedia = !deleted && m.kind !== "text" && m.kind !== "call";
  const viewOnce = m.kind === "image" && !!m.meta?.viewOnce;

  const openMenu = () => {
    if (deleted || m.status) return;
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect) onAction({ type: "menu", message: m, rect });
  };

  // Long-press on touch screens opens the menu (like WhatsApp).
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    pressTimer.current = window.setTimeout(() => {
      navigator.vibrate?.(10);
      openMenu();
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => window.clearTimeout(pressTimer.current);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openMenu();
  };

  // Joined corners for consecutive bubbles from the same person.
  const corners = mine
    ? `rounded-2xl ${startsGroup ? "" : "rounded-tr-md"} ${endsGroup ? "" : "rounded-br-md"}`
    : `rounded-2xl ${startsGroup ? "" : "rounded-tl-md"} ${endsGroup ? "" : "rounded-bl-md"}`;

  // Bubbles with a color behind them (mine, or theirs when shown) tint their contents from their text color.
  const theirs = !mine && !!tint && !deleted;
  const tinted = (mine || theirs) && !deleted;
  const surface = deleted
    ? "bg-transparent text-zinc-500 italic ring-1 ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700"
    : mine
      ? m.status === "failed"
        ? "bg-red-500 text-white"
        : "bubble-fill"
      : theirs
        ? "shadow-sm"
        : "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/5";

  const visual = (m.kind === "image" && !viewOnce) || m.kind === "video";
  const imageOnly = visual && !m.body && !m.replyTo && !deleted;
  const reactions = Object.entries(m.reactions);

  return (
    <div
      id={`msg-${m.id}`}
      className={`group flex flex-col ${mine ? "items-end" : "items-start"} ${startsGroup ? "mt-3" : "mt-0.5"}`}
    >
      {showName && <span className="mb-1 ml-3 text-xs font-medium text-zinc-500">{m.displayName}</span>}

      <div className={`flex max-w-full items-center gap-1 ${mine ? "flex-row-reverse" : ""}`}>
        <div
          ref={bubbleRef}
          onContextMenu={onContextMenu}
          onTouchStart={onTouchStart}
          onTouchEnd={cancelPress}
          onTouchMove={cancelPress}
          onDoubleClick={() => !deleted && !m.status && onAction({ type: "react", message: m, emoji: "❤️" })}
          style={theirs ? { background: tint!.background, color: tint!.ink } : undefined}
          className={`relative max-w-[min(85vw,28rem)] text-[15px] leading-relaxed break-words ${corners} ${surface} ${
            imageOnly ? "overflow-hidden p-0" : visual && !deleted ? "overflow-hidden p-1" : "px-3.5 py-2"
          } ${m.status === "pending" ? "opacity-80" : ""} select-text`}
        >
          {m.replyTo && !deleted && (
            <ReplyQuote reply={m.replyTo} mine={tinted} meId={meId} onClick={() => onAction({ type: "jump", messageId: m.replyTo!.id })} />
          )}

          {deleted ? (
            <span className="text-sm">This message was deleted</span>
          ) : m.kind === "voice" ? (
            <VoicePlayer id={m.id} src={m.localUrl ?? mediaUrl(m.roomId, m.id)} meta={m.meta} mine={tinted} />
          ) : viewOnce ? (
            <ViewOnceContent message={m} mine={mine} tinted={tinted} meId={meId} onOpen={() => onAction({ type: "open-view-once", message: m })} />
          ) : m.kind === "image" ? (
            <ImageContent message={m} onOpen={(src) => onAction({ type: "open-image", message: m, src })} />
          ) : m.kind === "video" ? (
            <VideoContent message={m} />
          ) : m.kind === "file" ? (
            <FileContent message={m} mine={tinted} />
          ) : m.kind === "call" ? (
            <CallContent message={m} mine={mine} tinted={tinted} onCallBack={(video) => onAction({ type: "call-back", video })} />
          ) : null}

          {!deleted && m.body && !viewOnce && (
            <p className={`whitespace-pre-wrap ${visual ? "px-2.5 pt-1.5 pb-1" : ""}`}>{linkify(m.body, tinted)}</p>
          )}

          {m.status === "pending" && isMedia && <UploadBadge progress={m.progress} />}
        </div>

        {/* Hover actions (desktop) */}
        {!deleted && !m.status && (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:hidden">
            <HoverButton label="React" onClick={openMenu}>
              <SmileIcon className="size-4" />
            </HoverButton>
            <HoverButton label="Reply" onClick={() => onAction({ type: "reply", message: m })}>
              <ReplyIcon className="size-4" />
            </HoverButton>
          </div>
        )}
      </div>

      {reactions.length > 0 && <Reactions reactions={reactions} meId={meId} mine={mine} onToggle={(emoji) => onAction({ type: "react", message: m, emoji })} />}

      {m.status === "failed" ? (
        <button
          onClick={() => onAction({ type: "retry", message: m })}
          className="mt-1 mr-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
        >
          Not sent · Tap to retry
        </button>
      ) : (
        endsGroup && (
          <span className={`mt-1 flex items-center gap-1 text-[11px] text-zinc-400 tabular-nums ${mine ? "mr-1" : "ml-1"}`}>
            {m.editedAt && !deleted && <span>edited ·</span>}
            {m.status === "pending" ? "Sending…" : formatTime(m.createdAt)}
            {mine && !m.status && !deleted && <Ticks read={read} className={read ? "text-accent-fg" : ""} />}
          </span>
        )
      )}
    </div>
  );
});

function HoverButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      {children}
    </button>
  );
}

function ReplyQuote({ reply, mine, meId, onClick }: { reply: ReplyPreview; mine: boolean; meId: string; onClick: () => void }) {
  const text = reply.deleted
    ? "Deleted message"
    : reply.kind === "voice"
      ? "Voice message"
      : reply.kind === "image"
        ? reply.body || "Photo"
        : reply.kind === "video"
          ? reply.body || "Video"
          : reply.kind === "file"
            ? "Document"
            : reply.kind === "call"
              ? "Call"
              : reply.body;
  return (
    <button
      onClick={onClick}
      className={`mb-1.5 flex w-full min-w-0 items-start gap-2 rounded-lg border-l-4 px-2.5 py-1.5 text-left text-sm ${
        mine ? "border-current/60 bg-current/10" : "border-accent bg-zinc-100 dark:bg-zinc-900/60"
      }`}
    >
      {reply.kind === "voice" && <MicIcon className="mt-0.5 size-3.5 shrink-0 opacity-70" />}
      {reply.kind === "image" && <ImageIcon className="mt-0.5 size-3.5 shrink-0 opacity-70" />}
      <span className="min-w-0">
        <span className={`block text-xs font-semibold ${mine ? "" : "text-accent-fg"}`}>
          {reply.userId === meId ? "You" : reply.displayName}
        </span>
        <span className={`line-clamp-2 ${mine ? "opacity-85" : "text-zinc-600 dark:text-zinc-300"} ${reply.deleted ? "italic" : ""}`}>
          {text}
        </span>
      </span>
    </button>
  );
}

/** Reserve the exact space before media loads, so the chat never jumps. */
function mediaBox(m: UiMessage) {
  const w = m.meta?.width ?? 300;
  const h = m.meta?.height ?? 300;
  return { width: Math.round(Math.min(280, (360 * w) / h, Math.max(w, 160))), aspectRatio: `${w} / ${h}`, maxWidth: "100%" };
}

function UploadBadge({ progress }: { progress?: number }) {
  const pct = progress !== undefined ? Math.round(progress * 100) : null;
  return (
    <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-1 text-[11px] font-medium text-white tabular-nums">
      {pct !== null && pct < 100 ? (
        <svg viewBox="0 0 20 20" className="size-3.5 -rotate-90" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="3" />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray={`${(pct / 100) * 50.3} 50.3`}
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <Spinner className="size-3.5" />
      )}
      {pct !== null && pct < 100 && <span>{pct}%</span>}
    </span>
  );
}

function VideoContent({ message: m }: { message: UiMessage }) {
  const src = m.localUrl ?? mediaUrl(m.roomId, m.id);
  return (
    <div className="relative overflow-hidden rounded-xl bg-black" style={mediaBox(m)}>
      {/* "#t=0.1" makes iPhones show the first frame instead of a black box */}
      <video
        src={m.localUrl ? src : `${src}#t=0.1`}
        controls
        playsInline
        preload="metadata"
        className="size-full object-contain"
        aria-label={m.body || "Video"}
      />
      {m.meta?.duration ? (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {formatDuration(m.meta.duration)}
        </span>
      ) : null}
    </div>
  );
}

function FileContent({ message: m, mine }: { message: UiMessage; mine: boolean }) {
  const name = m.meta?.name ?? "Document";
  const ext = fileExtension(name).toUpperCase().slice(0, 4) || "FILE";
  const href = m.localUrl ?? mediaUrl(m.roomId, m.id);
  return (
    <a
      href={m.status ? undefined : href}
      download={name}
      onClick={(e) => m.status && e.preventDefault()}
      className={`flex w-64 max-w-full items-center gap-3 rounded-xl p-2 transition ${
        mine ? "bg-current/10 hover:bg-current/15" : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
      }`}
      aria-label={`Download ${name}`}
    >
      <span className={`relative flex size-11 shrink-0 items-center justify-center rounded-lg ${mine ? "bg-current/15" : "bg-accent/15 text-accent-fg"}`}>
        <FileIcon className="size-5 -translate-y-1.5" />
        <span className="absolute bottom-1.5 text-[8px] leading-none font-bold tracking-wide">{ext}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium break-all">{name}</span>
        <span className={`text-xs ${mine ? "opacity-75" : "text-zinc-500 dark:text-zinc-400"}`}>
          {formatBytes(m.meta?.size ?? 0)} · {ext}
        </span>
      </span>
      {!m.status && <DownloadIcon className={`size-5 shrink-0 ${mine ? "opacity-80" : "text-zinc-400"}`} />}
    </a>
  );
}

function CallContent({
  message: m,
  mine,
  tinted,
  onCallBack,
}: {
  message: UiMessage;
  mine: boolean;
  tinted: boolean;
  onCallBack: (video: boolean) => void;
}) {
  const call = m.meta?.call;
  const missed = call?.status === "missed" || call?.status === "declined";
  const Icon = call?.video ? VideoIcon : PhoneIcon;
  // The record is written by the caller, so from the other side it reads "Missed …".
  const label = callLabel(call).replace(/^\S+\s/, "");
  return (
    <button
      onClick={() => onCallBack(!!call?.video)}
      className="flex items-center gap-3 py-0.5 text-left"
      title={call?.video ? "Video call back" : "Call back"}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
          tinted ? "bg-current/15" : missed ? "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400" : "bg-accent/15 text-accent-fg"
        }`}
      >
        <Icon className="size-4.5" />
      </span>
      <span>
        <span className="block text-sm font-medium">{mine ? label.replace("Missed", "Unanswered") : label}</span>
        <span className={`text-xs ${tinted ? "opacity-75" : "text-zinc-500 dark:text-zinc-400"}`}>Tap to call back</span>
      </span>
    </button>
  );
}

function ImageContent({ message: m, onOpen }: { message: UiMessage; onOpen: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  const src = m.localUrl ?? mediaUrl(m.roomId, m.id);
  const w = m.meta?.width ?? 300;
  const h = m.meta?.height ?? 300;
  // Reserve the exact space before the image loads, so the chat never jumps.
  const width = Math.round(Math.min(280, (360 * w) / h, w));

  return (
    <button
      onClick={() => onOpen(src)}
      className="relative block overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-700"
      style={{ width, aspectRatio: `${w} / ${h}`, maxWidth: "100%" }}
      aria-label="Open photo"
    >
      <img
        src={src}
        alt={m.body || "Photo"}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={`size-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </button>
  );
}

function ViewOnceContent({
  message: m,
  mine,
  tinted,
  meId,
  onOpen,
}: {
  tinted: boolean;
  message: UiMessage;
  mine: boolean;
  meId: string;
  onOpen: () => void;
}) {
  const openedByMe = m.viewedBy.includes(meId);
  const openedByOthers = m.viewedBy.some((id) => id !== meId);

  if (mine) {
    return (
      <span className="flex items-center gap-2 py-0.5 text-sm">
        <OnceIcon className="size-5" />
        <span className="font-medium">Photo</span>
        <span className="opacity-75">· {m.status ? "Sending" : openedByOthers ? "Opened" : "View once"}</span>
      </span>
    );
  }
  if (openedByMe) {
    return (
      <span className={`flex items-center gap-2 py-0.5 text-sm ${tinted ? "opacity-75" : "text-zinc-500 dark:text-zinc-400"}`}>
        <EyeIcon className="size-5" />
        Opened
      </span>
    );
  }
  return (
    <button onClick={onOpen} className={`flex items-center gap-2 py-0.5 text-sm font-medium ${tinted ? "" : "text-accent-fg"}`}>
      <OnceIcon className="size-5" />
      Photo · Tap to view once
    </button>
  );
}

function Reactions({
  reactions,
  meId,
  mine,
  onToggle,
}: {
  reactions: [string, string][];
  meId: string;
  mine: boolean;
  onToggle: (emoji: string) => void;
}) {
  const counts = new Map<string, { count: number; mineToo: boolean }>();
  for (const [userId, emoji] of reactions) {
    const c = counts.get(emoji) ?? { count: 0, mineToo: false };
    counts.set(emoji, { count: c.count + 1, mineToo: c.mineToo || userId === meId });
  }
  return (
    <div className={`relative z-10 -mt-1.5 flex flex-wrap gap-1 ${mine ? "mr-2 justify-end" : "ml-2"}`}>
      {[...counts].map(([emoji, { count, mineToo }]) => (
        <button
          key={emoji}
          onClick={() => onToggle(emoji)}
          className={`pop-in flex items-center gap-1 rounded-full px-1.5 py-0.5 text-sm shadow-sm ring-1 transition active:scale-95 ${
            mineToo
              ? "bg-accent/15 ring-accent/40 dark:bg-accent/30"
              : "bg-white ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700"
          }`}
          aria-label={`${emoji} ${count}${mineToo ? ", including you" : ""}`}
        >
          <span>{emoji}</span>
          {count > 1 && <span className="text-xs font-medium tabular-nums text-zinc-600 dark:text-zinc-300">{count}</span>}
        </button>
      ))}
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

/** Turns URLs into safe links (rendered as React elements, never as HTML). */
function linkify(text: string, mine: boolean): ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={`underline underline-offset-2 ${mine ? "" : "text-accent-fg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}
