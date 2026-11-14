import { useEffect, useState } from "react";
import { checkPasscode, lockoutRemaining } from "../lib/passcode";
import { BackIcon, LockIcon, Spinner } from "./ui";

const MAX = 8;

/** Full-screen passcode prompt. Typing works with the keypad or a keyboard. */
export function LockScreen({ onUnlock, onForgot }: { onUnlock: () => void; onForgot: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [wait, setWait] = useState(lockoutRemaining());
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(lockoutRemaining()), 500);
    return () => clearInterval(t);
  }, [wait]);

  async function submit(value = pin) {
    if (value.length < 4 || busy || lockoutRemaining() > 0) return;
    setBusy(true);
    const ok = await checkPasscode(value);
    setBusy(false);
    if (ok) return onUnlock();
    setPin("");
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setWait(lockoutRemaining());
  }

  function press(d: string) {
    if (busy || wait > 0) return;
    setPin((p) => (p.length < MAX ? p + d : p));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const seconds = Math.ceil(wait / 1000);

  return (
    <div className="fade-in fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white px-6 pt-[env(safe-area-inset-top)] pb-[max(1.5rem,env(safe-area-inset-bottom))] dark:bg-zinc-950" role="dialog" aria-modal="true" aria-label="Relay is locked">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-sm">
        <LockIcon className="size-7" />
      </span>
      <h1 className="mt-4 text-xl font-semibold">Enter your passcode</h1>
      <p className="mt-1 h-5 text-sm text-zinc-500 dark:text-zinc-400">
        {wait > 0 ? `Too many tries. Wait ${seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`}.` : "Relay is locked on this device."}
      </p>

      <div className={`mt-6 flex h-4 items-center gap-3 ${shake ? "animate-[shake_0.35s]" : ""}`} aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={`size-3.5 rounded-full transition ${i < pin.length ? "scale-110 bg-accent" : "bg-zinc-200 dark:bg-zinc-700"}`} />
        ))}
      </div>

      <div className="mt-8 grid w-full max-w-[17rem] grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} label={d} onClick={() => press(d)} disabled={wait > 0} />
        ))}
        <button
          onClick={() => setPin((p) => p.slice(0, -1))}
          className="flex h-16 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 active:scale-95 dark:hover:bg-zinc-900"
          aria-label="Delete"
        >
          <BackIcon className="size-6" />
        </button>
        <Key label="0" onClick={() => press("0")} disabled={wait > 0} />
        <button
          onClick={() => void submit()}
          disabled={pin.length < 4 || busy || wait > 0}
          className="flex h-16 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-ink transition hover:opacity-90 active:scale-95 disabled:opacity-30"
        >
          {busy ? <Spinner /> : "OK"}
        </button>
      </div>

      {forgot ? (
        <div className="mt-8 max-w-xs rounded-2xl bg-zinc-100 p-4 text-center text-sm dark:bg-zinc-900">
          <p>The passcode only lives on this device. To reset it, sign out and sign back in with your password.</p>
          <div className="mt-3 flex justify-center gap-2">
            <button onClick={() => setForgot(false)} className="rounded-lg px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button onClick={onForgot} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-500">
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setForgot(true)} className="mt-8 rounded-lg px-3 py-1.5 text-sm font-medium text-accent-fg hover:underline">
          Forgot passcode?
        </button>
      )}
    </div>
  );
}

function Key({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-16 items-center justify-center rounded-full bg-zinc-100 text-2xl font-medium tabular-nums transition hover:bg-zinc-200 active:scale-95 disabled:opacity-40 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      {label}
    </button>
  );
}
