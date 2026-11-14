import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LIMITS, type SiteSettings, type AdminStats, type AdminUser, type AuditEntry, type Me, type Role } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/format";
import { AdminReports } from "./AdminReports";
import { OwnerConversations } from "./OwnerConversations";
import { AlertIcon, Avatar, BackIcon, CheckIcon, EyeIcon, LockIcon, PlusIcon, SearchIcon, ShieldIcon, Spinner, XIcon } from "./ui";

type Tab = "overview" | "users" | "reports" | "conversations" | "site" | "audit";

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong.");

const card = "rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/5";

export function AdminPanel({ me, onClose, callPill }: { me: Me; onClose: () => void; callPill?: ReactNode }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [toast, setToast] = useState<string | null>(null);
  const [openReports, setOpenReports] = useState(0);
  useEffect(() => {
    api.admin.reports("open").then((r) => setOpenReports(r.open), () => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Esc goes back to the chats (unless a dialog is open — it handles Esc itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: [Tab, string][] = [
    ["overview", "Overview"],
    ["users", "Users"],
    ["reports", "Reports"],
    ...(me.superAdmin
      ? ([
          ["conversations", "Conversations"],
          ["site", "Site"],
        ] as [Tab, string][])
      : []),
    ["audit", "Audit log"],
  ];

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="divider-b safe-top bg-white dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-4 md:px-6">
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Back to chats"
            title="Back to chats (Esc)"
          >
            <BackIcon className="size-5" />
          </button>
          <ShieldIcon className="size-5 text-accent-fg" />
          <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
          {me.superAdmin && <Badge tone="amber">Owner</Badge>}
          <span className="flex-1" />
          {callPill}
        </div>
        <nav className="no-scrollbar fade-x mx-auto mt-3 flex max-w-6xl gap-1 overflow-x-auto px-4 md:px-6" aria-label="Admin sections">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`shrink-0 border-b-2 px-3 pb-2.5 text-sm font-medium transition ${
                tab === id
                  ? "border-accent text-zinc-900 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {label}
              {id === "reports" && openReports > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">{openReports}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {tab === "conversations" && me.superAdmin ? (
        <OwnerConversations />
      ) : (
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
            {tab === "overview" && <Overview onOpenUsers={() => setTab("users")} />}
            {tab === "users" && <Users me={me} onToast={setToast} />}
            {tab === "audit" && <AuditLog />}
            {tab === "reports" && <AdminReports onToast={setToast} onCount={setOpenReports} />}
            {tab === "site" && me.superAdmin && <SiteControls onToast={setToast} />}
          </div>
        </main>
      )}

      {toast && (
        <div
          role="status"
          className="pop-in fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg dark:bg-white dark:text-zinc-900"
        >
          <CheckIcon className="size-4 text-emerald-400 dark:text-emerald-600" />
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------- Overview ----------

function Overview({ onOpenUsers }: { onOpenUsers: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.admin
      .stats()
      .then((r) => {
        setStats(r.stats);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  // Live-ish: refresh every 30 s while the tab is open.
  useEffect(() => {
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (error && !stats) return <ErrorBox message={error} />;
  if (!stats) return <CenteredSpinner />;

  const cards: { label: string; value: number; hint?: string; live?: boolean }[] = [
    { label: "Online now", value: stats.onlineNow, hint: `of ${stats.users - stats.suspended} active accounts`, live: true },
    { label: "Messages", value: stats.messages, hint: `${stats.messages24h.toLocaleString()} in the last 24h` },
    { label: "Users", value: stats.users, hint: `${stats.newUsers7d} new this week` },
    { label: "Conversations", value: stats.rooms, hint: stats.pendingRequests ? `${stats.pendingRequests} pending requests` : "No pending requests" },
    { label: "Active sessions", value: stats.activeSessions, hint: "Signed-in devices" },
    { label: "Admins", value: stats.admins, hint: stats.suspended ? `${stats.suspended} suspended users` : "No suspended users" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className={`${card} p-4 md:p-5`}>
            <p className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              {c.live && <span className="record-pulse size-2 rounded-full bg-emerald-500" aria-hidden />}
              {c.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums md:text-3xl">{c.value.toLocaleString()}</p>
            {c.hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{c.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ActivityChart daily={stats.daily} />
        <div className={`${card} p-4 md:p-5`}>
          <h2 className="text-sm font-semibold">Most active this week</h2>
          {stats.topSenders.length === 0 ? (
            <p className="mt-6 text-center text-sm text-zinc-500">No messages this week.</p>
          ) : (
            <ol className="mt-3 space-y-2.5">
              {stats.topSenders.map((u, i) => {
                const max = stats.topSenders[0].messages;
                return (
                  <li key={u.id} className="flex items-center gap-3">
                    <span className="w-4 text-right text-xs text-zinc-400 tabular-nums">{i + 1}</span>
                    <Avatar name={u.displayName} seed={u.id} user={u} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{u.displayName}</span>
                        <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{u.messages.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (u.messages / max) * 100)}%` }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <button onClick={onOpenUsers} className="-mx-2 mt-3 rounded-lg px-2 py-2 text-sm font-medium text-accent-fg hover:bg-accent/10">
            Manage users →
          </button>
        </div>
      </div>

      <div className="flex gap-3 rounded-2xl bg-accent/10 p-4 text-sm text-accent-fg ring-1 ring-accent/20 dark:bg-accent/15">
        {stats.owners > 0 ? <EyeIcon className="mt-0.5 size-5 shrink-0" /> : <LockIcon className="mt-0.5 size-5 shrink-0" />}
        <div>
          {stats.owners > 0 ? (
            <>
              <p className="font-medium">Admins can't read messages. The owner account can.</p>
              <p className="mt-0.5 text-accent-fg/80">
                Regular admins manage accounts only. The single owner account can review conversations (never view-once
                media), and every conversation it opens is written to the audit log.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Messages are private, even from admins.</p>
              <p className="mt-0.5 text-accent-fg/80">
                Admins can manage accounts, but there is no way to read anyone's conversations from here. Every admin
                action is recorded in the audit log.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Messages per day, last 14 days. One series, so no legend; hover any bar for details. */
function ActivityChart({ daily }: { daily: AdminStats["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.messages));
  // A rounded "nice" top for the scale, so the gridline label is readable.
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const total = daily.reduce((n, d) => n + d.messages, 0);
  const label = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const active = hover !== null ? daily[hover] : null;

  return (
    <figure className={`${card} p-4 md:p-5`}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Messages per day</span>
        <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
          {active ? (
            <>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{label(active.day)}</span> ·{" "}
              {active.messages.toLocaleString()} messages · {active.signups} sign-ups
            </>
          ) : (
            `${total.toLocaleString()} in 14 days`
          )}
        </span>
      </figcaption>
      <div className="relative mt-7 h-44" onMouseLeave={() => setHover(null)}>
        {/* recessive gridlines */}
        {[1, 0.5, 0].map((f) => (
          <div key={f} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${f * 100}%` }}>
            <span className="w-7 -translate-y-1/2 text-right text-[10px] text-zinc-400 tabular-nums">
              {Math.round(top * f).toLocaleString()}
            </span>
            <span className={`h-px flex-1 ${f === 0 ? "bg-zinc-300 dark:bg-zinc-700" : "bg-zinc-100 dark:bg-zinc-800"}`} />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-9 flex items-end gap-0.5" role="img" aria-label={`Messages per day for the last 14 days, ${total} in total`}>
          {daily.map((d, i) => (
            <button
              key={d.day}
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${label(d.day)}: ${d.messages} messages, ${d.signups} sign-ups`}
              className="group flex h-full flex-1 items-end outline-none"
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${
                  hover === null || hover === i ? "bg-accent" : "bg-accent/35"
                } group-focus-visible:ring-2 group-focus-visible:ring-accent/40`}
                style={{ height: d.messages ? `${Math.max(2, (d.messages / top) * 100)}%` : "0" }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 ml-9 flex justify-between text-[10px] text-zinc-400">
        <span>{label(daily[0].day)}</span>
        <span>{label(daily[daily.length - 1].day)}</span>
      </div>
      <table className="sr-only">
        <caption>Messages and sign-ups per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Messages</th>
            <th>Sign-ups</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.messages}</td>
              <td>{d.signups}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---------- Users ----------

type UserFilter = "all" | "online" | "admins" | "suspended";
type UserSort = "newest" | "active" | "messages" | "name";

function Users({ me, onToast }: { me: Me; onToast: (msg: string) => void }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null);
  const [filter, setFilter] = useState<UserFilter>("all");
  const [sort, setSort] = useState<UserSort>("newest");

  const load = useCallback(async (q: string) => {
    try {
      const { users } = await api.admin.users(q);
      setUsers(users);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => load(query.trim()), query ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [query, load]);

  function onSaved(user: AdminUser | null, message: string) {
    setEditing(null);
    onToast(message);
    if (user) setUsers((prev) => (prev ? prev.map((u) => (u.id === user.id ? user : u)) : [user]));
    load(query.trim());
  }

  const counts = useMemo(
    () => ({
      all: users?.length ?? 0,
      online: users?.filter((u) => u.online).length ?? 0,
      admins: users?.filter((u) => u.role === "admin").length ?? 0,
      suspended: users?.filter((u) => u.suspendedAt).length ?? 0,
    }),
    [users],
  );

  const shown = useMemo(() => {
    if (!users) return null;
    const list = users.filter((u) =>
      filter === "online" ? u.online : filter === "admins" ? u.role === "admin" : filter === "suspended" ? !!u.suspendedAt : true,
    );
    const by: Record<UserSort, (a: AdminUser, b: AdminUser) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      active: (a, b) => Number(b.online) - Number(a.online) || (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0),
      messages: (a, b) => b.messageCount - a.messageCount,
      name: (a, b) => a.displayName.localeCompare(b.displayName),
    };
    return [...list].sort(by[sort]);
  }, [users, filter, sort]);

  const chips: [UserFilter, string][] = [
    ["all", "All"],
    ["online", "Online"],
    ["admins", "Admins"],
    ["suspended", "Suspended"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or username"
            aria-label="Search users"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pr-3 pl-9 text-sm outline-none transition placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-sm transition hover:opacity-90"
        >
          <PlusIcon className="size-4" />
          New user
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter users">
          {chips.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
                filter === id
                  ? "bg-accent/10 text-accent-fg ring-accent/30"
                  : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
              }`}
            >
              {id === "online" && <span className="size-2 rounded-full bg-emerald-500" />}
              {label}
              <span className="text-xs tabular-nums opacity-70">{counts[id]}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as UserSort)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none focus:border-accent dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="newest">Newest</option>
            <option value="active">Recently active</option>
            <option value="messages">Most messages</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {error ? (
        <ErrorBox message={error} />
      ) : !shown ? (
        <CenteredSpinner />
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">No users found.</p>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_90px_80px_72px] gap-4 border-b border-zinc-200 px-5 py-3 text-xs font-medium tracking-wide text-zinc-500 uppercase md:grid dark:border-zinc-800">
            <span>User</span>
            <span>Joined</span>
            <span>Last login</span>
            <span className="text-right">Messages</span>
            <span className="text-right">Devices</span>
            <span />
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shown.map((u) => (
              <li
                key={u.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition hover:bg-zinc-50/60 md:grid-cols-[minmax(0,2fr)_1fr_1fr_90px_80px_72px] md:px-5 dark:hover:bg-zinc-800/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={u.displayName} seed={u.id} user={u} size="sm" online={u.online} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{u.displayName}</span>
                      {u.id === me.id && <Badge tone="zinc">You</Badge>}
                      {u.superAdmin && <Badge tone="amber">Owner</Badge>}
                      {u.role === "admin" && !u.superAdmin && <Badge tone="indigo">Admin</Badge>}
                      {u.suspendedAt && <Badge tone="red">Suspended</Badge>}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      @{u.username}
                      {u.online && <span className="text-emerald-600 dark:text-emerald-400"> · online</span>}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setEditing(u)}
                  className="col-start-2 row-span-2 rounded-lg px-3 py-1.5 text-sm font-medium text-accent-fg transition hover:bg-accent/10 md:col-start-6 md:row-start-1 md:row-span-1 md:justify-self-end"
                >
                  Edit
                </button>
                <p className="col-start-1 row-start-2 pl-11 text-xs text-zinc-500 md:hidden dark:text-zinc-400">
                  {u.messageCount.toLocaleString()} messages · last login {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "never"}
                </p>
                <span className="hidden text-sm text-zinc-600 md:col-start-2 md:row-start-1 md:block dark:text-zinc-400" title={formatDateTime(u.createdAt)}>
                  {formatRelative(u.createdAt)}
                </span>
                <span className="hidden text-sm text-zinc-600 md:col-start-3 md:row-start-1 md:block dark:text-zinc-400" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
                  {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never"}
                </span>
                <span className="hidden text-right text-sm tabular-nums md:col-start-4 md:row-start-1 md:block">
                  {u.messageCount.toLocaleString()}
                </span>
                <span className="hidden text-right text-sm tabular-nums md:col-start-5 md:row-start-1 md:block">{u.activeSessions}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <UserDialog me={me} user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "indigo" | "red" | "zinc" | "amber"; children: ReactNode }) {
  const styles = {
    indigo: "bg-accent/10 text-accent-fg ring-accent/20 dark:bg-accent/15",
    red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/60 dark:text-red-300",
    zinc: "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-950/50 dark:text-amber-300",
  }[tone];
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles}`}>{children}</span>;
}

// ---------- Create / edit dialog ----------

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition " +
  "placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 " +
  "disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800";

function UserDialog({
  me,
  user,
  onClose,
  onSaved,
}: {
  me: Me;
  user: AdminUser | null;
  onClose: () => void;
  onSaved: (user: AdminUser | null, message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isNew = user === null;
  const isSelf = user?.id === me.id;
  // Admins manage regular accounts; only the owner (Grimm) can manage admins and promote people.
  const locked = !isNew && !isSelf && !me.superAdmin && (user.role === "admin" || user.superAdmin);
  const canSetRole = me.superAdmin && !isSelf;

  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "user");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (isNew) {
      const res = await run("save", () => api.admin.createUser({ username, displayName, password, role }));
      if (res) onSaved(res.user, `Created @${res.user.username}`);
    } else {
      const res = await run("save", () =>
        api.admin.updateUser(user.id, {
          username,
          displayName,
          role: canSetRole ? role : undefined,
          password: password || undefined,
        }),
      );
      if (res) onSaved(res.user, "Changes saved");
    }
  }

  async function toggleSuspend() {
    if (!user) return;
    const res = await run("suspend", () => api.admin.updateUser(user.id, { suspended: !user.suspendedAt }));
    if (res) onSaved(res.user, res.user.suspendedAt ? `Suspended @${user.username}` : `Restored @${user.username}`);
  }

  async function signOutAll() {
    if (!user) return;
    const res = await run("signout", () => api.admin.signOutEverywhere(user.id));
    if (res) onSaved(res.user, `Signed @${user.username} out everywhere`);
  }

  async function resetTwoFactor() {
    if (!user) return;
    const res = await run("2fa", () => api.admin.updateUser(user.id, { resetTwoFactor: true }));
    if (res) onSaved(res.user, `Turned off two-step verification for @${user.username}`);
  }

  async function remove() {
    if (!user) return;
    const res = await run("delete", () => api.admin.deleteUser(user.id));
    if (res) onSaved(null, `Deleted @${user.username}`);
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:bg-zinc-900 dark:text-zinc-100"
    >
      <form onSubmit={save} className="max-h-[85dvh] overflow-y-auto p-5 md:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {user && <Avatar name={user.displayName} seed={user.id} user={user} />}
            <div>
              <h2 className="text-lg font-semibold">{isNew ? "New user" : "Edit user"}</h2>
              {user && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Joined {formatDateTime(user.createdAt)} · {user.messageCount} messages
                </p>
              )}
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

        {locked && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <LockIcon className="mt-0.5 size-4 shrink-0" />
            {user?.superAdmin ? "This is the owner account. Only the owner can change it." : "Only the owner can manage other admins."}
          </div>
        )}
        <fieldset className="space-y-4" disabled={locked}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Username</span>
            <input
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={LIMITS.usernameMax}
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Display name</span>
            <input
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={LIMITS.displayNameMax}
              placeholder="Defaults to username"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Role</span>
            <select
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={!canSetRole}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            {isSelf ? (
              <span className="mt-1.5 block text-xs text-zinc-500">You can't change your own role.</span>
            ) : (
              !me.superAdmin && <span className="mt-1.5 block text-xs text-zinc-500">Only the owner can make or remove admins.</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">{isNew ? "Password" : "Reset password"}</span>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={LIMITS.passwordMax}
              placeholder={isNew ? `At least ${LIMITS.passwordMin} characters` : "Leave empty to keep current"}
              autoComplete="new-password"
              required={isNew}
            />
            {!isNew && !isSelf && password && (
              <span className="mt-1.5 block text-xs text-zinc-500">They'll be signed out of all devices.</span>
            )}
          </label>
        </fieldset>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
          >
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={locked || busy !== null || !username || (isNew && !password)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "save" && <Spinner />}
            {isNew ? "Create user" : "Save changes"}
          </button>
        </div>

        {user && !isSelf && !locked && (
          <div className="mt-6 space-y-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">Account actions</h3>
            <ActionRow
              title="Sign out everywhere"
              description={`Ends all ${user.activeSessions} active session${user.activeSessions === 1 ? "" : "s"}.`}
            >
              <SecondaryButton onClick={signOutAll} busy={busy === "signout"} disabled={busy !== null}>
                Sign out
              </SecondaryButton>
            </ActionRow>
            <ActionRow title="Reset two-step verification" description="Only if they lost their phone and recovery codes. Verify it's really them first.">
              <SecondaryButton onClick={resetTwoFactor} busy={busy === "2fa"} disabled={busy !== null}>
                Reset
              </SecondaryButton>
            </ActionRow>
            <ActionRow
              title={user.suspendedAt ? "Restore account" : "Suspend account"}
              description={
                user.suspendedAt
                  ? `Suspended ${formatRelative(user.suspendedAt)}. Restoring lets them sign in again.`
                  : "Blocks sign-in and disconnects them immediately."
              }
            >
              <SecondaryButton
                onClick={toggleSuspend}
                busy={busy === "suspend"}
                disabled={busy !== null}
                danger={!user.suspendedAt}
              >
                {user.suspendedAt ? "Restore" : "Suspend"}
              </SecondaryButton>
            </ActionRow>

            <div className="rounded-xl bg-red-50 p-4 ring-1 ring-red-600/10 dark:bg-red-950/30 dark:ring-red-400/10">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">Delete account</p>
              <p className="mt-0.5 text-xs text-red-700/80 dark:text-red-300/70">
                Permanently deletes @{user.username}, their direct-message conversations and all their messages.
                This can't be undone.
              </p>
              <input
                className={`${inputClass} mt-3`}
                value={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.value)}
                placeholder={`Type ${user.username} to confirm`}
                aria-label={`Type ${user.username} to confirm deletion`}
                autoCapitalize="none"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={remove}
                disabled={confirmDelete !== user.username || busy !== null}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "delete" && <Spinner />}
                Delete permanently
              </button>
            </div>
          </div>
        )}
      </form>
    </dialog>
  );
}

function ActionRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SecondaryButton({
  onClick,
  busy,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? "text-red-700 ring-red-600/30 hover:bg-red-50 dark:text-red-400 dark:ring-red-400/30 dark:hover:bg-red-950/40"
          : "text-zinc-700 ring-zinc-300 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

// ---------- Audit log ----------

const ACTION_LABELS: Record<string, string> = {
  "user.create": "created",
  "user.update": "updated",
  "user.delete": "deleted",
  "user.signout_all": "signed out everywhere",
  "conversation.view": "opened a conversation",
};

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.admin
      .audit()
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries ?? [];
    return (entries ?? []).filter((e) =>
      [e.adminUsername, e.targetUsername, e.details, ACTION_LABELS[e.action] ?? e.action].some((s) =>
        s?.toLowerCase().includes(q),
      ),
    );
  }, [entries, query]);

  if (error) return <ErrorBox message={error} />;
  if (!entries) return <CenteredSpinner />;
  if (entries.length === 0) {
    return <p className="py-12 text-center text-sm text-zinc-500">No admin actions yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the log"
            aria-label="Search the audit log"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pr-3 pl-9 text-sm outline-none transition placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">Nothing matches.</p>
      ) : (
        <ol className={`${card} overflow-hidden`}>
          {shown.map((e) => {
            const isView = e.action === "conversation.view";
            return (
            <li key={e.id} className="flex gap-3 border-b border-zinc-100 px-4 py-3 last:border-0 md:px-5 dark:border-zinc-800">
              <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${isView ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                {isView ? <EyeIcon className="size-3.5" /> : <ShieldIcon className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  <span className="font-medium">@{e.adminUsername}</span>{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">{ACTION_LABELS[e.action] ?? e.action}</span>{" "}
                  {e.targetUsername && <span className="font-medium">@{e.targetUsername}</span>}
                </p>
                {e.details && <p className="mt-0.5 break-words text-xs text-zinc-500 dark:text-zinc-400">{e.details}</p>}
              </div>
              <time className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400" title={formatDateTime(e.createdAt)}>
                {formatRelative(e.createdAt)}
              </time>
            </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------- Shared bits ----------

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-16 text-zinc-400">
      <Spinner className="size-6" />
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
      <AlertIcon className="size-4 shrink-0" />
      {message}
    </div>
  );
}

// ---------- Site (owner only) ----------

function SiteControls({ onToast }: { onToast: (msg: string) => void }) {
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .site()
      .then((r) => {
        setSite(r.site);
        setText(r.site.announcement?.text ?? "");
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function update(label: string, data: Parameters<typeof api.admin.updateSite>[0], message: string) {
    setBusy(label);
    setError(null);
    try {
      const r = await api.admin.updateSite(data);
      setSite(r.site);
      onToast(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!site) return error ? <ErrorBox message={error} /> : <CenteredSpinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className={`${card} p-5`}>
        <h2 className="font-semibold">Announcement</h2>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">A banner at the top of everyone's chat list. People can dismiss it; a new one shows again.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={LIMITS.announcementMax}
          rows={3}
          placeholder="e.g. Relay will be down for 5 minutes tonight at 22:00 for an update."
          className={`${inputClass} mt-3 resize-none`}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-zinc-400 tabular-nums">
            {text.length}/{LIMITS.announcementMax}
          </span>
          <div className="flex gap-2">
            {site.announcement && (
              <SecondaryButton onClick={() => update("clear", { announcement: "" }, "Announcement removed").then(() => setText(""))} busy={busy === "clear"} disabled={busy !== null}>
                Remove
              </SecondaryButton>
            )}
            <button
              onClick={() => update("announce", { announcement: text }, "Announcement published")}
              disabled={busy !== null || !text.trim() || text.trim() === site.announcement?.text}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === "announce" && <Spinner />}
              Publish
            </button>
          </div>
        </div>
      </section>

      <section className={`${card} divide-y divide-zinc-100 dark:divide-zinc-800`}>
        <SiteToggle
          title="Open sign-ups"
          description={site.registrationOpen ? "Anyone with the link can create an account." : "Closed: only admins can create accounts (Users → New user)."}
          checked={site.registrationOpen}
          busy={busy === "reg"}
          onChange={() => update("reg", { registrationOpen: !site.registrationOpen }, site.registrationOpen ? "Sign-ups closed" : "Sign-ups opened")}
        />
        <SiteToggle
          title="Maintenance mode"
          description={
            site.maintenance
              ? "ON: everyone except admins sees a \"Back soon\" screen and can't use the app."
              : "Temporarily lock the app for everyone except admins (e.g. while you deploy)."
          }
          checked={site.maintenance}
          danger
          busy={busy === "maint"}
          onChange={() => update("maint", { maintenance: !site.maintenance }, site.maintenance ? "Maintenance mode off" : "Maintenance mode on")}
        />
      </section>

      <section className={`${card} p-5 text-sm`}>
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldIcon className="size-4 text-amber-600" /> What the owner can do
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
          <li>Everything admins can: create, edit, suspend, sign out and delete accounts, reset passwords, see stats and the audit log.</li>
          <li>Manage admins too: promote, demote, suspend or delete them. Regular admins can't touch other admins or you.</li>
          <li>Review any conversation or group, delete single messages or whole chats, export conversations.</li>
          <li>Control the site: announcement, sign-ups, maintenance mode.</li>
          <li>
            <strong>Secret chats are the one exception:</strong> they're end-to-end encrypted, so they show as locked here. You can still see who and when, and delete them.
          </li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Every action here is recorded in the audit log.</p>
      </section>
      {error && <ErrorBox message={error} />}
    </div>
  );
}

function SiteToggle({
  title,
  description,
  checked,
  busy,
  danger,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  busy: boolean;
  danger?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-5">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onChange}
        disabled={busy}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors before:absolute before:-inset-y-3 before:inset-x-0 before:content-[""] disabled:opacity-50 ${checked ? (danger ? "bg-red-600" : "bg-accent") : "bg-zinc-300 dark:bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}
