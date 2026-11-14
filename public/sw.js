// Relay service worker: makes the app installable, shows push notifications while
// the app is closed, and opens Relay when one is tapped.
//
// Privacy: pushes carry NO message content (the push service only learns "something
// happened"), so the notification is generic. Nothing is cached here: chats always
// come fresh from the server, and nothing private is left on disk by this worker.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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

// A fetch handler is part of what makes browsers offer "Install". Pass everything through.
self.addEventListener("fetch", () => {});
