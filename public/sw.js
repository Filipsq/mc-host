// Service worker of the installed app (see src/components/AppInstall.tsx).
// Pages always come from the network, since the panel shows live servers;
// without a connection the app shows /offline.html instead of the browser's
// error. It also shows the notifications sent by src/lib/push.ts.
const CACHE = "mchosting-v1";
const OFFLINE = "/offline.html";
const SAVED = [OFFLINE, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SAVED)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
  } else if (SAVED.includes(new URL(event.request.url).pathname)) {
    // The offline page's own picture.
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "MCHosting", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: data.url || "/dashboard" },
      // A newer notice about the same page replaces the older one.
      tag: data.url || "mchosting",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then((w) => w.navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
