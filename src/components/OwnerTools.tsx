import { useEffect, useState, type ReactNode } from "react";
import { SITE_FEATURES, type AdminUser, type OwnerSearchHit, type OwnerStory, type OwnerUserDetail, type SiteSettings } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/format";
import { AlertIcon, LaptopIcon, MegaphoneIcon, SearchIcon, ShieldIcon, SmartphoneIcon, Spinner, TrashIcon, UsersIcon } from "./ui";

/*
 * The owner's extra tools (the highest authority), used inside the admin panel:
 *  - Site: read-only mode, feature switches, broadcast, sign everyone out
 *  - Moderate: search every conversation, moderate anyone's stories
 *  - Per account: restrict / timed suspension (admins too), and for the owner:
 *    devices, chats, activity, sign out one device, erase everything they wrote
 */

const card = "rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/5";
const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition " +
  "placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 " +
  "disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800";
const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong.");

function Button({
  onClick,
  busy,
  disabled,
  tone = "plain",
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "plain" | "danger" | "primary";
  children: ReactNode;
}) {
  const cls =
    tone === "primary"
      ? "bg-accent text-accent-ink hover:opacity-90"
      : tone === "danger"
        ? "text-red-700 ring-1 ring-red-600/30 hover:bg-red-50 dark:text-red-400 dark:ring-red-400/30 dark:hover:bg-red-950/40"
        : "text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`flex shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  danger,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  danger?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? (danger ? "bg-red-600" : "bg-accent") : "bg-zinc-300 dark:bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
      <AlertIcon className="mt-0.5 size-4 shrink-0" /> {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

/** Read-only mode, feature switches, broadcast and "sign everyone out". */
export function OwnerSiteExtras({ site, onSite, onToast }: { site: SiteSettings; onSite: (s: SiteSettings) => void; onToast: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [push, setPush] = useState(true);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const update = (label: string, data: Parameters<typeof api.admin.updateSite>[0], message: string) =>
    run(label, async () => {
      const r = await api.admin.updateSite(data);
      onSite(r.site);
      onToast(message);
    });

  return (
    <>
      <section className={`${card} divide-y divide-zinc-100 dark:divide-zinc-800`}>
        <div className="flex items-start justify-between gap-4 p-5">
          <div>
            <p className="font-medium">Read-only mode</p>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {site.readOnly
                ? "ON: everyone can read their chats, but only admins can send, call, upload or post."
                : "Freeze the whole app without locking anyone out: people can read, not send."}
            </p>
          </div>
          <Toggle
            label="Read-only mode"
            checked={site.readOnly}
            danger
            disabled={busy !== null}
            onChange={() => update("ro", { readOnly: !site.readOnly }, site.readOnly ? "Read-only mode off" : "Read-only mode on")}
          />
        </div>
        <div className="p-5">
          <p className="font-medium">Features</p>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Turn any feature off for everyone. Admins keep them, so they can still moderate.</p>
          <div className="mt-3 space-y-2.5">
            {SITE_FEATURES.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <span className="text-sm">{label}</span>
                <Toggle
                  label={label}
                  checked={site.features[key]}
                  disabled={busy !== null}
                  onChange={() => update(`f-${key}`, { features: { [key]: !site.features[key] } }, `${label} ${site.features[key] ? "off" : "on"}`)}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${card} p-5`}>
        <h2 className="flex items-center gap-2 font-semibold">
          <MegaphoneIcon className="size-4 text-accent-fg" /> Broadcast
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Pops up on every screen right now, like an alert. Unlike the announcement banner, it can't be missed.
        </p>
        <input
          className={`${inputClass} mt-3`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          placeholder="Title (optional)"
          aria-label="Broadcast title"
        />
        <textarea
          className={`${inputClass} mt-2 resize-none`}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Your message to everyone"
          aria-label="Broadcast message"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Also wake phones with a notification
          </label>
          <Button
            tone="primary"
            busy={busy === "bc"}
            disabled={!text.trim()}
            onClick={() =>
              run("bc", async () => {
                const r = await api.admin.owner.broadcast(title, text, push);
                setTitle("");
                setText("");
                onToast(`Sent to ${r.sent} people`);
              })
            }
          >
            Send to everyone
          </Button>
        </div>
      </section>

      <section className={`${card} p-5`}>
        <h2 className="font-semibold">Sign everyone out</h2>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Ends every session on every device for every account (yours stays signed in here). Use it after a security problem.
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {confirmSignOut ? (
            <>
              <Button onClick={() => setConfirmSignOut(false)}>Cancel</Button>
              <Button
                tone="danger"
                busy={busy === "so"}
                onClick={() =>
                  run("so", async () => {
                    const r = await api.admin.owner.signOutAll();
                    setConfirmSignOut(false);
                    onToast(`Signed out ${r.accounts} accounts`);
                  })
                }
              >
                Yes, sign everyone out
              </Button>
            </>
          ) : (
            <Button tone="danger" onClick={() => setConfirmSignOut(true)}>
              Sign everyone out…
            </Button>
          )}
        </div>
      </section>
      <ErrorLine text={error} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Moderate: search everything + stories
// ---------------------------------------------------------------------------

export function OwnerModerate({ onToast, onOpenRoom }: { onToast: (m: string) => void; onOpenRoom: (roomId: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SearchEverything onOpenRoom={onOpenRoom} />
      <StoriesModeration onToast={onToast} />
    </div>
  );
}

function SearchEverything({ onOpenRoom }: { onOpenRoom: (roomId: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<OwnerSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setHits((await api.admin.owner.search(q.trim())).hits);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${card} p-5`}>
      <h2 className="flex items-center gap-2 font-semibold">
        <SearchIcon className="size-4 text-accent-fg" /> Search every conversation
      </h2>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
        Words in any chat or group. Secret chats never match: they're encrypted. Each search is recorded in the audit log.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all messages…" aria-label="Search all messages" />
        <button
          disabled={busy || q.trim().length < 2}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {busy && <Spinner />} Search
        </button>
      </form>
      <div className="mt-3">
        <ErrorLine text={error} />
      </div>
      {hits && (
        <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800" aria-label="Search results">
          {hits.length === 0 && <li className="py-3 text-sm text-zinc-500">No messages found.</li>}
          {hits.map((h) => (
            <li key={h.messageId}>
              <button onClick={() => onOpenRoom(h.roomId)} className="w-full py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <span className="flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="truncate">
                    {h.roomType === "group" ? "👥 " : ""}
                    {h.roomTitle} · <strong className="font-medium text-zinc-700 dark:text-zinc-200">{h.displayName}</strong> @{h.username}
                  </span>
                  <span className="shrink-0">{formatRelative(h.createdAt)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm">{h.body || `(${h.kind})`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StoriesModeration({ onToast }: { onToast: (m: string) => void }) {
  const [stories, setStories] = useState<OwnerStory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.admin.owner.stories().then(
      (r) => setStories(r.stories),
      (e) => setError(errorMessage(e)),
    );
  }, []);

  async function remove(s: OwnerStory) {
    setBusy(s.id);
    try {
      await api.admin.owner.deleteStory(s.id);
      setStories((list) => list?.filter((x) => x.id !== s.id) ?? null);
      onToast(`Removed ${s.user.displayName}'s story`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`${card} p-5`}>
      <h2 className="font-semibold">Stories</h2>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Every live story, from everyone. Remove anything that breaks the rules.</p>
      <ErrorLine text={error} />
      {!stories ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : stories.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No live stories right now.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Live stories">
          {stories.map((s) => (
            <li key={s.id} className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <div className="flex aspect-[9/12] items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500 to-fuchsia-500 p-3 text-center text-sm font-medium text-white">
                {s.kind === "image" ? (
                  <img src={api.admin.owner.storyMediaUrl(s.id)} alt={s.text || "Story photo"} className="size-full object-cover" loading="lazy" />
                ) : (
                  <span className="line-clamp-6 break-words">{s.text}</span>
                )}
              </div>
              <div className="space-y-2 p-2.5">
                <p className="truncate text-xs">
                  <strong>{s.user.displayName}</strong> · {formatRelative(s.createdAt)} · 👁 {s.views}
                </p>
                <Button tone="danger" busy={busy === s.id} onClick={() => void remove(s)}>
                  <TrashIcon className="size-3.5" /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

const DURATIONS: [string, number | null][] = [
  ["1 hour", 3_600_000],
  ["1 day", 86_400_000],
  ["3 days", 3 * 86_400_000],
  ["1 week", 7 * 86_400_000],
  ["30 days", 30 * 86_400_000],
  ["Until I lift it", null],
];

/**
 * Restrict (read-only for a while) and suspend for a set time, with a reason the
 * person sees. Admins can use this on regular accounts; the owner on anyone.
 */
export function ModerationActions({ user, onSaved }: { user: AdminUser; onSaved: (u: AdminUser, message: string) => void }) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ user: AdminUser }>, message: string) {
    setBusy(label);
    setError(null);
    try {
      onSaved((await fn()).user, message);
      setReason("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const ms = DURATIONS[duration][1];
  const until = ms ? Date.now() + ms : null;
  // A restriction always needs an end; "until I lift it" means 10 years.
  const restrictUntil = until ?? Date.now() + 3650 * 86_400_000;

  return (
    <div className="space-y-3 rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-900/5 dark:bg-zinc-800/50 dark:ring-white/5">
      <p className="text-sm font-medium">Restrict or suspend</p>
      {user.restrictedUntil && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Restricted until {formatDateTime(user.restrictedUntil)}
          {user.restrictReason ? ` · ${user.restrictReason}` : ""}
        </p>
      )}
      {user.suspendedAt && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
          Suspended {user.suspendedUntil ? `until ${formatDateTime(user.suspendedUntil)}` : "until lifted"}
          {user.suspendReason ? ` · ${user.suspendReason}` : ""}
        </p>
      )}
      <div className="flex gap-2">
        <select className={inputClass} value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="For how long">
          {DURATIONS.map(([label], i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <input
        className={inputClass}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder="Reason (they'll see it)"
        aria-label="Reason"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          busy={busy === "restrict"}
          onClick={() =>
            run(
              "restrict",
              () => api.admin.updateUser(user.id, { restrictedUntil: restrictUntil, restrictReason: reason || null }),
              `Restricted @${user.username}`,
            )
          }
        >
          Restrict (read-only)
        </Button>
        {user.restrictedUntil && (
          <Button
            busy={busy === "unrestrict"}
            onClick={() => run("unrestrict", () => api.admin.updateUser(user.id, { restrictedUntil: null }), `Lifted @${user.username}'s restriction`)}
          >
            Lift restriction
          </Button>
        )}
        <Button
          tone="danger"
          busy={busy === "suspend"}
          onClick={() =>
            run(
              "suspend",
              () => api.admin.updateUser(user.id, { suspended: true, suspendedUntil: until, suspendReason: reason || null }),
              `Suspended @${user.username}${ms ? ` for ${DURATIONS[duration][0]}` : ""}`,
            )
          }
        >
          {user.suspendedAt ? "Change suspension" : "Suspend"}
        </Button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Restricted people can still read and receive messages, but can't send, call, upload or post. Suspended people can't sign in.
      </p>
      <ErrorLine text={error} />
    </div>
  );
}

/** Owner only: devices, chats and activity of one account, plus "erase everything they wrote". */
export function OwnerUserInsight({ user, onToast, onOpenRoom }: { user: AdminUser; onToast: (m: string) => void; onOpenRoom?: (roomId: string) => void }) {
  const [detail, setDetail] = useState<OwnerUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const load = () =>
    api.admin.owner.user(user.id).then(
      (r) => setDetail(r.detail),
      (e) => setError(errorMessage(e)),
    );
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!detail)
    return error ? (
      <ErrorLine text={error} />
    ) : (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  const s = detail.stats;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center text-xs" aria-label="Activity">
        {(
          [
            ["Messages", s.messages],
            ["Files", s.media],
            ["Reactions", s.reactions],
            ["Live stories", s.stories],
            ["Reported", s.reportsAgainst],
            ["Blocked by", s.blockedBy],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-xl bg-zinc-50 p-2 dark:bg-zinc-800/50">
            <p className="text-base font-semibold tabular-nums">{n}</p>
            <p className="text-zinc-500 dark:text-zinc-400">{label}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">Signed-in devices ({detail.sessions.length})</p>
        {detail.sessions.length === 0 && <p className="text-xs text-zinc-500">None.</p>}
        <ul className="space-y-1.5">
          {detail.sessions.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
              {/Android|iPhone|iPad|Mobile/i.test(d.device ?? "") ? (
                <SmartphoneIcon className="size-4 shrink-0 text-zinc-500" />
              ) : (
                <LaptopIcon className="size-4 shrink-0 text-zinc-500" />
              )}
              <span className="min-w-0 flex-1 text-xs">
                <span className="block truncate font-medium">{d.device ?? "Unknown device"}</span>
                <span className="block truncate text-zinc-500">
                  {d.location ? `${d.location} · ` : ""}active {formatRelative(d.lastActiveAt ?? d.createdAt)}
                </span>
              </span>
              <Button
                busy={busy === d.id}
                onClick={() =>
                  run(d.id, async () => {
                    await api.admin.owner.signOutDevice(user.id, d.id);
                    onToast("Device signed out");
                    await load();
                  })
                }
              >
                Sign out
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
          <UsersIcon className="size-4" /> Chats ({detail.rooms.length})
        </p>
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {detail.rooms.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpenRoom?.(r.id)}
                disabled={!onOpenRoom}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-50 disabled:hover:bg-transparent dark:hover:bg-zinc-800/50"
              >
                <span className="min-w-0 truncate">
                  {r.secret ? "🔒 " : r.type === "group" ? "👥 " : ""}
                  {r.title}
                </span>
                <span className="shrink-0 text-zinc-500 tabular-nums">
                  {r.messages} msgs{r.lastAt ? ` · ${formatRelative(r.lastAt)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl bg-red-50 p-4 ring-1 ring-red-600/10 dark:bg-red-950/30 dark:ring-red-400/10">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">Erase everything they wrote</p>
        <p className="mt-0.5 text-xs text-red-700/80 dark:text-red-300/70">
          Deletes all {s.messages} of @{user.username}'s messages and files in every chat and group, for everyone. Their account stays.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          {confirmErase ? (
            <>
              <Button onClick={() => setConfirmErase(false)}>Cancel</Button>
              <Button
                tone="danger"
                busy={busy === "erase"}
                onClick={() =>
                  run("erase", async () => {
                    const r = await api.admin.owner.eraseMessages(user.id);
                    setConfirmErase(false);
                    onToast(`Erased ${r.deleted} messages`);
                    await load();
                  })
                }
              >
                Yes, erase them all
              </Button>
            </>
          ) : (
            <Button tone="danger" onClick={() => setConfirmErase(true)} disabled={s.messages === 0}>
              Erase messages…
            </Button>
          )}
        </div>
      </div>
      <ErrorLine text={error} />
    </div>
  );
}

/** The list on the Site tab. */
export function OwnerPowersList() {
  return (
    <section className={`${card} p-5 text-sm`}>
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldIcon className="size-4 text-amber-600" /> What the owner can do
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
        <li>
          Everything admins can: create, edit, suspend, sign out and delete accounts, reset passwords and two-step verification, handle reports, see stats.
        </li>
        <li>Manage admins and promote people. Nobody else can touch admins or the owner account.</li>
        <li>Restrict anyone (read-only for a while) or suspend them for a set time, with a reason they see.</li>
        <li>See any account's devices, chats and activity; sign out a single device; erase everything someone wrote.</li>
        <li>Review, search, export and delete any conversation or group; join any group as its admin to moderate it from inside.</li>
        <li>Remove anyone's story.</li>
        <li>Run the site: announcement, broadcast alerts, sign-ups, maintenance mode, read-only mode, switch any feature off, sign everyone out.</li>
        <li>Search and filter the full audit log.</li>
        <li>
          <strong>Secret chats are the one exception:</strong> they're end-to-end encrypted, so nobody (you included) can read them. You can still see who and
          when, and delete them.
        </li>
      </ul>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Every action here is recorded in the audit log.</p>
    </section>
  );
}
