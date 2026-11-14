import { useEffect, useState } from "react";
import type { InvitePreview, Room } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { Sheet } from "./Dialogs";
import { Spinner, UsersIcon } from "./ui";

/** Invite links look like https://relay…/?join=AbCdEf123456 */
export function inviteLink(code: string): string {
  return `${location.origin}/?join=${code}`;
}

/** Reads ?join=… once and removes it from the address bar. */
export function readInviteFromUrl(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get("join");
  if (!code) return null;
  url.searchParams.delete("join");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return /^[A-Za-z0-9]{12}$/.test(code) ? code : null;
}

/** Profile links look like https://relay…/?u=username */
export function profileLink(username: string): string {
  return `${location.origin}/?u=${username}`;
}

export function readProfileFromUrl(): string | null {
  const url = new URL(location.href);
  const u = url.searchParams.get("u");
  if (!u) return null;
  url.searchParams.delete("u");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return /^[A-Za-z0-9_]{3,20}$/.test(u) ? u : null;
}

export function InviteDialog({
  code,
  onJoined,
  onOpen,
  onClose,
}: {
  code: string;
  onJoined: (room: Room) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .invite(code)
      .then((r) => setInvite(r.invite))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't open this invite."));
  }, [code]);

  async function join() {
    if (!invite) return;
    if (invite.member) {
      onOpen(invite.roomId);
      return onClose();
    }
    setBusy(true);
    try {
      onJoined((await api.joinInvite(code)).room);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't join.");
      setBusy(false);
    }
  }

  return (
    <Sheet title="Group invite" onClose={onClose}>
      <div className="flex flex-col items-center py-4 text-center">
        <span className="avatar-shape flex size-20 items-center justify-center bg-accent/15 text-accent-fg">
          <UsersIcon className="size-9" />
        </span>
        {invite ? (
          <>
            <h3 className="mt-4 max-w-full truncate px-2 text-lg font-semibold">{invite.name}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {invite.memberCount} {invite.memberCount === 1 ? "member" : "members"}
            </p>
            <button onClick={join} disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-50">
              {busy && <Spinner />}
              {invite.member ? "Open group" : "Join group"}
            </button>
          </>
        ) : error ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <Spinner className="mt-6 size-6 text-zinc-400" />
        )}
      </div>
    </Sheet>
  );
}
