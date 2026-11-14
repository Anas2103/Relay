import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { SESSION_IDLE_OPTIONS, type Me, type SecurityOverview, type SessionInfo } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatRelative } from "../lib/format";
import { AUTO_LOCK_OPTIONS, clearPasscode, LOCK_EVENT, passcodeFor, setAutoLock, setPasscode } from "../lib/passcode";
import { ConfirmDialog, Sheet } from "./Dialogs";
import { CheckIcon, CopyIcon, DownloadIcon, KeyIcon, LaptopIcon, LockIcon, ShieldIcon, SmartphoneIcon, Spinner } from "./ui";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong.");
const input =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 dark:border-zinc-700 dark:bg-zinc-800";
const primary =
  "flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-xl px-3.5 py-2 text-sm font-medium ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:ring-zinc-700 dark:hover:bg-zinc-800";

function Title({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {icon && <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 [&>svg]:size-4.5">{icon}</span>}
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </div>
    </div>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
      {text}
    </p>
  ) : null;
}

/** Everything about keeping the account safe: 2-step, devices, auto sign-out, passcode. */
export function SecuritySettings({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const [security, setSecurity] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.account.security().then(
      (r) => setSecurity(r.security),
      (e) => setError(errText(e)),
    );
  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <TwoFactorSection me={me} security={security} onChanged={(user) => (onMeUpdated(user), load())} />
      <DevicesSection security={security} setSecurity={setSecurity} error={error} />
      <PasscodeSection me={me} />
    </>
  );
}

// ---------- Two-step verification ----------

function TwoFactorSection({ me, security, onChanged }: { me: Me; security: SecurityOverview | null; onChanged: (me: Me) => void }) {
  const [step, setStep] = useState<"password" | "scan" | "codes" | null>(null);
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"disable" | "regenerate" | null>(null);

  function reset() {
    setStep(null);
    setPassword("");
    setSetup(null);
    setCode("");
    setError(null);
    setBusy(false);
  }

  async function begin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.account.setup2fa(password));
      setPassword("");
      setStep("scan");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.account.enable2fa(code);
      setCodes(r.recoveryCodes);
      setStep("codes");
      onChanged(r.user);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function passwordAction(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (action === "disable") {
        onChanged((await api.account.disable2fa(password)).user);
        setAction(null);
      } else {
        setCodes((await api.account.newRecoveryCodes(password)).recoveryCodes);
        setAction(null);
        setStep("codes");
      }
      setPassword("");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const on = me.twoFactor;
  return (
    <section className={`rounded-2xl p-4 ring-1 ${on ? "bg-emerald-50/60 ring-emerald-600/20 dark:bg-emerald-950/30 dark:ring-emerald-400/20" : "ring-zinc-200 dark:ring-zinc-800"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Title
          icon={<ShieldIcon />}
          title={on ? "Two-step verification is on" : "Two-step verification"}
          hint={
            on
              ? `Signing in needs your password and a code from your authenticator app. ${security ? `${security.recoveryCodesLeft} recovery code${security.recoveryCodesLeft === 1 ? "" : "s"} left.` : ""}`
              : "Even if someone learns your password, they can't sign in without a 6-digit code from your phone. Works with Google Authenticator, Authy, 1Password, Bitwarden and others."
          }
        />
        {on ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button className={secondary} onClick={() => setAction("regenerate")}>
              New recovery codes
            </button>
            <button className={`${secondary} text-red-600 dark:text-red-400`} onClick={() => setAction("disable")}>
              Turn off
            </button>
          </div>
        ) : (
          <button className={`${primary} shrink-0`} onClick={() => setStep("password")}>
            Turn on
          </button>
        )}
      </div>

      {step === "password" && (
        <Sheet title="Turn on two-step verification" onClose={reset}>
          <form onSubmit={begin} className="space-y-4 pt-1">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">First, confirm it's you.</p>
            <input type="text" autoComplete="username" className="hidden" readOnly tabIndex={-1} aria-hidden="true" />
            <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" autoFocus />
            <ErrorLine text={error} />
            <button className={`${primary} w-full`} disabled={!password || busy}>
              {busy && <Spinner />} Continue
            </button>
          </form>
        </Sheet>
      )}

      {step === "scan" && setup && (
        <Sheet title="Scan with your authenticator app" onClose={reset}>
          <form onSubmit={confirm} className="space-y-4 pt-1">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
              <li>Open your authenticator app and add an account.</li>
              <li>Scan this code (or tap the button on your phone).</li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            <div className="flex flex-col items-center gap-3">
              <QrCode text={setup.uri} />
              <a href={setup.uri} className="text-sm font-medium text-accent-fg hover:underline sm:hidden">
                Open in authenticator app
              </a>
              <details className="w-full text-center">
                <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">Can't scan? Enter this key instead</summary>
                <p className="mt-2 rounded-lg bg-zinc-100 px-3 py-2 font-mono text-sm tracking-wider break-all select-all dark:bg-zinc-800">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p>
              </details>
            </div>
            <input
              className={`${input} text-center font-mono text-xl tracking-[0.4em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="6-digit code"
            />
            <ErrorLine text={error} />
            <button className={`${primary} w-full`} disabled={code.length !== 6 || busy}>
              {busy && <Spinner />} Turn on
            </button>
          </form>
        </Sheet>
      )}

      {step === "codes" && codes && (
        <RecoveryCodes
          codes={codes}
          username={me.username}
          onDone={() => {
            setCodes(null);
            reset();
          }}
        />
      )}

      {action && (
        <Sheet title={action === "disable" ? "Turn off two-step verification?" : "Make new recovery codes"} onClose={() => (setAction(null), setPassword(""), setError(null))}>
          <form onSubmit={passwordAction} className="space-y-4 pt-1">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {action === "disable" ? "Your account will only be protected by your password." : "Your old recovery codes will stop working."} Enter your password to continue.
            </p>
            <input type="text" autoComplete="username" className="hidden" readOnly tabIndex={-1} aria-hidden="true" />
            <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" autoFocus />
            <ErrorLine text={error} />
            <button
              className={`${action === "disable" ? "flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50" : primary} w-full`}
              disabled={!password || busy}
            >
              {busy && <Spinner />} {action === "disable" ? "Turn off" : "Make new codes"}
            </button>
          </form>
        </Sheet>
      )}
    </section>
  );
}

function RecoveryCodes({ codes, username, onDone }: { codes: string[]; username: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Relay recovery codes for @${username}\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  const download = useMemo(() => URL.createObjectURL(new Blob([text], { type: "text/plain" })), [text]);
  useEffect(() => () => URL.revokeObjectURL(download), [download]);
  return (
    <Sheet
      title="Save your recovery codes"
      onClose={() => saved && onDone()}
      footer={
        <button className={`${primary} w-full`} disabled={!saved} onClick={onDone}>
          Done
        </button>
      }
    >
      <div className="space-y-4 pt-1">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          If you lose your phone, these let you sign in. <strong>Each works once and they won't be shown again.</strong> Store them in a password manager or print them.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-4 font-mono text-sm select-all dark:bg-zinc-800">
          {codes.map((c) => (
            <li key={c} className="text-center tracking-wider">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            className={`${secondary} flex flex-1 items-center justify-center gap-2`}
            onClick={() =>
              navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setSaved(true);
              })
            }
          >
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />} {copied ? "Copied" : "Copy"}
          </button>
          <a href={download} download={`relay-recovery-codes-${username}.txt`} onClick={() => setSaved(true)} className={`${secondary} flex flex-1 items-center justify-center gap-2`}>
            <DownloadIcon className="size-4" /> Download
          </a>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          I've saved my recovery codes
        </label>
      </div>
    </Sheet>
  );
}

/** A QR code drawn as SVG squares (no HTML injection, works offline). */
function QrCode({ text }: { text: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const out: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) out.push(`M${c} ${r}h1v1h-1z`);
    return { n, d: out.join("") };
  }, [text]);
  return (
    <svg viewBox={`-3 -3 ${cells.n + 6} ${cells.n + 6}`} className="size-48 rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200" role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges">
      <path d={cells.d} fill="#000" />
    </svg>
  );
}

// ---------- Devices ----------

function DevicesSection({
  security,
  setSecurity,
  error,
}: {
  security: SecurityOverview | null;
  setSecurity: (s: SecurityOverview) => void;
  error: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  async function run(id: string, fn: () => Promise<{ security: SecurityOverview }>) {
    setBusy(id);
    setProblem(null);
    try {
      setSecurity((await fn()).security);
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const others = security?.sessions.filter((s) => !s.current) ?? [];
  return (
    <section className="space-y-3">
      <Title title="Devices" hint="Everywhere you're signed in. Sign out any device you don't recognise, then change your password." />
      <ErrorLine text={error ?? problem} />
      {!security ? (
        !error && (
          <div className="flex justify-center py-6 text-zinc-400">
            <Spinner className="size-5" />
          </div>
        )
      ) : (
        <>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:divide-zinc-800 dark:ring-zinc-800">
            {security.sessions.map((s) => (
              <DeviceRow key={s.id} session={s} busy={busy === s.id} onRevoke={() => run(s.id, () => api.account.revokeSession(s.id))} />
            ))}
          </ul>
          {others.length > 0 && (
            <button onClick={() => setConfirmAll(true)} disabled={busy !== null} className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-600/25 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:ring-red-400/25 dark:hover:bg-red-950/40">
              {busy === "all" ? <Spinner className="mx-auto" /> : `Sign out all other devices (${others.length})`}
            </button>
          )}
          <label className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 ring-zinc-200 dark:ring-zinc-800">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Automatically sign out unused devices</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">Devices that haven't opened Relay for this long are signed out.</span>
            </span>
            <select
              value={security.sessionIdleDays}
              disabled={busy !== null}
              onChange={(e) => run("idle", () => api.account.setSessionIdle(Number(e.target.value)))}
              className="shrink-0 rounded-lg bg-zinc-100 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800"
            >
              {SESSION_IDLE_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d === 7 ? "1 week" : d === 30 ? "1 month" : d === 90 ? "3 months" : d === 180 ? "6 months" : "1 year"}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {confirmAll && (
        <ConfirmDialog
          title="Sign out all other devices?"
          message="Every device except this one will be signed out right away. You can sign back in with your password."
          confirmLabel="Sign out others"
          danger
          onConfirm={() => run("all", () => api.account.revokeOtherSessions())}
          onClose={() => setConfirmAll(false)}
        />
      )}
    </section>
  );
}

function DeviceRow({ session: s, busy, onRevoke }: { session: SessionInfo; busy: boolean; onRevoke: () => void }) {
  const phone = /iPhone|Android|iPad/.test(s.device);
  return (
    <li className="flex items-center gap-3 bg-white px-4 py-3 dark:bg-zinc-900">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${s.current ? "bg-accent/15 text-accent-fg" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
        {phone ? <SmartphoneIcon className="size-5" /> : <LaptopIcon className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{s.device}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {s.location} · {s.current ? <span className="font-medium text-accent-fg">This device</span> : `Active ${formatRelative(s.lastActiveAt)}`}
        </p>
      </div>
      {!s.current && (
        <button onClick={onRevoke} disabled={busy} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40">
          {busy ? <Spinner className="size-3.5" /> : "Sign out"}
        </button>
      )}
    </li>
  );
}

// ---------- Passcode lock ----------

function PasscodeSection({ me }: { me: Me }) {
  const [current, setCurrent] = useState(() => passcodeFor(me.id));
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [minutes, setMinutes] = useState<number>(current?.autoLockMinutes ?? 5);
  const [busy, setBusy] = useState(false);

  const mismatch = confirmPin.length >= 4 && pin !== confirmPin;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (pin.length < 4 || pin !== confirmPin) return;
    setBusy(true);
    await setPasscode(me.id, pin, minutes);
    setBusy(false);
    setCurrent(passcodeFor(me.id));
    setEditing(false);
    setPin("");
    setConfirmPin("");
  }

  return (
    <section className="rounded-2xl p-4 ring-1 ring-zinc-200 dark:ring-zinc-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Title
          icon={<LockIcon />}
          title="Passcode lock"
          hint="Lock Relay on this device with a PIN, so nobody can read your chats if they pick up your phone or computer. Only stored on this device."
        />
        {current ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button className={secondary} onClick={() => window.dispatchEvent(new Event(LOCK_EVENT))}>
              Lock now
            </button>
            <button className={secondary} onClick={() => setEditing(true)}>
              Change
            </button>
            <button
              className={`${secondary} text-red-600 dark:text-red-400`}
              onClick={() => {
                clearPasscode();
                setCurrent(null);
              }}
            >
              Turn off
            </button>
          </div>
        ) : (
          <button className={`${primary} shrink-0`} onClick={() => setEditing(true)}>
            Set a passcode
          </button>
        )}
      </div>
      {current && (
        <label className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span>Auto-lock</span>
          <select
            value={current.autoLockMinutes}
            onChange={(e) => {
              setAutoLock(Number(e.target.value));
              setCurrent(passcodeFor(me.id));
            }}
            className="rounded-lg bg-zinc-100 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40 dark:bg-zinc-800"
          >
            {AUTO_LOCK_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {editing && (
        <Sheet title={current ? "Change passcode" : "Set a passcode"} onClose={() => (setEditing(false), setPin(""), setConfirmPin(""))}>
          <form onSubmit={save} className="space-y-4 pt-1">
            <div className="flex justify-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent-fg">
                <KeyIcon className="size-6" />
              </span>
            </div>
            <input
              className={`${input} text-center font-mono text-xl tracking-[0.4em]`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="New PIN"
              aria-label="New PIN, 4 to 8 digits"
              autoFocus
            />
            <input
              className={`${input} text-center font-mono text-xl tracking-[0.4em]`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="Repeat PIN"
              aria-label="Repeat the PIN"
              aria-invalid={mismatch}
            />
            <p className={`text-center text-xs ${mismatch ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
              {mismatch ? "The PINs don't match." : "4 to 8 digits. If you forget it, sign out and back in to reset it."}
            </p>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Auto-lock</span>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="rounded-lg bg-zinc-100 px-2 py-1.5 text-sm outline-none dark:bg-zinc-800">
                {AUTO_LOCK_OPTIONS.map((o) => (
                  <option key={o.minutes} value={o.minutes}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button className={`${primary} w-full`} disabled={pin.length < 4 || pin !== confirmPin || busy}>
              {busy && <Spinner />} Save passcode
            </button>
          </form>
        </Sheet>
      )}
    </section>
  );
}
