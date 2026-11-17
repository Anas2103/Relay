// Relay service worker: makes the app installable, shows push notifications while
// the app is closed, and opens Relay when one is tapped.
//
// Privacy: pushes carry NO message content (the push service only learns "something
// happened"), so the notification is generic. This worker only caches the app's own
// code (HTML, scripts, styles, icons) so Relay opens without a connection — never
// anything from /api. (The optional offline copy of chats lives in IndexedDB, is
// wiped on sign-out and can be turned off in Privacy & security.)

const SHELL = "relay-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      // If Relay is open and visible, the app already shows its own alert.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.some((w) => w.visibilityState === "visible")) return;
      await self.registration.showNotification("Relay", {
        body: "You have a new message",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "relay:new-message",
        renotify: true,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })(),
  );
});

// The app shell: pages are network-first (always the newest version when online),
// hashed /assets/ files are cache-first (their names change with every build).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/version.json" || url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    // Static pages (legal, help) are separate documents: cache each under its own URL,
    // never as the app shell, or Relay would open as the Terms page when offline.
    const page = url.pathname.startsWith("/legal/");
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(SHELL)).put(page ? url.pathname : "/", res.clone());
          return res;
        } catch {
          return (await caches.match(page ? url.pathname : "/")) ?? (await caches.match("/")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await putAsset(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Icons, manifest, theme script (files at the root): use the network, fall back to the last copy.
  if (url.pathname.lastIndexOf("/") !== 0) return;
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) ?? Response.error();
      }
    })(),
  );
});

/** Old builds' files pile up over time; keep the newest ~200 (oldest are dropped first). */
async function putAsset(req, res) {
  const cache = await caches.open(SHELL);
  await cache.put(req, res);
  const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname.startsWith("/assets/"));
  for (const old of keys.slice(0, Math.max(0, keys.length - 200))) await cache.delete(old);
}
