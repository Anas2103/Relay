import { useState, type FormEvent } from "react";
import { passwordProblem } from "../../shared/password";
import { LIMITS, type Me } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { PasswordStrength } from "./PasswordStrength";
import { AlertIcon, BackIcon, KeyIcon, Logo, Spinner } from "./ui";

type Mode = "login" | "register";

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition " +
  "placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 " +
  "dark:border-zinc-800 dark:bg-zinc-900";

const primaryButton =
  "flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-sm transition hover:opacity-90 focus-visible:ring-4 focus-visible:ring-accent/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function AuthScreen({ onAuthed }: { onAuthed: (user: Me) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Password was right; waiting for the authenticator code. */
  const [challenge, setChallenge] = useState<string | null>(null);

  const weak = mode === "register" && password.length > 0 ? passwordProblem(password, username) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const result = await api.login(username, password);
        if ("twoFactor" in result) {
          setChallenge(result.challenge);
          setBusy(false);
          return;
        }
        onAuthed(result.user);
      } else {
        onAuthed((await api.register(username, password, displayName)).user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  if (challenge) {
    return (
      <TwoFactorStep
        challenge={challenge}
        onAuthed={onAuthed}
        onBack={() => {
          setChallenge(null);
          setPassword("");
        }}
      />
    );
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={52} />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            {mode === "login" ? "Sign in to keep chatting." : "Real-time, private chat with your friends."}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-xl bg-zinc-200/60 p-1 text-sm font-medium dark:bg-zinc-900">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-lg py-2 transition ${
                mode === m ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {m === "login" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Username" htmlFor="username">
            <input
              id="username"
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={LIMITS.usernameMax}
              placeholder="e.g. anas_dev"
              required
              autoFocus
            />
          </Field>

          {mode === "register" && (
            <Field label="Display name" htmlFor="displayName" hint="Optional — what friends see.">
              <input
                id="displayName"
                className={inputClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
                maxLength={LIMITS.displayNameMax}
                placeholder="e.g. Anas"
              />
            </Field>
          )}

          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              maxLength={LIMITS.passwordMax}
              required
            />
            {mode === "register" && <PasswordStrength password={password} username={username} />}
          </Field>

          {error && <ErrorBox text={error} />}

          <button type="submit" disabled={busy || !username || !password || !!weak} className={primaryButton}>
            {busy && <Spinner />}
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </main>
  );
}

/** Second step of signing in: the 6-digit code from the authenticator app, or a recovery code. */
function TwoFactorStep({ challenge, onAuthed, onBack }: { challenge: string; onAuthed: (user: Me) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAuthed((await api.verifyLogin(challenge, code)).user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
      // Expired or too many tries: back to the password.
      if (err instanceof ApiError && err.status === 401) setTimeout(onBack, 1800);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <button type="button" onClick={onBack} className="-ml-2 flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-900">
          <BackIcon className="size-4" /> Back
        </button>
        <div className="flex flex-col items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent-fg">
            <KeyIcon className="size-7" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Two-step verification</h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            {recovery ? "Enter one of the recovery codes you saved. Each code works once." : "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>
        {recovery ? (
          <input
            className={`${inputClass} text-center font-mono tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 16))}
            placeholder="xxxxx-xxxxx"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-label="Recovery code"
          />
        ) : (
          <input
            className={`${inputClass} text-center font-mono text-2xl tracking-[0.5em]`}
            value={code}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              if (digits.length === 6 && !busy) setTimeout(() => (document.getElementById("verify-2fa") as HTMLButtonElement | null)?.click(), 0);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            autoFocus
            aria-label="6-digit code"
          />
        )}
        {error && <ErrorBox text={error} />}
        <button id="verify-2fa" type="submit" disabled={busy || (recovery ? code.length < 10 : code.length !== 6)} className={primaryButton}>
          {busy && <Spinner />}
          Verify
        </button>
        <button
          type="button"
          onClick={() => {
            setRecovery(!recovery);
            setCode("");
            setError(null);
          }}
          className="w-full rounded-lg py-1.5 text-sm font-medium text-accent-fg hover:underline"
        >
          {recovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
        </button>
      </form>
    </main>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      {text}
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}
