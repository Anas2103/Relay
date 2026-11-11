import { useEffect, useRef, useState } from "react";
import type { Me, Profile } from "../../shared/types";
import { api, ApiError, avatarUrl } from "../lib/api";
import { formatRelative } from "../lib/format";
import type { Presence } from "./ChatLayout";
import { ImageViewer } from "./ImageViewer";
import { Avatar, Spinner, XIcon } from "./ui";

const joinedFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

export function ProfileSheet({
  userId,
  me,
  presence,
  onClose,
  onEditProfile,
}: {
  userId: string;
  me: Me;
  presence?: Presence;
  onClose: () => void;
  onEditProfile: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
    api
      .profile(userId)
      .then((r) => setProfile(r.profile))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this profile."));
  }, [userId]);

  const isMe = userId === me.id;
  const status = presence?.online
    ? "Online"
    : (presence?.lastSeenAt ?? profile?.lastSeenAt)
      ? `Last seen ${formatRelative((presence?.lastSeenAt ?? profile?.lastSeenAt)!)}`
      : null;
  const picture = profile ? avatarUrl(profile) : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-3xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:bg-zinc-900 dark:text-zinc-100"
      aria-label="Profile"
    >
      <div className="relative h-24 bg-gradient-to-br from-bubble to-bubble/60">
        <button
          onClick={() => dialogRef.current?.close()}
          className="absolute top-3 right-3 rounded-full bg-black/20 p-1.5 text-white transition hover:bg-black/30"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="px-6 pb-6">
        {error ? (
          <p className="py-10 text-center text-sm text-zinc-500">{error}</p>
        ) : !profile ? (
          <div className="flex justify-center py-12 text-zinc-400">
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            <button
              onClick={() => picture && setZoom(true)}
              className={`-mt-12 block rounded-full ring-4 ring-white dark:ring-zinc-900 ${picture ? "cursor-zoom-in" : "cursor-default"}`}
              aria-label={picture ? "View profile picture" : undefined}
              tabIndex={picture ? 0 : -1}
            >
              <Avatar name={profile.displayName} seed={profile.id} user={profile} size="xl" online={presence?.online} />
            </button>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">{profile.displayName}</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">@{profile.username}</p>
            {status && !isMe && (
              <p className={`mt-1 text-sm ${presence?.online ? "text-bubble-fg" : "text-zinc-500 dark:text-zinc-400"}`}>{status}</p>
            )}

            <div className="mt-5 space-y-4">
              <section>
                <h3 className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Bio</h3>
                <p className={`mt-1 text-sm whitespace-pre-wrap ${profile.bio ? "" : "text-zinc-400 italic"}`}>
                  {profile.bio || (isMe ? "You haven't written a bio yet." : "No bio yet.")}
                </p>
              </section>
              <section>
                <h3 className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Joined</h3>
                <p className="mt-1 text-sm">{joinedFmt.format(profile.createdAt)}</p>
              </section>
            </div>

            {isMe && (
              <button
                onClick={onEditProfile}
                className="mt-6 w-full rounded-xl bg-bubble px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Edit profile
              </button>
            )}
          </>
        )}
      </div>
      {zoom && picture && <ImageViewer src={picture} onClose={() => setZoom(false)} />}
    </dialog>
  );
}
