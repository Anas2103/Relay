import { useCallback, useEffect, useState } from "react";
import type { Me } from "../shared/types";
import { AuthScreen } from "./components/AuthScreen";
import { ChatLayout } from "./components/ChatLayout";
import { LockScreen } from "./components/LockScreen";
import { Logo } from "./components/ui";
import { api, UNAUTHORIZED_EVENT } from "./lib/api";
import { wipeAllKeys } from "./lib/e2e";
import { clearAllDrafts } from "./lib/drafts";
import { clearPasscode, LOCK_EVENT, passcodeFor } from "./lib/passcode";
import { disablePush, registerServiceWorker } from "./lib/pwa";
import { applyAppearance } from "./lib/theme";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);

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

  if (!me) return <AuthScreen onAuthed={updateMe} />;

  return (
    <>
      {/* While locked, the app keeps running underneath (calls, messages) but can't be seen or used. */}
      <div className={`h-full ${locked ? "invisible" : ""}`} inert={locked} aria-hidden={locked || undefined}>
        <ChatLayout me={me} onMeUpdated={updateMe} onLogout={logout} />
      </div>
      {locked && <LockScreen onUnlock={() => setLocked(false)} onForgot={logout} />}
    </>
  );
}
