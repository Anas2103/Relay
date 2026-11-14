import { useCallback, useEffect, useState } from "react";
import { REPORT_REASONS, type AdminReport } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Avatar, CheckIcon, LockIcon, Spinner } from "./ui";

const card = "rounded-2xl bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900 dark:ring-white/5";

/** Reports sent by users: what was reported, by whom, and quick actions. */
export function AdminReports({ onToast, onCount }: { onToast: (t: string) => void; onCount: (n: number) => void }) {
  const [view, setView] = useState<"open" | "closed">("open");
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.admin.reports(view).then(
      (r) => {
        setReports(r.reports);
        onCount(r.open);
      },
      (e) => setError(e instanceof ApiError ? e.message : "Couldn't load reports."),
    );
  }, [view, onCount]);
  useEffect(() => {
    setReports(null);
    load();
  }, [load]);

  async function act(r: AdminReport, what: "resolved" | "dismissed" | "suspend") {
    setBusy(`${r.id}:${what}`);
    setError(null);
    try {
      if (what === "suspend" && r.target) {
        await api.admin.updateUser(r.target.id, { suspended: true });
        await api.admin.resolveReport(r.id, "resolved");
        onToast(`Suspended @${r.target.username}`);
      } else if (what !== "suspend") {
        await api.admin.resolveReport(r.id, what);
        onToast(what === "resolved" ? "Report resolved" : "Report dismissed");
      }
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't do that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-200/60 p-1 text-sm font-medium dark:bg-zinc-800">
          {(["open", "closed"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-lg px-4 py-1.5 transition ${view === v ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
              {v === "open" ? "Open" : "Closed"}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">People report messages from the message menu, or a person from their profile.</p>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</p>}
      {!reports ? (
        <div className="flex justify-center py-12 text-zinc-400">
          <Spinner className="size-6" />
        </div>
      ) : reports.length === 0 ? (
        <div className={`${card} flex flex-col items-center gap-2 px-6 py-14 text-center`}>
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckIcon className="size-6" />
          </span>
          <p className="font-medium">{view === "open" ? "No open reports" : "Nothing here yet"}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{view === "open" ? "All clear. New reports show up here." : "Resolved and dismissed reports are kept here."}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className={`${card} p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  {r.target && <Avatar name={r.target.displayName} seed={r.target.id} size="md" />}
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {r.target ? r.target.displayName : "Deleted account"}
                      {r.target && <span className="ml-1.5 text-sm font-normal text-zinc-500 dark:text-zinc-400">@{r.target.username}</span>}
                      {r.target?.suspended && <span className="ml-2 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 uppercase dark:bg-red-900/40 dark:text-red-300">Suspended</span>}
                    </p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      Reported by {r.reporter ? `@${r.reporter.username}` : "a deleted account"} · {formatRelative(r.createdAt)}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{REPORT_REASONS[r.reason] ?? r.reason}</span>
              </div>
              {r.snapshot && (
                <blockquote className="mt-3 rounded-xl bg-zinc-100 px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap dark:bg-zinc-800">
                  {r.snapshot.encrypted && (
                    <span className="mb-1 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <LockIcon className="size-3" /> From a secret chat: text shared by the reporter, not verifiable
                    </span>
                  )}
                  {r.snapshot.body || <span className="text-zinc-500 italic">({r.snapshot.kind})</span>}
                </blockquote>
              )}
              {r.details && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">“{r.details}”</p>}
              {r.status === "open" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton onClick={() => act(r, "resolved")} busy={busy === `${r.id}:resolved`} tone="accent">
                    Mark resolved
                  </ActionButton>
                  <ActionButton onClick={() => act(r, "dismissed")} busy={busy === `${r.id}:dismissed`}>
                    Dismiss
                  </ActionButton>
                  {r.target && !r.target.suspended && (
                    <ActionButton onClick={() => act(r, "suspend")} busy={busy === `${r.id}:suspend`} tone="red">
                      Suspend @{r.target.username}
                    </ActionButton>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {r.status === "resolved" ? "Resolved" : "Dismissed"}
                  {r.resolvedBy ? ` by @${r.resolvedBy}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionButton({ onClick, busy, tone, children }: { onClick: () => void; busy: boolean; tone?: "accent" | "red"; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 ${
        tone === "accent"
          ? "bg-accent text-accent-ink hover:opacity-90"
          : tone === "red"
            ? "text-red-600 ring-1 ring-red-600/25 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            : "ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}
