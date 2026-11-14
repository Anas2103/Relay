import { useMemo, useState } from "react";
import { REPORT_REASONS, SCHEDULE_MAX_DAYS, type ReportReason, type ScheduledMessage, type User } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { plainText } from "../lib/richText";
import { Sheet } from "./Dialogs";
import { Avatar, CheckIcon, SendIcon, Spinner, TrashIcon } from "./ui";

const input =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 dark:border-zinc-700 dark:bg-zinc-800";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-40";

// ---------- Report ----------

/** Report a message or a person to the admins. */
export function ReportDialog({
  target,
  onClose,
}: {
  /** What's being reported. `evidence` = decrypted text from a secret chat (the server only has ciphertext). */
  target: { userId: string; name: string; roomId?: string; messageId?: string; evidence?: string; preview?: string };
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.report({ reason, details: details.trim() || undefined, userId: target.userId, roomId: target.roomId, messageId: target.messageId, evidence: target.evidence });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the report.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet title="Report sent" onClose={onClose} footer={<button className={primary} onClick={onClose}>Done</button>}>
        <div className="flex flex-col items-center py-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckIcon className="size-6" />
          </span>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">Thanks. The admins will look at it. {target.name} isn't told who reported them.</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={target.messageId ? "Report message" : `Report ${target.name}`}
      onClose={onClose}
      footer={
        <button className={primary} disabled={!reason || busy} onClick={send}>
          {busy && <Spinner />} Send report
        </button>
      }
    >
      <div className="space-y-4 pt-1">
        {target.preview && (
          <blockquote className="line-clamp-3 rounded-xl bg-zinc-100 px-3.5 py-2.5 text-sm break-words dark:bg-zinc-800">{plainText(target.preview)}</blockquote>
        )}
        {target.evidence !== undefined && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">This is a secret chat: the text above is shared with the admins so they can see what was said.</p>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What's wrong?</legend>
          <div className="space-y-1.5">
            {(Object.entries(REPORT_REASONS) as [ReportReason, string][]).map(([id, label]) => (
              <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 transition ${reason === id ? "bg-accent/10 ring-2 ring-accent" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"}`}>
                <input type="radio" name="reason" checked={reason === id} onChange={() => setReason(id)} className="accent-[var(--accent)]" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <textarea className={`${input} resize-none`} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} placeholder="Anything else the admins should know? (optional)" />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Sheet>
  );
}

// ---------- Schedule ----------

function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Pick when a message should be sent. */
export function ScheduleDialog({ text, onSchedule, onClose }: { text: string; onSchedule: (sendAt: number) => void; onClose: () => void }) {
  const presets = useMemo(() => {
    const now = new Date();
    const tonight = new Date(now);
    tonight.setHours(20, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const list: [string, number][] = [["In 1 hour", now.getTime() + 3_600_000]];
    if (tonight.getTime() > now.getTime() + 600_000) list.push(["Tonight at 20:00", tonight.getTime()]);
    list.push(["Tomorrow at 9:00", tomorrow.getTime()]);
    return list;
  }, []);
  const [value, setValue] = useState(() => toLocalInput(Date.now() + 3_600_000));
  const at = new Date(value).getTime();
  const valid = Number.isFinite(at) && at > Date.now() + 30_000 && at < Date.now() + SCHEDULE_MAX_DAYS * 86_400_000;

  return (
    <Sheet
      title="Schedule message"
      onClose={onClose}
      footer={
        <button className={primary} disabled={!valid} onClick={() => (onSchedule(at), onClose())}>
          Schedule for {valid ? formatDateTime(at) : "…"}
        </button>
      }
    >
      <div className="space-y-4 pt-1">
        <blockquote className="line-clamp-3 rounded-xl bg-zinc-100 px-3.5 py-2.5 text-sm break-words dark:bg-zinc-800">{plainText(text)}</blockquote>
        <div className="flex flex-wrap gap-2">
          {presets.map(([label, ts]) => (
            <button key={label} onClick={() => setValue(toLocalInput(ts))} className="min-h-9 rounded-full px-3.5 py-1.5 text-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800">
              {label}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Date and time</span>
          <input type="datetime-local" className={input} value={value} min={toLocalInput(Date.now() + 60_000)} onChange={(e) => setValue(e.target.value)} />
        </label>
        {!valid && <p className="text-xs text-red-600 dark:text-red-400">Pick a time at least a minute from now.</p>}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">It's sent automatically, even if your device is off.</p>
      </div>
    </Sheet>
  );
}

/** Your scheduled messages in this chat. */
export function ScheduledSheet({
  items,
  onSendNow,
  onDelete,
  onClose,
}: {
  items: ScheduledMessage[];
  onSendNow: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={`Scheduled messages (${items.length})`} onClose={onClose}>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">Nothing scheduled.</p>
      ) : (
        <ul className="space-y-2 pt-1">
          {items.map((s) => (
            <li key={s.id} className="rounded-2xl p-3 ring-1 ring-zinc-200 dark:ring-zinc-700">
              <p className="text-xs font-semibold text-accent-fg">
                {formatDateTime(s.sendAt)}
                {s.silent ? " · without sound" : ""}
              </p>
              <p className="mt-1 line-clamp-3 text-sm break-words">{s.body.startsWith("e2e1.") ? "🔒 Encrypted message" : plainText(s.body)}</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => onSendNow(s.id)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent-fg ring-1 ring-accent/30 hover:bg-accent/10">
                  <SendIcon className="size-3.5" /> Send now
                </button>
                <button onClick={() => onDelete(s.id)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-600/25 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
                  <TrashIcon className="size-3.5" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---------- Seen by ----------

export function SeenBySheet({ readers, unread, onClose }: { readers: User[]; unread: User[]; onClose: () => void }) {
  const row = (u: User) => (
    <li key={u.id} className="flex items-center gap-3 py-1.5">
      <Avatar name={u.displayName} seed={u.id} user={u} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.displayName}</span>
    </li>
  );
  return (
    <Sheet title="Seen by" onClose={onClose}>
      <div className="space-y-4 pt-1">
        {readers.length ? <ul>{readers.map(row)}</ul> : <p className="py-2 text-sm text-zinc-500">Nobody has read it yet.</p>}
        {unread.length > 0 && (
          <div>
            <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Not yet</p>
            <ul className="mt-1 opacity-60">{unread.map(row)}</ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
