import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { Me } from "../shared/types";
import { ChatLayout } from "./components/ChatLayout";
import { LockScreen } from "./components/LockScreen";
import { Logo } from "./components/ui";
import { api, UNAUTHORIZED_EVENT } from "./lib/api";
import { wipeAllKeys } from "./lib/e2e";
import { clearAllDrafts } from "./lib/drafts";
import { clearOffline } from "./lib/offline";
import { clearPasscode, LOCK_EVENT, passcodeFor } from "./lib/passcode";
import { disablePush, registerServiceWorker } from "./lib/pwa";
import { applyAppearance } from "./lib/theme";
import { useUpdateAvailable } from "./lib/update";

// Signed-in people (almost everyone, almost always) never download the sign-in screen.
const AuthScreen = lazy(() => import("./components/AuthScreen").then((m) => ({ default: m.AuthScreen })));
const ConsentScreen = lazy(() => import("./components/ConsentScreen").then((m) => ({ default: m.ConsentScreen })));

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const updateAvailable = useUpdateAvailable();

  const updateMe = useCallback((next: Me) => {
    setMe(next);
    applyAppearance(next.settings, true);
  }, []);

  useEffect(() => {
    void registerServiceWorker();
    api
      .me()
      .then((r) => {
        setMe(r.user);
        applyAppearance(r.user.settings);
        // Opening Relay with a passcode set always starts locked.
        setLocked(!!passcodeFor(r.user.id));
      })
      .catch(() => setMe(null))
      .finally(() => setLoading(false));

    const onUnauthorized = () => setMe(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  // Auto-lock after being away (tab hidden, or no input while open) for the chosen time.
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    let hiddenAt = 0;
    let lastInput = Date.now();
    const limit = () => {
      const pc = passcodeFor(meId);
      return pc && pc.autoLockMinutes > 0 ? pc.autoLockMinutes * 60_000 : null;
    };
    const onVisibility = () => {
      const ms = limit();
      if (document.hidden) hiddenAt = Date.now();
      else if (ms && hiddenAt && Date.now() - hiddenAt >= ms) setLocked(true);
    };
    const onInput = () => (lastInput = Date.now());
    const onLock = () => passcodeFor(meId) && setLocked(true);
    const timer = window.setInterval(() => {
      const ms = limit();
      if (ms && !document.hidden && Date.now() - lastInput >= ms) setLocked(true);
    }, 15_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("keydown", onInput);
    window.addEventListener(LOCK_EVENT, onLock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener(LOCK_EVENT, onLock);
    };
  }, [meId]);

  const logout = useCallback(async () => {
    // Like Telegram: signing out removes this device's secret-chat keys, passcode and push subscription.
    await disablePush().catch(() => {});
    await wipeAllKeys();
    clearPasscode();
    clearAllDrafts();
    await clearOffline();
    await api.logout().catch(() => {});
    setLocked(false);
    setMe(null);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse">
          <Logo size={48} />
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Logo size={48} />
          </div>
        }
      >
        <AuthScreen onAuthed={updateMe} />
      </Suspense>
    );
  }

  if (me.needsConsent) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Logo size={48} />
          </div>
        }
      >
        <ConsentScreen me={me} onDone={updateMe} onLogout={logout} />
      </Suspense>
    );
  }

  return (
    <>
      {/* While locked, the app keeps running underneath (calls, messages) but can't be seen or used. */}
      <div className={`h-full ${locked ? "invisible" : ""}`} inert={locked} aria-hidden={locked || undefined}>
        <ChatLayout me={me} onMeUpdated={updateMe} onLogout={logout} />
      </div>
      {locked && <LockScreen onUnlock={() => setLocked(false)} onForgot={logout} />}
      {updateAvailable && !locked && <UpdateBanner />}
    </>
  );
}

/** A new version was deployed while this tab stayed open. */
function UpdateBanner() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div
      role="status"
      className="pop-in fixed inset-x-0 z-[60] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-zinc-900 py-1.5 pr-1.5 pl-4 text-sm text-white shadow-2xl ring-1 ring-white/10 dark:bg-zinc-100 dark:text-zinc-900"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <span className="min-w-0 truncate">✨ Relay was updated</span>
      <button onClick={() => location.reload()} className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink hover:opacity-90">
        Reload
      </button>
      <button onClick={() => setHidden(true)} aria-label="Later" className="shrink-0 rounded-full px-2 py-1 text-xs opacity-70 hover:opacity-100">
        Later
      </button>
    </div>
  );
}
