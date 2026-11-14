import { useEffect, useState } from "react";
import { calls } from "./calls";

declare const __BUILD_ID__: string;

const CHECK_EVERY_MS = 10 * 60_000;

/**
 * Notices when a new version of Relay was deployed while this tab (or the
 * installed app) stayed open, so nobody is stuck on an old version for days.
 *
 * - Shows "Relay was updated" with a Reload button.
 * - Reloads by itself when nobody is looking (tab hidden) and no call is on.
 *   Drafts are kept in this browser, so nothing typed is lost.
 */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return; // no version.json in dev
    let stopped = false;
    let pending = false;

    const check = async () => {
      if (stopped || pending) return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (build && build !== __BUILD_ID__) {
          pending = true;
          setAvailable(true);
        }
      } catch {
        // offline — try later
      }
    };

    const idle = () => calls.getState().phase === "idle";
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
      // Out of sight and not on a call: quietly switch to the new version.
      else if (pending && idle()) location.reload();
    };

    void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", check);
    };
  }, []);

  return available;
}
