import { api, ApiError } from "./api";

/*
 * Installable app (PWA) + push notifications.
 * The service worker (public/sw.js) shows notifications when the app is closed and
 * opens the right chat when one is tapped. Pushes carry no message content.
 */

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  registration ??= (async () => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
    try {
      return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    } catch {
      return null;
    }
  })();
  return registration;
}

function urlBase64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export type PushStatus = "unsupported" | "unconfigured" | "denied" | "off" | "on";

export async function pushStatus(): Promise<PushStatus> {
  if (!("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const reg = await registerServiceWorker();
  if (!reg) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await reg.pushManager.getSubscription();
  if (sub) return "on";
  const { key } = await api.pushKey().catch(() => ({ key: null }));
  return key ? "off" : "unconfigured";
}

export async function enablePush(): Promise<PushStatus> {
  const reg = await registerServiceWorker();
  if (!reg || !("PushManager" in window)) return "unsupported";
  const { key } = await api.pushKey();
  if (!key) return "unconfigured";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) });
  try {
    await api.pushSubscribe(sub.toJSON());
  } catch (err) {
    await sub.unsubscribe().catch(() => {});
    throw err instanceof ApiError ? err : new Error("Couldn't turn on push notifications.");
  }
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

// ---------- "Install app" ----------

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredInstall: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  listeners.forEach((l) => l());
});

export function canInstall(): boolean {
  return deferredInstall !== null;
}

export function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function install(): Promise<boolean> {
  if (!deferredInstall) return false;
  await deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  listeners.forEach((l) => l());
  return outcome === "accepted";
}
