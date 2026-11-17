import { useState, type FormEvent } from "react";
import { MIN_AGE } from "../../shared/legal";
import type { Me } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { inputClass, LegalLinks, TermsCheckbox } from "./AuthScreen";
import { Logo, Spinner } from "./ui";

/**
 * Shown instead of the app when the Terms or Privacy Policy changed since this
 * person last accepted them (or the account predates them). Older accounts are
 * also asked for their birth date, since Relay is for people MIN_AGE and over.
 */
export function ConsentScreen({ me, onDone, onLogout }: { me: Me; onDone: (me: Me) => void; onLogout: () => void }) {
  const [birthDate, setBirthDate] = useState("");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone((await api.consent({ acceptTerms: true, ...(me.needsBirthDate ? { birthDate } : {}) })).user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Before you continue</h1>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            We've published Relay's Terms of Service and Privacy Policy. Please read and accept them to keep using Relay.
          </p>
        </div>
        {me.needsBirthDate && (
          <div>
            <label htmlFor="consentBirthDate" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Date of birth
            </label>
            <input
              id="consentBirthDate"
              type="date"
              className={inputClass}
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              autoComplete="bday"
              required
            />
            <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">Relay is for people {MIN_AGE} and older. It's never shown to anyone.</p>
          </div>
        )}
        <TermsCheckbox checked={accept} onChange={setAccept} />
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !accept || (me.needsBirthDate && !birthDate)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Spinner />}
          Continue
        </button>
        <button type="button" onClick={onLogout} className="w-full text-center text-sm text-zinc-500 hover:underline">
          Sign out
        </button>
        <LegalLinks />
      </form>
    </main>
  );
}
