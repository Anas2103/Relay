import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LIMITS, type AdminStats, type AdminUser, type AuditEntry, type Role, type User } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/format";
import { AlertIcon, Avatar, BackIcon, CheckIcon, LockIcon, PlusIcon, SearchIcon, ShieldIcon, Spinner, XIcon } from "./ui";

type Tab = "overview" | "users" | "audit";

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong.");

export function AdminPanel({ me, onClose }: { me: User; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className="below-call-bar flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-4 md:px-6">
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Back to chats"
            title="Back to chats"
          >
            <BackIcon className="size-5" />
          </button>
          <ShieldIcon className="size-5 text-accent-fg" />
          <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
        </div>
        <nav className="mx-auto mt-3 flex max-w-6xl gap-1 px-4 md:px-6" aria-label="Admin sections">
          {(
            [
              ["overview", "Overview"],
              ["users", "Users"],
              ["audit", "Audit log"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`border-b-2 px-3 pb-2.5 text-sm font-medium transition ${
                tab === id
                  ? "border-accent text-zinc-900 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
          {tab === "overview" && <Overview />}
          {tab === "users" && <Users me={me} onToast={setToast} />}
          {tab === "audit" && <AuditLog />}
        </div>
      </main>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg dark:bg-white dark:text-zinc-900"
        >
          <CheckIcon className="size-4 text-emerald-400 dark:text-emerald-600" />
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------- Overview ----------

function Overview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .stats()
      .then((r) => setStats(r.stats))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!stats) return <CenteredSpinner />;

  const cards: { label: string; value: number; hint?: string }[] = [
    { label: "Users", value: stats.users, hint: `${stats.newUsers7d} new this week` },
    { label: "Messages", value: stats.messages, hint: `${stats.messages24h} in the last 24h` },
    { label: "Conversations", value: stats.rooms },
    { label: "Active sessions", value: stats.activeSessions },
    { label: "Admins", value: stats.admins },
    { label: "Suspended", value: stats.suspended },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-900/5 md:p-5 dark:bg-zinc-900 dark:ring-white/5"
          >
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums md:text-3xl">
              {c.value.toLocaleString()}
            </p>
            {c.hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{c.hint}</p>}
          </div>
        ))}
      </div>

      <div className="flex gap-3 rounded-2xl bg-accent/10 p-4 text-sm text-accent-fg ring-1 ring-accent/20 dark:bg-accent/15">
        <LockIcon className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-medium">Messages are private, even from admins.</p>
          <p className="mt-0.5 text-accent-fg/80">
            Admins can manage accounts, but there is no way to read anyone's conversations from here. Every admin
            action is recorded in the audit log.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- Users ----------

function Users({ me, onToast }: { me: User; onToast: (msg: string) => void }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null);

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
    if (user) setUsers((prev) => (prev ? [user, ...prev.filter((u) => u.id !== user.id)] : [user]));
    load(query.trim());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users"
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

      {error ? (
        <ErrorBox message={error} />
      ) : !users ? (
        <CenteredSpinner />
      ) : users.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">No users found.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/5">
          <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_90px_80px_72px] gap-4 border-b border-zinc-200 px-5 py-3 text-xs font-medium tracking-wide text-zinc-500 uppercase md:grid dark:border-zinc-800">
            <span>User</span>
            <span>Joined</span>
            <span>Last login</span>
            <span className="text-right">Messages</span>
            <span className="text-right">Sessions</span>
            <span />
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((u) => (
              <li
                key={u.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_1fr_1fr_90px_80px_72px] md:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={u.displayName} seed={u.id} size="sm" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{u.displayName}</span>
                      {u.id === me.id && <Badge tone="zinc">You</Badge>}
                      {u.role === "admin" && <Badge tone="indigo">Admin</Badge>}
                      {u.suspendedAt && <Badge tone="red">Suspended</Badge>}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{u.username}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditing(u)}
                  className="col-start-2 row-span-2 rounded-lg px-3 py-1.5 text-sm font-medium text-accent-fg transition hover:bg-accent/10 md:col-start-6 md:row-start-1 md:row-span-1 md:justify-self-end"
                >
                  Edit
                </button>
                <p className="col-start-1 row-start-2 pl-11 text-xs text-zinc-500 md:hidden dark:text-zinc-400">
                  {u.messageCount} messages · last login {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "never"}
                </p>
                <span className="hidden text-sm text-zinc-600 md:block md:row-start-1 md:col-start-2 dark:text-zinc-400">
                  {formatRelative(u.createdAt)}
                </span>
                <span className="hidden text-sm text-zinc-600 md:block md:row-start-1 md:col-start-3 dark:text-zinc-400">
                  {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never"}
                </span>
                <span className="hidden text-right text-sm tabular-nums md:block md:row-start-1 md:col-start-4">
                  {u.messageCount.toLocaleString()}
                </span>
                <span className="hidden text-right text-sm tabular-nums md:block md:row-start-1 md:col-start-5">
                  {u.activeSessions}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <UserDialog
          me={me}
          user={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "indigo" | "red" | "zinc"; children: ReactNode }) {
  const styles = {
    indigo: "bg-accent/10 text-accent-fg ring-accent/20 dark:bg-accent/15",
    red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/60 dark:text-red-300",
    zinc: "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300",
  }[tone];
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles}`}>{children}</span>
  );
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
  me: User;
  user: AdminUser | null;
  onClose: () => void;
  onSaved: (user: AdminUser | null, message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isNew = user === null;
  const isSelf = user?.id === me.id;

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
          role: isSelf ? undefined : role,
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
            {user && <Avatar name={user.displayName} seed={user.id} />}
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

        <div className="space-y-4">
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
              disabled={isSelf}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            {isSelf && (
              <span className="mt-1.5 block text-xs text-zinc-500">You can't change your own role.</span>
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
        </div>

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
            disabled={busy !== null || !username || (isNew && !password)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "save" && <Spinner />}
            {isNew ? "Create user" : "Save changes"}
          </button>
        </div>

        {user && !isSelf && (
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
};

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .audit()
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!entries) return <CenteredSpinner />;
  if (entries.length === 0) {
    return <p className="py-12 text-center text-sm text-zinc-500">No admin actions yet.</p>;
  }

  return (
    <ol className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/5">
      {entries.map((e) => (
        <li
          key={e.id}
          className="flex flex-col gap-1 border-b border-zinc-100 px-4 py-3 last:border-0 md:flex-row md:items-baseline md:gap-4 md:px-5 dark:border-zinc-800"
        >
          <time className="shrink-0 text-xs text-zinc-500 tabular-nums md:w-36 dark:text-zinc-400" title={formatDateTime(e.createdAt)}>
            {formatDateTime(e.createdAt)}
          </time>
          <div className="min-w-0 text-sm">
            <span className="font-medium">@{e.adminUsername}</span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">{ACTION_LABELS[e.action] ?? e.action}</span>{" "}
            {e.targetUsername && <span className="font-medium">@{e.targetUsername}</span>}
            {e.details && <p className="mt-0.5 break-words text-xs text-zinc-500 dark:text-zinc-400">{e.details}</p>}
          </div>
        </li>
      ))}
    </ol>
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
