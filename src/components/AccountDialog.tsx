import { useEffect, useRef, useState, type FormEvent } from "react";
import { LIMITS, type User } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { AlertIcon, Avatar, CheckIcon, Spinner, XIcon } from "./ui";

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition " +
  "placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 " +
  "dark:border-zinc-700 dark:bg-zinc-800";

const primaryButton =
  "flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white " +
  "shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

type Status = { kind: "error" | "success"; text: string } | null;

export function AccountDialog({
  me,
  onClose,
  onUserUpdated,
}: {
  me: User;
  onClose: () => void;
  onUserUpdated: (user: User) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:bg-zinc-900 dark:text-zinc-100"
      aria-labelledby="account-title"
    >
      <div className="max-h-[85dvh] overflow-y-auto p-5 md:p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={me.displayName} seed={me.id} size="lg" />
            <div className="min-w-0">
              <h2 id="account-title" className="truncate text-lg font-semibold">
                {me.displayName}
              </h2>
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">@{me.username}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <ProfileForm me={me} onUserUpdated={onUserUpdated} />
        <div className="my-6 h-px bg-zinc-200 dark:bg-zinc-800" />
        <PasswordForm />
      </div>
    </dialog>
  );
}

function ProfileForm({ me, onUserUpdated }: { me: User; onUserUpdated: (user: User) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const changed = displayName.trim() !== me.displayName && displayName.trim() !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const { user } = await api.account.updateProfile(displayName);
      onUserUpdated({ ...me, ...user });
      setDisplayName(user.displayName);
      setStatus({ kind: "success", text: "Display name updated." });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3 className="text-sm font-semibold">Profile</h3>
      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm text-zinc-600 dark:text-zinc-400">Display name</span>
        <input
          className={inputClass}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={LIMITS.displayNameMax}
          autoComplete="nickname"
        />
      </label>
      <StatusLine status={status} />
      <div className="mt-3 flex justify-end">
        <button type="submit" disabled={!changed || busy} className={primaryButton}>
          {busy && <Spinner />}
          Save
        </button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const tooShort = next.length > 0 && next.length < LIMITS.passwordMin;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current && next.length >= LIMITS.passwordMin && next === confirm && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setStatus(null);
    try {
      await api.account.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ kind: "success", text: "Password changed. Your other devices have been signed out." });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3 className="text-sm font-semibold">Change password</h3>
      {/* Hidden username helps password managers update the right entry. */}
      <input type="text" autoComplete="username" className="hidden" readOnly tabIndex={-1} aria-hidden="true" />
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-sm text-zinc-600 dark:text-zinc-400">Current password</span>
          <input
            type="password"
            className={inputClass}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            maxLength={LIMITS.passwordMax}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-zinc-600 dark:text-zinc-400">New password</span>
          <input
            type="password"
            className={inputClass}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            maxLength={LIMITS.passwordMax}
            aria-invalid={tooShort}
          />
          <span className={`mt-1.5 block text-xs ${tooShort ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
            At least {LIMITS.passwordMin} characters.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-zinc-600 dark:text-zinc-400">Confirm new password</span>
          <input
            type="password"
            className={inputClass}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            maxLength={LIMITS.passwordMax}
            aria-invalid={mismatch}
          />
          {mismatch && <span className="mt-1.5 block text-xs text-red-600 dark:text-red-400">Passwords don't match.</span>}
        </label>
      </div>
      <StatusLine status={status} />
      <div className="mt-3 flex justify-end">
        <button type="submit" disabled={!canSubmit} className={primaryButton}>
          {busy && <Spinner />}
          Change password
        </button>
      </div>
    </form>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  const ok = status.kind === "success";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
        ok
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
      }`}
    >
      {ok ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : <AlertIcon className="mt-0.5 size-4 shrink-0" />}
      {status.text}
    </div>
  );
}
