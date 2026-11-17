import { useState } from "react";
import { api } from "../lib/api";
import { scheduleInRoom } from "../lib/sendToRoom";
import { Sheet } from "./Dialogs";
import { ClockIcon, Spinner } from "./ui";

/** Today at `hour`, or tomorrow if that's already past (or less than 10 minutes away). */
function nextAt(hour: number, addDays = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  if (addDays === 0 && d.getTime() < Date.now() + 10 * 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function choices(): [string, number][] {
  const nextMonday = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  })();
  return [
    ["In 20 minutes", Date.now() + 20 * 60_000],
    ["In 1 hour", Date.now() + 60 * 60_000],
    ["In 3 hours", Date.now() + 3 * 60 * 60_000],
    ["This evening (8 PM)", nextAt(20)],
    ["Tomorrow morning (9 AM)", nextAt(9, 1)],
    ["Next Monday (9 AM)", nextMonday],
  ];
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** For <input type="datetime-local">, in local time. */
function localInput(t: number) {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

/**
 * "Remind me" (like Telegram): the reminder is a scheduled message in your Saved
 * Messages, sent by the server at the right time — so it arrives as a
 * notification even when the app is closed.
 */
export function RemindDialog({
  excerpt,
  chatName,
  onDone,
  onClose,
}: {
  excerpt: string;
  chatName: string;
  onDone: (text: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState(localInput(Date.now() + 2 * 60 * 60_000));

  const set = async (sendAt: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { room } = await api.openSaved();
      const quote = excerpt.length > 600 ? `${excerpt.slice(0, 600)}…` : excerpt;
      await scheduleInRoom(room.id, `⏰ Reminder · ${chatName}\n\n${quote}`, sendAt);
      onDone(`Reminder set for ${when(sendAt)}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set the reminder.");
      setBusy(false);
    }
  };

  return (
    <Sheet title="Remind me" onClose={onClose}>
      <p className="mb-3 line-clamp-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{excerpt}</p>
      <div className="space-y-1">
        {choices().map(([label, t]) => (
          <button
            key={label}
            disabled={busy}
            onClick={() => void set(t)}
            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <span className="flex items-center gap-3 font-medium">
              <ClockIcon className="size-4 text-zinc-400" />
              {label}
            </span>
            <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{when(t)}</span>
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          const t = new Date(custom).getTime();
          if (!Number.isFinite(t) || t < Date.now() + 60_000) return setError("Pick a time at least a minute from now.");
          void set(t);
        }}
      >
        <input
          type="datetime-local"
          value={custom}
          min={localInput(Date.now())}
          onChange={(e) => setCustom(e.target.value)}
          aria-label="Pick a date and time"
          className="h-10 min-w-0 flex-1 rounded-xl bg-zinc-100 px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800"
        />
        <button
          disabled={busy}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {busy && <Spinner />} Set
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">You'll get it in Saved Messages, with a notification — even if Relay is closed.</p>
    </Sheet>
  );
}
