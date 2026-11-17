import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, STORY_BACKGROUNDS, type Me, type Room, type Story, type StoryGroup, type User } from "../../shared/types";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";
import { prepareImage } from "../lib/media";
import { sendToRoom } from "../lib/sendToRoom";
import { Sheet } from "./Dialogs";
import { Avatar, EyeIcon, ImageIcon, PlusIcon, SendIcon, Spinner, TrashIcon, XIcon } from "./ui";

/*
 * Stories (like WhatsApp Status / Instagram): a photo or a short text your
 * contacts can see for 24 hours. A row of rings at the top of the chat list,
 * a full-screen viewer, and a quick composer.
 */

export const STORY_GRADIENTS: Record<string, string> = {
  indigo: "linear-gradient(135deg,#4f46e5,#7c3aed)",
  sunset: "linear-gradient(135deg,#f97316,#db2777)",
  ocean: "linear-gradient(135deg,#0284c7,#14b8a6)",
  forest: "linear-gradient(135deg,#15803d,#65a30d)",
  berry: "linear-gradient(135deg,#be185d,#7e22ce)",
  night: "linear-gradient(135deg,#0f172a,#334155)",
};

const STORY_MS = 6000;
const storyMedia = (id: string) => `/api/stories/${id}/media`;

/** The row of story rings at the top of the chat list. */
export function StoryBar({ me, rooms }: { me: Me; rooms: Room[] }) {
  const [groups, setGroups] = useState<StoryGroup[] | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);

  const refresh = useCallback(() => {
    api.stories().then(
      (r) => setGroups(r.groups),
      () => {},
    );
  }, []);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 2 * 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  if (!groups) return null;
  const mineIndex = groups.findIndex((g) => g.user.id === me.id);
  const others = groups.filter((g) => g.user.id !== me.id);
  // Nothing to show and nothing posted: keep the list clean, but still offer "Add story".
  return (
    <>
      <div className="no-scrollbar fade-x flex shrink-0 gap-3 overflow-x-auto px-3 pt-1 pb-3 md:px-4" role="list" aria-label="Stories">
        <div role="listitem" className="flex w-16 shrink-0 flex-col items-center gap-1">
          <span className="relative">
            <button
              onClick={() => (mineIndex >= 0 ? setViewing(mineIndex) : setComposing(true))}
              aria-label={mineIndex >= 0 ? "View your story" : "Add a story"}
            >
              <span className={`block rounded-full p-[2px] ${mineIndex >= 0 ? "bg-zinc-300 dark:bg-zinc-600" : ""}`}>
                <span className="block rounded-full bg-white p-[2px] dark:bg-zinc-900">
                  <Avatar name={me.displayName} seed={me.id} user={me} size="lg" />
                </span>
              </span>
            </button>
            <button
              onClick={() => setComposing(true)}
              className="absolute -right-0.5 -bottom-0.5 z-10 flex size-6 items-center justify-center rounded-full bg-accent text-accent-ink ring-2 ring-white dark:ring-zinc-900"
              aria-label="Add a story"
            >
              <PlusIcon className="size-3" strokeWidth={3} />
            </button>
          </span>
          <span className="w-full truncate text-center text-[11px] text-zinc-500 dark:text-zinc-400">Your story</span>
        </div>
        {others.map((g) => (
          <div key={g.user.id} role="listitem" className="flex w-16 shrink-0 flex-col items-center gap-1">
            <button onClick={() => setViewing(groups.indexOf(g))} aria-label={`${g.user.displayName}'s story${g.unseen ? " (new)" : ""}`}>
              <span
                className="block rounded-full p-[2px]"
                style={{ background: g.unseen ? "conic-gradient(from 180deg,var(--accent),#f97316,#db2777,var(--accent))" : undefined }}
              >
                <span className={`block rounded-full p-[2px] ${g.unseen ? "bg-white dark:bg-zinc-900" : "ring-2 ring-zinc-300 dark:ring-zinc-600"}`}>
                  <Avatar name={g.user.displayName} seed={g.user.id} user={g.user} size="lg" />
                </span>
              </span>
            </button>
            <span className={`w-full truncate text-center text-[11px] ${g.unseen ? "font-semibold" : "text-zinc-500 dark:text-zinc-400"}`}>
              {g.user.displayName.split(" ")[0]}
            </span>
          </div>
        ))}
      </div>
      {viewing !== null && groups[viewing] && (
        <StoryViewer
          groups={groups}
          start={viewing}
          me={me}
          rooms={rooms}
          onSeen={(storyId) =>
            setGroups(
              (gs) =>
                gs?.map((g) => {
                  const stories = g.stories.map((s) => (s.id === storyId ? { ...s, viewed: true } : s));
                  return { ...g, stories, unseen: stories.some((s) => !s.viewed) };
                }) ?? gs,
            )
          }
          onChanged={refresh}
          onClose={() => {
            setViewing(null);
            refresh();
          }}
        />
      )}
      {composing && (
        <StoryComposer
          onPosted={() => {
            setComposing(false);
            refresh();
          }}
          onClose={() => setComposing(false)}
        />
      )}
    </>
  );
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/** Full-screen viewer: tap right/left to move, hold to pause, swipe down or ✕ to close. */
function StoryViewer({
  groups,
  start,
  me,
  rooms,
  onSeen,
  onChanged,
  onClose,
}: {
  groups: StoryGroup[];
  start: number;
  me: Me;
  rooms: Room[];
  onSeen: (storyId: string) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [gi, setGi] = useState(start);
  // Start at the first story you haven't seen.
  const firstUnseen = (g: StoryGroup) =>
    Math.max(
      0,
      g.stories.findIndex((s) => !s.viewed),
    );
  const [si, setSi] = useState(() => firstUnseen(groups[start]));
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [viewers, setViewers] = useState<{ user: User; viewedAt: number }[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const group = groups[gi];
  const story: Story | undefined = group?.stories[si];
  const mine = group?.user.id === me.id;
  const elapsed = useRef(0);

  const next = useCallback(() => {
    if (!group) return onClose();
    if (si + 1 < group.stories.length) setSi(si + 1);
    else if (gi + 1 < groups.length) {
      setGi(gi + 1);
      setSi(firstUnseen(groups[gi + 1]));
    } else onClose();
  }, [group, gi, si, groups, onClose]);
  const prev = () => {
    if (si > 0) setSi(si - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setSi(0);
    }
  };

  // Mark as seen, and reset the timer for each story.
  useEffect(() => {
    if (!story) return;
    elapsed.current = 0;
    setProgress(0);
    setLoaded(story.kind === "text");
    setViewers(null);
    if (!story.viewed) {
      onSeen(story.id);
      void api.viewStory(story.id).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // The progress bar (pauses while holding, typing a reply, or waiting for the photo).
  useEffect(() => {
    if (!story || paused || !loaded || reply || viewers) return;
    let last = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      elapsed.current += t - last;
      last = t;
      const p = Math.min(1, elapsed.current / STORY_MS);
      setProgress(p);
      if (p >= 1) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story, paused, loaded, reply, viewers, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!group || !story) return null;
  const dm = rooms.find((r) => r.type === "dm" && r.peer?.id === group.user.id && r.status === "accepted");

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || !dm) return;
    setReply("");
    const quote = story.kind === "text" ? story.text : story.text ? `📷 ${story.text}` : "📷 Photo";
    try {
      await sendToRoom(dm.id, { kind: "text", body: `↩️ Replied to your story “${quote.slice(0, 80)}”\n\n${text}` });
      setSent("Reply sent");
    } catch {
      setSent("Couldn't send your reply");
    }
    window.setTimeout(() => setSent(null), 1800);
  };

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black select-none"
      role="dialog"
      aria-label={`${group.user.displayName}'s story`}
    >
      <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden md:h-[min(92vh,52rem)] md:rounded-3xl">
        {/* Content */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={story.kind === "text" ? { background: STORY_GRADIENTS[story.background ?? "indigo"] ?? STORY_GRADIENTS.indigo } : undefined}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          {story.kind === "image" ? (
            <>
              {!loaded && <Spinner className="size-8 text-white/70" />}
              <img
                src={storyMedia(story.id)}
                alt={story.text || "Story photo"}
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(true)}
                draggable={false}
                className={`max-h-full max-w-full object-contain ${loaded ? "" : "hidden"}`}
              />
            </>
          ) : (
            <p className="px-8 text-center text-2xl leading-snug font-semibold whitespace-pre-wrap text-white drop-shadow md:text-3xl">{story.text}</p>
          )}
          {story.kind === "image" && story.text && (
            <p className="absolute inset-x-0 bottom-24 mx-auto w-fit max-w-[90%] rounded-2xl bg-black/50 px-4 py-2 text-center text-white backdrop-blur-sm">
              {story.text}
            </p>
          )}
        </div>

        {/* Tap zones */}
        <button className="absolute top-16 bottom-24 left-0 z-10 w-1/3" aria-label="Previous" onClick={prev} />
        <button className="absolute top-16 right-0 bottom-24 z-10 w-1/3" aria-label="Next" onClick={next} />

        {/* Top: progress + who */}
        <div
          className="relative z-20 bg-gradient-to-b from-black/60 to-transparent px-3 pt-3 pb-6"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="flex gap-1">
            {group.stories.map((s, i) => (
              <span key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                <span className="block h-full bg-white" style={{ width: `${i < si ? 100 : i === si ? progress * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-white">
            <Avatar name={group.user.displayName} seed={group.user.id} user={group.user} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{mine ? "Your story" : group.user.displayName}</span>
              <span className="block text-xs text-white/70">{ago(story.createdAt)}</span>
            </span>
            {mine && (
              <button
                onClick={async () => {
                  await api.deleteStory(story.id).catch(() => {});
                  onChanged();
                  if (group.stories.length === 1) onClose();
                  else next();
                }}
                className="rounded-full p-2 hover:bg-white/15"
                aria-label="Delete this story"
              >
                <TrashIcon className="size-5" />
              </button>
            )}
            <button onClick={onClose} className="rounded-full p-2 hover:bg-white/15" aria-label="Close stories">
              <XIcon className="size-6" />
            </button>
          </div>
        </div>

        <div className="flex-1" />

        {/* Bottom: reply, or "seen by" on your own */}
        <div
          className="relative z-20 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {sent && <p className="mb-2 text-center text-sm text-white/90">{sent}</p>}
          {mine ? (
            <button
              onClick={() =>
                api.storyViewers(story.id).then(
                  (r) => setViewers(r.viewers),
                  () => setViewers([]),
                )
              }
              className="mx-auto flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur-md hover:bg-white/25"
            >
              <EyeIcon className="size-4" /> Seen by {story.views ?? 0}
            </button>
          ) : dm ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendReply();
              }}
            >
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                maxLength={LIMITS.messageMax}
                placeholder={`Reply to ${group.user.displayName.split(" ")[0]}…`}
                aria-label="Reply to this story"
                className="h-11 min-w-0 flex-1 rounded-full border border-white/40 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/60 focus:border-white"
              />
              <button
                disabled={!reply.trim()}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900 disabled:opacity-40"
                aria-label="Send reply"
              >
                <SendIcon className="size-5" />
              </button>
            </form>
          ) : null}
        </div>

        {viewers && (
          <div
            className="absolute inset-x-0 bottom-0 z-30 max-h-[60%] overflow-y-auto rounded-t-3xl bg-white p-4 text-zinc-900 dark:bg-zinc-900 dark:text-white"
            role="dialog"
            aria-label="Seen by"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Seen by {viewers.length}</span>
              <button onClick={() => setViewers(null)} className="rounded-full p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
                <XIcon className="size-5" />
              </button>
            </div>
            {viewers.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">Nobody yet.</p>
            ) : (
              <ul className="space-y-2">
                {viewers.map((v) => (
                  <li key={v.user.id} className="flex items-center gap-3">
                    <Avatar name={v.user.displayName} seed={v.user.id} user={v.user} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.user.displayName}</span>
                    <span className="text-xs text-zinc-500">{formatTime(v.viewedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** New story: a short text on a color, or a photo with a caption. */
function StoryComposer({ onPosted, onClose }: { onPosted: () => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [background, setBackground] = useState<string>(STORY_BACKGROUNDS[0]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const p = await prepareImage(file, LIMITS.storyMaxBytes);
      setPhoto({ blob: p.blob, url: URL.createObjectURL(p.blob), width: p.width, height: p.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that photo.");
    }
  };

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      if (photo) await api.postPhotoStory(photo.blob, photo.width, photo.height, text.trim());
      else await api.postTextStory(text.trim(), background);
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post your story.");
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New story"
      onClose={onClose}
      footer={
        <button
          onClick={() => void post()}
          disabled={busy || (!photo && !text.trim())}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {busy && <Spinner />} Share for 24 hours
        </button>
      }
    >
      <div
        className="relative mx-auto flex aspect-[9/14] w-full max-w-[16rem] items-center justify-center overflow-hidden rounded-2xl"
        style={photo ? { background: "#000" } : { background: STORY_GRADIENTS[background] }}
      >
        {photo ? (
          <>
            <img src={photo.url} alt="" className="max-h-full max-w-full object-contain" />
            <button onClick={() => setPhoto(null)} className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white" aria-label="Remove photo">
              <XIcon className="size-4" />
            </button>
          </>
        ) : (
          <p className="px-5 text-center text-lg font-semibold whitespace-pre-wrap text-white">{text || "Type something…"}</p>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={LIMITS.storyTextMax}
        rows={2}
        placeholder={photo ? "Add a caption (optional)" : "What's on your mind?"}
        aria-label={photo ? "Caption" : "Story text"}
        className="mt-3 w-full resize-none rounded-xl bg-zinc-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        {!photo ? (
          <div className="flex gap-1.5" role="radiogroup" aria-label="Background">
            {STORY_BACKGROUNDS.map((b) => (
              <button
                key={b}
                role="radio"
                aria-checked={background === b}
                aria-label={b}
                onClick={() => setBackground(b)}
                className={`size-7 rounded-full ring-offset-2 transition dark:ring-offset-zinc-900 ${background === b ? "ring-2 ring-accent" : ""}`}
                style={{ background: STORY_GRADIENTS[b] }}
              />
            ))}
          </div>
        ) : (
          <span />
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent/10"
        >
          <ImageIcon className="size-4" /> {photo ? "Change photo" : "Photo"}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Seen by your contacts (people you chat 1:1 with) and gone after 24 hours.</p>
    </Sheet>
  );
}
